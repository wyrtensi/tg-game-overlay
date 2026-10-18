/** One node to create, and the existing node it should be inserted before (null = at the end). */
export interface MessageInsert {
  id: string;
  beforeId: string | null;
}

export interface MessageSyncPlan {
  removed: string[];
  inserts: MessageInsert[];
}

/**
 * Reconciles the ids currently rendered against the ids that should be
 * visible now, so the caller can patch the DOM incrementally (append/insert
 * new nodes, remove stale ones) instead of rebuilding the whole list.
 *
 * A plain added/removed set is not enough here: switching from passive to
 * active mode can reveal older messages that were previously excluded (past
 * ttl, or missed while hidden), and those need to land at their correct
 * chronological position, not just get appended at the end.
 */
export function planMessageSync(trackedIds: string[], desiredIds: string[]): MessageSyncPlan {
  const desiredSet = new Set(desiredIds);
  const removed = trackedIds.filter((id) => !desiredSet.has(id));

  const trackedSet = new Set(trackedIds);
  const inserts: MessageInsert[] = [];

  for (let i = 0; i < desiredIds.length; i += 1) {
    const id = desiredIds[i];
    if (trackedSet.has(id)) continue;

    let beforeId: string | null = null;
    for (let j = i + 1; j < desiredIds.length; j += 1) {
      if (trackedSet.has(desiredIds[j])) {
        beforeId = desiredIds[j];
        break;
      }
    }
    inserts.push({ id, beforeId });
  }

  return { removed, inserts };
}
