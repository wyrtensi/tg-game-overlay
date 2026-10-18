import { describe, expect, test } from "vitest";
import { MediaStore } from "./media-store";

describe("MediaStore", () => {
  test("evicts the oldest retained media when the byte budget is exceeded", () => {
    const store = new MediaStore<{ dataUrl: string }>(6);
    store.set("old", { dataUrl: "data:image/png;base64,QUJD" });
    store.set("new", { dataUrl: "data:image/png;base64,QUJDREVG" });

    expect(store.prune(["old", "new"])).toEqual(["old"]);
    expect(store.get("old")).toBeUndefined();
    expect(store.get("new")).toEqual({ dataUrl: "data:image/png;base64,QUJDREVG" });
  });
});
