import { describe, expect, test } from "vitest";
import { applyCredentialUpdate } from "./credentials-state";

describe("credential state", () => {
  test("replaces startup credentials with a saved personal pair", () => {
    expect(applyCredentialUpdate(
      { apiId: 0, apiHash: "" },
      { apiId: 123_456, apiHash: "0123456789abcdef0123456789abcdef" },
    )).toEqual({ apiId: 123_456, apiHash: "0123456789abcdef0123456789abcdef" });
  });
});
