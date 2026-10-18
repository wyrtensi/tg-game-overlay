import { describe, expect, test } from "vitest";
import { normalizeProfileExecutable } from "./profile-input";

describe("normalizeProfileExecutable", () => {
  test("keeps a bare executable and normalizes its case", () => {
    expect(normalizeProfileExecutable("  GameClient.EXE  ")).toBe("gameclient.exe");
  });

  test("uses the executable name from a quoted Windows path", () => {
    expect(normalizeProfileExecutable('"C:\\Games\\My Game\\Launcher.exe"')).toBe("launcher.exe");
  });

  test("rejects a value that is not an executable", () => {
    expect(normalizeProfileExecutable("C:\\Games\\My Game")).toBeNull();
  });
});
