import type { ProfileCandidate } from "./types";

export function shouldRefreshProfileCandidates(documentVisible: boolean): boolean {
  return documentVisible;
}

export function sameProfileCandidates(current: ProfileCandidate[], next: ProfileCandidate[]): boolean {
  return current.length === next.length && current.every((candidate, index) =>
    candidate.exe === next[index].exe && candidate.title === next[index].title);
}
