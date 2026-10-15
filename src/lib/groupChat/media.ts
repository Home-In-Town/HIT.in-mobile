// ── Media coercion ────────────────────────────────────────────────────────────
// Lifted to module scope from inside handlePropertyViewDetails' useCallback body
// so the property drawer uses the SAME coercion as the detail sheet instead of a
// second, drifting copy. A media entry is either a bare URL string or a
// `{ url }` file object depending on which endpoint produced it (the room
// projection nests `{ url }` objects under `media`, transformProject hands back
// whatever Mongo stored), so every consumer must tolerate both shapes.
export const mediaUrls = (arr: any): string[] =>
  (Array.isArray(arr) ? arr : []).map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean);
export const oneUrl = (v: any): string => (typeof v === 'string' ? v : v?.url || '');
