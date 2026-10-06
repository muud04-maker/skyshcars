/* Multi-select helpers for the admin tables / pickers (pure + testable). */

export function toggleId(ids: number[], id: number) {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Tick every visible row, or clear the visible ones when they are all already ticked. */
export function toggleAllIds(ids: number[], visible: number[]) {
  const all = visible.length > 0 && visible.every((v) => ids.includes(v));
  return all ? ids.filter((x) => !visible.includes(x)) : [...new Set([...ids, ...visible])];
}

export function clearIds() { return [] as number[]; }

export function countSelected(ids: number[]) { return ids.length; }
