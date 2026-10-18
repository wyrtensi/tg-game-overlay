import { describe, expect, test } from "vitest";
import { extractDimensions } from "./media-extract";

describe("extractDimensions", () => {
  test("uses the largest available photo size for a full photo download", () => {
    const photo = {
      className: "Photo",
      sizes: [
        { className: "PhotoSize", w: 160, h: 100 },
        { className: "PhotoSize", w: 1280, h: 720 },
      ],
    };

    expect(extractDimensions({ photo: photo as never }, "photo")).toEqual({ width: 1280, height: 720 });
  });
});
