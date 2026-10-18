// Client-side crypto from PROTOCOL.md. Dependency-free: only WebCrypto,
// TextEncoder and btoa/atob, so the same code runs in browsers and Node.
// The server itself never imports this file; tests and tools do.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 600000;

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeRoomName(name) {
  return name.trim().normalize('NFC').toLowerCase();
}

/**
 * @returns {Promise<{ roomId: string, encKey: CryptoKey }>}
 */
export async function deriveRoomKeys(roomName, password, iterations = PBKDF2_ITERATIONS) {
  const roomNorm = normalizeRoomName(roomName);
  const salt = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`tgo-relay-v1|salt|${roomNorm}`)));
  const pwKey = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const master = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, pwKey, 256);
  const hkdfKey = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const hkdf = (info) =>
    subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, hkdfKey, 256);
  const roomId = toHex(new Uint8Array(await hkdf('tgo-relay-v1|room-id')));
  const encBits = await hkdf('tgo-relay-v1|enc');
  const encKey = await subtle.importKey('raw', encBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { roomId, encKey };
}

/** Encrypts an envelope object into the base64 `data` field of a `send` frame. */
export async function encryptEnvelope({ roomId, encKey }, envelope) {
  const plain = enc.encode(JSON.stringify(envelope));
  const padded = new Uint8Array(plain.length + (256 - (plain.length % 256)));
  padded.set(plain);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(`tgo-relay-v1|msg|${roomId}`) },
      encKey,
      padded,
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

/** Returns the envelope, or null if the data does not decrypt or parse. */
export async function decryptEnvelope({ roomId, encKey }, data) {
  try {
    const raw = base64ToBytes(data);
    if (raw.length < 12 + 16) return null;
    const plain = new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: enc.encode(`tgo-relay-v1|msg|${roomId}`) },
        encKey,
        raw.subarray(12),
      ),
    );
    let end = plain.length;
    while (end > 0 && plain[end - 1] === 0) end--;
    return JSON.parse(dec.decode(plain.subarray(0, end)));
  } catch {
    return null;
  }
}

/** HMAC proof for the auth frame; role is "client" or "admin". */
export async function authProof(key, role, nonce) {
  const k = await subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('HMAC', k, enc.encode(`tgo-relay-v1|auth|${role}|${nonce}`));
  return bytesToBase64(new Uint8Array(sig));
}
