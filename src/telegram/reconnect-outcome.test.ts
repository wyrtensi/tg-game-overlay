import { describe, expect, test } from "vitest";
import { reconnectFailureOutcome } from "./reconnect-outcome";

describe("reconnectFailureOutcome", () => {
  test("retries a saved session after an initial network failure", () => {
    expect(reconnectFailureOutcome(new Error("offline"))).toEqual({ kind: "retry" });
  });

  test("changes to reauth_required when the session is revoked", () => {
    expect(reconnectFailureOutcome({ errorMessage: "AUTH_KEY_UNREGISTERED" })).toEqual({ kind: "reauth_required" });
  });

  test("carries a server flood wait into the next retry", () => {
    expect(reconnectFailureOutcome({ seconds: 45 })).toEqual({ kind: "retry", floodWaitSeconds: 45 });
  });
});
