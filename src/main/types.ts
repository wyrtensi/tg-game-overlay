import type { Zone } from "../core/zones";

/** Mirrors the Rust-side Config/Profile shapes from CONTRACT.md. */
export type ProfileMode = "show" | "hidden" | "blocked";

export interface Profile {
  exe: string;
  title: string;
  mode: ProfileMode;
  inactive: Zone;
  active: Zone;
}

export interface ProfileCandidate {
  exe: string;
  title: string;
}

export interface Config {
  hotkey: string;
  markupHotkey: string;
  ttlMs: number;
  opacity: number;
  fontScale: number;
  textColor: string;
  authorColor: string;
  shadow: number;
  fadeMs: number;
  stickerAnimationSeconds: number;
  messageLayout: MessageLayout;
  showAuthor: boolean;
  showMessageTime: boolean;
  incomingBubbleColor: string;
  outgoingBubbleColor: string;
  directionSignals: DirectionSettings;
  phraseWheel: PhraseWheelSettings;
  autostart: boolean;
  demoFeed: boolean;
  apiId?: number;
  chat?: ChatRef | null;
  /** Which worker carries the chat; absent means Telegram. */
  transport?: Transport;
  relay?: RelaySettings;
  profiles: Profile[];
}

export type Transport = "telegram" | "relay";

/** The relay server and room; the access key and room password are stored as secrets, not here. */
export interface RelaySettings {
  url: string;
  room: string;
  displayName: string;
}

export interface RelaySecretState {
  hasAccessKey: boolean;
  hasPassword: boolean;
}

export interface DirectionSettings {
  enabled: boolean;
  upKey: string;
  downKey: string;
  leftKey: string;
  rightKey: string;
  displayMs: number;
}

export interface PhraseWheelSettings {
  enabled: boolean;
  hotkey: string;
  deadZonePx: number;
  phrases: string[];
}

export type MessageLayout = "compact" | "dialogue";

export interface FeedSettings {
  ttlMs: number;
  opacity: number;
  fontScale: number;
  textColor?: string;
  authorColor?: string;
  shadow?: number;
  fadeMs?: number;
  stickerAnimationSeconds?: number;
  messageLayout?: MessageLayout;
  showAuthor?: boolean;
  showMessageTime?: boolean;
  incomingBubbleColor?: string;
  outgoingBubbleColor?: string;
}

/** The feed-appearance fields as used by the settings UI: always fully populated. */
export type FeedAppearance = Required<FeedSettings>;

export interface Flags {
  autostart: boolean;
  demoFeed: boolean;
}

/** Mirrors CONTRACT.md's Telegram additions: the worker window, driven through Rust. */
export type ChatKind = "user" | "chat" | "channel";

export interface ChatRef {
  kind: ChatKind;
  id: string;
  accessHash?: string;
  title: string;
  username?: string;
  isBot?: boolean;
  topicId?: number | null;
}

export type TgState = "offline" | "connecting" | "reconnecting" | "code" | "password" | "connected" | "reauth_required" | "error";

export interface TgStatus {
  state: TgState;
  phone?: string;
  error?: string;
  waitSeconds?: number;
  reconnectAttempt?: number;
}

export type LoginStep = "phone" | "code" | "password" | "logout";
