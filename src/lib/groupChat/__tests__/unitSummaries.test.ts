// Characterisation tests for the unit_update day-summary helpers. They lock in
// the behaviour AS IT IS TODAY — the local-date grouping, the segment order and
// the Aaj/Kal labels — because every one of those regressions is invisible in
// the UI until someone notices a summary filed under the wrong day.
import { colors } from '../../../theme';
import { statusMeta } from '../../units';
import { MONTH_SHORT } from '../formatting';
import {
  buildUnitDayGroups,
  localDateKey,
  UNIT_SUMMARY_ORDER,
  unitStatusMeta,
} from '../unitSummaries';
import type { GroupMessage, UnitStatus } from '../../api';

/**
 * Minimal unit_update fixture. `toStatus` is widened to `string` so a test can
 * feed a status the client has never heard of — the production field is typed
 * `UnitStatus`, but the server is the only writer and the helpers deliberately
 * cope with an unknown key.
 */
function unitMsg(id: string, when: Date, toStatus: string, extra: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id,
    room: 'room-1',
    sender: { id: 'u1', name: 'Tester', role: 'agent' },
    messageType: 'unit_update',
    content: '',
    unitUpdate: { project: 'p1', label: 'A-101', toStatus: toStatus as UnitStatus },
    createdAt: when.toISOString(),
    ...extra,
  };
}

// Local noon on a fixed calendar day. Noon, not midnight, so a ±1h DST shift in
// the runner's zone can never move the fixture onto a neighbouring day.
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe('localDateKey', () => {
  it('returns the LOCAL calendar y-m-d, zero-padded', () => {
    expect(localDateKey(new Date(2025, 0, 5, 12, 0, 0))).toBe('2025-01-05');
    expect(localDateKey(new Date(2025, 10, 30, 12, 0, 0))).toBe('2025-11-30');
  });

  it('keys an early-hours Date on its local day, not its UTC day', () => {
    // 00:01 and 23:59 local on the same day: with ANY non-zero UTC offset at
    // least one of the two lands on a different UTC calendar date, so the pair
    // exposes the local-vs-UTC difference without naming a timezone. Both
    // expected strings are built from locally-constructed components, so
    // neither is timezone-dependent.
    const early = new Date(2025, 4, 15, 0, 1, 0);
    const late = new Date(2025, 4, 15, 23, 59, 0);
    expect(localDateKey(early)).toBe('2025-05-15');
    expect(localDateKey(late)).toBe('2025-05-15');

    // The whole point of the helper: it must NOT agree with the old
    // `toISOString().split('T')[0]`. Only assertable off UTC+0, where the two
    // formulations legitimately coincide.
    const atUtc = early.getTimezoneOffset() === 0 && late.getTimezoneOffset() === 0;
    if (!atUtc) {
      const differsSomewhere =
        localDateKey(early) !== early.toISOString().slice(0, 10) ||
        localDateKey(late) !== late.toISOString().slice(0, 10);
      expect(differsSomewhere).toBe(true);
    }
  });
});

describe('unitStatusMeta', () => {
  it('delegates to statusMeta for a key the client knows', () => {
    expect(unitStatusMeta('available')).toEqual(statusMeta('available'));
    expect(unitStatusMeta('available').label).toBe('Vacant');
    expect(unitStatusMeta('booked').label).toBe('Booked');
  });

  it('title-cases an UNKNOWN key and never calls it Vacant', () => {
    // The negative assertion is the reason the wrapper exists: statusMeta falls
    // back to UNIT_STATUS.available, which would assert something false about
    // the unit.
    expect(unitStatusMeta('rescinded')).toEqual({ label: 'Rescinded', color: colors.muted2 });
    expect(unitStatusMeta('rescinded').label).not.toBe('Vacant');
  });
});

describe('buildUnitDayGroups', () => {
  it("keys the Map on the id of each day's FIRST message, not on the date key", () => {
    const d1 = localNoon(2025, 5, 10);
    const d2 = localNoon(2025, 5, 11);
    const groups = buildUnitDayGroups(
      [
        unitMsg('m1', d1, 'booked'),
        unitMsg('m2', new Date(d1.getTime() + 3600000), 'sold'),
        unitMsg('m3', d2, 'available'),
      ],
      localNoon(2025, 5, 20),
    );

    expect([...groups.keys()]).toEqual(['m1', 'm3']);
    expect(groups.has(localDateKey(d1))).toBe(false);
    expect(groups.get('m1')!.items.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(groups.get('m3')!.items.map(m => m.id)).toEqual(['m3']);
    expect(groups.get('m1')!.dateKey).toBe(localDateKey(d1));
  });

  it('groups by LOCAL calendar day across the 00:00–05:29 window', () => {
    // 02:00 and 23:00 local are one local day but, off UTC+0, usually two
    // different UTC days. Asserted against localDateKey(...) rather than a
    // literal so the expectation holds in every zone.
    const earlyHours = new Date(2025, 4, 15, 2, 0, 0);
    const lateHours = new Date(2025, 4, 15, 23, 0, 0);
    const groups = buildUnitDayGroups(
      [unitMsg('early', earlyHours, 'booked'), unitMsg('late', lateHours, 'sold')],
      localNoon(2025, 5, 25),
    );

    expect(groups.size).toBe(1);
    expect(groups.get('early')!.dateKey).toBe(localDateKey(earlyHours));
    expect(groups.get('early')!.items.map(m => m.id)).toEqual(['early', 'late']);
  });

  it('counts each status present on the day', () => {
    const d = localNoon(2025, 5, 10);
    const groups = buildUnitDayGroups(
      [
        unitMsg('a', d, 'booked'),
        unitMsg('b', d, 'booked'),
        unitMsg('c', d, 'sold'),
      ],
      localNoon(2025, 5, 20),
    );

    const segments = groups.get('a')!.segments;
    expect(segments.map(s => [s.key, s.count])).toEqual([['booked', 2], ['sold', 1]]);
    expect(segments.find(s => s.key === 'booked')!.color).toBe(statusMeta('booked').color);
  });

  it('orders segments by UNIT_SUMMARY_ORDER, not by first appearance', () => {
    expect(UNIT_SUMMARY_ORDER).toEqual(['booked', 'available', 'sold', 'on-hold']);
    const d = localNoon(2025, 5, 10);
    const groups = buildUnitDayGroups(
      [
        unitMsg('a', d, 'on-hold'),
        unitMsg('b', d, 'sold'),
        unitMsg('c', d, 'available'),
        unitMsg('e', d, 'booked'),
      ],
      localNoon(2025, 5, 20),
    );

    expect(groups.get('a')!.segments.map(s => s.key)).toEqual(UNIT_SUMMARY_ORDER);
  });

  it('APPENDS unknown statuses instead of dropping them, stable among themselves', () => {
    const d = localNoon(2025, 5, 10);
    const groups = buildUnitDayGroups(
      [
        unitMsg('a', d, 'rescinded'),
        unitMsg('b', d, 'sold'),
        unitMsg('c', d, 'blocked'),
        unitMsg('e', d, 'booked'),
      ],
      localNoon(2025, 5, 20),
    );

    // Knowns first in preference order; the two unknowns keep insertion order
    // (first seen in the thread) because the comparator ranks both at
    // UNIT_SUMMARY_ORDER.length and the sort is stable.
    expect(groups.get('a')!.segments.map(s => s.key)).toEqual(['booked', 'sold', 'rescinded', 'blocked']);
    expect(groups.get('a')!.segments.map(s => s.label)).toEqual(['Booked', 'Sold', 'Rescinded', 'Blocked']);
  });

  it("labels today 'Aaj', yesterday 'Kal' and anything older 'DD MMM'", () => {
    const now = localNoon(2025, 5, 15);
    const yesterday = localNoon(2025, 5, 14);
    const older = localNoon(2025, 5, 2);
    const groups = buildUnitDayGroups(
      [unitMsg('old', older, 'booked'), unitMsg('yest', yesterday, 'sold'), unitMsg('today', now, 'available')],
      now,
    );

    expect(groups.get('today')!.dateLabel).toBe('Aaj');
    expect(groups.get('yest')!.dateLabel).toBe('Kal');
    expect(groups.get('old')!.dateLabel).toBe(`${older.getDate()} ${MONTH_SHORT[older.getMonth()]}`);
    expect(groups.get('old')!.dateLabel).toBe('2 May');
  });

  it('skips non-unit_update messages, unparseable dates and a missing payload', () => {
    const d = localNoon(2025, 5, 10);
    const groups = buildUnitDayGroups(
      [
        unitMsg('text', d, 'booked', { messageType: 'text' }),
        unitMsg('nopayload', d, 'booked', { unitUpdate: undefined }),
        unitMsg('baddate', d, 'booked', { createdAt: 'not-a-date' }),
        unitMsg('good', d, 'booked'),
      ],
      localNoon(2025, 5, 20),
    );

    expect([...groups.keys()]).toEqual(['good']);
    expect(groups.get('good')!.items.map(m => m.id)).toEqual(['good']);
  });
});
