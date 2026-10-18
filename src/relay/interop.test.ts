import { describe, expect, it } from "vitest";
import { authProof, decryptEnvelope, deriveRoomKeys, encryptEnvelope, type Envelope } from "./crypto";
// The server package ships its own dependency-free copy of the client crypto
// (used by its tests and the upload script); both must agree byte for byte.
// @ts-expect-error plain JavaScript module without type declarations
import * as reference from "../../server/src/client-crypto.js";

const FAST = 1000;
const envelope: Envelope = { v: 1, id: "x", author: "Sam", at: 7, t: "text", text: "interop" };

describe("relay crypto interop with server/src/client-crypto.js", () => {
  it("derives the same room id", async () => {
    const ours = await deriveRoomKeys("Squad", "pass", FAST);
    const theirs = await reference.deriveRoomKeys("Squad", "pass", FAST);
    expect(ours.roomId).toBe(theirs.roomId);
  });

  it("decrypts each other's messages", async () => {
    const ours = await deriveRoomKeys("Squad", "pass", FAST);
    const theirs = await reference.deriveRoomKeys("Squad", "pass", FAST);
    expect(await decryptEnvelope(ours, await reference.encryptEnvelope(theirs, envelope))).toEqual(envelope);
    expect(await reference.decryptEnvelope(theirs, await encryptEnvelope(ours, envelope))).toEqual(envelope);
  });

  it("computes the same auth proof", async () => {
    expect(await authProof("access-key-0123456789", "bm9uY2U=", "client"))
      .toBe(await reference.authProof("access-key-0123456789", "client", "bm9uY2U="));
  });
});
