import { describe, expect, test } from "vitest";
import { profileAddIntent, selectedProfileExecutable } from "./profile-add-intent";

describe("profileAddIntent", () => {
  test("picks only for empty input", () => {
    expect(profileAddIntent("  ")).toEqual({ kind: "pick" });
  });

  test("adds entered paths", () => {
    expect(profileAddIntent('"C:\\Games\\My Game\\Launcher.EXE"')).toEqual({
      kind: "add",
      value: '"C:\\Games\\My Game\\Launcher.EXE"',
    });
  });

  test("does nothing when the native dialog is cancelled", () => {
    expect(selectedProfileExecutable(null)).toBeNull();
  });
});
