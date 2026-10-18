import { normalizeHexColor } from "./color";
import { validateHotkeyCombo } from "./hotkey";
import { normalizeProfileExecutable } from "./profile-input";
import type { ChatRef, Config, DirectionSettings, FeedSettings, Flags, PhraseWheelSettings, Profile, RelaySettings, Transport } from "./types";
import { normalizeDirectionSettings, validateDirectionSettings } from "./direction-settings";
import { normalizePhraseWheelSettings, validatePhrase } from "./phrase-wheel-settings";

const TTL_MIN_MS = 3000;
const TTL_MAX_MS = 60_000;
const OPACITY_MIN = 0;
const OPACITY_MAX = 1;
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.6;
const SHADOW_MIN = 0;
const SHADOW_MAX = 1;
const FADE_MIN_MS = 0;
const FADE_MAX_MS = 5000;
const STICKER_ANIMATION_MIN_SECONDS = 0;
const STICKER_ANIMATION_MAX_SECONDS = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Stands in for the Rust backend when the page runs outside Tauri (plain
 * browser smoke test, or manual UI review). Mirrors the command semantics
 * from CONTRACT.md closely enough to exercise the whole settings window.
 */
export class DemoBackend {
  private config: Config;
  private nextAddedIndex = 1;

  constructor(initial: Config) {
    this.config = initial;
  }

  getConfig(): Config {
    return this.config;
  }

  setTransport(transport: Transport): Config {
    this.config = { ...this.config, transport };
    return this.config;
  }

  setRelaySettings(relay: RelaySettings): Config {
    this.config = { ...this.config, relay };
    return this.config;
  }

  setHotkey(hotkey: string): Config {
    const error = validateHotkeyCombo(hotkey, true);
    if (error) throw error;
    if ([this.config.markupHotkey, this.config.phraseWheel.hotkey].some((reserved) => hotkey.toLowerCase() === reserved.toLowerCase())) {
      throw "Эта комбинация уже используется для разметки зон";
    }
    this.config = { ...this.config, hotkey };
    return this.config;
  }

  setMarkupHotkey(hotkey: string): Config {
    const error = validateHotkeyCombo(hotkey);
    if (error) throw error;
    if ([this.config.hotkey, this.config.phraseWheel.hotkey].some((reserved) => hotkey.toLowerCase() === reserved.toLowerCase())) {
      throw "Эта комбинация уже используется для показа чата";
    }
    this.config = { ...this.config, markupHotkey: hotkey };
    return this.config;
  }

  setDirectionSettings(settings: DirectionSettings): Config {
    const normalized = normalizeDirectionSettings(settings);
    const error = validateDirectionSettings(normalized);
    if (error) throw error;
    this.config = { ...this.config, directionSignals: normalized };
    return this.config;
  }

  setPhraseWheelSettings(settings: PhraseWheelSettings): Config {
    const normalized = normalizePhraseWheelSettings(settings);
    const hotkeyError = validateHotkeyCombo(normalized.hotkey);
    if (hotkeyError) throw hotkeyError;
    const reservedHotkeys = [this.config.hotkey, this.config.markupHotkey];
    if (reservedHotkeys.some((hotkey) => hotkey.toLowerCase() === normalized.hotkey.toLowerCase())) {
      throw "Это сочетание уже используется другой функцией приложения";
    }
    if (normalized.phrases.length < 2 || normalized.phrases.length > 8) throw "Добавьте от 2 до 8 фраз";
    for (const phrase of normalized.phrases) {
      const error = validatePhrase(phrase);
      if (error) throw error;
    }
    this.config = { ...this.config, phraseWheel: normalized };
    return this.config;
  }

  setFeedSettings(settings: FeedSettings): Config {
    const textColor =
      settings.textColor !== undefined
        ? (normalizeHexColor(settings.textColor) ?? this.config.textColor)
        : this.config.textColor;
    const authorColor =
      settings.authorColor !== undefined
        ? (normalizeHexColor(settings.authorColor) ?? this.config.authorColor)
        : this.config.authorColor;
    const shadow =
      settings.shadow !== undefined ? clamp(settings.shadow, SHADOW_MIN, SHADOW_MAX) : this.config.shadow;
    const fadeMs =
      settings.fadeMs !== undefined ? clamp(settings.fadeMs, FADE_MIN_MS, FADE_MAX_MS) : this.config.fadeMs;
    const stickerAnimationSeconds =
      settings.stickerAnimationSeconds !== undefined
        ? clamp(settings.stickerAnimationSeconds, STICKER_ANIMATION_MIN_SECONDS, STICKER_ANIMATION_MAX_SECONDS)
        : this.config.stickerAnimationSeconds;
    const incomingBubbleColor =
      settings.incomingBubbleColor !== undefined
        ? (normalizeHexColor(settings.incomingBubbleColor) ?? this.config.incomingBubbleColor)
        : this.config.incomingBubbleColor;
    const outgoingBubbleColor =
      settings.outgoingBubbleColor !== undefined
        ? (normalizeHexColor(settings.outgoingBubbleColor) ?? this.config.outgoingBubbleColor)
        : this.config.outgoingBubbleColor;
    const messageLayout =
      settings.messageLayout === "compact" || settings.messageLayout === "dialogue"
        ? settings.messageLayout
        : this.config.messageLayout;
    const showAuthor = settings.showAuthor ?? this.config.showAuthor;
    const showMessageTime = settings.showMessageTime ?? this.config.showMessageTime;

    this.config = {
      ...this.config,
      ttlMs: clamp(settings.ttlMs, TTL_MIN_MS, TTL_MAX_MS),
      opacity: clamp(settings.opacity, OPACITY_MIN, OPACITY_MAX),
      fontScale: clamp(settings.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX),
      textColor,
      authorColor,
      shadow,
      fadeMs,
      stickerAnimationSeconds,
      incomingBubbleColor,
      outgoingBubbleColor,
      messageLayout,
      showAuthor,
      showMessageTime,
    };
    return this.config;
  }

  setFlags(flags: Flags): Config {
    this.config = { ...this.config, ...flags };
    return this.config;
  }

  upsertProfile(profile: Profile): Config {
    const exists = this.config.profiles.some((p) => p.exe === profile.exe);
    const profiles = exists
      ? this.config.profiles.map((p) => (p.exe === profile.exe ? profile : p))
      : [...this.config.profiles, profile];

    this.config = { ...this.config, profiles };
    return this.config;
  }

  removeProfile(exe: string): Config {
    this.config = { ...this.config, profiles: this.config.profiles.filter((p) => p.exe !== exe) };
    return this.config;
  }

  addCurrentApp(): Config {
    const exe = `sample-app-${this.nextAddedIndex}.exe`;
    this.nextAddedIndex += 1;

    const profile: Profile = {
      exe,
      title: `Тестовое приложение ${this.nextAddedIndex - 1}`,
      mode: "show",
      inactive: { x: 0.02, y: 0.75, width: 0.28, height: 0.2 },
      active: { x: 0.02, y: 0.4, width: 0.28, height: 0.55 },
    };

    return this.upsertProfile(profile);
  }

  addProfileByExe(value: string): Config {
    const exe = normalizeProfileExecutable(value);
    if (!exe) throw "Укажите имя файла с расширением .exe";

    if (this.config.profiles.some((profile) => profile.exe === exe)) return this.config;

    return this.upsertProfile({
      exe,
      title: exe.replace(/\.exe$/i, ""),
      mode: "show",
      inactive: { x: 0.02, y: 0.75, width: 0.28, height: 0.2 },
      active: { x: 0.02, y: 0.4, width: 0.28, height: 0.55 },
    });
  }

  toggleMarkup(_on: boolean): void {
    // No overlay window to notify in the demo backend; kept for interface parity.
  }

  setChat(chat: ChatRef | null): Config {
    this.config = { ...this.config, chat };
    return this.config;
  }

  saveApiKeys(apiId: number, _apiHash: string): Config {
    // Mirrors CONTRACT.md: Config only ever carries apiId, the hash is never echoed back.
    this.config = { ...this.config, apiId };
    return this.config;
  }

  clearApiKeys(): Config {
    this.config = { ...this.config, apiId: undefined };
    return this.config;
  }
}
