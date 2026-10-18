/**
 * Shapes shared with the Rust backend, mirrored from CONTRACT.md.
 * Duplicated here (not imported from src/main/types.ts) because src/main/**
 * is off-limits for this worker.
 */

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

export type MediaKind = "photo" | "webp" | "tgs" | "webm" | "gif";

export interface OverlayMediaRef {
  kind: MediaKind;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface OverlayMessage {
  id: string;
  author: string;
  text: string;
  at: number;
  outgoing?: boolean;
  media?: OverlayMediaRef;
}

/** Only the fields this worker reads from Config. */
export interface WorkerConfig {
  apiId?: number;
  chat?: ChatRef | null;
  /** "relay" hands the chat to the relay worker; this worker then stays idle. */
  transport?: "telegram" | "relay";
  language?: string;
}

export type LoginStep = "phone" | "code" | "password" | "logout";

export interface TgLoginEvent {
  step: LoginStep;
  value?: string;
}

export type TgStatusState =
  | "offline"
  | "connecting"
  | "reconnecting"
  | "code"
  | "password"
  | "connected"
  | "reauth_required"
  | "error";

export interface TgStatus {
  state: TgStatusState;
  phone?: string;
  error?: string;
  waitSeconds?: number;
  reconnectAttempt?: number;
}

export interface TgDialogsRequest {
  query: string | null;
}

export type StickerKind = "webp" | "tgs" | "webm";

export interface StickerEntry {
  fileId: string;
  emoji?: string;
  kind: StickerKind;
  /** Small preview, ready to draw when Telegram supplied one. */
  dataUrl?: string;
  documentReady?: boolean;
}

export interface StickerPack {
  id: string;
  title: string;
  stickers: StickerEntry[];
}

export interface SendFileEvent {
  requestId: string;
  dataUrl: string;
  caption?: string;
}

export interface StickerLoadUpdate {
  packs: StickerPack[];
  phase: "metadata" | "previews" | "complete";
  error?: string;
}

export interface SendTextEvent {
  requestId: string;
  text: string;
}

export interface SendStickerEvent {
  requestId: string;
  fileId: string;
}

export interface DirectionEvent {
  requestId: string;
  direction: Direction;
  at: number;
}

export interface PhraseEvent {
  requestId: string;
  phrase: string;
  at: number;
}
import type { Direction } from "./direction-message";
