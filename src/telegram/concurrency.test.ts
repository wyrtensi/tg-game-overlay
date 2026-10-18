import { describe, expect, test } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  test("maps every item, preserving input order in the output", async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  test("never runs more than `limit` callbacks at once", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return n;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  test("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async (n: number) => n)).toEqual([]);
  });

  test("handles a limit larger than the list", async () => {
    expect(await mapWithConcurrency([1, 2], 10, async (n) => n)).toEqual([1, 2]);
  });
});
