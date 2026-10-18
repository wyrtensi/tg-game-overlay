import { describe, expect, test } from "vitest";
import { planMessageSync } from "./feed-diff";

describe("planMessageSync", () => {
  test("everything is inserted at the end when there was nothing before", () => {
    expect(planMessageSync([], ["1", "2"])).toEqual({
      removed: [],
      inserts: [
        { id: "1", beforeId: null },
        { id: "2", beforeId: null },
      ],
    });
  });

  test("appends a newly arrived id after the existing ones", () => {
    expect(planMessageSync(["1", "2"], ["1", "2", "3"])).toEqual({
      removed: [],
      inserts: [{ id: "3", beforeId: null }],
    });
  });

  test("removes only the ids that dropped out", () => {
    expect(planMessageSync(["1", "2", "3"], ["2", "3"])).toEqual({
      removed: ["1"],
      inserts: [],
    });
  });

  test("inserts a revealed older message before its correct neighbour, not at the end", () => {
    // Entering active mode can reveal a previously-missed message that
    // arrived chronologically between two already-tracked lines.
    expect(planMessageSync(["1", "3"], ["1", "2", "3"])).toEqual({
      removed: [],
      inserts: [{ id: "2", beforeId: "3" }],
    });
  });

  test("inserts a run of new leading messages before the first tracked one, in order", () => {
    expect(planMessageSync(["3"], ["1", "2", "3"])).toEqual({
      removed: [],
      inserts: [
        { id: "1", beforeId: "3" },
        { id: "2", beforeId: "3" },
      ],
    });
  });

  test("handles removals and insertions together", () => {
    expect(planMessageSync(["1", "2", "4"], ["1", "3", "4"])).toEqual({
      removed: ["2"],
      inserts: [{ id: "3", beforeId: "4" }],
    });
  });

  test("is a no-op for an unchanged list", () => {
    expect(planMessageSync(["1", "2"], ["1", "2"])).toEqual({ removed: [], inserts: [] });
  });
});
