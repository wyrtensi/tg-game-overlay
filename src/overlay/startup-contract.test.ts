/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import html from "../../overlay.html?raw";
import script from "./main.ts?raw";

describe("overlay startup document", () => {
  test("provides every control required before the overlay can subscribe to events", () => {
    const availableIds = new Set(
      Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]),
    );
    const requiredIds = Array.from(
      script.matchAll(/el<[^>]+>\("([^"]+)"\)/g),
      (match) => match[1],
    );

    expect(requiredIds.filter((id) => !availableIds.has(id))).toEqual([]);
  });
});
