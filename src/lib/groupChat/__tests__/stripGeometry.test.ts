// Characterisation tests for the builder-strip stride. Every expectation is
// written against the exported constants rather than against 10 / 14 / 196,
// because the point of the module is that the styles and the stride maths read
// the SAME numbers — a test that hardcoded them could still pass after the two
// drifted apart.
import { CARD_GAP, STRIP_PADDING_H, cardStride } from '../stripGeometry';

// The literal the function falls back to when it has nothing measured to work
// from: the card is a fixed 186 dp in the StyleSheet today, plus one gap.
const FALLBACK = 186 + CARD_GAP;

describe('cardStride', () => {
  it('derives the stride from a realistic measured content width', () => {
    // contentWidth = 2*padding + n*cardWidth + (n-1)*gap, as the ScrollView
    // would report it for three 186 dp cards.
    const count = 3;
    const contentWidth = 2 * STRIP_PADDING_H + count * 186 + (count - 1) * CARD_GAP;

    expect(cardStride(contentWidth, count)).toBe(
      (contentWidth - 2 * STRIP_PADDING_H + CARD_GAP) / count,
    );
    expect(cardStride(contentWidth, count)).toBe(FALLBACK);
  });

  it('still derives the stride when the card is NOT 186 dp wide', () => {
    // Proves the measurement is actually being used rather than coincidentally
    // agreeing with the fallback in the test above.
    const count = 4;
    const contentWidth = 2 * STRIP_PADDING_H + count * 240 + (count - 1) * CARD_GAP;

    expect(cardStride(contentWidth, count)).toBe(240 + CARD_GAP);
  });

  it('falls back when the count is below 1', () => {
    expect(cardStride(606, 0)).toBe(FALLBACK);
    expect(cardStride(606, -2)).toBe(FALLBACK);
  });

  it('falls back when nothing has been measured yet', () => {
    expect(cardStride(0, 3)).toBe(FALLBACK);
    expect(cardStride(-100, 3)).toBe(FALLBACK);
  });

  it("falls back via the `measured > 1` guard on an implausibly small width", () => {
    // Chosen so the derived value is exactly 1 — the boundary the guard
    // rejects — and so the arithmetic is expressed in the constants.
    const atBoundary = 2 * STRIP_PADDING_H - CARD_GAP + 1;
    expect((atBoundary - 2 * STRIP_PADDING_H + CARD_GAP) / 1).toBe(1);
    expect(cardStride(atBoundary, 1)).toBe(FALLBACK);

    // And a width that drives it negative.
    expect(cardStride(1, 100)).toBe(FALLBACK);
  });
});
