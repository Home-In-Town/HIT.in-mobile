// Characterisation tests for the display formatters. Three of these functions
// format money and all three disagree about zero and about negatives — fmtPrice
// returns '—', fmtMoney returns '' and fmtLakhs returns '—' off a `<= 0` test
// while fmtPrice uses `!v`. That divergence is the behaviour AS IT IS TODAY, so
// it is asserted on all three rather than quietly unified: a future dedupe has
// to notice it is changing something a caller may rely on.
import {
  fmtCooldownLeft,
  fmtLakhs,
  fmtMoney,
  fmtPrice,
  messageClock,
  timeStr,
} from '../formatting';

describe('fmtPrice', () => {
  it("returns the em dash for zero and for a missing value", () => {
    expect(fmtPrice(0)).toBe('—');
    expect(fmtPrice(undefined as any)).toBe('—');
    expect(fmtPrice(NaN)).toBe('—');
  });

  it('formats a crore with exactly one decimal, always', () => {
    expect(fmtPrice(15000000)).toBe('₹1.5Cr');
    // An exact crore keeps the '.0' here. fmtMoney drops it — see below.
    expect(fmtPrice(10000000)).toBe('₹1.0Cr');
  });

  it('formats a lakh with no decimals, rounding at toFixed(0)', () => {
    expect(fmtPrice(8500000)).toBe('₹85L');
    expect(fmtPrice(8550000)).toBe('₹86L');
    expect(fmtPrice(100000)).toBe('₹1L');
  });

  it('falls back to en-IN grouping below a lakh', () => {
    expect(fmtPrice(50000)).toBe(`₹${(50000).toLocaleString('en-IN')}`);
    expect(fmtPrice(50000)).toBe('₹50,000');
  });

  it('lets a NEGATIVE through as a negative rupee string', () => {
    // CURRENT behaviour, reported not fixed: the guard is `!v`, not `v <= 0`,
    // so only zero is special-cased. fmtMoney and fmtLakhs both use `<= 0`.
    expect(fmtPrice(-5000)).toBe('₹-5,000');
  });
});

describe('fmtLakhs', () => {
  it("returns the em dash for missing, zero and negative", () => {
    expect(fmtLakhs()).toBe('—');
    expect(fmtLakhs(null)).toBe('—');
    expect(fmtLakhs(0)).toBe('—');
    expect(fmtLakhs(-12)).toBe('—');
  });

  it('switches to Cr with one decimal at 100 lakhs', () => {
    expect(fmtLakhs(100)).toBe('₹1.0 Cr');
    expect(fmtLakhs(120)).toBe('₹1.2 Cr');
    expect(fmtLakhs(250)).toBe('₹2.5 Cr');
  });

  it('rounds to whole lakhs below that', () => {
    expect(fmtLakhs(45)).toBe('₹45 L');
    expect(fmtLakhs(44.6)).toBe('₹45 L');
    expect(fmtLakhs(99)).toBe('₹99 L');
  });
});

describe('fmtMoney', () => {
  it("returns an EMPTY STRING for zero and negative, not the em dash", () => {
    // The deliberate divergence from fmtPrice: this one is used where an empty
    // segment is dropped by a .filter(Boolean), so '—' would print a dash in a
    // row that is meant to collapse.
    expect(fmtMoney(0)).toBe('');
    expect(fmtMoney(-1)).toBe('');
    expect(fmtMoney(undefined as any)).toBe('');
    expect(fmtPrice(0)).toBe('—');
  });

  it('drops the decimal on an EXACT crore and keeps it otherwise', () => {
    // The `v % 10000000 === 0` branch.
    expect(fmtMoney(10000000)).toBe('₹1Cr');
    expect(fmtMoney(20000000)).toBe('₹2Cr');
    expect(fmtMoney(15000000)).toBe('₹1.5Cr');
    expect(fmtMoney(12300000)).toBe('₹1.2Cr');
  });

  it('rounds to whole lakhs', () => {
    expect(fmtMoney(8500000)).toBe('₹85L');
    expect(fmtMoney(850000)).toBe('₹9L');
    expect(fmtMoney(100000)).toBe('₹1L');
  });

  it('falls back to en-IN grouping below a lakh', () => {
    expect(fmtMoney(99999)).toBe(`₹${(99999).toLocaleString('en-IN')}`);
    expect(fmtMoney(99999)).toBe('₹99,999');
  });
});

describe('fmtCooldownLeft', () => {
  it('prints hours and minutes above an hour', () => {
    expect(fmtCooldownLeft(2 * 3600000 + 30 * 60000)).toBe('2h 30m');
    expect(fmtCooldownLeft(3600000)).toBe('1h 0m');
  });

  it('prints minutes only below an hour', () => {
    expect(fmtCooldownLeft(59 * 60000)).toBe('59m');
    expect(fmtCooldownLeft(90000)).toBe('1m');
  });

  it("prints '0m' at zero", () => {
    expect(fmtCooldownLeft(0)).toBe('0m');
  });
});

describe('timeStr', () => {
  // Offsets are measured from Date.now() at call time rather than from a frozen
  // clock, so the floor division cannot land a test on the wrong side of a
  // boundary while the suite runs.
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it('returns an empty string for an empty input', () => {
    expect(timeStr('')).toBe('');
  });

  it("says 'now' under a minute", () => {
    expect(timeStr(ago(0))).toBe('now');
    expect(timeStr(ago(30000))).toBe('now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(timeStr(ago(5 * 60000))).toBe('5m');
    expect(timeStr(ago(59 * 60000))).toBe('59m');
    expect(timeStr(ago(3 * 3600000))).toBe('3h');
    expect(timeStr(ago(23 * 3600000))).toBe('23h');
    expect(timeStr(ago(4 * 86400000))).toBe('4d');
  });

  it('has NO NaN guard, unlike messageClock', () => {
    // CURRENT behaviour, reported not fixed: an unparseable timestamp prints
    // on the row where messageClock would print nothing. It falls all the way
    // through to the DAYS branch, because every `<` comparison against NaN is
    // false — so the row reads 'NaNd', not 'NaNm'.
    expect(timeStr('not-a-date')).toBe('NaNd');
    expect(messageClock('not-a-date')).toBe('');
  });
});

describe('messageClock', () => {
  it('returns an empty string for an empty input', () => {
    expect(messageClock('')).toBe('');
  });

  it('returns an empty string for an unparseable string', () => {
    expect(messageClock('not-a-date')).toBe('');
  });

  it('returns a non-empty clock for a valid ISO string', () => {
    // The exact rendering is Intl's to decide, so only its presence is pinned.
    const out = messageClock(new Date(2025, 4, 15, 14, 30, 0).toISOString());
    expect(out).not.toBe('');
    expect(out).toMatch(/\d/);
  });
});
