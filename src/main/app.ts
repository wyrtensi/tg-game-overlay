import { parseApiId, validateApiHash, validateApiId } from "./api-keys";
import { normalizeHexColor, validateHexColor } from "./color";
import { configsEqual, feedSettingsEqual } from "./config-diff";
import { debounce } from "./debounce";
import { DemoBackend } from "./demo-backend";
import { demoBus } from "./demo-bus";
import { createDemoConfig } from "./demo-config";
import { DEMO_DIALOGS, nextDemoStatus } from "./demo-telegram";
import { chatPickerMessage, type DialogLoadState } from "./chat-picker-state";
import { describeChatKind, filterDialogs, isChatEqual } from "./dialogs";
import { DEFAULT_FEED_SETTINGS } from "./feed-defaults";
import {
  formatFadeLabel,
  formatFontScaleLabel,
  formatOpacityLabel,
  formatShadowLabel,
  formatTtlLabel,
  formatZoneSummary,
  msToSeconds,
  secondsToMs,
} from "./format";
import { formatKeyCombo, hotkeyFieldKeyAction, validateHotkeyCombo } from "./hotkey";
import { normalizePhone, validatePhone } from "./phone";
import { normalizeProfileExecutable } from "./profile-input";
import { profileAddIntent, selectedProfileExecutable } from "./profile-add-intent";
import { sameProfileCandidates, shouldRefreshProfileCandidates } from "./profile-refresh";
import { formatStickerAnimationSeconds } from "./sticker-animation";
import { hasTauri, safeInvoke, safeListen } from "./tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { currentLoginStep, describeTelegramStatus, reconnectAction, shouldClearLoginInput } from "./telegram-status";
import { readinessState } from "./readiness";
import { focusReadinessTarget, readinessView } from "./readiness-view";
import type { ChatRef, Config, DirectionSettings, FeedAppearance, LoginStep, MessageLayout, PhraseWheelSettings, Profile, ProfileCandidate, ProfileMode, LanguageSetting, RelaySecretState, RelaySettings, TgStatus, Transport } from "./types";
import { normalizeDirectionSettings, validateDirectionSettings } from "./direction-settings";
import { normalizePhraseWheelSettings, validatePhrase } from "./phrase-wheel-settings";
import { SerialSaver } from "./serial-save";
import { applyTranslations, resolveLanguage, setLocale, t } from "../i18n";

/**
 * Entry point for the settings (main) window. Renders from a single `config`
 * object kept in sync with the backend via get_config / config:changed, and
 * falls back to an in-memory DemoBackend when there is no Tauri host to talk
 * to (plain-browser smoke test).
 */

let config: Config = createDemoConfig();
const demoBackend = new DemoBackend(config);

// Telegram connection state. None of this is persisted anywhere in the page;
// it only exists to drive the login form and the countdown.
let tgStatus: TgStatus = { state: "offline" };
let tgDialogs: ChatRef[] = [];
let lastLoginStep: LoginStep = "phone";
let renderedLoginStep: "phone" | "code" | "password" | undefined;
let demoPhone: string | undefined;
let chatPickerOpen = false;
let dialogLoadState: DialogLoadState = { state: "idle" };
let dialogSearchTimer: ReturnType<typeof setTimeout> | undefined;
let profileCandidates: ProfileCandidate[] = [];
let waitDeadline: number | null = null;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let profileRefreshTimer: ReturnType<typeof setInterval> | undefined;
let chatShortcutError: string | null = null;
/** False in public builds: Telegram then needs the user's own api_id / api_hash. */
let builtinKeys = true;
let relaySecrets: RelaySecretState = { hasAccessKey: false, hasPassword: false };
let apiKeysAutoOpened = false;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

function reportBackendError(err: unknown): void {
  const message = t(typeof err === "string" ? err : err instanceof Error ? err.message : "Неизвестная ошибка");
  const statusEl = document.getElementById("global-status");
  if (statusEl) statusEl.textContent = message;
  console.error("[tg-game-overlay]", err);
}

/** Runs a command against Tauri, or the DemoBackend fallback when there is no Tauri host. */
async function invokeConfig(command: string, args?: Record<string, unknown>): Promise<Config> {
  if (hasTauri()) return safeInvoke<Config>(command, args);

  switch (command) {
    case "get_config":
      return demoBackend.getConfig();
    case "set_hotkey":
      return demoBackend.setHotkey(String((args as { hotkey: string }).hotkey));
    case "set_markup_hotkey":
      return demoBackend.setMarkupHotkey(String((args as { hotkey: string }).hotkey));
    case "set_feed_settings":
      return demoBackend.setFeedSettings((args as { settings: FeedAppearance }).settings);
    case "set_direction_settings":
      return demoBackend.setDirectionSettings((args as { settings: DirectionSettings }).settings);
    case "set_phrase_wheel_settings":
      return demoBackend.setPhraseWheelSettings((args as { settings: PhraseWheelSettings }).settings);
    case "set_flags":
      return demoBackend.setFlags(args as unknown as { autostart: boolean; demoFeed: boolean });
    case "upsert_profile":
      return demoBackend.upsertProfile((args as { profile: Profile }).profile);
    case "remove_profile":
      return demoBackend.removeProfile(String((args as { exe: string }).exe));
    case "add_current_app":
      return demoBackend.addCurrentApp();
    case "add_profile_by_exe":
      return demoBackend.addProfileByExe(String((args as { value: string }).value));
    case "set_chat":
      return demoBackend.setChat((args as { chat: ChatRef | null }).chat);
    case "tg_save_api_keys": {
      const { apiId, apiHash } = args as { apiId: number; apiHash: string };
      return demoBackend.saveApiKeys(apiId, apiHash);
    }
    case "tg_clear_api_keys":
      return demoBackend.clearApiKeys();
    case "set_language":
      return demoBackend.setLanguage((args as { language: LanguageSetting }).language);
    case "set_transport":
      return demoBackend.setTransport((args as { transport: Transport }).transport);
    case "set_relay_settings":
      return demoBackend.setRelaySettings((args as { settings: RelaySettings }).settings);
    default:
      throw new Error(`Демо-режим не поддерживает команду ${command}`);
  }
}

async function loadProfileCandidates(): Promise<ProfileCandidate[]> {
  if (hasTauri()) return safeInvoke<ProfileCandidate[]>("list_profile_candidates");
  return [
    { exe: "sample-game.exe", title: "Тестовая игра" },
    { exe: "another-game.exe", title: "Другая тестовая игра" },
  ];
}

async function loadCurrentTelegramStatus(): Promise<TgStatus> {
  if (hasTauri()) return safeInvoke<TgStatus>("tg_current_status");
  return tgStatus;
}

/** For commands that return void per CONTRACT.md (Telegram login/dialogs, markup toggle). */
async function invokeVoid(command: string, args?: Record<string, unknown>): Promise<void> {
  if (hasTauri()) {
    await safeInvoke(command, args);
    return;
  }

  switch (command) {
    case "toggle_markup":
      demoBackend.toggleMarkup(Boolean((args as { on: boolean } | undefined)?.on));
      return;
    case "tg_login_step": {
      const { step, value } = args as { step: LoginStep; value?: string };
      lastLoginStep = step;
      const result = nextDemoStatus(step, value, demoPhone);
      demoPhone = step === "logout" ? undefined : (result.status.phone ?? demoPhone);
      setTimeout(() => demoBus.emit<TgStatus>("tg:status", result.status), result.delayMs);
      return;
    }
    case "tg_logout": {
      demoPhone = undefined;
      setTimeout(() => demoBus.emit<TgStatus>("tg:status", { state: "offline" }), 200);
      return;
    }
    case "tg_request_dialogs": {
      setTimeout(() => demoBus.emit("tg:dialogs", { dialogs: DEMO_DIALOGS }), 250);
      return;
    }
    default:
      return;
  }
}

/** Subscribes to a backend event, or to the local demo bus when there is no Tauri host. */
async function subscribeEvent<T>(name: string, handler: (payload: T) => void): Promise<void> {
  if (hasTauri()) {
    await safeListen<T>(name, handler);
    return;
  }
  demoBus.on<T>(name, handler);
}

function applyConfig(next: Config): void {
  config = next;
  applyLocale();
  render();
}

let appliedLanguage: string | null = null;

/** Switches the interface language when the setting (or the first config) arrives. */
function applyLocale(): void {
  const setting = config.language ?? "auto";
  if (setting === appliedLanguage) return;
  appliedLanguage = setting;
  setLocale(resolveLanguage(setting, typeof navigator === "undefined" ? [] : navigator.languages));
  applyTranslations();
  // Placeholders that render functions leave alone when the field has text.
  renderedLoginStep = undefined;
}

function render(): void {
  renderReadiness();
  renderTransport();
  renderTelegramSection();
  renderRelaySection();
  renderProfiles();
  renderHotkeys();
  renderDirectionSettings();
  renderPhraseWheelSettings();
  renderFeedSettings();
  renderFlags();
}

// ---- Profiles ---------------------------------------------------------

function renderProfiles(): void {
  const emptyEl = byId<HTMLElement>("profiles-empty");
  const list = byId<HTMLElement>("profiles-list");
  list.replaceChildren();

  if (config.profiles.length === 0) {
    emptyEl.hidden = false;
    list.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  list.hidden = false;

  for (const profile of config.profiles) {
    list.appendChild(buildProfileCard(profile));
  }
}

const MODE_OPTIONS: { mode: ProfileMode; label: string; title: string }[] = [
  { mode: "show", label: "Показ", title: "Показывать чат в этой игре" },
  { mode: "hidden", label: "Скрыт", title: "Скрывать чат, но не блокировать игру из списка" },
  { mode: "blocked", label: "Блок", title: "Никогда не показывать чат в этой игре" },
];

function buildModeSwitch(profile: Profile): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "mode-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("Режим для {title}", { title: profile.title }));

  for (const { mode, label, title } of MODE_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = t(label);
    btn.title = t(title);
    btn.setAttribute("aria-pressed", String(profile.mode === mode));
    btn.addEventListener("click", () => {
      if (profile.mode === mode) return;
      void updateProfile({ ...profile, mode });
    });
    wrap.appendChild(btn);
  }

  return wrap;
}

function updateProfile(profile: Profile): Promise<void> {
  return invokeConfig("upsert_profile", { profile }).then(applyConfig).catch(reportBackendError);
}

function buildProfileCard(profile: Profile): HTMLElement {
  const card = document.createElement("article");
  card.className = "profile-card";
  card.setAttribute("aria-label", profile.title);
  const zonesApply = profile.mode !== "blocked";

  const header = document.createElement("div");
  header.className = "profile-card__header";
  const identity = document.createElement("div");
  identity.className = "profile-card__identity";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "profile-title-input";
  titleInput.value = profile.title;
  titleInput.setAttribute("aria-label", t("Название для {exe}", { exe: profile.exe }));
  titleInput.addEventListener("change", () => {
    const title = titleInput.value.trim() || profile.exe;
    void updateProfile({ ...profile, title });
  });
  const exe = document.createElement("span");
  exe.className = "profile-card__exe";
  exe.textContent = profile.exe;
  identity.append(titleInput, exe);
  header.appendChild(identity);

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const markupBtn = document.createElement("button");
  markupBtn.type = "button";
  markupBtn.textContent = t("Зоны");
  markupBtn.disabled = !zonesApply;
  markupBtn.title = t(zonesApply ? "Настроить зоны на игровом окне" : "Игра заблокирована — зоны не используются");
  markupBtn.addEventListener("click", () => {
    void invokeVoid("toggle_markup", { on: true }).catch(reportBackendError);
  });
  actions.appendChild(markupBtn);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn--danger";
  removeBtn.textContent = t("Удалить");
  removeBtn.setAttribute("aria-label", t("Удалить {title}", { title: profile.title }));
  removeBtn.addEventListener("click", () => {
    void invokeConfig("remove_profile", { exe: profile.exe }).then(applyConfig).catch(reportBackendError);
  });
  actions.appendChild(removeBtn);
  header.appendChild(actions);

  const details = document.createElement("div");
  details.className = "profile-card__details";
  const mode = document.createElement("div");
  mode.className = "profile-card__field";
  const modeLabel = document.createElement("span");
  modeLabel.className = "profile-card__label";
  modeLabel.textContent = t("Режим чата");
  mode.append(modeLabel, buildModeSwitch(profile));
  details.appendChild(mode);

  const zones = document.createElement("div");
  zones.className = "profile-card__zones";
  for (const [label, zone] of [
    ["Пассивная зона", profile.inactive],
    ["Активная зона", profile.active],
  ] as const) {
    const field = document.createElement("div");
    field.className = "profile-card__zone";
    const name = document.createElement("span");
    name.className = "profile-card__label";
    name.textContent = t(label);
    const summary = document.createElement("span");
    summary.className = "zone-summary";
    summary.textContent = zonesApply ? formatZoneSummary(zone) : t("Не используется");
    field.append(name, summary);
    zones.appendChild(field);
  }
  details.appendChild(zones);
  card.append(header, details);
  return card;
}

function renderProfileCandidates(): void {
  const select = byId<HTMLSelectElement>("profile-process-select");
  const selected = select.value;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t(profileCandidates.length ? "Выберите окно запущенной игры" : "Нет доступных игровых окон");
  select.appendChild(placeholder);
  select.disabled = profileCandidates.length === 0;

  for (const candidate of profileCandidates) {
    const option = document.createElement("option");
    option.value = candidate.exe;
    option.textContent = `${candidate.title} — ${candidate.exe}`;
    select.appendChild(option);
  }
  if (profileCandidates.some((candidate) => candidate.exe === selected)) select.value = selected;
}

async function refreshProfileCandidates(): Promise<void> {
  const refresh = byId<HTMLButtonElement>("profile-process-refresh");
  const select = byId<HTMLSelectElement>("profile-process-select");
  const errorEl = byId<HTMLElement>("profile-exe-error");
  refresh.disabled = true;
  try {
    const nextCandidates = await loadProfileCandidates();
    if (!sameProfileCandidates(profileCandidates, nextCandidates) || select.options.length === 0) {
      profileCandidates = nextCandidates;
      renderProfileCandidates();
    }
    errorEl.textContent = "";
  } catch (err) {
    errorEl.textContent = t(err instanceof Error ? err.message : "Не удалось получить список игровых окон");
  } finally {
    refresh.disabled = false;
  }
}

function wireProfileAdder(): void {
  const form = byId<HTMLFormElement>("profile-add-form");
  const input = byId<HTMLInputElement>("profile-exe-input");
  const select = byId<HTMLSelectElement>("profile-process-select");
  const errorEl = byId<HTMLElement>("profile-exe-error");

  const addProfile = (value: string): void => {
    const exe = normalizeProfileExecutable(value);
    if (!exe) {
      errorEl.textContent = t("Укажите имя файла с расширением .exe");
      return;
    }

    errorEl.textContent = "";
    void invokeConfig("add_profile_by_exe", { value })
      .then((next) => {
        input.value = "";
        select.value = "";
        applyConfig(next);
      })
      .catch((err) => {
        errorEl.textContent = t(err instanceof Error ? err.message : "Не удалось добавить игру");
      });
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addProfile(input.value);
  });

  byId<HTMLButtonElement>("profile-add-button").addEventListener("click", () => {
    const intent = profileAddIntent(input.value);
    if (intent.kind === "add") {
      addProfile(intent.value);
      return;
    }

    if (!hasTauri()) {
      errorEl.textContent = t("Выбор файла доступен в приложении Windows.");
      return;
    }

    void open({
      multiple: false,
      directory: false,
      filters: [{ name: "Programs", extensions: ["exe"] }],
    })
      .then((path) => selectedProfileExecutable(path))
      .then((path) => {
        if (path === null) return;
        input.value = path;
        addProfile(path);
      })
      .catch((err) => {
        errorEl.textContent = t(err instanceof Error ? err.message : "Не удалось открыть выбор файла");
      });
  });

  select.addEventListener("change", () => {
    if (!select.value) return;
    addProfile(select.value);
  });

  byId<HTMLButtonElement>("profile-process-refresh").addEventListener("click", () => {
    void refreshProfileCandidates();
  });
}

function wireProfileCandidateRefresh(): void {
  profileRefreshTimer = setInterval(() => {
    if (!shouldRefreshProfileCandidates(document.visibilityState === "visible")) return;
    void refreshProfileCandidates();
  }, 3_000);

  window.addEventListener("beforeunload", () => {
    if (profileRefreshTimer) clearInterval(profileRefreshTimer);
  });
}

// ---- Hotkeys ------------------------------------------------------------

interface HotkeyFieldConfig {
  inputId: string;
  errorId: string;
  command: string;
  getValue: () => string;
  allowSingleKey?: boolean;
}

const HOTKEY_FIELDS: HotkeyFieldConfig[] = [
  {
    inputId: "hotkey-input",
    errorId: "hotkey-error",
    command: "set_hotkey",
    getValue: () => config.hotkey,
    allowSingleKey: true,
  },
  {
    inputId: "markup-hotkey-input",
    errorId: "markup-hotkey-error",
    command: "set_markup_hotkey",
    getValue: () => config.markupHotkey,
  },
];

function wireHotkeyField(field: HotkeyFieldConfig): void {
  const input = byId<HTMLInputElement>(field.inputId);
  const errorEl = byId<HTMLElement>(field.errorId);

  input.addEventListener("keydown", (event) => {
    const action = hotkeyFieldKeyAction(event);
    if (action === "navigate") return; // the browser moves focus on
    event.preventDefault();
    event.stopPropagation();
    if (action === "cancel") {
      input.value = field.getValue();
      errorEl.textContent = "";
      input.classList.remove("is-invalid");
      return;
    }
    if (action === "ignore") return;

    const combo = formatKeyCombo(event);
    if (combo === null) return; // still only a modifier held down

    const validationError = validateHotkeyCombo(combo, field.allowSingleKey);
    if (validationError) {
      errorEl.textContent = validationError;
      input.classList.add("is-invalid");
      return;
    }

    invokeConfig(field.command, { hotkey: combo })
      .then((next) => {
        errorEl.textContent = "";
        input.classList.remove("is-invalid");
        applyConfig(next);
      })
      .catch((err) => {
        input.value = field.getValue();
        input.classList.add("is-invalid");
        errorEl.textContent = t(typeof err === "string" ? err : "Не удалось задать комбинацию клавиш");
      });
  });

  input.addEventListener("focus", () => {
    errorEl.textContent = "";
    input.classList.remove("is-invalid");
  });
}

function wireHotkeyInputs(): void {
  for (const field of HOTKEY_FIELDS) wireHotkeyField(field);
}

function renderHotkeys(): void {
  for (const field of HOTKEY_FIELDS) {
    byId<HTMLInputElement>(field.inputId).value = field.getValue();
  }
  byId<HTMLElement>("hotkey-runtime-error").textContent = chatShortcutError ?? "";
}

function renderReadiness(): void {
  const relay = isRelay();
  byId<HTMLElement>("readiness-telegram-label").textContent = relay ? t("1. Сервер") : "1. Telegram";
  byId<HTMLElement>("readiness-chat-label").textContent = t(relay ? "2. Комната" : "2. Чат");
  const slots = readinessView(readinessState(tgStatus, config, { builtinKeys }));
  for (const slot of slots) {
    const button = byId<HTMLButtonElement>(`readiness-${slot.id}`);
    const status = byId<HTMLElement>(`readiness-${slot.id}-status`);
    status.textContent = slot.text;
    button.disabled = slot.disabled;
    button.dataset.complete = String(slot.complete);
    button.dataset.badge = t(slot.complete ? "Готово" : slot.id === "ready" ? "Осталось" : "Дальше");
    if (slot.targetId) {
      button.dataset.targetId = slot.targetId;
    } else {
      delete button.dataset.targetId;
    }
  }
}

function wireReadiness(): void {
  for (const id of ["telegram", "chat", "game", "ready"] as const) {
    byId<HTMLButtonElement>(`readiness-${id}`).addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const targetId = button.dataset.targetId;
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (target instanceof HTMLElement) focusReadinessTarget(target);
    });
  }
}

const DIRECTION_INPUT_IDS = ["direction-up-key", "direction-down-key", "direction-left-key", "direction-right-key"] as const;

function currentDirectionSettings(): DirectionSettings {
  return {
    enabled: byId<HTMLInputElement>("direction-enabled").checked,
    upKey: byId<HTMLInputElement>("direction-up-key").value,
    downKey: byId<HTMLInputElement>("direction-down-key").value,
    leftKey: byId<HTMLInputElement>("direction-left-key").value,
    rightKey: byId<HTMLInputElement>("direction-right-key").value,
    displayMs: Number(byId<HTMLInputElement>("direction-display-ms").value),
  };
}

function saveDirectionSettings(): void {
  const settings = normalizeDirectionSettings(currentDirectionSettings());
  const error = validateDirectionSettings(settings);
  const errorEl = byId<HTMLElement>("direction-error");
  if (error) {
    errorEl.textContent = error;
    return;
  }
  void invokeConfig("set_direction_settings", { settings })
    .then((next) => {
      errorEl.textContent = "";
      applyConfig(next);
    })
    .catch((err) => {
      errorEl.textContent = t(typeof err === "string" ? err : "Не удалось сохранить указатели");
    });
}

function wireDirectionSettings(): void {
  byId<HTMLInputElement>("direction-enabled").addEventListener("change", saveDirectionSettings);
  byId<HTMLInputElement>("direction-display-ms").addEventListener("change", saveDirectionSettings);
  for (const id of DIRECTION_INPUT_IDS) {
    const input = byId<HTMLInputElement>(id);
    input.addEventListener("keydown", (event) => {
      if (hotkeyFieldKeyAction(event) === "navigate") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        renderDirectionSettings();
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
      input.value = event.code || event.key;
      saveDirectionSettings();
    });
  }
}

function renderDirectionSettings(): void {
  const settings = config.directionSignals;
  byId<HTMLInputElement>("direction-enabled").checked = settings.enabled;
  byId<HTMLInputElement>("direction-up-key").value = settings.upKey;
  byId<HTMLInputElement>("direction-down-key").value = settings.downKey;
  byId<HTMLInputElement>("direction-left-key").value = settings.leftKey;
  byId<HTMLInputElement>("direction-right-key").value = settings.rightKey;
  byId<HTMLInputElement>("direction-display-ms").value = String(settings.displayMs);
  byId<HTMLElement>("direction-display-value").textContent = t("{n} с", { n: (settings.displayMs / 1000).toFixed(1) });
}

// ---- Phrase wheel -----------------------------------------------------

function currentPhraseWheelSettings(): PhraseWheelSettings {
  return {
    enabled: byId<HTMLInputElement>("phrase-wheel-enabled").checked,
    hotkey: byId<HTMLInputElement>("phrase-wheel-hotkey").value,
    deadZonePx: Number(byId<HTMLInputElement>("phrase-wheel-dead-zone").value),
    phrases: Array.from(document.querySelectorAll<HTMLInputElement>("[data-phrase-wheel-text]"), (input) => input.value),
  };
}

function reportPhraseWheelError(message: string): void {
  byId<HTMLElement>("phrase-wheel-error").textContent = message;
}

/**
 * Phrase wheel saves run in order and only the newest response is applied:
 * a row edit saves on `change`, which fires right before a click on
 * "Удалить" or "Добавить фразу" saves again, and an older response landing
 * last would otherwise bring the previous list back.
 */
const phraseWheelSaver = new SerialSaver((settings: PhraseWheelSettings) =>
  invokeConfig("set_phrase_wheel_settings", { settings }));

/**
 * Re-renders only the phrase rows from `phrases` (the live inputs, edited)
 * and saves the form; the other phrase wheel fields keep what they show.
 */
function savePhraseList(phrases: string[]): void {
  config = { ...config, phraseWheel: { ...config.phraseWheel, phrases } };
  renderPhraseRows(phrases);
  savePhraseWheelSettings();
}

function savePhraseWheelSettings(): void {
  const raw = currentPhraseWheelSettings();
  const hotkeyError = validateHotkeyCombo(raw.hotkey);
  if (hotkeyError) {
    reportPhraseWheelError(hotkeyError);
    return;
  }
  for (const phrase of raw.phrases) {
    const phraseError = validatePhrase(phrase);
    if (phraseError) {
      reportPhraseWheelError(phraseError);
      return;
    }
  }
  const settings = normalizePhraseWheelSettings(raw);
  if (settings.phrases.length < 2 || settings.phrases.length > 8) {
    reportPhraseWheelError(t("Добавьте от 2 до 8 фраз"));
    return;
  }
  void phraseWheelSaver.submit(settings).then((outcome) => {
    if (outcome.status === "saved") {
      reportPhraseWheelError("");
      applyConfig(outcome.result);
    } else if (outcome.status === "failed") {
      const err = outcome.error;
      reportPhraseWheelError(t(typeof err === "string" ? err : "Не удалось сохранить колесо фраз"));
    }
  });
}

function renderPhraseWheelSettings(): void {
  const settings = config.phraseWheel;
  byId<HTMLInputElement>("phrase-wheel-enabled").checked = settings.enabled;
  byId<HTMLInputElement>("phrase-wheel-hotkey").value = settings.hotkey;
  const deadZone = byId<HTMLInputElement>("phrase-wheel-dead-zone");
  deadZone.value = String(settings.deadZonePx);
  byId<HTMLElement>("phrase-wheel-dead-zone-value").textContent = `${settings.deadZonePx} px`;
  renderPhraseRows(settings.phrases);
}

function renderPhraseRows(phrases: string[]): void {
  const list = byId<HTMLElement>("phrase-wheel-phrases");
  list.innerHTML = "";
  phrases.forEach((phrase, index) => {
    const row = document.createElement("div");
    row.className = "phrase-wheel-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = phrase;
    input.maxLength = 160;
    input.dataset.phraseWheelText = "true";
    input.setAttribute("aria-label", t("Фраза {n}", { n: index + 1 }));
    input.addEventListener("change", savePhraseWheelSettings);
    row.appendChild(input);

    const move = (label: string, delta: number) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--small";
      button.textContent = label;
      button.disabled = index + delta < 0 || index + delta >= phrases.length;
      button.addEventListener("click", () => {
        const current = currentPhraseWheelSettings().phrases;
        [current[index], current[index + delta]] = [current[index + delta], current[index]];
        savePhraseList(current);
      });
      row.appendChild(button);
    };
    move("↑", -1);
    move("↓", 1);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--small";
    remove.textContent = t("Удалить");
    remove.disabled = phrases.length <= 2;
    remove.addEventListener("click", () => {
      // The live inputs, not the rendered list: an unsaved edit in another row stays.
      savePhraseList(currentPhraseWheelSettings().phrases.filter((_, itemIndex) => itemIndex !== index));
    });
    row.appendChild(remove);
    list.appendChild(row);
  });
  byId<HTMLButtonElement>("phrase-wheel-add").disabled = phrases.length >= 8;
}

function wirePhraseWheelSettings(): void {
  byId<HTMLInputElement>("phrase-wheel-enabled").addEventListener("change", savePhraseWheelSettings);
  byId<HTMLInputElement>("phrase-wheel-dead-zone").addEventListener("change", savePhraseWheelSettings);
  byId<HTMLInputElement>("phrase-wheel-hotkey").addEventListener("keydown", (event) => {
    const action = hotkeyFieldKeyAction(event);
    if (action === "navigate") return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "cancel") {
      renderPhraseWheelSettings();
      return;
    }
    if (action === "ignore") return;
    const combo = formatKeyCombo(event);
    if (combo === null) return;
    byId<HTMLInputElement>("phrase-wheel-hotkey").value = combo;
    savePhraseWheelSettings();
  });
  byId<HTMLButtonElement>("phrase-wheel-add").addEventListener("click", () => {
    const phrases = currentPhraseWheelSettings().phrases;
    if (phrases.length >= 8) return;
    savePhraseList([...phrases, t("Новая фраза")]);
  });
}

// ---- Feed appearance --------------------------------------------------

const FEED_INPUT_IDS = [
  "ttl-slider",
  "opacity-slider",
  "font-scale-slider",
  "shadow-slider",
  "fade-slider",
  "sticker-animation-slider",
  "text-color-input",
  "author-color-input",
  "message-layout-select",
  "show-author-checkbox",
  "show-message-time-checkbox",
  "incoming-bubble-color-input",
  "outgoing-bubble-color-input",
] as const;

function currentFeedSettings(): FeedAppearance {
  return {
    ttlMs: secondsToMs(Number(byId<HTMLInputElement>("ttl-slider").value)),
    opacity: Number(byId<HTMLInputElement>("opacity-slider").value),
    fontScale: Number(byId<HTMLInputElement>("font-scale-slider").value),
    shadow: Number(byId<HTMLInputElement>("shadow-slider").value),
    fadeMs: Number(byId<HTMLInputElement>("fade-slider").value),
    stickerAnimationSeconds: Number(byId<HTMLInputElement>("sticker-animation-slider").value),
    textColor: byId<HTMLInputElement>("text-color-input").value,
    authorColor: byId<HTMLInputElement>("author-color-input").value,
    messageLayout: byId<HTMLSelectElement>("message-layout-select").value as MessageLayout,
    showAuthor: byId<HTMLInputElement>("show-author-checkbox").checked,
    showMessageTime: byId<HTMLInputElement>("show-message-time-checkbox").checked,
    incomingBubbleColor: byId<HTMLInputElement>("incoming-bubble-color-input").value,
    outgoingBubbleColor: byId<HTMLInputElement>("outgoing-bubble-color-input").value,
  };
}

function applyFeedSettingsToInputs(settings: FeedAppearance): void {
  byId<HTMLInputElement>("ttl-slider").value = String(msToSeconds(settings.ttlMs));
  byId<HTMLInputElement>("opacity-slider").value = String(settings.opacity);
  byId<HTMLInputElement>("font-scale-slider").value = String(settings.fontScale);
  byId<HTMLInputElement>("shadow-slider").value = String(settings.shadow);
  byId<HTMLInputElement>("fade-slider").value = String(settings.fadeMs);
  byId<HTMLInputElement>("sticker-animation-slider").value = String(settings.stickerAnimationSeconds);
  byId<HTMLInputElement>("text-color-input").value = settings.textColor;
  byId<HTMLInputElement>("author-color-input").value = settings.authorColor;
  byId<HTMLSelectElement>("message-layout-select").value = settings.messageLayout;
  byId<HTMLInputElement>("show-author-checkbox").checked = settings.showAuthor;
  byId<HTMLInputElement>("show-message-time-checkbox").checked = settings.showMessageTime;
  byId<HTMLInputElement>("incoming-bubble-color-input").value = settings.incomingBubbleColor;
  byId<HTMLInputElement>("outgoing-bubble-color-input").value = settings.outgoingBubbleColor;
}

function textShadowFor(strength: number): string {
  const blur = (2 + strength * 6).toFixed(1);
  const alpha = strength.toFixed(2);
  return `0 1px ${blur}px rgba(0, 0, 0, ${alpha})`;
}

function updatePreview(settings: FeedAppearance): void {
  byId<HTMLElement>("ttl-value").textContent = formatTtlLabel(msToSeconds(settings.ttlMs));
  byId<HTMLElement>("opacity-value").textContent = formatOpacityLabel(settings.opacity);
  byId<HTMLElement>("font-scale-value").textContent = formatFontScaleLabel(settings.fontScale);
  byId<HTMLElement>("shadow-value").textContent = formatShadowLabel(settings.shadow);
  byId<HTMLElement>("fade-value").textContent = formatFadeLabel(settings.fadeMs);
  byId<HTMLElement>("sticker-animation-value").textContent = formatStickerAnimationSeconds(settings.stickerAnimationSeconds);

  const shadow = textShadowFor(settings.shadow);
  const fontSize = `${(13 * settings.fontScale).toFixed(1)}px`;
  const surface = byId<HTMLElement>("feed-preview-surface");
  surface.classList.toggle("feed-preview__surface--dialogue", settings.messageLayout === "dialogue");
  surface.classList.toggle("feed-preview__surface--without-authors", !settings.showAuthor);
  surface.classList.toggle("feed-preview__surface--without-time", !settings.showMessageTime);
  surface.style.setProperty("--preview-incoming-bubble-color", settings.incomingBubbleColor);
  surface.style.setProperty("--preview-outgoing-bubble-color", settings.outgoingBubbleColor);
  surface.style.setProperty("--preview-bubble-opacity", `${Math.round(settings.opacity * 100)}%`);

  for (const message of surface.querySelectorAll<HTMLElement>(".feed-preview__message")) {
    message.style.background = settings.messageLayout === "compact" ? `rgba(20, 22, 30, ${settings.opacity})` : "";
    message.style.fontSize = fontSize;

    const author = message.querySelector<HTMLElement>(".feed-preview__author");
    if (author) {
      author.style.color = settings.authorColor;
      author.style.textShadow = shadow;
    }

    const text = message.querySelector<HTMLElement>(".feed-preview__text");
    if (text) {
      text.style.color = settings.textColor;
      text.style.textShadow = shadow;
    }
  }
}

function updateResetButtonState(settings: FeedAppearance): void {
  const resetBtn = byId<HTMLButtonElement>("reset-feed-defaults");
  resetBtn.disabled = feedSettingsEqual(settings, DEFAULT_FEED_SETTINGS);
}

const sendFeedSettings = debounce((settings: FeedAppearance) => {
  const textColorError = validateHexColor(settings.textColor);
  const authorColorError = validateHexColor(settings.authorColor);
  const incomingBubbleColorError = validateHexColor(settings.incomingBubbleColor);
  const outgoingBubbleColorError = validateHexColor(settings.outgoingBubbleColor);
  byId<HTMLElement>("text-color-error").textContent = textColorError ?? "";
  byId<HTMLElement>("author-color-error").textContent = authorColorError ?? "";
  byId<HTMLElement>("incoming-bubble-color-error").textContent = incomingBubbleColorError ?? "";
  byId<HTMLElement>("outgoing-bubble-color-error").textContent = outgoingBubbleColorError ?? "";
  if (textColorError || authorColorError || incomingBubbleColorError || outgoingBubbleColorError) return;

  const normalized: FeedAppearance = {
    ...settings,
    textColor: normalizeHexColor(settings.textColor) ?? settings.textColor,
    authorColor: normalizeHexColor(settings.authorColor) ?? settings.authorColor,
    incomingBubbleColor: normalizeHexColor(settings.incomingBubbleColor) ?? settings.incomingBubbleColor,
    outgoingBubbleColor: normalizeHexColor(settings.outgoingBubbleColor) ?? settings.outgoingBubbleColor,
  };

  void invokeConfig("set_feed_settings", { settings: normalized }).then(applyConfig).catch(reportBackendError);
}, 300);

function wireFeedInputs(): void {
  for (const id of FEED_INPUT_IDS) {
    byId<HTMLInputElement | HTMLSelectElement>(id).addEventListener("input", () => {
      const settings = currentFeedSettings();
      updatePreview(settings);
      updateResetButtonState(settings);
      sendFeedSettings(settings);
    });
  }

  byId<HTMLButtonElement>("reset-feed-defaults").addEventListener("click", () => {
    sendFeedSettings.cancel();
    applyFeedSettingsToInputs(DEFAULT_FEED_SETTINGS);
    updatePreview(DEFAULT_FEED_SETTINGS);
    updateResetButtonState(DEFAULT_FEED_SETTINGS);
    void invokeConfig("set_feed_settings", { settings: DEFAULT_FEED_SETTINGS })
      .then(applyConfig)
      .catch(reportBackendError);
  });

  byId<HTMLButtonElement>("preview-bg-toggle").addEventListener("click", () => {
    const surface = byId<HTMLElement>("feed-preview-surface");
    const toggle = byId<HTMLButtonElement>("preview-bg-toggle");
    const isLight = surface.classList.toggle("feed-preview__surface--light");
    toggle.setAttribute("aria-pressed", String(isLight));
    toggle.textContent = t(isLight ? "Тёмный фон" : "Светлый фон");
  });
}

function renderFeedSettings(): void {
  const settings: FeedAppearance = {
    ttlMs: config.ttlMs,
    opacity: config.opacity,
    fontScale: config.fontScale,
    textColor: config.textColor,
    authorColor: config.authorColor,
    shadow: config.shadow,
    fadeMs: config.fadeMs,
    stickerAnimationSeconds: config.stickerAnimationSeconds,
    messageLayout: config.messageLayout,
    showAuthor: config.showAuthor,
    showMessageTime: config.showMessageTime,
    incomingBubbleColor: config.incomingBubbleColor,
    outgoingBubbleColor: config.outgoingBubbleColor,
  };

  applyFeedSettingsToInputs(settings);
  updatePreview(settings);
  updateResetButtonState(settings);
}

// ---- Flags ------------------------------------------------------------

function wireFlagInputs(): void {
  const autostart = byId<HTMLInputElement>("autostart-checkbox");
  const demoFeed = byId<HTMLInputElement>("demo-feed-checkbox");

  const handler = () => {
    void invokeConfig("set_flags", { autostart: autostart.checked, demoFeed: demoFeed.checked })
      .then(applyConfig)
      .catch(reportBackendError);
  };

  autostart.addEventListener("change", handler);
  demoFeed.addEventListener("change", handler);

  const language = byId<HTMLSelectElement>("language-select");
  language.addEventListener("change", () => {
    void invokeConfig("set_language", { language: language.value as LanguageSetting })
      .then(applyConfig)
      .catch(reportBackendError);
  });
}

function renderFlags(): void {
  byId<HTMLSelectElement>("language-select").value = config.language ?? "auto";
  byId<HTMLInputElement>("autostart-checkbox").checked = config.autostart;
  byId<HTMLInputElement>("demo-feed-checkbox").checked = config.demoFeed;
}

// ---- Telegram: connection status and countdown ---------------------------

function stopCountdown(): void {
  if (countdownTimer !== undefined) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
  waitDeadline = null;
}

function renderTelegramStatusText(): void {
  const badge = byId<HTMLElement>("tg-status-badge");
  let status = tgStatus;

  if (waitDeadline !== null) {
    const remaining = Math.max(0, Math.round((waitDeadline - Date.now()) / 1000));
    status = { ...tgStatus, waitSeconds: remaining };
  }

  badge.textContent = describeTelegramStatus(status);
  badge.dataset.state = tgStatus.state;
  renderReadiness();

  const retry = byId<HTMLButtonElement>("tg-reconnect-now");
  const action = reconnectAction(status);
  retry.hidden = !action.visible;
  retry.disabled = action.disabled;
}

function handleTgStatus(status: TgStatus): void {
  const becameConnected = tgStatus.state !== "connected" && status.state === "connected";
  tgStatus = status;
  stopCountdown();

  if (status.waitSeconds && status.waitSeconds > 0) {
    waitDeadline = Date.now() + status.waitSeconds * 1000;
    countdownTimer = setInterval(() => {
      if (waitDeadline === null) return;
      renderTelegramStatusText();
      if (Date.now() >= waitDeadline) stopCountdown();
    }, 1000);
  }

  renderTelegramSection();
  renderRelaySection();
  if (becameConnected && !isRelay()) requestTelegramDialogs();
}

// ---- Telegram: login form -------------------------------------------------

const LOGIN_STEP_UI: Record<
  "phone" | "code" | "password",
  { label: string; hint: string; placeholder: string; submitLabel: string; inputType: string }
> = {
  phone: {
    label: "Номер телефона",
    hint: "Международный формат, например +79261234567",
    placeholder: "+79261234567",
    submitLabel: "Отправить код",
    inputType: "text",
  },
  code: {
    label: "Код из Telegram",
    hint: "Пришёл в приложении Telegram или по SMS",
    placeholder: "12345",
    submitLabel: "Подтвердить",
    inputType: "text",
  },
  password: {
    label: "Пароль (двухфакторная аутентификация)",
    hint: "Только если для аккаунта включён облачный пароль",
    placeholder: "",
    submitLabel: "Войти",
    inputType: "password",
  },
};

function renderLoginForm(): void {
  const step = currentLoginStep(tgStatus, lastLoginStep);
  const ui = LOGIN_STEP_UI[step];
  const input = byId<HTMLInputElement>("tg-login-input");
  const busy = tgStatus.state === "connecting";
  const hint = step === "code" && tgStatus.phone ? t("Код отправлен на {phone}. Проверьте Telegram или SMS", { phone: tgStatus.phone }) : t(ui.hint);

  byId<HTMLLabelElement>("tg-login-label").textContent = t(ui.label);
  byId<HTMLElement>("tg-login-hint").textContent = hint;
  if (shouldClearLoginInput(renderedLoginStep, step)) input.value = "";
  renderedLoginStep = step;
  if (document.activeElement !== input) input.type = ui.inputType;
  input.placeholder = ui.placeholder;
  input.disabled = busy;
  byId<HTMLButtonElement>("tg-login-submit").textContent = t(ui.submitLabel);
  byId<HTMLButtonElement>("tg-login-submit").disabled = busy;

  byId<HTMLElement>("tg-login-error").textContent = tgStatus.state === "error" ? t(tgStatus.error ?? "Ошибка") : "";
}

function wireLoginForm(): void {
  const input = byId<HTMLInputElement>("tg-login-input");
  const errorEl = byId<HTMLElement>("tg-login-error");

  input.addEventListener("input", () => {
    if (currentLoginStep(tgStatus, lastLoginStep) === "code") {
      input.value = input.value.replace(/\D/g, "");
    }
  });

  byId<HTMLFormElement>("tg-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const step = currentLoginStep(tgStatus, lastLoginStep);
    const raw = input.value;

    let value = raw;
    let validationError: string | undefined;
    if (step === "phone") {
      value = normalizePhone(raw);
      validationError = validatePhone(value);
    } else if (step === "code") {
      validationError = raw.trim() ? undefined : t("Введите код");
    } else {
      validationError = raw ? undefined : t("Введите пароль");
    }

    if (validationError) {
      errorEl.textContent = validationError;
      return;
    }

    errorEl.textContent = "";
    lastLoginStep = step;
    if (step === "password") input.value = ""; // don't leave the password sitting in the field
    void invokeVoid("tg_login_step", { step, value }).catch(reportBackendError);
  });

  byId<HTMLButtonElement>("tg-logout").addEventListener("click", () => {
    void invokeVoid("tg_logout").catch(reportBackendError);
  });
}

// ---- Telegram: chat picker -------------------------------------------------

function renderChatList(list: ChatRef[]): void {
  const ul = byId<HTMLElement>("tg-chat-list");
  ul.innerHTML = "";

  for (const chat of list) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const canMirror = chat.kind === "chat" || Boolean(chat.accessHash);
    btn.disabled = !canMirror;
    const title = document.createElement("span");
    title.className = "tg-chat-list__title";
    title.textContent = `${chat.title} · ${describeChatKind(chat.kind, chat.isBot)}`;
    const details = document.createElement("span");
    details.className = "tg-chat-list__details";
    details.textContent = [
      chat.username ? `@${chat.username}` : null,
      `ID: ${chat.id}`,
      canMirror ? null : t("Откройте этот чат в Telegram и обновите список"),
    ].filter(Boolean).join(" · ");
    btn.append(title, details);
    if (isChatEqual(chat, config.chat)) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", async () => {
      try {
        applyConfig(await invokeConfig("set_chat", { chat }));
        chatPickerOpen = false;
        renderChatPicker();
      } catch (err) {
        reportBackendError(err);
      }
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }

  const message = chatPickerMessage(dialogLoadState, list.length, byId<HTMLInputElement>("tg-chat-search").value);
  if (message) {
    const li = document.createElement("li");
    li.className = "tg-chat-list__empty";
    li.textContent = message;
    ul.appendChild(li);

    if (dialogLoadState.state === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn";
      retry.textContent = t("Повторить загрузку");
      retry.addEventListener("click", () => requestTelegramDialogs());
      li.appendChild(retry);
    }
  }
}

function handleTgDialogs(payload: { dialogs: ChatRef[]; error?: string | null; query?: string | null }): void {
  const currentQuery = byId<HTMLInputElement>("tg-chat-search").value.trim();
  if ((payload.query ?? "").trim() !== currentQuery) return;
  tgDialogs = payload.dialogs;
  dialogLoadState = payload.error ? { state: "error", error: payload.error } : { state: "ready" };
  renderChatList(filterDialogs(tgDialogs, currentQuery));
}

function requestTelegramDialogs(query: string | null = null): void {
  dialogLoadState = { state: "loading" };
  renderChatList([]);
  void invokeVoid("tg_request_dialogs", { query: query?.trim() || null }).catch((err) => {
    dialogLoadState = { state: "error", error: err instanceof Error ? err.message : "Команда не выполнилась" };
    renderChatList([]);
  });
}

function renderChatPicker(): void {
  const connected = tgStatus.state === "connected";
  const toggle = byId<HTMLButtonElement>("tg-chat-toggle");
  const search = byId<HTMLInputElement>("tg-chat-search");
  const picker = byId<HTMLElement>("tg-chat-picker");
  const currentEl = byId<HTMLElement>("tg-chat-current");

  toggle.disabled = !connected;
  search.disabled = !connected;
  const open = connected && chatPickerOpen;
  picker.hidden = !open;
  toggle.textContent = t(open ? "Отмена" : "Сменить");

  if (!connected) {
    currentEl.textContent = t("Подключите Telegram, чтобы выбрать чат");
  } else if (config.chat) {
    currentEl.textContent = t("В оверлее: {chat}. Другие чаты не показываются.", { chat: `${config.chat.title} · ${describeChatKind(config.chat.kind, config.chat.isBot)}` });
  } else {
    currentEl.textContent = t("Чат не выбран — оверлею пока нечего показывать");
  }
}

function wireChatPicker(): void {
  byId<HTMLButtonElement>("tg-chat-toggle").addEventListener("click", () => {
    if (tgStatus.state !== "connected") return;
    chatPickerOpen = !chatPickerOpen;
    if (chatPickerOpen) {
      const search = byId<HTMLInputElement>("tg-chat-search");
      search.value = "";
      renderChatList(filterDialogs(tgDialogs, ""));
      requestTelegramDialogs();
    }
    renderChatPicker();
  });

  byId<HTMLInputElement>("tg-chat-search").addEventListener("input", (event) => {
    const query = (event.target as HTMLInputElement).value;
    renderChatList(filterDialogs(tgDialogs, query));
    if (dialogSearchTimer) clearTimeout(dialogSearchTimer);
    dialogSearchTimer = setTimeout(() => requestTelegramDialogs(query), 250);
  });
}

// ---- Telegram: own API keys -------------------------------------------------

function renderApiKeys(): void {
  const idInput = byId<HTMLInputElement>("tg-api-id-input");
  if (document.activeElement !== idInput) {
    idInput.value = config.apiId ? String(config.apiId) : "";
  }
  idInput.placeholder = t(builtinKeys ? "Используются встроенные ключи" : "Например, 1234567");
  byId<HTMLElement>("tg-api-keys-hint").textContent = t(builtinKeys
    ? "Приложение уже работает со встроенными ключами — свои нужны только для отладки или обхода лимитов, большинству это не требуется."
    : "В этой сборке нет встроенных ключей. Получите свои api_id и api_hash на my.telegram.org → API development tools и сохраните их здесь: они остаются только на этом компьютере.");
  const clear = byId<HTMLButtonElement>("tg-api-keys-clear");
  clear.hidden = !config.apiId;
  clear.textContent = t(builtinKeys ? "Вернуть встроенные ключи" : "Удалить ключи");
  if (!builtinKeys && !config.apiId && !apiKeysAutoOpened) {
    apiKeysAutoOpened = true;
    byId<HTMLDetailsElement>("tg-api-keys").open = true;
  }
}

function wireApiKeysForm(): void {
  byId<HTMLButtonElement>("tg-api-keys-save").addEventListener("click", () => {
    const idInput = byId<HTMLInputElement>("tg-api-id-input");
    const hashInput = byId<HTMLInputElement>("tg-api-hash-input");
    const idError = byId<HTMLElement>("tg-api-id-error");
    const hashError = byId<HTMLElement>("tg-api-hash-error");

    const idValidation = validateApiId(idInput.value);
    const hashValidation = validateApiHash(hashInput.value);
    idError.textContent = idValidation ?? "";
    hashError.textContent = hashValidation ?? "";
    if (idValidation || hashValidation) return;

    const apiId = parseApiId(idInput.value) as number;
    const apiHash = hashInput.value.trim();
    hashInput.value = ""; // don't leave the hash sitting in the field once it's sent

    void invokeConfig("tg_save_api_keys", { apiId, apiHash }).then(applyConfig).catch(reportBackendError);
  });
  byId<HTMLButtonElement>("tg-api-keys-clear").addEventListener("click", () => {
    void invokeConfig("tg_clear_api_keys").then(applyConfig).catch(reportBackendError);
  });
}

// ---- Telegram: section orchestration --------------------------------------

function renderDemoFeedHint(): void {
  const connected = tgStatus.state === "connected";
  const checkbox = byId<HTMLInputElement>("demo-feed-checkbox");
  const hint = byId<HTMLElement>("demo-feed-hint");

  checkbox.disabled = connected;
  hint.textContent = t(connected
    ? "Недоступно: Telegram подключён, в ленте настоящие сообщения."
    : "Работает только пока Telegram не подключён.");
}

function renderTelegramSection(): void {
  renderTelegramStatusText();

  const connected = tgStatus.state === "connected";
  byId<HTMLElement>("tg-login-row").hidden = connected;
  byId<HTMLElement>("tg-connected-row").hidden = !connected;

  if (connected) {
    byId<HTMLElement>("tg-connected-line").textContent = tgStatus.phone
      ? t("Подключено: {phone}", { phone: tgStatus.phone })
      : t("Подключено");
  } else {
    renderLoginForm();
    if (chatPickerOpen) chatPickerOpen = false; // picking a chat only makes sense while connected
  }

  renderChatPicker();
  renderApiKeys();
  renderDemoFeedHint();
}

function wireTelegramSection(): void {
  wireLoginForm();
  wireChatPicker();
  wireApiKeysForm();
  byId<HTMLButtonElement>("tg-reconnect-now").addEventListener("click", () => {
    const retry = byId<HTMLButtonElement>("tg-reconnect-now");
    retry.disabled = true;
    void invokeVoid("tg_reconnect_now").catch(reportBackendError);
  });
}

// ---- Transport switch and the relay server ---------------------------------

function isRelay(): boolean {
  return config.transport === "relay";
}

const TRANSPORT_HINTS: Record<Transport, string> = {
  telegram: "Оверлей показывает выбранный чат или группу Telegram.",
  relay: "Оверлей показывает комнату на вашем сервере со сквозным шифрованием. Telegram при этом не используется.",
};

function renderTransport(): void {
  const relay = isRelay();
  byId<HTMLButtonElement>("transport-telegram").setAttribute("aria-pressed", String(!relay));
  byId<HTMLButtonElement>("transport-relay").setAttribute("aria-pressed", String(relay));
  byId<HTMLElement>("transport-hint").textContent = t(TRANSPORT_HINTS[relay ? "relay" : "telegram"]);
  byId<HTMLElement>("telegram-card").hidden = relay;
  byId<HTMLElement>("relay-card").hidden = !relay;
  const nav = byId<HTMLAnchorElement>("nav-transport-link");
  nav.textContent = relay ? t("Сервер") : "Telegram";
  nav.href = relay ? "#relay-heading" : "#telegram-heading";
}

function wireTransport(): void {
  for (const transport of ["telegram", "relay"] as const) {
    byId<HTMLButtonElement>(`transport-${transport}`).addEventListener("click", () => {
      if ((config.transport ?? "telegram") === transport) return;
      const errorEl = byId<HTMLElement>("transport-error");
      errorEl.textContent = "";
      void invokeConfig("set_transport", { transport }).then(applyConfig).catch((err) => {
        errorEl.textContent = t(typeof err === "string" ? err : "Не удалось переключить способ связи");
      });
    });
  }
}

async function loadRelaySecrets(): Promise<void> {
  if (!hasTauri()) return;
  try {
    relaySecrets = await safeInvoke<RelaySecretState>("relay_secret_state");
  } catch (err) {
    reportBackendError(err);
  }
}

const RELAY_TEXT_FIELDS = ["relay-url-input", "relay-room-input", "relay-name-input"] as const;

function renderRelaySection(): void {
  const relay = config.relay ?? { url: "", room: "", displayName: "" };
  const values: Record<(typeof RELAY_TEXT_FIELDS)[number], string> = {
    "relay-url-input": relay.url,
    "relay-room-input": relay.room,
    "relay-name-input": relay.displayName,
  };
  for (const id of RELAY_TEXT_FIELDS) {
    const input = byId<HTMLInputElement>(id);
    if (document.activeElement !== input && !input.dataset.dirty) input.value = values[id];
  }
  byId<HTMLInputElement>("relay-access-key-input").placeholder = t(relaySecrets.hasAccessKey
    ? "Сохранён — оставьте пустым, чтобы не менять"
    : "Не меньше 16 символов");
  byId<HTMLInputElement>("relay-password-input").placeholder = relaySecrets.hasPassword
    ? t("Сохранён — оставьте пустым, чтобы не менять")
    : "";
  byId<HTMLButtonElement>("relay-forget").hidden = !relaySecrets.hasAccessKey && !relaySecrets.hasPassword;

  const relayActive = isRelay();
  const badge = byId<HTMLElement>("relay-status-badge");
  badge.textContent = relayActive ? describeTelegramStatus(tgStatus) : t("Не используется");
  badge.dataset.state = relayActive ? tgStatus.state : "offline";
  const retry = byId<HTMLButtonElement>("relay-reconnect-now");
  const action = reconnectAction(tgStatus);
  retry.hidden = !relayActive || !action.visible;
  retry.disabled = action.disabled;
  const errorEl = byId<HTMLElement>("relay-error");
  if (!errorEl.dataset.local) {
    errorEl.textContent = relayActive && (tgStatus.state === "error" || tgStatus.state === "offline")
      ? t(tgStatus.error ?? "")
      : "";
  }
}

function wireRelayForm(): void {
  for (const id of RELAY_TEXT_FIELDS) {
    byId<HTMLInputElement>(id).addEventListener("input", (event) => {
      (event.target as HTMLInputElement).dataset.dirty = "true";
    });
  }
  const errorEl = byId<HTMLElement>("relay-error");
  const showError = (message: string): void => {
    errorEl.dataset.local = "true";
    errorEl.textContent = message;
  };
  const backendMessage = (err: unknown): string =>
    t(typeof err === "string" ? err : err instanceof Error ? err.message : "Не удалось сохранить");

  byId<HTMLFormElement>("relay-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const settings: RelaySettings = {
      url: byId<HTMLInputElement>("relay-url-input").value.trim(),
      room: byId<HTMLInputElement>("relay-room-input").value.trim(),
      displayName: byId<HTMLInputElement>("relay-name-input").value.trim(),
    };
    const keyInput = byId<HTMLInputElement>("relay-access-key-input");
    const passwordInput = byId<HTMLInputElement>("relay-password-input");
    const accessKey = keyInput.value.trim();
    const password = passwordInput.value;
    if (!settings.url) return showError(t("Укажите адрес сервера, например 203.0.113.10:8790"));
    if (!settings.room) return showError(t("Укажите комнату"));
    if (!accessKey && !relaySecrets.hasAccessKey) return showError(t("Укажите ключ доступа к серверу"));
    if (accessKey && accessKey.length < 16) return showError(t("Ключ доступа короче 16 символов"));
    if (!password && !relaySecrets.hasPassword) return showError(t("Придумайте пароль комнаты и передайте его друзьям"));
    delete errorEl.dataset.local;
    errorEl.textContent = "";

    void invokeConfig("set_relay_settings", {
      settings,
      accessKey: accessKey || null,
      password: password || null,
    }).then(async (next) => {
      keyInput.value = "";
      passwordInput.value = "";
      for (const id of RELAY_TEXT_FIELDS) delete byId<HTMLInputElement>(id).dataset.dirty;
      await loadRelaySecrets();
      applyConfig(next);
    }).catch((err) => showError(backendMessage(err)));
  });

  byId<HTMLButtonElement>("relay-forget").addEventListener("click", () => {
    void invokeConfig("set_relay_settings", {
      settings: config.relay ?? { url: "", room: "", displayName: "" },
      accessKey: "",
      password: "",
    }).then(async (next) => {
      await loadRelaySecrets();
      applyConfig(next);
    }).catch((err) => showError(backendMessage(err)));
  });

  byId<HTMLButtonElement>("relay-reconnect-now").addEventListener("click", () => {
    byId<HTMLButtonElement>("relay-reconnect-now").disabled = true;
    void invokeVoid("tg_reconnect_now").catch(reportBackendError);
  });
}

// ---- Overlay status badge -----------------------------------------------

interface OverlayStatePayload {
  kind: "off" | "hidden" | "inactive" | "active";
  gameExe: string | null;
}

const OVERLAY_STATE_LABELS: Record<OverlayStatePayload["kind"], (exe: string | null) => string> = {
  off: () => t("Оверлей выключен"),
  hidden: () => t("Игра свёрнута — оверлей скрыт"),
  inactive: (exe) => (exe ? t("Наготове: {exe}", { exe }) : t("Наготове")),
  active: (exe) => (exe ? t("Чат открыт: {exe}", { exe }) : t("Чат открыт")),
};

function renderOverlayStatus(state: OverlayStatePayload): void {
  const badge = byId<HTMLElement>("overlay-status");
  badge.textContent = OVERLAY_STATE_LABELS[state.kind](state.gameExe);
  badge.dataset.state = state.kind;
}

// ---- Bootstrap ------------------------------------------------------------

async function init(): Promise<void> {
  try {
    config = await invokeConfig("get_config");
  } catch (err) {
    reportBackendError(err);
    config = createDemoConfig();
  }

  if (hasTauri()) {
    try {
      builtinKeys = await safeInvoke<boolean>("tg_builtin_keys_available");
    } catch (err) {
      reportBackendError(err);
    }
  }
  await loadRelaySecrets();

  applyLocale();
  wireTransport();
  wireRelayForm();
  wireTelegramSection();
  wireReadiness();
  wireProfileAdder();
  wireProfileCandidateRefresh();
  wireHotkeyInputs();
  wireDirectionSettings();
  wirePhraseWheelSettings();
  wireFeedInputs();
  wireFlagInputs();
  render();

  await safeListen<Config>("config:changed", (next) => {
    // While a phrase wheel save is in flight the page's own list is newer
    // than the intermediate configs the earlier saves broadcast.
    const incoming = phraseWheelSaver.busy ? { ...next, phraseWheel: config.phraseWheel } : next;
    if (configsEqual(config, incoming)) return;
    applyConfig(incoming);
  });

  await safeListen<OverlayStatePayload>("overlay:state", renderOverlayStatus);
  await safeListen<string | null>("overlay:chat_shortcut_error", (error) => {
    chatShortcutError = error;
    renderHotkeys();
  });
  await subscribeEvent<TgStatus>("tg:status", handleTgStatus);
  await subscribeEvent<{ dialogs: ChatRef[]; error?: string | null }>("tg:dialogs", handleTgDialogs);

  try {
    handleTgStatus(await loadCurrentTelegramStatus());
  } catch (err) {
    reportBackendError(err);
    render();
  }
  if (hasTauri()) {
    try {
      chatShortcutError = await safeInvoke<string | null>("get_chat_shortcut_error");
      renderHotkeys();
    } catch (err) {
      reportBackendError(err);
    }
  }
  void refreshProfileCandidates();
}

window.addEventListener("DOMContentLoaded", () => {
  void init();
});
