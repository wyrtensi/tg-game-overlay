import { describe, expect, test } from "vitest";
import { shouldDismissOnOutsideClick } from "./dismiss";

describe("shouldDismissOnOutsideClick", () => {
  test("dismisses a click outside the active zone while chatting", () => {
    expect(shouldDismissOnOutsideClick("active", false, false)).toBe(true);
  });

  test("keeps the chat open for a click inside the active zone", () => {
    expect(shouldDismissOnOutsideClick("active", false, true)).toBe(false);
  });

  test("never dismisses while markup mode owns the mouse", () => {
    expect(shouldDismissOnOutsideClick("active", true, false)).toBe(false);
  });

  test("does nothing outside active mode, since the window is click-through there", () => {
    expect(shouldDismissOnOutsideClick("inactive", false, false)).toBe(false);
    expect(shouldDismissOnOutsideClick("hidden", false, false)).toBe(false);
    expect(shouldDismissOnOutsideClick("off", false, false)).toBe(false);
  });
});
