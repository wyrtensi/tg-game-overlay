import { describe, expect, it } from "vitest";
import {
  authProof,
  decryptEnvelope,
  deriveRoomKeys,
  encryptEnvelope,
  isEnvelope,
  normalizeRoomName,
  pad,
  unpad,
  type Envelope,
} from "./crypto";

// Fewer iterations keep the suite fast; the derivation path is identical.
const FAST = 1000;

const sample: Envelope = { v: 1, id: "m1", author: "Alex", at: 1, t: "text", text: "привет" };

describe("relay crypto", () => {
  it("derives the same room for the same name and password", async () => {
    const a = await deriveRoomKeys(" Squad ", "secret", FAST);
    const b = await deriveRoomKeys("squad", "secret", FAST);
    expect(a.roomId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.roomId).toBe(b.roomId);
  });

  it("puts a different password into a different room", async () => {
    const a = await deriveRoomKeys("squad", "secret", FAST);
    const b = await deriveRoomKeys("squad", "secret2", FAST);
    expect(a.roomId).not.toBe(b.roomId);
  });

  it("round-trips an envelope and hides the plaintext", async () => {
    const keys = await deriveRoomKeys("squad", "secret", FAST);
    const data = await encryptEnvelope(keys, sample);
    expect(atob(data)).not.toContain("Alex");
    expect(await decryptEnvelope(keys, data)).toEqual(sample);
  });

  it("uses a fresh nonce for every message", async () => {
    const keys = await deriveRoomKeys("squad", "secret", FAST);
    expect(await encryptEnvelope(keys, sample)).not.toBe(await encryptEnvelope(keys, sample));
  });

  it("rejects ciphertext from another room or a tampered frame", async () => {
    const keys = await deriveRoomKeys("squad", "secret", FAST);
    const other = await deriveRoomKeys("squad", "other", FAST);
    const data = await encryptEnvelope(keys, sample);
    expect(await decryptEnvelope(other, data)).toBeNull();
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    expect(await decryptEnvelope(keys, btoa(String.fromCharCode(...bytes)))).toBeNull();
    expect(await decryptEnvelope(keys, "not base64!")).toBeNull();
  });

  it("pads to 256-byte blocks with at least one zero byte", () => {
    expect(pad(new Uint8Array(255)).length).toBe(256);
    expect(pad(new Uint8Array(256)).length).toBe(512);
    expect(Array.from(unpad(pad(new Uint8Array([1, 2, 3]))))).toEqual([1, 2, 3]);
  });

  it("validates envelope shapes", () => {
    expect(isEnvelope(sample)).toBe(true);
    expect(isEnvelope({ ...sample, t: "sticker", sticker: { id: "a".repeat(64), kind: "tgs" } })).toBe(true);
    expect(isEnvelope({ ...sample, t: "sticker", sticker: { id: "../x", kind: "tgs" } })).toBe(false);
    expect(isEnvelope({ ...sample, t: "direction", direction: "north" })).toBe(false);
    expect(isEnvelope({ ...sample, t: "image", image: { mime: "text/html", b64: "" } })).toBe(false);
    expect(isEnvelope({ ...sample, v: 2 })).toBe(false);
  });

  it("normalizes room names", () => {
    expect(normalizeRoomName("  Комната ")).toBe("комната");
  });

  it("computes a stable HMAC proof", async () => {
    const proof = await authProof("access-key-0123456789", "bm9uY2U=");
    expect(proof).toBe(await authProof("access-key-0123456789", "bm9uY2U="));
    expect(proof).not.toBe(await authProof("access-key-0123456789", "bm9uY2U=", "admin"));
  });
});
