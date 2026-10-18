import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// The light player has no expression engine: animation JSON from a chat or a
// relay server must never be able to run code through Lottie expressions.
import type { AnimationItem } from "lottie-web/build/player/lottie_light";
import { type ChatMessage, Feed, type FeedMode } from "../core/feed";
import type { OverlayKind } from "../core/states";
import { type Zone, clampZone, defaultActiveZone } from "../core/zones";
import { findImageClipboardItem } from "./clipboard";
import { validateAttachment } from "./attachment";
import { type Point, formatZonePercent } from "./drag";
import { shouldDismissOnOutsideClick } from "./dismiss";
import { fadeDelayMs } from "./fade";
import { planMessageSync } from "./feed-diff";
import { messageAreaRect, resolveInputPlacement, stickerPanelHeight } from "./layout";
import { MarkupSession } from "./markup-session";
import { fitMediaBox, mediaElementKind, photoPreviewMaxSize, type MediaKind } from "./media";
import { mediaFailureLabel } from "./media-state";
import { MediaStore } from "./media-store";
import { playbackDeadline, remainingPlaybackMs } from "./sticker-playback";
import { isNearBottom } from "./scroll";
import { filterStickers, pushRecent, type StickerPack, withRecentPack } from "./stickers";
import { messageClassNames, messageContent } from "./message-presentation";
import { pickerEmptyMessage, pickerProgressMessage, type StickerPickerState } from "./sticker-picker-state";
import { DirectionSignalStore } from "./direction-signal";
import { phraseWheelItems, wheelOrigin } from "./phrase-wheel";
import type { SendKind, SendResult } from "../telegram/send-result";
import type { Direction } from "../telegram/direction-message";

const HISTORY_LIMIT = 300;
const MEDIA_MEMORY_LIMIT_BYTES = 24 * 1024 * 1024;
const RENDER_INTERVAL_MS = 250;

const DEFAULT_INACTIVE_ZONE: Zone = { x: 0.02, y: 0.62, width: 0.32, height: 0.33 };
const DEFAULT_ACTIVE_ZONE: Zone = defaultActiveZone(DEFAULT_INACTIVE_ZONE);
const DEFAULT_TEXT_COLOR = "#f2f2f2";
const DEFAULT_AUTHOR_COLOR = "#7fb2ff";
const DEFAULT_SHADOW = 0.85;
const DEFAULT_FADE_MS = 1200;
const DEFAULT_STICKER_ANIMATION_SECONDS = 10;
const DEFAULT_DIRECTION_DISPLAY_MS = 2500;
const MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Baseline input-field footprint (textarea + its own padding/border and the
// input zone's padding, at fontScale 1) used only to decide whether it fits
// below the message area (see layout.ts) - a one-line field grows taller
// with multi-line text, so this is a "does the common case fit" threshold,
// not a hard measurement.
const BASE_INPUT_HEIGHT_PX = 56;
const INPUT_GAP_PX = 8;

// Max box a piece of media reserves at fontScale 1 - stickers are meant to
// all read at roughly the same size, photos get a bit more room.
const BASE_STICKER_MAX_PX = 128;

const RECENT_STICKERS_MAX = 24;
const RECENT_STICKERS_STORAGE_KEY = "overlay:recentStickers";

interface MediaPayload {
  kind: MediaKind;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

/** What the backend actually sends - core/feed.ts's ChatMessage predates media. */
interface OverlayMessagePayload extends ChatMessage {
  media?: MediaPayload;
}

interface PendingAttachment {
  dataUrl: string;
  mimeType: string;
  name: string;
}

interface PendingSend {
  kind: SendKind;
  text?: string;
  stickerId?: string;
}

function loadRecentStickers(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STICKERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentStickers(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_STICKERS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private/disabled storage: recents just will not persist across reloads.
  }
}

/** tgs media is gzipped Lottie JSON packed into the data URL. */
async function inflateTgsAnimationData(dataUrl: string): Promise<unknown> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const { ungzip } = await import("pako");
  return JSON.parse(ungzip(bytes, { to: "string" }));
}

interface FeedSettings {
  inactiveZone: Zone;
  activeZone: Zone;
  ttlMs: number;
  opacity: number;
  fontScale: number;
  textColor: string;
  authorColor: string;
  shadow: number;
  fadeMs: number;
  stickerAnimationSeconds: number;
  messageLayout: "compact" | "dialogue";
  showAuthor: boolean;
  showMessageTime: boolean;
  incomingBubbleColor: string;
  outgoingBubbleColor: string;
  directionDisplayMs: number;
}

interface OverlayStatePayload {
  kind: OverlayKind;
  gameExe: string | null;
}

interface OverlayZonesPayload {
  inactive: Zone;
  active: Zone;
  ttlMs: number;
  opacity: number;
  fontScale: number;
  textColor: string;
  authorColor: string;
  shadow: number;
  fadeMs: number;
  stickerAnimationSeconds: number;
  messageLayout: "compact" | "dialogue";
  showAuthor: boolean;
  showMessageTime: boolean;
  incomingBubbleColor: string;
  outgoingBubbleColor: string;
  directionDisplayMs: number;
}

interface DirectionPayload {
  messageId: string;
  author: string;
  direction: Direction;
  at: number;
  outgoing: boolean;
}

interface DirectionPendingPayload {
  requestId: string;
  direction: Direction;
  at: number;
}

interface PhraseWheelPayload {
  active: boolean;
  phrases: string[];
  selectedIndex: number | null;
  originX: number | null;
  originY: number | null;
  cancelRadiusPx: number | null;
}

interface MarkupPayload {
  active: boolean;
}

/** Any element ever pushed through the feed, kept so settings changes can rebuild it. */
interface LogEntry {
  message: ChatMessage;
  mode: FeedMode;
}

/** A rendered message line plus the data it was built from, for incremental diffing. */
interface TrackedNode {
  el: HTMLElement;
  message: ChatMessage;
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`overlay: missing #${id}`);
  return found as T;
}

class OverlayApp {
  // The message area is one persistent element in both modes - it only
  // resizes (grows upward) - so lines already on screen never move and
  // never get torn down when the chat opens or closes.
  private readonly feedZoneEl = el<HTMLDivElement>("feed-zone");
  private readonly feedEl = el<HTMLDivElement>("feed");
  private readonly inputZoneEl = el<HTMLDivElement>("input-zone");
  private readonly inputEl = el<HTMLTextAreaElement>("input");
  private readonly markupEl = el<HTMLDivElement>("markup");
  private readonly markupInactiveRectEl = el<HTMLDivElement>("markup-rect-inactive");
  private readonly markupActiveRectEl = el<HTMLDivElement>("markup-rect-active");
  private readonly markupSizeEl = el<HTMLDivElement>("markup-size");
  private readonly markupHintEl = el<HTMLDivElement>("markup-hint");
  private readonly markupActionsEl = el<HTMLDivElement>("markup-actions");
  private readonly markupSaveEl = el<HTMLButtonElement>("markup-save");
  private readonly markupCustomizeEl = el<HTMLButtonElement>("markup-customize-active");
  private readonly markupCancelCustomizeEl = el<HTMLButtonElement>("markup-cancel-customize");
  private readonly pendingAttachmentEl = el<HTMLDivElement>("pending-attachment");
  private readonly pendingAttachmentPreviewEl = el<HTMLImageElement>("pending-attachment-preview");
  private readonly pendingAttachmentRemoveEl = el<HTMLButtonElement>("pending-attachment-remove");
  private readonly stickerToggleEl = el<HTMLButtonElement>("sticker-toggle");
  private readonly stickerPanelEl = el<HTMLDivElement>("sticker-panel");
  private readonly sendStatusEl = el<HTMLDivElement>("send-status");
  private readonly hotkeyWarningEl = el<HTMLDivElement>("hotkey-warning");
  private readonly attachmentToggleEl = el<HTMLButtonElement>("attachment-toggle");
  private readonly attachmentFileEl = el<HTMLInputElement>("attachment-file");
  private readonly directionLayerEl = el<HTMLDivElement>("direction-layer");
  private readonly directionSignalEl = el<HTMLDivElement>("direction-signal");
  private readonly directionAuthorEl = el<HTMLSpanElement>("direction-signal-author");
  private readonly directionArrowEl = this.directionSignalEl.querySelector<SVGElement>("svg")!;
  private readonly phraseSignalLayerEl = el<HTMLDivElement>("phrase-signal-layer");
  private readonly phraseSignalAuthorEl = el<HTMLSpanElement>("phrase-signal-author");
  private readonly phraseSignalTextEl = el<HTMLSpanElement>("phrase-signal-text");
  private readonly phraseWheelLayerEl = el<HTMLDivElement>("phrase-wheel-layer");
  private readonly phraseWheelLabelsEl = el<HTMLDivElement>("phrase-wheel-labels");
  private readonly mediaLightboxEl = el<HTMLDivElement>("media-lightbox");
  private readonly mediaLightboxCloseEl = el<HTMLButtonElement>("media-lightbox-close");
  private readonly mediaLightboxImageEl = el<HTMLImageElement>("media-lightbox-image");
  private lightboxReturnFocus: HTMLElement | null = null;

  private kind: OverlayKind = "off";
  private previousKind: OverlayKind = "off";
  private gameExe: string | null = null;

  private settings: FeedSettings = {
    inactiveZone: DEFAULT_INACTIVE_ZONE,
    activeZone: DEFAULT_ACTIVE_ZONE,
    ttlMs: 8000,
    opacity: 0.55,
    fontScale: 1,
    textColor: DEFAULT_TEXT_COLOR,
    authorColor: DEFAULT_AUTHOR_COLOR,
    shadow: DEFAULT_SHADOW,
    fadeMs: DEFAULT_FADE_MS,
    stickerAnimationSeconds: DEFAULT_STICKER_ANIMATION_SECONDS,
    messageLayout: "compact",
    showAuthor: true,
    showMessageTime: true,
    incomingBubbleColor: "#1c222c",
    outgoingBubbleColor: "#1e5d92",
    directionDisplayMs: DEFAULT_DIRECTION_DISPLAY_MS,
  };

  private feed = new Feed({ ttlMs: this.settings.ttlMs, historyLimit: HISTORY_LIMIT });
  private readonly log: LogEntry[] = [];

  // Keyed by message id so the message area can be updated incrementally
  // (insert new/revealed lines at their correct position, drop expired
  // ones) instead of rebuilt every tick - one pool shared by both modes.
  private readonly feedNodes = new Map<string, TrackedNode>();

  private stickToBottom = true;
  private markupSession: MarkupSession | null = null;
  private lastCursor: Point = { x: 0, y: 0 };

  // Media that arrived attached to a message, kept separately from Feed
  // (whose ChatMessage predates media) and keyed by message id so a later
  // "same id, media now attached" update can patch the existing node.
  private readonly mediaById = new MediaStore<MediaPayload>(MEDIA_MEMORY_LIMIT_BYTES);
  private readonly lottieByMessageId = new Map<string, AnimationItem>();
  private readonly pickerLotties = new Set<AnimationItem>();
  private readonly videosByMessageId = new Map<string, HTMLVideoElement>();
  private readonly stickerDeadlines = new Map<string, number | null>();
  private readonly stickerPauseTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
  private mediaPaused = false;

  private pendingAttachment: PendingAttachment | null = null;
  private readonly pendingSends = new Map<string, PendingSend>();
  private readonly directionSignals = new DirectionSignalStore();
  private directionHideTimer: ReturnType<typeof window.setTimeout> | null = null;
  private directionVersion = 0;
  private phraseHideTimer: ReturnType<typeof window.setTimeout> | null = null;
  private phraseWheelActive = false;
  private phraseWheelPhrases: string[] = [];
  private phraseWheelSelectedIndex: number | null = null;
  private phraseWheelCancelRadius = 42;
  private phraseWheelOrigin: { x: number; y: number } | null = null;

  private stickerPacks: StickerPack[] = [];
  private stickerPickerState: StickerPickerState = { status: "idle" };
  private stickerPacksRequested = false;
  private stickerPanelOpen = false;
  private recentStickerIds: string[] = loadRecentStickers();
  private selectedStickerPackId: string | null = null;
  private stickerSearchQuery = "";
  private stickerPickerRenderVersion = 0;

  start(): void {
    this.wireInput();
    this.wireFeedScroll();
    this.wireMarkupLayer();
    this.wireOutsideClick();
    this.wireStickerPanel();
    this.wirePendingAttachment();
    this.wireMediaLightbox();
    this.applyTheme();
    void this.wireTauri();
    window.setInterval(() => this.render(), RENDER_INTERVAL_MS);
    this.render();
  }

  // -- Tauri wiring, guarded so a plain-browser smoke test never crashes --

  private async wireTauri(): Promise<void> {
    if (!isTauri()) return;

    await this.safeListen<OverlayStatePayload>("overlay:state", (payload) => {
      this.kind = payload.kind;
      this.gameExe = payload.gameExe;
      this.positionDirectionSignal();
      this.render();
    });

    await this.safeListen<OverlayZonesPayload>("overlay:zones", (payload) => {
      this.settings = {
        inactiveZone: clampZone(payload.inactive),
        activeZone: clampZone(payload.active),
        ttlMs: payload.ttlMs,
        opacity: payload.opacity,
        fontScale: payload.fontScale,
        textColor: payload.textColor,
        authorColor: payload.authorColor,
        shadow: payload.shadow,
        fadeMs: payload.fadeMs,
        stickerAnimationSeconds: payload.stickerAnimationSeconds,
        messageLayout: payload.messageLayout,
        showAuthor: payload.showAuthor,
        showMessageTime: payload.showMessageTime,
        incomingBubbleColor: payload.incomingBubbleColor,
        outgoingBubbleColor: payload.outgoingBubbleColor,
        directionDisplayMs: payload.directionDisplayMs,
      };
      this.rebuildFeed();
      this.applyTheme();
      this.retimeFeedFades();
      this.refreshTimedStickerPlayback();
      this.positionDirectionSignal();
      this.render();
    });

    await this.safeListen<string | null>("overlay:chat_shortcut_error", (error) => {
      this.hotkeyWarningEl.textContent = error ?? "";
      this.hotkeyWarningEl.hidden = !error;
    });

    await this.safeListen<OverlayMessagePayload>("overlay:message", (payload) => {
      const mode: FeedMode = this.kind === "active" ? "active" : this.kind === "inactive" ? "inactive" : "hidden";
      // The worker can push the same id twice: once with just text, again
      // once the media has finished downloading. Patch the existing node in
      // place rather than waiting for the normal add/remove diff, which
      // would never notice (the id was already tracked either way).
      const alreadyTracked = this.feedNodes.has(payload.id);
      if (payload.media) this.mediaById.set(payload.id, payload.media);

      this.feed.add(payload, mode);
      const logged = this.log.findIndex((entry) => entry.message.id === payload.id);
      if (logged >= 0) this.log[logged] = { message: payload, mode };
      else this.log.push({ message: payload, mode });
      if (this.log.length > HISTORY_LIMIT) this.log.splice(0, this.log.length - HISTORY_LIMIT);
      for (const id of this.mediaById.prune(this.log.map((entry) => entry.message.id))) {
        this.evictMedia(id);
      }

      if (alreadyTracked) {
        this.patchMessageContent(payload);
      }
      this.render();
    });

    await this.safeListen<DirectionPendingPayload>("overlay:direction_pending", (payload) => {
      this.directionSignals.pending(payload.requestId, payload.direction, payload.at);
      this.presentDirectionSignal();
    });

    await this.safeListen<DirectionPayload>("overlay:direction", (payload) => {
      this.directionSignals.upsert(payload);
      this.presentDirectionSignal();
    });

    await this.safeListen<PhraseWheelPayload>("overlay:phrase_wheel", (payload) => {
      this.phraseWheelActive = payload.active;
      this.phraseWheelPhrases = payload.phrases;
      this.phraseWheelSelectedIndex = payload.selectedIndex;
      this.phraseWheelCancelRadius = Number.isFinite(payload.cancelRadiusPx)
        ? Math.max(16, Math.min(160, payload.cancelRadiusPx!))
        : 42;
      if (payload.active && Number.isFinite(payload.originX) && Number.isFinite(payload.originY)) {
        this.phraseWheelOrigin = wheelOrigin({ x: payload.originX!, y: payload.originY! }, { width: window.innerWidth, height: window.innerHeight });
      } else if (!payload.active) {
        this.phraseWheelOrigin = null;
      }
      this.renderPhraseWheel();
    });

    await this.safeListen<{ author?: string; phrase: string }>("overlay:phrase", (payload) => {
      this.presentPhraseSignal(payload.phrase, payload.author);
    });

    await this.safeListen<Record<string, never>>("overlay:reset", () => {
      this.resetFeed();
    });

    await this.safeListen<SendResult>("overlay:send_result", (result) => {
      if (result.kind === "direction") {
        if (result.ok && result.messageId) this.directionSignals.confirm(result.requestId, result.messageId);
        else if (!result.ok) this.directionSignals.discard(result.requestId);
        this.presentDirectionSignal();
      }
      this.applySendResult(result);
    });

    await this.safeListen<MarkupPayload>("overlay:markup", (payload) => {
      this.markupSession = payload.active
        ? new MarkupSession({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
        : null;
      this.render();
    });

    await this.safeListen<{ packs: StickerPack[]; phase?: "metadata" | "previews" | "complete"; error?: string }>("tg:stickers", (payload) => {
      this.stickerPacks = payload.packs;
      this.stickerPickerState = payload.error
        ? { status: "error", message: payload.error }
        : { status: "ready", packs: payload.packs, phase: payload.phase };
      this.renderStickerPanel();
    });

    // The backend may have moved on before this page finished loading.
    this.safeInvoke("sync_overlay");
  }

  private async safeListen<T>(event: string, handler: (payload: T) => void): Promise<void> {
    try {
      await listen<T>(event, (e) => handler(e.payload));
    } catch {
      // Backend event bridge unavailable (e.g. a plain-browser smoke test); stay static.
    }
  }

  private safeInvoke(cmd: string, args?: Record<string, unknown>): void {
    if (!isTauri()) return;
    void invoke(cmd, args).catch(() => {
      // Prototype UI: nothing sensible to show if the backend call fails.
    });
  }

  private rebuildFeed(): void {
    this.feed = new Feed({ ttlMs: this.settings.ttlMs, historyLimit: HISTORY_LIMIT });
    for (const entry of this.log) this.feed.add(entry.message, entry.mode);
  }

  private presentDirectionSignal(): void {
    const signal = this.directionSignals.current();
    if (!signal) {
      this.hideDirectionSignal();
      return;
    }

    const rotation: Record<Direction, number> = { up: 0, right: 90, down: 180, left: 270 };
    this.directionArrowEl.style.setProperty("--direction-rotation", `${rotation[signal.direction]}deg`);
    this.directionAuthorEl.textContent = signal.author ?? "";
    this.directionAuthorEl.hidden = !signal.author;
    this.positionDirectionSignal();
    this.directionLayerEl.hidden = false;
    this.directionSignalEl.classList.remove("direction-signal--replace");
    void this.directionSignalEl.offsetWidth;
    this.directionSignalEl.classList.add("direction-signal--replace");

    if (this.directionHideTimer) window.clearTimeout(this.directionHideTimer);
    const version = ++this.directionVersion;
    this.directionHideTimer = window.setTimeout(() => {
      if (version === this.directionVersion) this.hideDirectionSignal();
    }, this.settings.directionDisplayMs);
  }

  private positionDirectionSignal(): void {
    const zone = this.kind === "active" ? this.settings.activeZone : this.settings.inactiveZone;
    this.directionLayerEl.style.left = `${(zone.x + zone.width * 0.5) * 100}%`;
    this.directionLayerEl.style.top = `${(zone.y + zone.height * 0.38) * 100}%`;
  }

  private hideDirectionSignal(): void {
    if (this.directionHideTimer) window.clearTimeout(this.directionHideTimer);
    this.directionHideTimer = null;
    this.directionLayerEl.hidden = true;
  }

  private presentPhraseSignal(phrase: string, author?: string): void {
    this.phraseSignalTextEl.textContent = phrase;
    this.phraseSignalAuthorEl.textContent = author ?? "";
    this.phraseSignalAuthorEl.hidden = !author;
    const zone = this.kind === "active" ? this.settings.activeZone : this.settings.inactiveZone;
    this.phraseSignalLayerEl.style.left = `${(zone.x + zone.width * 0.5) * 100}%`;
    this.phraseSignalLayerEl.style.top = `${(zone.y + zone.height * 0.58) * 100}%`;
    this.phraseSignalLayerEl.hidden = false;
    if (this.phraseHideTimer) window.clearTimeout(this.phraseHideTimer);
    this.phraseHideTimer = window.setTimeout(() => {
      this.phraseSignalLayerEl.hidden = true;
      this.phraseHideTimer = null;
    }, this.settings.directionDisplayMs);
  }

  private renderPhraseWheel(): void {
    this.phraseWheelLayerEl.hidden = !this.phraseWheelActive;
    if (!this.phraseWheelActive) return;
    const origin = this.phraseWheelOrigin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.phraseWheelLayerEl.style.setProperty("--wheel-origin-x", `${origin.x}px`);
    this.phraseWheelLayerEl.style.setProperty("--wheel-origin-y", `${origin.y}px`);
    this.phraseWheelLayerEl.style.setProperty("--wheel-cancel-diameter", `${this.phraseWheelCancelRadius * 2}px`);
    this.phraseWheelLayerEl.classList.toggle("phrase-wheel--compact-cancel", this.phraseWheelCancelRadius < 30);
    this.phraseWheelLabelsEl.innerHTML = "";
    const radius = Math.max(105, this.phraseWheelCancelRadius + 64, Math.min(window.innerWidth, window.innerHeight) * 0.18);
    for (const item of phraseWheelItems(this.phraseWheelPhrases, this.phraseWheelSelectedIndex, radius)) {
      const label = document.createElement("div");
      label.className = "phrase-wheel__label";
      if (item.selected) label.classList.add("phrase-wheel__label--selected");
      label.textContent = item.phrase;
      label.style.transform = `translate(${item.x}px, ${item.y}px) translate(-50%, -50%)${item.selected ? " scale(1.12)" : ""}`;
      this.phraseWheelLabelsEl.appendChild(label);
    }
  }

  private newRequestId(): string {
    return crypto.randomUUID();
  }

  private showSendError(error: string): void {
    this.sendStatusEl.textContent = error;
    this.sendStatusEl.hidden = false;
  }

  private clearSendError(): void {
    this.sendStatusEl.textContent = "";
    this.sendStatusEl.hidden = true;
  }

  private applySendResult(result: SendResult): void {
    const pending = this.pendingSends.get(result.requestId);
    if (!pending || pending.kind !== result.kind) return;
    this.pendingSends.delete(result.requestId);

    if (!result.ok) {
      this.showSendError(result.error ?? "Telegram не подтвердил отправку");
      return;
    }

    this.clearSendError();
    if (result.kind === "sticker" && pending.stickerId) {
      this.recentStickerIds = pushRecent(this.recentStickerIds, pending.stickerId, RECENT_STICKERS_MAX);
      saveRecentStickers(this.recentStickerIds);
      this.stickerPanelOpen = false;
    } else if (result.kind === "file") {
      this.clearPendingAttachment();
      if (this.inputEl.value.trim() === (pending.text ?? "")) {
        this.inputEl.value = "";
        this.inputEl.style.height = "auto";
      }
    } else if (result.kind === "text" && this.inputEl.value.trim() === (pending.text ?? "")) {
      this.inputEl.value = "";
      this.inputEl.style.height = "auto";
    }
    this.renderStickerPanel();
    this.render();
  }

  private resetFeed(): void {
    this.feed.clear();
    this.log.splice(0, this.log.length);
    this.directionSignals.clear();
    this.hideDirectionSignal();
    for (const [id, tracked] of this.feedNodes) {
      this.destroyMediaFor(id);
      tracked.el.remove();
    }
    this.feedNodes.clear();
    this.mediaById.clear();
    for (const timer of this.stickerPauseTimers.values()) clearTimeout(timer);
    this.stickerPauseTimers.clear();
    this.stickerDeadlines.clear();
    this.lottieByMessageId.clear();
    this.videosByMessageId.clear();
    this.stickToBottom = true;
    this.clearPendingAttachment();
    this.render();
  }

  /** textColor/authorColor/shadow apply globally and update live via CSS custom properties. */
  private applyTheme(): void {
    const root = document.documentElement.style;
    root.setProperty("--overlay-text-color", this.settings.textColor);
    root.setProperty("--overlay-author-color", this.settings.authorColor);
    root.setProperty("--overlay-shadow", String(this.settings.shadow));
    root.setProperty("--overlay-incoming-bubble-color", this.settings.incomingBubbleColor);
    root.setProperty("--overlay-outgoing-bubble-color", this.settings.outgoingBubbleColor);
    this.feedEl.classList.toggle("feed--without-time", !this.settings.showMessageTime);
  }

  /**
   * Applies the passive fade to every currently rendered line, or clears it
   * if the chat is active (expiry paused there). Called after a settings
   * change (ttlMs/fadeMs may have moved) and when leaving active mode,
   * where it also resumes the countdown from each message's real age
   * instead of restarting it.
   */
  private retimeFeedFades(): void {
    const now = Date.now();
    const shouldFade = this.kind !== "active";
    for (const { el: node, message } of this.feedNodes.values()) {
      node.classList.toggle("msg--fading", shouldFade);
      if (shouldFade) this.setFadeTiming(node, now - message.at);
    }
  }

  private setFadeTiming(node: HTMLElement, ageMs: number): void {
    const delay = fadeDelayMs(ageMs, this.settings.ttlMs, this.settings.fadeMs);
    node.style.setProperty("--fade-ms", `${this.settings.fadeMs}ms`);
    node.style.setProperty("--fade-delay", `${delay}ms`);
  }

  // -- Chat input --

  private wireInput(): void {
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.safeInvoke("dismiss");
      } else if (e.key === "PageUp") {
        e.preventDefault();
        this.scrollFeed(-1);
      } else if (e.key === "PageDown") {
        e.preventDefault();
        this.scrollFeed(1);
      }
    });

    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = `${this.inputEl.scrollHeight}px`;
    });

    this.inputEl.addEventListener("paste", (e) => this.handlePaste(e));
  }

  private sendMessage(): void {
    const text = this.inputEl.value.trim();
    const requestId = this.newRequestId();
    this.clearSendError();

    if (this.pendingAttachment) {
      this.pendingSends.set(requestId, { kind: "file", text });
      this.safeInvoke("send_file", {
        requestId,
        dataUrl: this.pendingAttachment.dataUrl,
        caption: text || undefined,
      });
    } else {
      if (!text) return;
      this.pendingSends.set(requestId, { kind: "text", text });
      this.safeInvoke("send_message", { requestId, text });
    }
  }

  private handlePaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;

    const index = findImageClipboardItem(Array.from(items).map((item) => ({ type: item.type })));
    if (index === null) return;
    const file = items[index].getAsFile();
    if (!file) return;

    e.preventDefault();
    this.prepareAttachment(file);
  }

  private prepareAttachment(file: File): void {
    const error = validateAttachment({ mimeType: file.type, byteLength: file.size });
    if (error) {
      this.showSendError(error);
      return;
    }
    this.clearSendError();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      this.pendingAttachment = { dataUrl: reader.result, mimeType: file.type, name: file.name };
      this.renderPendingAttachment();
    };
    reader.onerror = () => this.showSendError("Не удалось прочитать файл");
    reader.readAsDataURL(file);
  }

  private wirePendingAttachment(): void {
    this.pendingAttachmentRemoveEl.addEventListener("click", () => this.clearPendingAttachment());
    this.attachmentToggleEl.addEventListener("click", () => this.attachmentFileEl.click());
    this.attachmentFileEl.addEventListener("change", () => {
      const file = this.attachmentFileEl.files?.[0];
      if (file) this.prepareAttachment(file);
      this.attachmentFileEl.value = "";
    });
  }

  private clearPendingAttachment(): void {
    this.pendingAttachment = null;
    this.renderPendingAttachment();
  }

  private renderPendingAttachment(): void {
    this.pendingAttachmentEl.hidden = !this.pendingAttachment;
    if (this.pendingAttachment) {
      this.pendingAttachmentPreviewEl.src = this.pendingAttachment.dataUrl;
      this.pendingAttachmentPreviewEl.alt = this.pendingAttachment.name;
    }
  }

  private wireFeedScroll(): void {
    this.feedEl.addEventListener("scroll", () => {
      this.stickToBottom = isNearBottom(this.feedEl.scrollTop, this.feedEl.clientHeight, this.feedEl.scrollHeight);
    });
  }

  private scrollFeed(direction: 1 | -1): void {
    this.feedEl.scrollTop += direction * this.feedEl.clientHeight * 0.9;
    this.stickToBottom = isNearBottom(this.feedEl.scrollTop, this.feedEl.clientHeight, this.feedEl.scrollHeight);
  }

  /** Active mode takes the whole window's mouse; a click outside the chat closes it, like Esc. */
  private wireOutsideClick(): void {
    document.addEventListener("mousedown", (e) => {
      const target = e.target as Node;
      const insideChat =
        this.feedZoneEl.contains(target) ||
        this.inputZoneEl.contains(target) ||
        this.mediaLightboxEl.contains(target);
      if (shouldDismissOnOutsideClick(this.kind, this.markupSession !== null, insideChat)) {
        this.safeInvoke("dismiss");
      }
    });
  }

  // -- Sticker picker --

  private wireStickerPanel(): void {
    this.stickerToggleEl.addEventListener("click", () => {
      this.stickerPanelOpen = !this.stickerPanelOpen;
      if (this.stickerPanelOpen) this.stickerSearchQuery = "";
      if (this.stickerPanelOpen && !this.stickerPacksRequested) {
        this.stickerPacksRequested = true;
        this.stickerPickerState = { status: "loading" };
        this.safeInvoke("tg_request_stickers");
      }
      this.renderStickerPanel();
      // Reflects the new open/closed state immediately instead of waiting
      // for the next render tick.
      this.render();
    });
  }

  /** Rebuilds the picker's contents; visibility itself is driven every tick by renderInputZone. */
  private renderStickerPanel(focusSearch = false): void {
    if (!this.stickerPanelOpen) {
      this.destroyPickerLotties();
      return;
    }

    this.stickerPickerRenderVersion += 1;
    this.destroyPickerLotties();
    const renderVersion = this.stickerPickerRenderVersion;

    const packs = withRecentPack(this.stickerPacks, this.recentStickerIds);
    this.stickerPanelEl.replaceChildren();

    const emptyMessage = pickerEmptyMessage(this.stickerPickerState);
    if (emptyMessage) {
      const empty = document.createElement("div");
      empty.className = "sticker-panel__empty";
      empty.textContent = emptyMessage;
      this.stickerPanelEl.appendChild(empty);
      if (this.stickerPickerState.status === "error") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "sticker-panel__retry";
        retry.textContent = "Повторить";
        retry.addEventListener("click", () => {
          this.stickerPacksRequested = true;
          this.stickerPickerState = { status: "loading" };
          this.safeInvoke("tg_request_stickers");
          this.renderStickerPanel();
        });
        this.stickerPanelEl.appendChild(retry);
      }
      return;
    }

    const availablePacks = packs.filter((pack) => pack.stickers.length > 0);
    if (availablePacks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sticker-panel__empty";
      empty.textContent = "В этих наборах пока нет превью стикеров";
      this.stickerPanelEl.appendChild(empty);
      return;
    }

    if (!this.selectedStickerPackId || !availablePacks.some((pack) => pack.id === this.selectedStickerPackId)) {
      this.selectedStickerPackId = availablePacks[0].id;
    }

    const search = document.createElement("input");
    search.type = "search";
    search.className = "sticker-search";
    search.placeholder = "Поиск стикеров";
    search.value = this.stickerSearchQuery;
    search.setAttribute("aria-label", "Поиск стикеров в выбранном наборе");
    search.addEventListener("input", () => {
      this.stickerSearchQuery = search.value;
      this.renderStickerPanel(true);
    });

    const tabs = document.createElement("div");
    tabs.className = "sticker-tabs";
    tabs.setAttribute("role", "tablist");
    for (const pack of availablePacks) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "sticker-tab";
      tab.textContent = pack.title;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(pack.id === this.selectedStickerPackId));
      tab.addEventListener("click", () => {
        this.selectedStickerPackId = pack.id;
        this.stickerSearchQuery = "";
        this.renderStickerPanel();
      });
      tabs.appendChild(tab);
    }
    this.stickerPanelEl.append(search, tabs);

    const tools = document.createElement("div");
    tools.className = "sticker-panel__tools";
    const progress = pickerProgressMessage(this.stickerPickerState);
    if (progress) {
      const status = document.createElement("span");
      status.className = "sticker-panel__progress";
      status.textContent = progress;
      tools.appendChild(status);
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "sticker-panel__refresh";
    refresh.textContent = "Обновить";
    refresh.addEventListener("click", () => {
      this.stickerPacksRequested = true;
      this.safeInvoke("tg_request_stickers", { refresh: true });
    });
    tools.appendChild(refresh);
    this.stickerPanelEl.appendChild(tools);

    const selectedPack = availablePacks.find((pack) => pack.id === this.selectedStickerPackId) ?? availablePacks[0];
    const stickers = filterStickers([selectedPack], this.stickerSearchQuery)[0]?.stickers ?? [];
    if (stickers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sticker-panel__empty";
      empty.textContent = "Ничего не найдено";
      this.stickerPanelEl.appendChild(empty);
      if (focusSearch) search.focus();
      return;
    }

    const grid = document.createElement("div");
    grid.className = "sticker-grid";
    for (const sticker of stickers) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sticker-item";
      button.disabled = sticker.documentReady === false;
      if (sticker.dataUrl) {
        if (sticker.dataUrl.startsWith("data:video/")) {
          const video = document.createElement("video");
          video.src = sticker.dataUrl;
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.autoplay = true;
          video.setAttribute("aria-label", sticker.emoji ?? "Анимированный стикер");
          button.appendChild(video);
        } else if (sticker.dataUrl.startsWith("data:application/x-tgsticker")) {
          const animation = document.createElement("span");
          animation.className = "sticker-item__animation";
          animation.setAttribute("aria-label", sticker.emoji ?? "Анимированный стикер");
          button.appendChild(animation);
          void this.mountPickerLottie(animation, sticker.dataUrl, renderVersion);
        } else {
          const img = document.createElement("img");
          img.src = sticker.dataUrl;
          img.alt = sticker.emoji ?? "";
          button.appendChild(img);
        }
      } else {
        const fallback = document.createElement("span");
        fallback.className = "sticker-item__fallback";
        fallback.textContent = sticker.emoji ?? "◌";
        button.appendChild(fallback);
      }
      button.addEventListener("click", () => this.sendSticker(sticker.fileId));
      grid.appendChild(button);
    }
    this.stickerPanelEl.appendChild(grid);
    if (focusSearch) search.focus();
  }

  private sendSticker(fileId: string): void {
    const requestId = this.newRequestId();
    this.clearSendError();
    this.pendingSends.set(requestId, { kind: "sticker", stickerId: fileId });
    this.safeInvoke("send_sticker", { requestId, fileId });
  }

  // -- Markup mode --

  private wireMarkupLayer(): void {
    this.markupActionsEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.markupSaveEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.saveMarkup();
    });
    this.markupCustomizeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.markupSession?.startActiveEditing();
      this.render();
    });
    this.markupCancelCustomizeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.markupSession?.cancelActiveEditing();
      this.render();
    });
    this.markupEl.addEventListener("mousedown", (e) => {
      if (!this.markupSession) return;
      this.markupSession.pointerDown({ x: e.clientX, y: e.clientY });
      this.render();
    });

    this.markupEl.addEventListener("mousemove", (e) => {
      this.lastCursor = { x: e.clientX, y: e.clientY };
      if (!this.markupSession) return;
      this.markupSession.pointerMove(this.lastCursor);
      this.render();
    });

    this.markupEl.addEventListener("mouseup", (e) => {
      if (!this.markupSession) return;
      this.markupSession.pointerUp({ x: e.clientX, y: e.clientY });
      this.render();
    });

    document.addEventListener("keydown", (e) => {
      if (!this.markupSession) return;
      if (e.key === "Enter") {
        e.preventDefault();
        this.saveMarkup();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.safeInvoke("toggle_markup", { on: false });
      }
    });
  }

  private saveMarkup(): void {
    if (!this.markupSession || !this.gameExe) return;
    const snapshot = this.markupSession.snapshot();
    if (!snapshot.inactiveZone || !snapshot.activeZone) return;

    this.safeInvoke("save_zones", {
      exe: this.gameExe,
      inactive: snapshot.inactiveZone,
      active: snapshot.activeZone,
    });
    // The backend owns markup mode; ask it to close now that the zones are saved.
    this.safeInvoke("toggle_markup", { on: false });
  }

  // -- Rendering --

  private render(): void {
    if (this.markupSession) {
      this.feedZoneEl.hidden = true;
      this.inputZoneEl.hidden = true;
      this.setMediaPaused(true);
      this.renderMarkup(this.markupSession);
      this.previousKind = this.kind;
      return;
    }
    this.markupEl.hidden = true;

    if (this.kind !== "active" && this.kind !== "inactive") {
      this.feedZoneEl.hidden = true;
      this.inputZoneEl.hidden = true;
      this.setMediaPaused(true);
      this.previousKind = this.kind;
      return;
    }
    this.setMediaPaused(false);

    const now = Date.now();
    const isActive = this.kind === "active";
    const enteringActive = isActive && this.previousKind !== "active";
    const leavingActive = this.previousKind === "active" && this.kind === "inactive";

    // Freeze/resume the passive fade exactly at the mode boundary, not every
    // tick: entering active means "expiry paused", leaving it means the
    // fade countdown resumes from the message's real current age.
    if (enteringActive || leavingActive) this.retimeFeedFades();

    this.feedZoneEl.hidden = false;
    this.inputZoneEl.hidden = false;

    const area = messageAreaRect(this.settings.inactiveZone, this.settings.activeZone, isActive);
    positionZone(this.feedZoneEl, area);
    this.feedEl.classList.toggle("feed--scrollable", isActive);
    this.feedZoneEl.style.setProperty(
      "--overlay-backdrop",
      backdropColor(isActive ? Math.max(this.settings.opacity, 0.7) : this.settings.opacity),
    );
    this.feedZoneEl.style.fontSize = `${this.settings.fontScale}em`;

    const messages = this.feed.visible(isActive ? "active" : "inactive", now);
    this.syncMessageNodes(messages, now, !isActive);

    if (isActive) {
      if (enteringActive) {
        this.stickToBottom = true;
      }
      if (enteringActive || this.stickToBottom) {
        this.feedEl.scrollTop = this.feedEl.scrollHeight;
      }
    }

    this.renderInputZone(area, isActive);
    if (enteringActive) this.inputEl.focus();

    this.previousKind = this.kind;
  }

  /** Positions the input below the message area, or inside its bottom edge if there is no room below. */
  private renderInputZone(area: Zone, isActive: boolean): void {
    this.inputZoneEl.classList.toggle("input-zone--visible", isActive);

    if (!isActive) this.stickerPanelOpen = false;
    this.stickerPanelEl.hidden = !(isActive && this.stickerPanelOpen);
    this.stickerToggleEl.classList.toggle("sticker-toggle--active", isActive && this.stickerPanelOpen);

    const bottom = area.y + area.height;
    const inputHeightPx = BASE_INPUT_HEIGHT_PX * this.settings.fontScale;
    const placement = resolveInputPlacement(bottom, window.innerHeight, inputHeightPx + INPUT_GAP_PX);

    this.feedZoneEl.classList.toggle("feed-zone--input-inside", isActive && placement === "inside");

    this.inputZoneEl.style.left = `${area.x * 100}%`;
    this.inputZoneEl.style.width = `${area.width * 100}%`;
    this.inputZoneEl.style.fontSize = `${this.settings.fontScale}em`;

    if (placement === "below") {
      // Anchored by its top, growing downward - there is room, by construction.
      this.inputZoneEl.style.top = `${(bottom + INPUT_GAP_PX / window.innerHeight) * 100}%`;
      this.inputZoneEl.style.bottom = "";
    } else {
      // Anchored by its bottom to the message area's own bottom edge, growing
      // upward instead - keeps it from spilling past the window edge no
      // matter how tall the field's real content makes it (multi-line input).
      this.inputZoneEl.style.top = "";
      this.inputZoneEl.style.bottom = `${(1 - bottom) * 100}%`;
    }

    const inputTop = this.inputZoneEl.getBoundingClientRect().top;
    this.inputZoneEl.style.setProperty("--sticker-panel-height", `${stickerPanelHeight(inputTop)}px`);
  }

  private wireMediaLightbox(): void {
    this.mediaLightboxEl.addEventListener("click", (event) => {
      if (event.target === this.mediaLightboxEl) this.closePhoto();
    });
    this.mediaLightboxCloseEl.addEventListener("click", () => this.closePhoto());
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || this.mediaLightboxEl.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      this.closePhoto();
    }, { capture: true });
  }

  private openPhoto(media: MediaPayload): void {
    this.lightboxReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.mediaLightboxImageEl.src = media.dataUrl;
    this.mediaLightboxEl.hidden = false;
    this.mediaLightboxCloseEl.focus({ preventScroll: true });
  }

  private closePhoto(): void {
    if (this.mediaLightboxEl.hidden) return;
    this.mediaLightboxEl.hidden = true;
    this.mediaLightboxImageEl.removeAttribute("src");
    const returnFocus = this.lightboxReturnFocus;
    this.lightboxReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  /**
   * Keeps the message area's children in sync with `messages` by id, using
   * planMessageSync so a line revealed out of chronological order (e.g. a
   * message missed while hidden, surfaced by switching to active mode)
   * lands at the right spot instead of just being appended at the end.
   * Existing lines are never touched, which is what keeps them from moving.
   */
  private syncMessageNodes(messages: ChatMessage[], now: number, fades: boolean): void {
    const { removed, inserts } = planMessageSync([...this.feedNodes.keys()], messages.map((m) => m.id));

    for (const id of removed) {
      this.feedNodes.get(id)?.el.remove();
      this.feedNodes.delete(id);
      // The message is gone for good (expired or missed for this mode) -
      // destroy its animation outright rather than just pausing it.
      this.destroyMediaFor(id);
    }

    if (inserts.length === 0) return;
    const byId = new Map(messages.map((m) => [m.id, m]));
    for (const { id, beforeId } of inserts) {
      const message = byId.get(id);
      if (!message) continue;
      const node = this.renderMessageEl(message);
      if (fades) {
        node.classList.add("msg--fading");
        this.setFadeTiming(node, now - message.at);
      }
      const beforeEl = beforeId ? (this.feedNodes.get(beforeId)?.el ?? null) : null;
      this.feedEl.insertBefore(node, beforeEl);
      this.feedNodes.set(id, { el: node, message });
    }
  }

  private renderMarkup(session: MarkupSession): void {
    this.markupEl.hidden = false;
    const snapshot = session.snapshot();

    const inactivePreview = snapshot.step === "inactive" ? snapshot.previewZone : snapshot.inactiveZone;
    showRect(this.markupInactiveRectEl, inactivePreview);

    const activePreview = snapshot.step === "inactive" ? null : snapshot.step === "active" ? (snapshot.previewZone ?? snapshot.activeZone) : snapshot.activeZone;
    showRect(this.markupActiveRectEl, activePreview);

    if (snapshot.previewZone) {
      this.markupSizeEl.hidden = false;
      this.markupSizeEl.textContent = formatZonePercent(snapshot.previewZone);
      this.markupSizeEl.style.left = `${this.lastCursor.x}px`;
      this.markupSizeEl.style.top = `${this.lastCursor.y}px`;
    } else {
      this.markupSizeEl.hidden = true;
    }

    this.markupActionsEl.hidden = snapshot.step === "inactive";
    this.markupSaveEl.disabled = !session.canSave();
    this.markupCustomizeEl.hidden = snapshot.step === "active";
    this.markupCancelCustomizeEl.hidden = snapshot.step !== "active";
    this.markupHintEl.textContent =
      snapshot.step === "inactive"
        ? "Выделите область, где должны появляться сообщения"
        : snapshot.step === "active"
          ? "Выделите область открытого чата или оставьте автоматическую"
          : "Готово. Сохраните или при желании настройте область открытого чата.";
  }

  // -- Message media --

  private renderMessageEl(message: ChatMessage): HTMLDivElement {
    const line = document.createElement("div");
    line.className = messageClassNames(message.outgoing, this.settings.messageLayout).join(" ");
    line.dataset.id = message.id;
    line.append(...this.buildMessageChildren(message));
    return line;
  }

  /** Rebuilds the content of an existing line without moving its feed node. */
  private patchMessageContent(message: ChatMessage): void {
    const tracked = this.feedNodes.get(message.id);
    if (!tracked) return;
    this.destroyMediaFor(message.id);
    tracked.el.replaceChildren(...this.buildMessageChildren(message));
    tracked.message = message;
  }

  private buildMessageChildren(message: ChatMessage): Node[] {
    const media = this.mediaById.get(message.id);
    const content = messageContent(
      message.text,
      this.settings.showAuthor,
      media?.kind === "webp" || media?.kind === "tgs" || media?.kind === "webm",
    );
    const children: Node[] = [];

    // A sticker-only message shows no backdrop pill, so its author (if any)
    // is not wrapped in .msg-text - it just sits above the media instead.
    if (media && !content.showText && content.showAuthor) children.push(this.buildAuthorEl(message));
    if (media) children.push(this.buildMediaEl(message.id, media));
    if (content.showText) {
      const bubble = document.createElement("div");
      bubble.className = "msg-text";
      if (content.showAuthor) bubble.append(this.buildAuthorEl(message));
      bubble.append(document.createTextNode(message.text));
      bubble.append(this.buildTimeEl(message.at));
      children.push(bubble);
    } else {
      children.push(this.buildTimeEl(message.at));
    }

    return children;
  }

  private buildTimeEl(at: number): HTMLTimeElement {
    const date = new Date(at);
    const time = document.createElement("time");
    time.className = "msg-time";
    time.dateTime = date.toISOString();
    time.textContent = MESSAGE_TIME_FORMATTER.format(date);
    return time;
  }

  private buildAuthorEl(message: ChatMessage): HTMLSpanElement {
    const author = document.createElement("span");
    author.className = "author";
    author.textContent = `${message.author}:`;
    return author;
  }

  /** Reserves the final box size up front (see media.ts fitMediaBox) so nothing shifts once it loads. */
  private buildMediaEl(messageId: string, media: MediaPayload): HTMLElement {
    const maxSizePx = media.kind === "photo"
      ? photoPreviewMaxSize(this.kind === "active" ? "active" : "inactive", this.settings.fontScale)
      : BASE_STICKER_MAX_PX * this.settings.fontScale;
    const box = fitMediaBox(media.width, media.height, maxSizePx);

    const container = document.createElement("div");
    container.className = "msg-media";
    container.style.width = `${box.width}px`;
    container.style.height = `${box.height}px`;
    if (media.kind === "photo" && this.kind === "active") {
      container.classList.add("msg-media--photo-preview");
      container.tabIndex = 0;
      container.setAttribute("role", "button");
      container.setAttribute("aria-label", "Открыть изображение");
      container.addEventListener("click", () => this.openPhoto(media));
      container.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.openPhoto(media);
        }
      });
    }

    const kind = mediaElementKind(media.kind, media.mimeType);
    if (kind === "img") {
      const img = document.createElement("img");
      img.src = media.dataUrl;
      img.alt = "";
      img.addEventListener("error", () => this.renderMediaFailure(container, media.kind, messageId), { once: true });
      container.appendChild(img);
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.src = media.dataUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.addEventListener("error", () => this.renderMediaFailure(container, media.kind, messageId), { once: true });
      container.appendChild(video);
      this.videosByMessageId.set(messageId, video);
      if (this.isTimedSticker(media)) this.syncStickerPlayback(messageId);
      else if (!this.mediaPaused) void video.play().catch(() => {});
    } else {
      // gzipped Lottie JSON - pako and lottie-web are only pulled in once a
      // tgs sticker actually shows up, not paid for by every feed.
      container.classList.add("msg-media--lottie");
      void this.mountLottie(messageId, container, media.dataUrl);
    }

    return container;
  }

  private async mountLottie(messageId: string, container: HTMLElement, dataUrl: string): Promise<void> {
    try {
      const [animationData, { default: lottie }] = await Promise.all([
        inflateTgsAnimationData(dataUrl),
        import("lottie-web/build/player/lottie_light"),
      ]);
      // The message may have expired (and its node removed) while this was
      // in flight - do not mount an animation nobody will ever see or clean up.
      if (!container.isConnected) return;

      const instance = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: !this.mediaPaused,
        animationData,
      });
      this.lottieByMessageId.set(messageId, instance);
      this.syncStickerPlayback(messageId);
    } catch {
      this.renderMediaFailure(container, "tgs", messageId);
    }
  }

  private async mountPickerLottie(container: HTMLElement, dataUrl: string, renderVersion: number): Promise<void> {
    try {
      const [animationData, { default: lottie }] = await Promise.all([
        inflateTgsAnimationData(dataUrl),
        import("lottie-web/build/player/lottie_light"),
      ]);
      if (!container.isConnected || renderVersion !== this.stickerPickerRenderVersion) return;

      const instance = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData,
      });
      this.pickerLotties.add(instance);
    } catch {
      if (!container.isConnected || renderVersion !== this.stickerPickerRenderVersion) return;
      container.textContent = "◌";
    }
  }

  private destroyPickerLotties(): void {
    for (const animation of this.pickerLotties) animation.destroy();
    this.pickerLotties.clear();
  }

  private renderMediaFailure(container: HTMLElement, kind: MediaKind, messageId: string): void {
    this.destroyMediaFor(messageId);
    container.classList.add("msg-media--failed");
    container.replaceChildren(document.createTextNode(mediaFailureLabel(kind)));
  }

  private destroyMediaFor(id: string): void {
    const timer = this.stickerPauseTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.stickerPauseTimers.delete(id);
    }
    this.stickerDeadlines.delete(id);
    const instance = this.lottieByMessageId.get(id);
    if (instance) {
      instance.destroy();
      this.lottieByMessageId.delete(id);
    }
    const video = this.videosByMessageId.get(id);
    if (video) {
      video.pause();
      this.videosByMessageId.delete(id);
    }
  }

  private evictMedia(id: string): void {
    this.destroyMediaFor(id);
    const tracked = this.feedNodes.get(id);
    if (tracked) tracked.el.replaceChildren(...this.buildMessageChildren(tracked.message));
  }

  /** Stops every mounted animation while the overlay is hidden/off/in markup mode, so it never burns CPU unseen. */
  private setMediaPaused(paused: boolean): void {
    if (this.mediaPaused === paused) return;
    this.mediaPaused = paused;

    for (const [id, video] of this.videosByMessageId) {
      if (paused) {
        video.pause();
        this.clearStickerPauseTimer(id);
      } else if (this.stickerDeadlines.has(id)) {
        this.syncStickerPlayback(id);
      } else {
        void video.play().catch(() => {});
      }
    }
    for (const [id, instance] of this.lottieByMessageId) {
      if (paused) {
        instance.pause();
        this.clearStickerPauseTimer(id);
      } else if (this.stickerDeadlines.has(id)) {
        this.syncStickerPlayback(id);
      } else {
        instance.play();
      }
    }
  }

  private isTimedSticker(media: MediaPayload): boolean {
    return media.kind === "tgs" || media.kind === "webm";
  }

  private clearStickerPauseTimer(id: string): void {
    const timer = this.stickerPauseTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.stickerPauseTimers.delete(id);
  }

  private refreshTimedStickerPlayback(): void {
    for (const id of this.stickerDeadlines.keys()) this.syncStickerPlayback(id);
  }

  private syncStickerPlayback(id: string): void {
    const deadline = playbackDeadline(
      this.stickerDeadlines.get(id) ?? undefined,
      Date.now(),
      this.settings.stickerAnimationSeconds,
    );
    this.stickerDeadlines.set(id, deadline);
    this.clearStickerPauseTimer(id);

    const remaining = remainingPlaybackMs(Date.now(), deadline);
    const shouldPlay = !this.mediaPaused && remaining !== null && remaining > 0;
    const video = this.videosByMessageId.get(id);
    const lottie = this.lottieByMessageId.get(id);

    if (!shouldPlay) {
      video?.pause();
      lottie?.pause();
      return;
    }

    if (video) void video.play().catch(() => {});
    lottie?.play();
    this.stickerPauseTimers.set(
      id,
      window.setTimeout(() => {
        this.stickerPauseTimers.delete(id);
        this.videosByMessageId.get(id)?.pause();
        this.lottieByMessageId.get(id)?.pause();
      }, remaining),
    );
  }
}

function positionZone(target: HTMLElement, zone: Zone): void {
  target.style.left = `${zone.x * 100}%`;
  target.style.top = `${zone.y * 100}%`;
  target.style.width = `${zone.width * 100}%`;
  target.style.height = `${zone.height * 100}%`;
}

function showRect(target: HTMLElement, zone: Zone | null): void {
  if (!zone) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  positionZone(target, zone);
}

function backdropColor(opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  return `rgba(12, 14, 18, ${clamped})`;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => new OverlayApp().start());
}
