import { expect, test } from "vitest";
import { sameProfileCandidates, shouldRefreshProfileCandidates } from "./profile-refresh";

test("refreshes only for a visible settings document", () => {
  expect(shouldRefreshProfileCandidates(true)).toBe(true);
  expect(shouldRefreshProfileCandidates(false)).toBe(false);
});

test("leaves an open process picker untouched when the candidate list has not changed", () => {
  const current = [{ exe: "riftbreaker.exe", title: "The Riftbreaker" }];
  expect(sameProfileCandidates(current, [{ exe: "riftbreaker.exe", title: "The Riftbreaker" }])).toBe(true);
  expect(sameProfileCandidates(current, [{ exe: "riftbreaker.exe", title: "Riftbreaker" }])).toBe(false);
  expect(sameProfileCandidates(current, [{ exe: "other.exe", title: "Other" }])).toBe(false);
});
