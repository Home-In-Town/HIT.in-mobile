// Geometry of the builder property strip, lifted out of the StyleSheet because
// the auto-scroll stride is derived from it. The timer used to carry its own
// hardcoded `const cardWidth = 196` (186 card + 10 gap) with no link back to
// `bp.card` / `bp.stripRow`, so the two could silently disagree the moment either
// style was touched. Now the styles and the stride math read the same constants
// and the stride itself is derived from the ScrollView's MEASURED content width —
// see cardStride() below.
export const CARD_GAP = 10;
export const STRIP_PADDING_H = 14;

// How long each card holds still before the strip advances. The brief originally
// asked for "3-4 seconds" and this was 3500 ms, the middle of that band — but on
// the device that read as sluggish, so it is now 2000 ms. The number was once
// hardcoded inside the setInterval call, where "make it faster" meant editing a
// magic literal buried in the scroll maths. It lives here now so the pace is ONE
// line to change, independently of the stride/wrap logic. Note what the number
// does and does not control: it is the DWELL between ticks, not the glide. The
// glide is `scrollTo({ animated: true })`, handed to the platform animator at a
// fixed duration (~250 ms on Android) that this constant cannot influence — so
// lowering this is the only lever on perceived pace, and dropping it much below
// ~1500 ms would start cutting into the time needed to read a card's price.
export const BUILDER_STRIP_AUTOSCROLL_MS = 2000;

/**
 * One card plus one gap, in px — how far the carousel must travel per tick.
 *
 * Derived from what the ScrollView actually measured rather than from a hardcoded
 * pixel guess: `contentWidth = 2*padding + n*cardWidth + (n-1)*gap`, so
 * `cardWidth + gap = (contentWidth - 2*padding + gap) / n`. Measuring beats
 * guessing here because the card is a fixed 186 dp today but nothing enforces
 * that, and a stale stride desyncs the strip silently (it scrolls, just to the
 * wrong place). Falls back to the literal 186 + gap only when the content has not
 * been measured yet.
 */
export function cardStride(contentWidth: number, count: number): number {
  if (count < 1 || contentWidth <= 0) return 186 + CARD_GAP;
  const measured = (contentWidth - 2 * STRIP_PADDING_H + CARD_GAP) / count;
  return measured > 1 ? measured : 186 + CARD_GAP;
}
