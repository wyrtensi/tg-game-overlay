import { describe, expect, test } from "vitest";
import { nextDemoStatus } from "./demo-telegram";

describe("nextDemoStatus", () => {
  test("logout goes straight to offline", () => {
    const result = nextDemoStatus("logout", undefined, "+79261234567");
    expect(result.status).toEqual({ state: "offline" });
  });

  test("an invalid phone number reports an error synchronously", () => {
    const result = nextDemoStatus("phone", "123", undefined);
    expect(result.status.state).toBe("error");
    expect(result.delayMs).toBe(0);
  });

  test("a valid phone number moves to the code step after a delay", () => {
    const result = nextDemoStatus("phone", "+7 926 123-45-67", undefined);
    expect(result.status).toEqual({ state: "code", phone: "+79261234567" });
    expect(result.delayMs).toBeGreaterThan(0);
  });

  test("the magic flood-wait phone reports a wait time", () => {
    const result = nextDemoStatus("phone", "+70000000000", undefined);
    expect(result.status.state).toBe("error");
    expect(result.status.waitSeconds).toBeGreaterThan(0);
  });

  test("code 000000 moves to the password step", () => {
    const result = nextDemoStatus("code", "000000", "+79261234567");
    expect(result.status).toEqual({ state: "password", phone: "+79261234567" });
  });

  test("any other well-formed code connects directly", () => {
    const result = nextDemoStatus("code", "123456", "+79261234567");
    expect(result.status).toEqual({ state: "connected", phone: "+79261234567" });
  });

  test("a malformed code reports an error and keeps the phone", () => {
    const result = nextDemoStatus("code", "12", "+79261234567");
    expect(result.status.state).toBe("error");
    expect(result.status.phone).toBe("+79261234567");
  });

  test("password 'wrong' reports an error", () => {
    const result = nextDemoStatus("password", "wrong", "+79261234567");
    expect(result.status.state).toBe("error");
  });

  test("any other password connects", () => {
    const result = nextDemoStatus("password", "correct-horse", "+79261234567");
    expect(result.status).toEqual({ state: "connected", phone: "+79261234567" });
  });
});
