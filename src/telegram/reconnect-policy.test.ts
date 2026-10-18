import { describe, expect, test } from "vitest";
import { isSessionAuthorizationError, reconnectDelayMs } from "./reconnect-policy";

describe("reconnectDelayMs", () => {
  test("uses the normal exponential delay when the server gives no wait", () => {
    expect(reconnectDelayMs(2)).toBe(4_000);
  });

  test("uses the longer server wait", () => {
    expect(reconnectDelayMs(0, 12)).toBe(12_000);
  });

  test("does not shorten a capped retry for a small server wait", () => {
    expect(reconnectDelayMs(10, 5)).toBe(30_000);
  });
});

describe("isSessionAuthorizationError", () => {
  test("recognizes a revoked Telegram session", () => {
    expect(isSessionAuthorizationError({ errorMessage: "AUTH_KEY_UNREGISTERED" })).toBe(true);
  });

  test("keeps a temporary network failure recoverable", () => {
    expect(isSessionAuthorizationError(new Error("network offline"))).toBe(false);
  });
});
