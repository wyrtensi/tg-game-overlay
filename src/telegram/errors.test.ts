import { describe, expect, test } from "vitest";
import { errors as tgErrors } from "telegram";
import { mapLoginError } from "./errors";

describe("mapLoginError", () => {
  test("maps PHONE_CODE_INVALID to a Russian message", () => {
    const err = new tgErrors.RPCError("PHONE_CODE_INVALID", undefined as any, 400);

    const status = mapLoginError(err);

    expect(status.state).toBe("error");
    expect(status.error).toMatch(/код/i);
    expect(status.waitSeconds).toBeUndefined();
  });

  test("maps PHONE_NUMBER_INVALID to a Russian message", () => {
    const err = new tgErrors.RPCError("PHONE_NUMBER_INVALID", undefined as any, 400);

    const status = mapLoginError(err);

    expect(status.state).toBe("error");
    expect(status.error).toMatch(/номер/i);
  });

  test("maps PASSWORD_HASH_INVALID to a Russian message", () => {
    const err = new tgErrors.RPCError("PASSWORD_HASH_INVALID", undefined as any, 400);

    const status = mapLoginError(err);

    expect(status.state).toBe("error");
    expect(status.error).toMatch(/пароль/i);
  });

  test("maps a FloodWaitError to an error with waitSeconds", () => {
    const err = new tgErrors.FloodWaitError({ request: undefined, capture: 120 });

    const status = mapLoginError(err);

    expect(status.state).toBe("error");
    expect(status.waitSeconds).toBe(120);
    expect(status.error).toMatch(/120/);
  });

  test("falls back to a generic Russian message for unknown errors", () => {
    const status = mapLoginError(new Error("boom"));

    expect(status.state).toBe("error");
    expect(status.error).toBeTruthy();
    expect(status.waitSeconds).toBeUndefined();
  });
});
