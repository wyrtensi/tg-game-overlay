// End-to-end encryption for the relay transport (server/PROTOCOL.md).
// WebCrypto only: the key never leaves this worker and the server sees ciphertext.

const VERSION = "tgo-relay-v1";
export const PBKDF2_ITERATIONS = 600_000;
const PAD_BLOCK = 256;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface RoomKeys {
  roomId: string;
  key: CryptoKey;
}

export type EnvelopeType = "text" | "sticker" | "image" | "direction" | "phrase";
export type RelayStickerKind = "tgs" | "webp" | "webm";
export type RelayDirection = "up" | "down" | "left" | "right";

export interface Envelope {
  v: 1;
  id: string;
  author: string;
  sid?: string;
  at: number;
  t: EnvelopeType;
  text?: string;
  sticker?: { id: string; kind: RelayStickerKind };
  image?: { mime: string; b64: string; width?: number; height?: number };
  direction?: RelayDirection;
  phrase?: string;
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("WebCrypto недоступен");
  return api;
}

export function normalizeRoomName(room: string): string {
  return room.trim().normalize("NFC").toLowerCase();
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest("SHA-256", bytes)));
}

/** Derives the server-visible room id and the AES-256-GCM key from the room name and password. */
export async function deriveRoomKeys(
  room: string,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<RoomKeys> {
  const api = subtle();
  const salt = new Uint8Array(await api.digest("SHA-256", encoder.encode(`${VERSION}|salt|${normalizeRoomName(room)}`)));
  const passwordKey = await api.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await api.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, passwordKey, 256);
  const hkdf = await api.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);
  const empty = new Uint8Array(0);
  const roomIdBits = await api.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: empty, info: encoder.encode(`${VERSION}|room-id`) },
    hkdf,
    256,
  );
  const key = await api.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: empty, info: encoder.encode(`${VERSION}|enc`) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { roomId: toHex(new Uint8Array(roomIdBits)), key };
}

function additionalData(roomId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${VERSION}|msg|${roomId}`);
}

/** Pads with at least one zero byte up to a multiple of 256, hiding exact message lengths. */
export function pad(plain: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = Math.ceil((plain.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const padded = new Uint8Array(length);
  padded.set(plain);
  return padded;
}

export function unpad(padded: Uint8Array): Uint8Array {
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  return padded.subarray(0, end);
}

export async function encryptEnvelope(keys: RoomKeys, envelope: Envelope): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const padded = pad(encoder.encode(JSON.stringify(envelope)));
  const cipher = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv, additionalData: additionalData(keys.roomId) }, keys.key, padded),
  );
  const framed = new Uint8Array(IV_BYTES + cipher.length);
  framed.set(iv);
  framed.set(cipher, IV_BYTES);
  return bytesToBase64(framed);
}

/** Returns null for anything that does not decrypt or does not look like an envelope. */
export async function decryptEnvelope(keys: RoomKeys, data: string): Promise<Envelope | null> {
  try {
    const framed = base64ToBytes(data);
    if (framed.length <= IV_BYTES) return null;
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: framed.subarray(0, IV_BYTES), additionalData: additionalData(keys.roomId) },
      keys.key,
      framed.subarray(IV_BYTES),
    );
    const parsed: unknown = JSON.parse(decoder.decode(unpad(new Uint8Array(plain))));
    return isEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const ENVELOPE_TYPES: readonly EnvelopeType[] = ["text", "sticker", "image", "direction", "phrase"];
const DIRECTIONS: readonly RelayDirection[] = ["up", "down", "left", "right"];
const STICKER_KINDS: readonly RelayStickerKind[] = ["tgs", "webp", "webm"];

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.v !== 1 || typeof item.id !== "string" || typeof item.author !== "string") return false;
  if (typeof item.at !== "number" || !ENVELOPE_TYPES.includes(item.t as EnvelopeType)) return false;
  switch (item.t) {
    case "text":
      return typeof item.text === "string";
    case "sticker": {
      const sticker = item.sticker as Record<string, unknown> | undefined;
      return typeof sticker?.id === "string"
        && /^[0-9a-f]{64}$/.test(sticker.id)
        && STICKER_KINDS.includes(sticker.kind as RelayStickerKind);
    }
    case "image": {
      const image = item.image as Record<string, unknown> | undefined;
      return typeof image?.mime === "string" && image.mime.startsWith("image/") && typeof image.b64 === "string";
    }
    case "direction":
      return DIRECTIONS.includes(item.direction as RelayDirection);
    case "phrase":
      return typeof item.phrase === "string";
    default:
      return false;
  }
}

/** Proof for the server challenge: HMAC-SHA256(accessKey, "tgo-relay-v1|auth|<role>|<nonce>"). */
export async function authProof(accessKey: string, nonce: string, role: "client" | "admin" = "client"): Promise<string> {
  const api = subtle();
  const key = await api.importKey("raw", encoder.encode(accessKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await api.sign("HMAC", key, encoder.encode(`${VERSION}|auth|${role}|${nonce}`));
  return bytesToBase64(new Uint8Array(signature));
}
