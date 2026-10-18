// Node-globals shim MUST run before anything from "telegram" is evaluated
// (see node-globals-shim.ts for why: GramJS assumes an ambient Buffer/process
// the way Webpack's ProvidePlugin would supply them, which Vite does not).
import "./node-globals-shim";

import bigInt from "big-integer";
import { Buffer } from "buffer";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage";

import { chatKey, hasChatChanged, isCurrentGeneration, messageBelongsToChat, messageBelongsToTopic } from "./chat-key";
import { mapWithConcurrency } from "./concurrency";
import { applyCredentialUpdate, type TelegramCredentials } from "./credentials-state";
import { decodeDataUrl, extensionForMimeType } from "./dataurl";
import {
  directionFromText,
  telegramErrorCode,
} from "./direction-message";
import { DirectionDispatcher } from "./direction-dispatcher";
import { PhraseDispatcher, phraseFromText } from "./phrase-dispatcher";
import { toChatRefs, type DialogLike } from "./dialogs";
import { mergeChatRefs, remoteChatRefs, type SearchResultLike } from "./remote-dialogs";
import { mapLoginError } from "./errors";
import {
  buildDataUrl,
  detectMedia,
  downloadedMediaAllowed,
  exceedsMediaCap,
  fallbackMediaText,
  mediaDownloadAllowed,
} from "./media";
import { PushedMediaCache } from "./media-cache";
import { extractDimensions } from "./media-extract";
import { HISTORY_LIMIT, mapMessageToOverlay, resolveAuthorName, type SenderLike } from "./messages";
import { buildInputPeer } from "./peer";
import { PreviewCache } from "./preview-cache";
import { ReconnectLoop, type ReconnectOutcome } from "./reconnect-loop";
import { reconnectFailureOutcome } from "./reconnect-outcome";
import { SingleFlight } from "./single-flight";
import { mergePreview } from "./sticker-load";
import {
  buildStickerPack,
  orderRecentStickers,
  stickerPreviewRequest,
  type StickerWithPreview,
} from "./stickers";
import { stickerRequestResult } from "./sticker-request-result";
import { sendErrorMessage, type SendKind, type SendResult } from "./send-result";
import { unavailableSendResult } from "./send-availability";
import { safeInvoke, safeListen } from "./tauri";
import type {
  ChatRef,
  DirectionEvent,
  PhraseEvent,
  LoginStep,
  MediaKind,
  OverlayMessage,
  SendFileEvent,
  SendStickerEvent,
  SendTextEvent,
  StickerPack,
  StickerLoadUpdate,
  TgLoginEvent,
  TgStatus,
  WorkerConfig,
} from "./types";
import { resolveLanguage, setLocale, t } from "../i18n";

const HEALTH_CHECK_INTERVAL_MS = 5000;
const HISTORY_BACKFILL_INTERVAL_MS = 15_000;
const HISTORY_ERROR_LOG_INTERVAL_MS = 60_000;
/** Media kept for history re-pushes (see PushedMediaCache); the history is ~20 messages. */
const PUSHED_MEDIA_CACHE_BYTES = 32 * 1024 * 1024;

// Sticker picker tuning (CONTRACT.md's tg:stickers_request/tg_stickers): the
// contract wants full StickerPack[] in one answer, so there is no way to
// answer with pack metadata first and stream contents in later - these caps
// are the actual lazy-loading lever. Kept conservative on purpose: a user
// with many packs can still hit a FLOOD_WAIT if raised much further, since
// worst case is MAX_STICKER_PACKS * MAX_STICKERS_PER_PACK thumb downloads
// on the very first request (subsequent ones are instant - see
// stickerPacksCache). A guess - tighten/loosen if the picker feels wrong,
// or if the first answer is too slow for heavy sticker users.
const MAX_STICKER_PACKS = 20;
const MAX_STICKERS_PER_PACK = 30;
const STICKER_PACK_CONCURRENCY = 3;
const STICKER_DOWNLOAD_CONCURRENCY = 5;
const MAX_STICKER_PREVIEW_BYTES = 512 * 1024;
const RECENT_STICKERS_PACK_ID = "recent";
const RECENT_STICKERS_PACK_TITLE = "Недавние";
const FAVORITE_STICKERS_PACK_ID = "favorites";
const FAVORITE_STICKERS_PACK_TITLE = "Избранные";

interface LoginWaiter {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

/** Thrown to unwind a login attempt cleanly (logout or phone resubmit mid-flow). */
const LOGIN_CANCELLED_MESSAGE = "AUTH_USER_CANCEL";

function isCancelledLoginError(err: unknown): boolean {
  return err instanceof Error && err.message === LOGIN_CANCELLED_MESSAGE;
}

/**
 * Owns the single GramJS TelegramClient for the whole app. Rust is the only
 * bus between this hidden worker and the other two windows (CONTRACT.md) -
 * everything here is wired through invoke()/listen(), never a direct call
 * into src/main or src/overlay.
 */
export class TelegramWorker {
  private client: TelegramClient | null = null;
  private apiId = 0;
  private apiHash = "";
  private chat: ChatRef | null = null;
  private chatGeneration = 0;
  /** False while the relay transport is selected: no connection, no status, no events. */
  private active = true;
  private readonly reconnectLoop = new ReconnectLoop({
    runAttempt: () => this.reconnectNow(),
    onWaiting: ({ attempt, waitSeconds }) => {
      void this.reportStatus({ state: "reconnecting", reconnectAttempt: attempt, waitSeconds });
    },
    onConnected: () => {
      void this.finishReconnect();
    },
    onReauthRequired: () => {
      void this.requireReauthentication();
    },
  });
  private loginInProgress = false;
  private loginCancelled = false;
  private loginPromise: Promise<void> | null = null;
  private loginWaiters = new Map<LoginStep, LoginWaiter>();
  private messageHandlerAttached = false;
  /** Documents for stickers this worker has already mirrored, keyed by id - see onSendSticker. */
  private stickerCache = new Map<string, Api.Document>();
  /** Answered instantly on a second tg:stickers_request - see onStickersRequest. */
  private stickerPacksCache: StickerPack[] | null = null;
  /** Prevents concurrent picker opens from duplicating Telegram sticker requests. */
  private readonly stickerLoad = new SingleFlight<void>();
  /** Invalidates pending picker loads when the Telegram account changes. */
  private stickerLoadEpoch = 0;
  private readonly previewCache = new PreviewCache();
  private readonly directionDispatcher = new DirectionDispatcher();
  private readonly phraseDispatcher = new PhraseDispatcher();
  private readonly phraseMessageIds = new Set<string>();
  /** Own display name, cached once per connection - lets outgoing messages skip getSender() entirely. */
  private selfName: string | null = null;
  private selfId: string | null = null;
  /**
   * Message ids already pushed to the overlay, with the edit date they were
   * pushed at. sendMessage/sendFile push their own result immediately (its
   * `out`/id/peer are already known - no need to wait for an update), and if
   * Telegram *also* redelivers it as a NewMessage update (observed behavior
   * for multi-device sync, but not guaranteed by the GramJS APIs we call),
   * this dedupes it. History backfills skip what the overlay already shows
   * unless it was edited since. Cleared only when the overlay feed starts
   * empty (page reload, chat or account change). Bounded so it cannot grow
   * forever over a long session.
   */
  private pushedIds = new Map<string, number>();
  private readonly pushedMedia = new PushedMediaCache(PUSHED_MEDIA_CACHE_BYTES);
  private healthCheckTimer: number | null = null;
  private historyBackfillTimer: number | null = null;
  private lastHistoryErrorAt = 0;

  async start(): Promise<void> {
    const keys = await safeInvoke<{ apiId: number; apiHash: string }>("tg_api_keys");
    this.apiId = keys.apiId;
    this.apiHash = keys.apiHash;

    await this.loadConfig();

    const whenActive = <T,>(handler: (payload: T) => unknown) => (payload: T) => {
      if (this.active) void handler(payload);
    };

    await Promise.all([
      safeListen<TgLoginEvent>("tg:login", whenActive((evt) => this.onLoginEvent(evt))),
      safeListen<Record<string, never>>("tg:history_request", whenActive(() => {
        // The overlay page (re)started with an empty feed: everything is new
        // to it, now or after the next connect. Media comes from pushedMedia.
        this.pushedIds.clear();
        if (this.client?.connected) void this.pushHistory(this.chatGeneration);
      })),
      safeListen<WorkerConfig>("config:changed", (config) => {
        setLocale(resolveLanguage(config.language, typeof navigator === "undefined" ? [] : navigator.languages ?? []));
        void this.applyTransport(config.transport);
        if (!this.active) return;
        const nextChat = config.chat ?? null;
        const chatChanged = hasChatChanged(this.chat, nextChat);
        this.chat = nextChat;
        if (chatChanged) {
          const generation = ++this.chatGeneration;
          this.pushedIds.clear();
          this.pushedMedia.clear();
          void safeInvoke("reset_overlay_feed").then(() => {
            if (nextChat && this.client && isCurrentGeneration(generation, this.chatGeneration)) {
              return this.pushHistory(generation);
            }
          });
        }
      }),
      safeListen<TelegramCredentials>("tg:api_keys_changed", (credentials) => {
        const updated = applyCredentialUpdate(
          { apiId: this.apiId, apiHash: this.apiHash },
          credentials,
        );
        this.apiId = updated.apiId;
        this.apiHash = updated.apiHash;
        // Keys saved after a start without them: pick the saved session up now.
        if (this.active && !this.client && !this.loginInProgress && this.hasApiKeys()) void this.connectSavedSession();
      }),
      safeListen("tg:reconnect_now", whenActive(() => this.reconnectLoop.retryNow())),
      safeListen<{ query: string | null }>("tg:dialogs_request", whenActive((req) => this.onDialogsRequest(req.query))),
      safeListen<SendTextEvent>("tg:send", whenActive((evt) => this.onSend(evt))),
      safeListen<DirectionEvent>("tg:direction", whenActive((evt) => this.onDirection(evt))),
      safeListen<PhraseEvent>("tg:phrase", whenActive((evt) => this.onPhrase(evt))),
      safeListen<SendStickerEvent>("tg:send_sticker", whenActive((evt) => this.onSendSticker(evt))),
      safeListen<{ refresh?: boolean }>("tg:stickers_request", whenActive((evt) => this.onStickersRequest(evt.refresh === true))),
      safeListen<SendFileEvent>("tg:send_file", whenActive((evt) => this.onSendFile(evt))),
    ]);

    await safeInvoke("tg_worker_ready");

    if (this.active) await this.connectSavedSession();

    this.startHealthCheck();
    window.addEventListener("beforeunload", () => this.stopForShutdown(), { once: true });
  }

  private async loadConfig(): Promise<void> {
    const config = await safeInvoke<WorkerConfig>("get_config");
    this.chat = config.chat ?? null;
    this.chatGeneration = 1;
    this.active = config.transport !== "relay";
    setLocale(resolveLanguage(config.language, typeof navigator === "undefined" ? [] : navigator.languages ?? []));
  }

  private hasApiKeys(): boolean {
    return this.apiId > 0 && this.apiHash.length > 0;
  }

  private async connectSavedSession(): Promise<void> {
    // Without keys every connect fails as "unauthorized" and would wipe a
    // perfectly good session; wait until the user saves their api_id / api_hash.
    if (!this.hasApiKeys()) {
      await this.reportStatus({ state: "offline" });
      return;
    }
    const session = await safeInvoke<string | null>("tg_session");
    if (session) {
      await this.connectWithSession(session);
    } else {
      await this.reportStatus({ state: "offline" });
    }
  }

  /** Switching transports: go fully idle for the relay, reconnect when Telegram is selected again. */
  private async applyTransport(transport: WorkerConfig["transport"]): Promise<void> {
    const active = transport !== "relay";
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      if (this.loginInProgress) await this.cancelLoginInProgress();
      this.reconnectLoop.stop();
      const client = this.client;
      this.client = null;
      this.clearAccountCaches();
      if (client) await client.disconnect().catch(() => {});
      return;
    }
    this.chatGeneration += 1;
    await this.connectSavedSession();
  }

  private async reportStatus(status: TgStatus): Promise<void> {
    if (!this.active) return;
    console.log("[telegram] status", status);
    await safeInvoke("tg_status", { status });
  }

  private newClient(session: string): TelegramClient {
    return new TelegramClient(new StringSession(session), this.apiId, this.apiHash, {
      connectionRetries: Infinity,
    });
  }

  // ---------------------------------------------------------------------
  // Step 1: lifecycle - connect with a saved session, or go offline.
  // ---------------------------------------------------------------------

  private async connectWithSession(session: string): Promise<void> {
    this.reconnectLoop.reset();
    await this.reportStatus({ state: "connecting" });
    const client = this.newClient(session);
    this.client = client;
    // A transport switch can replace or drop the client while connect() is
    // still retrying; a stale attempt must never judge (and wipe) the session.
    const abandoned = (): boolean => {
      if (this.client === client && this.active) return false;
      void client.disconnect().catch(() => {});
      return true;
    };
    try {
      await client.connect();
      if (abandoned()) return;
      await this.verifyAuthorization(client);
      if (abandoned()) return;
      await this.markConnected(client);
    } catch (err) {
      if (abandoned()) return;
      console.error("[telegram] connect with saved session failed", err);
      if (telegramErrorCode(err) === "API_ID_INVALID") {
        // The keys are wrong, not the session: keep it, stop retrying and
        // wait for tg:api_keys_changed (it reconnects once there is no client).
        this.client = null;
        void client.disconnect().catch(() => {});
        await this.reportStatus({ state: "error", error: "Telegram не принял api_id или api_hash. Проверьте свои ключи Telegram" });
        return;
      }
      const outcome = reconnectFailureOutcome(err);
      if (outcome.kind === "reauth_required") {
        await this.requireReauthentication(client);
      } else {
        this.reconnectLoop.schedule(outcome.floodWaitSeconds);
      }
    }
  }

  /**
   * Throws unless the session is authorized. GramJS's checkAuthorization()
   * swallows every error and answers false, so a wrong api_hash, a
   * FLOOD_WAIT or a timeout would look like a revoked session and the saved
   * one would be wiped; the raw call lets the caller classify the error
   * with reconnectFailureOutcome (only session authorization codes clear it).
   */
  private async verifyAuthorization(client: TelegramClient): Promise<void> {
    await client.invoke(new Api.updates.GetState());
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = window.setInterval(() => {
      void this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    this.historyBackfillTimer = window.setInterval(() => {
      if (!this.active || !this.client?.connected || !this.chat) return;
      void this.pushHistory(this.chatGeneration, true);
    }, HISTORY_BACKFILL_INTERVAL_MS);
  }

  private async checkHealth(): Promise<void> {
    if (!this.active) return;
    if (this.loginInProgress) return; // let the login flow own the status line
    if (!this.client) return; // never logged in - nothing to watch
    if (this.client.connected) return;
    this.reconnectLoop.schedule();
  }

  private async reconnectNow(): Promise<ReconnectOutcome> {
    const client = this.client;
    if (!client) return { kind: "reauth_required" };
    try {
      await client.connect();
      await this.verifyAuthorization(client);
      return client.connected ? { kind: "connected" } : { kind: "retry" };
    } catch (err) {
      console.error("[telegram] reconnect attempt failed", err);
      return reconnectFailureOutcome(err);
    }
  }

  private async finishReconnect(): Promise<void> {
    const client = this.client;
    if (!client || !client.connected) return;
    await this.markConnected(client);
  }

  private async markConnected(client: TelegramClient): Promise<void> {
    if (this.client !== client || !client.connected) return;
    this.reconnectLoop.reset();
    await this.cacheSelfName(client);
    await this.restorePhraseMessageId();
    this.attachMessageHandler();
    await this.reportStatus({ state: "connected" });
    // The live subscription does not replay a disconnected gap, so history
    // remains the authoritative backfill after every successful reconnect.
    // The overlay still shows what it had: only new or edited messages go.
    await this.pushHistory(this.chatGeneration);
  }

  private clearAccountCaches(): void {
    this.selfId = null;
    this.selfName = null;
    this.messageHandlerAttached = false;
    this.stickerCache.clear();
    this.stickerPacksCache = null;
    this.stickerLoadEpoch += 1;
    this.stickerLoad.reset();
    this.pushedIds.clear();
    this.pushedMedia.clear();
    this.phraseMessageIds.clear();
  }

  private async restorePhraseMessageId(): Promise<void> {
    if (!this.selfId || !this.chat) return;
    const messageId = await safeInvoke<number | null>("get_phrase_message_id", {
      accountId: this.selfId,
      chatKey: chatKey(this.chat),
    });
    if (messageId !== null) this.phraseMessageIds.add(String(messageId));
  }

  /** `expected` names the client the verdict is about; a replaced client keeps the session. */
  private async requireReauthentication(expected: TelegramClient | null = this.client): Promise<void> {
    if (!this.active || this.client !== expected) return;
    this.reconnectLoop.stop();
    const client = this.client;
    this.client = null;
    this.clearAccountCaches();
    try {
      await safeInvoke("tg_clear_session");
    } catch (err) {
      console.error("[telegram] failed to clear an invalid session", err);
    }
    try {
      await client?.disconnect();
    } catch (err) {
      console.error("[telegram] disconnect after invalid session failed", err);
    }
    await this.reportStatus({ state: "reauth_required" });
  }

  private stopForShutdown(): void {
    this.reconnectLoop.stop();
    if (this.healthCheckTimer !== null) window.clearInterval(this.healthCheckTimer);
    if (this.historyBackfillTimer !== null) window.clearInterval(this.historyBackfillTimer);
    this.healthCheckTimer = null;
    this.historyBackfillTimer = null;
    const client = this.client;
    this.client = null;
    if (client) void client.disconnect().catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Step 2: login, driven by tg:login events from the settings window.
  // ---------------------------------------------------------------------

  private async onLoginEvent(evt: TgLoginEvent): Promise<void> {
    if (evt.step === "logout") {
      await this.logout();
      return;
    }
    if (evt.step === "phone") {
      if (this.loginInProgress) {
        // A second "phone" step while one is already running: either the
        // user resubmitted (RESTART_AUTH-style flow) or the settings window
        // just retried. Cancel the stuck attempt cleanly, then start fresh -
        // never leave the old one dangling forever on an unresolved waiter.
        await this.cancelLoginInProgress();
      }
      await this.beginLogin(evt.value ?? "");
      return;
    }
    this.settleLoginStep(evt.step, evt.value ?? "");
  }

  private waitForLoginStep(step: LoginStep): Promise<string> {
    return new Promise((resolve, reject) => {
      this.loginWaiters.set(step, { resolve, reject });
    });
  }

  private settleLoginStep(step: LoginStep, value: string): void {
    const waiter = this.loginWaiters.get(step);
    if (waiter) {
      this.loginWaiters.delete(step);
      waiter.resolve(value);
    }
  }

  /** Rejects any step the current login attempt is waiting on (code/password). */
  private cancelPendingLoginWaiters(): void {
    for (const waiter of this.loginWaiters.values()) {
      waiter.reject(new Error(LOGIN_CANCELLED_MESSAGE));
    }
    this.loginWaiters.clear();
  }

  /**
   * Unwinds an in-progress client.start() call cleanly: rejecting the
   * pending waiter makes the stuck phoneCode/password callback reject,
   * GramJS's auth loop then calls onError again, and onError (seeing
   * loginCancelled) tells it to stop via the one real cancel path GramJS
   * exposes - returning true, which makes client.start() throw
   * AUTH_USER_CANCEL. We wait for that unwind before starting a new attempt
   * so the two never share state.
   */
  private async cancelLoginInProgress(): Promise<void> {
    this.loginCancelled = true;
    this.cancelPendingLoginWaiters();
    await this.loginPromise?.catch(() => {});
    this.loginCancelled = false;
  }

  private async beginLogin(phone: string): Promise<void> {
    if (!this.hasApiKeys()) {
      await this.reportStatus({ state: "error", error: "Сначала сохраните свои api_id и api_hash в разделе «Свои ключи Telegram»" });
      return;
    }
    this.reconnectLoop.stop();
    const previousClient = this.client;
    this.client = null;
    this.clearAccountCaches();
    if (previousClient) {
      try {
        await previousClient.disconnect();
      } catch (err) {
        console.error("[telegram] disconnect before a new login failed", err);
      }
    }
    this.reconnectLoop.reset();
    const promise = this.runLogin(phone);
    this.loginPromise = promise;
    try {
      await promise;
    } finally {
      if (this.loginPromise === promise) this.loginPromise = null;
    }
  }

  private async runLogin(phone: string): Promise<void> {
    this.loginInProgress = true;
    let client: TelegramClient | null = null;
    try {
      await this.reportStatus({ state: "connecting" });
      client = this.newClient("");
      await client.connect();

      await client.start({
        phoneNumber: async () => phone,
        phoneCode: async () => {
          await this.reportStatus({ state: "code", phone });
          return this.waitForLoginStep("code");
        },
        password: async () => {
          await this.reportStatus({ state: "password", phone });
          return this.waitForLoginStep("password");
        },
        onError: async (err) => {
          if (this.loginCancelled) return true; // stop the retry loop, cleanly
          await this.reportStatus(mapLoginError(err));
          return false; // never stop otherwise: the user can just resubmit the step
        },
      });

      this.client = client;
      const session = client.session.save() as unknown as string;
      await safeInvoke("tg_save_session", { session });
      await this.markConnected(client);
    } catch (err) {
      if (isCancelledLoginError(err)) {
        // Our own cancellation (logout or phone resubmit) - the caller
        // reports whatever status follows; do not surface a scary error.
        try {
          await client?.disconnect();
        } catch (disconnectErr) {
          console.error("[telegram] disconnect after a cancelled login failed", disconnectErr);
        }
      } else {
        console.error("[telegram] login failed", err);
        await this.reportStatus(mapLoginError(err));
      }
    } finally {
      this.loginInProgress = false;
    }
  }

  private async logout(): Promise<void> {
    this.reconnectLoop.stop();
    if (this.loginInProgress) {
      await this.cancelLoginInProgress();
    }
    const client = this.client;
    this.client = null;
    this.clearAccountCaches();
    if (client) {
      try {
        await client.invoke(new Api.auth.LogOut());
      } catch (err) {
        console.error("[telegram] auth.LogOut failed (continuing)", err);
      }
      try {
        await client.disconnect();
      } catch (err) {
        console.error("[telegram] disconnect after logout failed", err);
      }
    }
    // tg_logout already cleared the stored session secret before emitting
    // tg:login{step:"logout"} - we only report the resulting state here.
    await this.reportStatus({ state: "offline" });
  }

  // ---------------------------------------------------------------------
  // Step 3: chat list.
  // ---------------------------------------------------------------------

  private async onDialogsRequest(query: string | null): Promise<void> {
    if (!this.client?.connected) {
      await safeInvoke("tg_dialogs", { dialogs: [], error: "Telegram ещё не подключён", query });
      return;
    }
    try {
      const dialogs = await this.client.getDialogs({ limit: 200 });
      const local = toChatRefs(dialogs as unknown as DialogLike[], query);
      let remote: ChatRef[] = [];
      const needle = query?.trim();
      if (needle) {
        try {
          const result = await this.client.invoke(new Api.contacts.Search({ q: needle, limit: 50 }));
          remote = remoteChatRefs(result as unknown as SearchResultLike);
        } catch (error) {
          console.error("[telegram] remote dialog search failed", error);
        }
      }
      await safeInvoke("tg_dialogs", { dialogs: mergeChatRefs(remote, local), query });
    } catch (err) {
      console.error("[telegram] getDialogs failed", err);
      await safeInvoke("tg_dialogs", { dialogs: [], error: dialogLoadError(err), query });
    }
  }

  // ---------------------------------------------------------------------
  // Step 4: message stream for the mirrored chat.
  // ---------------------------------------------------------------------

  private attachMessageHandler(): void {
    if (!this.client || this.messageHandlerAttached) return;
    this.client.addEventHandler((event: NewMessageEvent) => {
      void this.onNewMessage(event);
    }, new NewMessage({}));
    this.client.addEventHandler((event: EditedMessageEvent) => {
      void this.onEditedMessage(event);
    }, new EditedMessage({}));
    this.messageHandlerAttached = true;
  }

  private isMirroredChat(message: Api.Message): boolean {
    const chat = this.chat;
    if (!chat) return false;
    if (messageBelongsToChat(chat, message.peerId as { className?: string; userId?: { toString(): string }; chatId?: { toString(): string }; channelId?: { toString(): string } } | undefined)) {
      return true;
    }
    return chat.kind === "user" && message.chatId?.toString() === chat.id;
  }

  private isMirroredTopic(message: Api.Message): boolean {
    const replyTo = message.replyTo as { replyToTopId?: number; replyToMsgId?: number } | undefined;
    return messageBelongsToTopic(this.chat?.topicId, replyTo, message.id);
  }

  /** `background` is the periodic backfill, whose repeated failures are logged at most once a minute. */
  private async pushHistory(generation = this.chatGeneration, background = false): Promise<void> {
    if (!this.client || !this.chat) return;
    const chat = this.chat;
    try {
      const peer = buildInputPeer(chat);
      const messages = await this.client.getMessages(peer, {
        limit: HISTORY_LIMIT,
        ...(chat.topicId == null ? {} : { replyTo: chat.topicId }),
      });
      if (!isCurrentGeneration(generation, this.chatGeneration)) return;
      // Newest-first from Telegram; the feed reads oldest-to-newest.
      const ordered = [...messages].reverse();
      for (const message of ordered) {
        if (!isCurrentGeneration(generation, this.chatGeneration)) return;
        if (!messageBelongsToTopic(chat.topicId, message.replyTo as { replyToTopId?: number; replyToMsgId?: number } | undefined, message.id)) continue;
        await this.pushMessage(message, generation, "history");
      }
      this.lastHistoryErrorAt = 0;
    } catch (err) {
      const now = Date.now();
      if (!background || now - this.lastHistoryErrorAt >= HISTORY_ERROR_LOG_INTERVAL_MS) {
        console.error("[telegram] failed to load history for the mirrored chat", err);
        this.lastHistoryErrorAt = now;
      }
    }
  }

  private async onNewMessage(event: NewMessageEvent): Promise<void> {
    const message = event.message;
    if (!this.isMirroredChat(message) || !this.isMirroredTopic(message)) return;
    const generation = this.chatGeneration;
    if (this.phraseMessageIds.has(String(message.id))) {
      await this.pushPhraseMessage(message, generation);
      return;
    }
    await this.pushMessage(message, generation);
  }

  private async onEditedMessage(event: EditedMessageEvent): Promise<void> {
    const message = event.message;
    if (!this.isMirroredChat(message) || !this.isMirroredTopic(message)) return;
    if (this.phraseMessageIds.has(String(message.id))) {
      await this.pushPhraseMessage(message, this.chatGeneration);
      return;
    }
    const direction = directionFromText(message.message ?? "");
    if (direction) {
      await this.pushDirection(message, direction, this.chatGeneration, Date.now());
      return;
    }

    // Re-emit an ordinary edit with the original id. The overlay feed treats
    // it as an in-place update instead of creating a second chat line.
    await this.pushMessage(message, this.chatGeneration, "edit");
  }

  private static readonly MAX_TRACKED_IDS = 500;

  /** True if this message id was already pushed at this edit date (see pushedIds' doc comment). */
  private markPushed(id: string, editStamp: number): boolean {
    if (this.pushedIds.get(id) === editStamp) return true;
    this.pushedIds.delete(id);
    this.pushedIds.set(id, editStamp);
    if (this.pushedIds.size > TelegramWorker.MAX_TRACKED_IDS) {
      const oldest = this.pushedIds.keys().next().value;
      if (oldest !== undefined) this.pushedIds.delete(oldest);
    }
    return false;
  }

  /**
   * `source` says where the message comes from: a live update or our own
   * send ("live"), a live edit ("edit"), or a history load or backfill.
   */
  private async pushMessage(
    message: Api.Message,
    generation = this.chatGeneration,
    source: "live" | "edit" | "history" = "live",
  ): Promise<void> {
    if (!isCurrentGeneration(generation, this.chatGeneration)) return;
    // Direction and phrase messages are signals, never feed lines, and only
    // a live update means someone just sent one: from history (and the 15 s
    // backfill) the same old arrow or phrase would pop up again and again.
    if (this.phraseMessageIds.has(String(message.id))) {
      if (source !== "history") await this.pushPhraseMessage(message, generation);
      return;
    }
    const observedAt = Date.now();
    const direction = directionFromText(message.message ?? "");
    if (direction) {
      if (source !== "history") await this.pushDirection(message, direction, generation, observedAt);
      return;
    }
    const alreadyPushed = this.markPushed(String(message.id), message.editDate ?? 0);
    if (alreadyPushed && source !== "edit") return;

    const author = await this.resolveAuthor(message);
    if (!isCurrentGeneration(generation, this.chatGeneration)) return;
    const media = detectMedia(message);
    const rawText = message.message ?? "";
    const overlay = mapMessageToOverlay(
      { id: message.id, message: rawText, date: message.date, out: message.out },
      author,
    );

    if (!media) {
      await safeInvoke("push_message", { message: overlay });
      return;
    }

    this.cacheStickerDocument(media.kind, message);

    const fileKey = mediaFileKey(message);
    const pushedMedia = fileKey ? this.pushedMedia.get(overlay.id, fileKey) : undefined;
    if (pushedMedia) {
      await safeInvoke("push_message", {
        message: { ...overlay, text: rawText || fallbackMediaText(media.kind), media: pushedMedia },
      });
      return;
    }

    // Placeholder first (caption if any, else the media word), never block on
    // the download - see CONTRACT.md step 5.
    await safeInvoke("push_message", {
      message: { ...overlay, text: rawText || fallbackMediaText(media.kind) },
    });

    if (!mediaDownloadAllowed(media.kind, documentSize(message))) {
      return; // stays as a text-only placeholder, no point downloading
    }

    void this.attachMediaLater(message, overlay, rawText, media, generation, fileKey);
  }

  private async pushDirection(
    message: Api.Message,
    direction: "up" | "down" | "left" | "right",
    generation = this.chatGeneration,
    observedAt = Date.now(),
  ): Promise<void> {
    if (!isCurrentGeneration(generation, this.chatGeneration)) return;
    const author = await this.resolveAuthor(message);
    if (!isCurrentGeneration(generation, this.chatGeneration)) return;
    await safeInvoke("tg_direction", {
      payload: {
        messageId: String(message.id),
        author,
        direction,
        at: observedAt,
        outgoing: message.out === true,
      },
    });
  }

  private async pushPhraseMessage(message: Api.Message, generation = this.chatGeneration): Promise<void> {
    if (!isCurrentGeneration(generation, this.chatGeneration)) return;
    const author = await this.resolveAuthor(message);
    if (!isCurrentGeneration(generation, this.chatGeneration)) return;
    await safeInvoke("tg_phrase", {
      payload: {
        messageId: String(message.id),
        author,
        phrase: phraseFromText(message.message ?? ""),
        at: Date.now(),
        outgoing: message.out === true,
      },
    });
  }

  private cacheStickerDocument(kind: MediaKind, message: Api.Message): void {
    if (kind === "photo") return;
    const doc = message.document;
    if (doc && doc.className === "Document") {
      this.stickerCache.set(doc.id.toString(), doc);
    }
  }

  private async attachMediaLater(
    message: Api.Message,
    overlay: OverlayMessage,
    rawText: string,
    media: { kind: MediaKind; mimeType: string },
    generation: number,
    fileKey: string | undefined,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const bytes = await this.client.downloadMedia(message);
      if (!isCurrentGeneration(generation, this.chatGeneration)) return;
      if (!bytes) return;
      const buffer = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
      if (!downloadedMediaAllowed(media.kind, buffer.length)) return; // keep the placeholder text

      const { width, height } = extractDimensions(message, media.kind);
      const dataUrl = buildDataUrl(new Uint8Array(buffer), media.mimeType);
      const mediaRef = { ...media, dataUrl, width, height };
      if (fileKey) this.pushedMedia.set(overlay.id, fileKey, mediaRef);
      await safeInvoke("push_message", {
        message: {
          ...overlay,
          text: rawText || fallbackMediaText(media.kind),
          media: mediaRef,
        },
      });
    } catch (err) {
      console.error("[telegram] media download failed, keeping the text placeholder", err);
    }
  }

  private async cacheSelfName(client: TelegramClient): Promise<void> {
    try {
      const me = await client.getMe();
      this.selfId = (me as { id?: { toString(): string } }).id?.toString() ?? null;
      this.selfName = resolveAuthorName(me as unknown as SenderLike, t("Я"));
    } catch (err) {
      console.error("[telegram] getMe() failed, outgoing messages will fall back to getSender()", err);
      this.selfName = null;
      this.selfId = null;
    }
  }

  private async resolveAuthor(message: Api.Message): Promise<string> {
    // Our own messages: skip getSender() entirely (message.sender is often
    // unset on the Api.Message returned directly by sendMessage/sendFile,
    // since it isn't backed by an update's bundled entities - the fallback
    // path below would risk the entity-cache trap for no reason).
    if (message.out && this.selfName) return this.selfName;

    if (message.sender) {
      return resolveAuthorName(message.sender as unknown as SenderLike);
    }
    try {
      const sender = await message.getSender();
      return resolveAuthorName(sender as unknown as SenderLike);
    } catch (err) {
      console.error("[telegram] could not resolve the sender name", err);
      return "?";
    }
  }

  // ---------------------------------------------------------------------
  // Step 6: sending.
  // ---------------------------------------------------------------------

  private async reportSendResult(result: SendResult): Promise<void> {
    await safeInvoke("tg_send_result", { result });
  }

  private async reportSendFailure(requestId: string, kind: SendKind, error: unknown): Promise<void> {
    await this.reportSendResult({ requestId, kind, ok: false, error: sendErrorMessage(error) });
  }

  private async reportUnavailableSend(requestId: string, kind: SendKind): Promise<boolean> {
    const result = unavailableSendResult(requestId, kind, {
      clientConnected: this.client?.connected === true,
      chatSelected: this.chat !== null,
      reconnecting: this.reconnectLoop.isRecovering,
    });
    if (!result) return false;
    await this.reportSendResult(result);
    return true;
  }

  private async onDirection(evt: DirectionEvent): Promise<void> {
    if (await this.reportUnavailableSend(evt.requestId, "direction")) return;
    const client = this.client;
    const chat = this.chat;
    const generation = this.chatGeneration;
    if (!client || !chat) return;
    if (!this.selfId) await this.cacheSelfName(client);
    const accountId = this.selfId;
    const selectedChatKey = chatKey(chat);
    if (!accountId || !selectedChatKey) {
      await this.reportSendFailure(evt.requestId, "direction", new Error("Не удалось определить Telegram-аккаунт"));
      return;
    }

    try {
      const peer = buildInputPeer(chat);
      const sent = await this.directionDispatcher.dispatch(evt.direction, {
        getMessageId: async () => {
          if (!isCurrentGeneration(generation, this.chatGeneration) || this.client !== client) {
            throw new Error("Чат был изменён до отправки указателя");
          }
          const messageId = await safeInvoke<number | null>("get_direction_message_id", {
            accountId,
            chatKey: selectedChatKey,
          });
          return messageId ?? undefined;
        },
        setMessageId: async (messageId) => {
          await safeInvoke("set_direction_message_id", {
            accountId,
            chatKey: selectedChatKey,
            messageId,
          });
        },
        edit: (id, emoji) => client.editMessage(peer, { message: id, text: emoji }),
        send: (emoji) => client.sendMessage(peer, {
          message: emoji,
          ...(chat.topicId == null
            ? {}
            : { replyTo: chat.topicId, topMsgId: chat.topicId }),
        }),
        errorCode: telegramErrorCode,
      });
      await this.reportSendResult({
        requestId: evt.requestId,
        kind: "direction",
        ok: true,
        messageId: String(sent.messageId),
      });
    } catch (err) {
      console.error("[telegram] direction update failed", err);
      await this.reportSendFailure(evt.requestId, "direction", err);
    }
  }

  private async onPhrase(evt: PhraseEvent): Promise<void> {
    if (await this.reportUnavailableSend(evt.requestId, "phrase")) return;
    const client = this.client;
    const chat = this.chat;
    const generation = this.chatGeneration;
    if (!client || !chat) return;
    if (!this.selfId) await this.cacheSelfName(client);
    const accountId = this.selfId;
    const selectedChatKey = chatKey(chat);
    if (!accountId || !selectedChatKey) {
      await this.reportSendFailure(evt.requestId, "phrase", new Error("Не удалось определить Telegram-аккаунт"));
      return;
    }
    try {
      const peer = buildInputPeer(chat);
      const sent = await this.phraseDispatcher.dispatch(evt.phrase, {
        getMessageId: async () => {
          if (!isCurrentGeneration(generation, this.chatGeneration) || this.client !== client) {
            throw new Error("Чат был изменён до отправки фразы");
          }
          const messageId = await safeInvoke<number | null>("get_phrase_message_id", { accountId, chatKey: selectedChatKey });
          return messageId ?? undefined;
        },
        setMessageId: async (messageId) => {
          this.phraseMessageIds.add(String(messageId));
          await safeInvoke("set_phrase_message_id", { accountId, chatKey: selectedChatKey, messageId });
        },
        edit: (id, text) => client.editMessage(peer, { message: id, text }),
        send: (text) => client.sendMessage(peer, {
          message: text,
          ...(chat.topicId == null ? {} : { replyTo: chat.topicId, topMsgId: chat.topicId }),
        }),
        errorCode: telegramErrorCode,
      });
      await safeInvoke("tg_phrase", {
        payload: { messageId: String(sent.messageId), author: this.selfName ?? t("Я"), phrase: evt.phrase, at: evt.at, outgoing: true },
      });
      await this.reportSendResult({ requestId: evt.requestId, kind: "phrase", ok: true, messageId: String(sent.messageId) });
    } catch (err) {
      console.error("[telegram] phrase update failed", err);
      await this.reportSendFailure(evt.requestId, "phrase", err);
    }
  }

  private async onSend(evt: SendTextEvent): Promise<void> {
    if (await this.reportUnavailableSend(evt.requestId, "text")) return;
    if (!this.client || !this.chat) return;
    try {
      const peer = buildInputPeer(this.chat);
      const sent = await this.client.sendMessage(peer, {
        message: evt.text,
        ...(this.chat.topicId == null
          ? {}
          : { replyTo: this.chat.topicId, topMsgId: this.chat.topicId }),
      });
      // Push our own result straight away rather than waiting on Telegram to
      // redeliver it as a NewMessage update: sendMessage's RPC response is
      // not itself routed through GramJS's update dispatcher (verified: no
      // _handleUpdate call in client/messages.js), and whether the server
      // separately pushes updateNewMessage back to the sending session isn't
      // something to bet the demo on. pushMessage's id-based dedup (see
      // pushedIds) drops it harmlessly if that update does also arrive.
      await this.pushMessage(sent);
      await this.reportSendResult({
        requestId: evt.requestId,
        kind: "text",
        ok: true,
        messageId: String(sent.id),
      });
    } catch (err) {
      console.error("[telegram] sendMessage failed", err);
      await this.reportSendFailure(evt.requestId, "text", err);
    }
  }

  private async onSendSticker(evt: SendStickerEvent): Promise<void> {
    if (await this.reportUnavailableSend(evt.requestId, "sticker")) return;
    if (!this.client || !this.chat) return;
    const document = this.stickerCache.get(evt.fileId);
    if (!document) {
      console.error(`[telegram] send_sticker: no cached document for fileId ${evt.fileId}`);
      await this.reportSendFailure(evt.requestId, "sticker", new Error("Стикер ещё не готов к отправке"));
      return;
    }
    try {
      const peer = buildInputPeer(this.chat);
      const sent = await this.client.sendFile(peer, {
        file: document,
        ...(this.chat.topicId == null
          ? {}
          : { replyTo: this.chat.topicId, topMsgId: this.chat.topicId }),
      });
      await this.pushMessage(sent);
      await this.reportSendResult({
        requestId: evt.requestId,
        kind: "sticker",
        ok: true,
        messageId: String(sent.id),
      });
    } catch (err) {
      console.error("[telegram] sendFile (sticker) failed", err);
      await this.reportSendFailure(evt.requestId, "sticker", err);
    }
  }

  // ---------------------------------------------------------------------
  // Sticker picker: tg:stickers_request / tg_stickers.
  // ---------------------------------------------------------------------

  private async publishStickerUpdate(update: StickerLoadUpdate): Promise<void> {
    await safeInvoke("tg_stickers", { payload: update });
  }

  private async onStickersRequest(refresh = false): Promise<void> {
    const client = this.client;
    const loadEpoch = this.stickerLoadEpoch;
    if (!client?.connected) {
      await safeInvoke("tg_stickers", {
        payload: { ...stickerRequestResult("disconnected"), phase: "complete" },
      });
      return;
    }
    if (this.stickerPacksCache && !refresh) {
      await this.publishStickerUpdate({ packs: this.stickerPacksCache, phase: "complete" });
      return;
    }
    if (!refresh) {
      if (!this.selfId) await this.cacheSelfName(client);
      if (this.selfId) {
        try {
          const cached = await this.previewCache.getPacks(this.selfId);
          if (cached) await this.publishStickerUpdate({ packs: cached, phase: "previews" });
        } catch (err) {
          console.error("[telegram] sticker pack cache unavailable", err);
        }
      }
    }
    try {
      await this.stickerLoad.run(async () => {
        const packs = await this.fetchStickerPacks(client);
        if (!this.isCurrentStickerLoad(client, loadEpoch)) return;
        await this.publishStickerUpdate({ packs, phase: "metadata" });
        const hydrated = await this.hydrateStickerPreviews(client, packs);
        if (!this.isCurrentStickerLoad(client, loadEpoch)) return;
        this.stickerPacksCache = hydrated;
        if (this.selfId) await this.previewCache.putPacks(this.selfId, hydrated);
        await this.publishStickerUpdate({ packs: hydrated, phase: "complete" });
      });
    } catch (err) {
      console.error("[telegram] failed to load sticker packs", err);
      await safeInvoke("tg_stickers", {
        payload: { ...stickerRequestResult("failed"), phase: "complete" },
      });
    }
  }

  private isCurrentStickerLoad(client: TelegramClient, loadEpoch: number): boolean {
    return this.client === client && this.stickerLoadEpoch === loadEpoch;
  }

  private async fetchStickerPacks(client: TelegramClient): Promise<StickerPack[]> {
    const packs: StickerPack[] = [];

    const [recentPack, favoritePack, installedSets] = await Promise.all([
      this.fetchSpecialStickerPack(
        RECENT_STICKERS_PACK_ID,
        RECENT_STICKERS_PACK_TITLE,
        () => this.fetchRecentStickerDocuments(client),
      ),
      this.fetchSpecialStickerPack(
        FAVORITE_STICKERS_PACK_ID,
        FAVORITE_STICKERS_PACK_TITLE,
        () => this.fetchFavoriteStickerDocuments(client),
      ),
      this.fetchInstalledStickerSets(client).catch((err) => {
        console.error("[telegram] failed to load installed sticker packs", err);
        return [];
      }),
    ]);

    if (recentPack) {
      packs.push(recentPack);
    }
    if (favoritePack) {
      packs.push(favoritePack);
    }

    const installedPacks = await mapWithConcurrency(installedSets.slice(0, MAX_STICKER_PACKS), STICKER_PACK_CONCURRENCY, async (set) => {
      try {
        const documents = (await this.fetchStickerSetDocuments(client, set)).slice(0, MAX_STICKERS_PER_PACK);
        return this.buildPackMetadata(set.id.toString(), set.title, documents);
      } catch (err) {
        console.error(`[telegram] failed to load the sticker pack "${set.title}"`, err);
        return null;
      }
    });

    for (const pack of installedPacks) {
      if (pack) packs.push(pack);
    }

    return packs;
  }

  private async fetchSpecialStickerPack(
    id: string,
    title: string,
    fetchDocuments: () => Promise<Api.Document[]>,
  ): Promise<StickerPack | null> {
    try {
      const documents = await fetchDocuments();
      if (documents.length === 0) return null;
      const pack = this.buildPackMetadata(id, title, documents);
      return pack.stickers.length > 0 ? pack : null;
    } catch (err) {
      console.error(`[telegram] failed to load ${title.toLowerCase()} stickers`, err);
      return null;
    }
  }

  private async fetchRecentStickerDocuments(client: TelegramClient): Promise<Api.Document[]> {
    const result = await client.invoke(new Api.messages.GetRecentStickers({ hash: bigInt(0) }));
    if (result.className !== "messages.RecentStickers") return [];
    const documents = result.stickers.filter((doc): doc is Api.Document => doc.className === "Document");
    return orderRecentStickers(documents, result.dates).slice(0, MAX_STICKERS_PER_PACK);
  }

  private async fetchFavoriteStickerDocuments(client: TelegramClient): Promise<Api.Document[]> {
    const result = await client.invoke(new Api.messages.GetFavedStickers({ hash: bigInt(0) }));
    if (result.className !== "messages.FavedStickers") return [];
    return result.stickers
      .filter((doc): doc is Api.Document => doc.className === "Document")
      .slice(0, MAX_STICKERS_PER_PACK);
  }

  private async fetchInstalledStickerSets(client: TelegramClient): Promise<Api.StickerSet[]> {
    const result = await client.invoke(new Api.messages.GetAllStickers({ hash: bigInt(0) }));
    if (result.className !== "messages.AllStickers") return [];
    return result.sets.filter((set): set is Api.StickerSet => set.className === "StickerSet");
  }

  private async fetchStickerSetDocuments(
    client: TelegramClient,
    set: Api.StickerSet,
  ): Promise<Api.Document[]> {
    const inputSet = new Api.InputStickerSetID({ id: set.id, accessHash: set.accessHash });
    const result = await client.invoke(new Api.messages.GetStickerSet({ stickerset: inputSet, hash: 0 }));
    if (result.className !== "messages.StickerSet") return [];
    return result.documents.filter((doc): doc is Api.Document => doc.className === "Document");
  }

  private buildPackMetadata(
    id: string,
    title: string,
    documents: Api.Document[],
  ): StickerPack {
    const entries: StickerWithPreview[] = documents.map((document) => {
      this.stickerCache.set(document.id.toString(), document);
      return {
        document: { id: document.id, mimeType: document.mimeType, alt: stickerAlt(document) },
      };
    });
    const pack = buildStickerPack(id, title, entries);
    return {
      ...pack,
      stickers: pack.stickers.map((sticker) => ({ ...sticker, documentReady: true })),
    };
  }

  private async hydrateStickerPreviews(client: TelegramClient, packs: StickerPack[]): Promise<StickerPack[]> {
    let hydrated = packs;
    const stickers = packs.flatMap((pack) => pack.stickers);
    const cached = await mapWithConcurrency(stickers, 12, async (sticker) => {
      try {
        return { fileId: sticker.fileId, entry: await this.previewCache.get(sticker.fileId) };
      } catch {
        return { fileId: sticker.fileId, entry: null };
      }
    });
    for (const item of cached) {
      if (item.entry) hydrated = mergePreview(hydrated, item.fileId, item.entry.dataUrl);
    }
    await this.publishStickerUpdate({ packs: hydrated, phase: "previews" });

    for (const pack of packs) {
      const missing = pack.stickers.filter((sticker) => !findSticker(hydrated, sticker.fileId)?.dataUrl);
      const downloaded = await mapWithConcurrency(missing, STICKER_DOWNLOAD_CONCURRENCY, async (sticker) => {
        const document = this.stickerCache.get(sticker.fileId);
        if (!document) return null;
        const dataUrl = await this.downloadStickerPreview(client, document);
        if (!dataUrl) return null;
        const now = Date.now();
        try {
          await this.previewCache.put({
            fileId: sticker.fileId,
            dataUrl,
            bytes: dataUrlByteLength(dataUrl),
            updatedAt: now,
            lastUsedAt: now,
          });
        } catch {
          // Preview caching is optional; the current session can still use the downloaded image.
        }
        return { fileId: sticker.fileId, dataUrl };
      });
      for (const item of downloaded) {
        if (item) hydrated = mergePreview(hydrated, item.fileId, item.dataUrl);
      }
      await this.publishStickerUpdate({ packs: hydrated, phase: "previews" });
    }
    try {
      await this.previewCache.prune();
    } catch {
      // A cache cleanup failure must not hide otherwise usable stickers.
    }
    return hydrated;
  }

  private async downloadStickerPreview(client: TelegramClient, document: Api.Document): Promise<string | null> {
    // A .tgs sticker's thumbs sometimes hold only a PhotoPathSize (an SVG
    // outline, not raster data). GramJS's getThumb() filters those out
    // before indexing by number, so if none remain thumb:0 silently falls
    // back to downloading the *full* document with an empty thumbSize
    // (verified in node_modules/telegram/client/downloads.js:
    // _downloadDocument/getThumb/pickFileSize). That full payload is not a
    // JPEG, so hard-coding "image/jpeg" below would mislabel it into a
    // broken image. When a compact animated sticker has no raster thumbnail,
    // the original payload is still displayable by the overlay as WebM or TGS.
    const request = stickerPreviewRequest(document.mimeType, hasRasterThumb(document));
    if (!request) return null;
    try {
      // downloadMedia's .d.ts only lists Message | TypeMessageMedia, but the
      // implementation explicitly handles a bare Api.Document too (verified
      // in node_modules/telegram/client/downloads.js) - the cast just works
      // around an incomplete type declaration, not an unsupported call.
      const bytes = await client.downloadMedia(
        document as unknown as Api.TypeMessageMedia,
        request.thumbnail ? { thumb: 0 } : {},
      );
      if (!bytes) return null;
      const buffer = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
      if (buffer.length > MAX_STICKER_PREVIEW_BYTES) return null;
      if (request.mimeType === "application/x-tgsticker" && !downloadedMediaAllowed("tgs", buffer.length)) return null;
      return buildDataUrl(new Uint8Array(buffer), request.mimeType);
    } catch (err) {
      console.error("[telegram] sticker preview download failed", err);
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Pasted images: tg:send_file.
  // ---------------------------------------------------------------------

  private async onSendFile(evt: SendFileEvent): Promise<void> {
    if (await this.reportUnavailableSend(evt.requestId, "file")) return;
    if (!this.client || !this.chat) return;
    try {
      const { bytes, mimeType } = decodeDataUrl(evt.dataUrl);
      if (exceedsMediaCap(bytes.byteLength)) {
        throw new Error("Файл больше 8 МиБ");
      }
      const buffer = Object.assign(Buffer.from(bytes), {
        name: `image.${extensionForMimeType(mimeType)}`,
      });
      const peer = buildInputPeer(this.chat);
      const sent = await this.client.sendFile(peer, {
        file: buffer,
        caption: evt.caption || undefined,
        ...(this.chat.topicId == null
          ? {}
          : { replyTo: this.chat.topicId, topMsgId: this.chat.topicId }),
      });
      await this.pushMessage(sent);
      await this.reportSendResult({
        requestId: evt.requestId,
        kind: "file",
        ok: true,
        messageId: String(sent.id),
      });
    } catch (err) {
      console.error("[telegram] send_file failed", err);
      await this.reportSendFailure(evt.requestId, "file", err);
    }
  }
}

function dialogLoadError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Telegram не ответил";
}

/** Identifies the file behind a message's media, so a cached download is never reused for a swapped file. */
function mediaFileKey(message: Api.Message): string | undefined {
  const photo = message.photo;
  if (photo && photo.className === "Photo") return `photo:${photo.id.toString()}`;
  const doc = message.document;
  if (doc && doc.className === "Document") return `document:${doc.id.toString()}`;
  return undefined;
}

function documentSize(message: Api.Message): number | undefined {
  const doc = message.document;
  if (!doc || doc.className !== "Document") return undefined;
  return Number(doc.size);
}

/** The emoji tied to a sticker document, read off its DocumentAttributeSticker. */
function stickerAlt(document: Api.Document): string | undefined {
  for (const attr of document.attributes) {
    if (attr.className === "DocumentAttributeSticker") return attr.alt || undefined;
  }
  return undefined;
}

/** True when at least one of the document's thumbs is raster data, not just a PhotoPathSize outline. */
function hasRasterThumb(document: Api.Document): boolean {
  return (document.thumbs ?? []).some((size) => size.className !== "PhotoPathSize");
}

function findSticker(packs: StickerPack[], fileId: string) {
  return packs.flatMap((pack) => pack.stickers).find((sticker) => sticker.fileId === fileId);
}

function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4);
}
