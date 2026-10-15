// unit_update day-summary helpers lifted out of GroupChatEmbedded.tsx. Pure —
// reaches only the theme tokens and src/lib/units.ts; the api imports are types
// only, because src/lib/api.ts pulls expo-constants in at module scope.
import { colors } from '../../theme';
import { statusMeta, UNIT_STATUS } from '../units';
import { MONTH_SHORT } from './formatting';
import type { GroupMessage, UnitStatus } from '../api';

// ── unit_update day summaries ─────────────────────────────────────────────────
//
// Local-date key. The previous code keyed on `toISOString().split('T')[0]`, i.e.
// UTC, so in IST every update posted between 00:00 and 05:29 was filed under the
// PREVIOUS day — and 'Aaj' was computed the same wrong way, so the two could
// disagree. It also re-parsed the 'YYYY-MM-DD' key with `new Date(key)`, which
// JS reads as UTC midnight, shifting the printed 'DD MMM' back a day again.
export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Display ORDER preference only — never the loop source. The old code iterated
// this list and read counts off it, so any status key outside it would have been
// silently dropped from the summary.
export const UNIT_SUMMARY_ORDER: UnitStatus[] = ['booked', 'available', 'sold', 'on-hold'];

// One status→{label,color} helper shared by the summary segments AND the
// expanded rows, so the two can never disagree (design review #8). `statusMeta`
// falls back to UNIT_STATUS.available for an unknown key, which would label a
// status the client has never heard of "Vacant" — worse than showing the raw
// key, because it asserts something false about a unit.
export const unitStatusMeta = (s: string): { label: string; color: string } =>
  s in UNIT_STATUS
    ? statusMeta(s)
    : { label: s.charAt(0).toUpperCase() + s.slice(1), color: colors.muted2 };

export interface UnitDaySegment { key: string; label: string; color: string; count: number }
export interface UnitDayGroup { dateKey: string; dateLabel: string; segments: UnitDaySegment[]; items: GroupMessage[] }

/**
 * Build one day group per local calendar day of unit_update messages, keyed on
 * the id of that day's FIRST update.
 *
 * Previously each memoised bubble filtered the WHOLE `messages` array to find
 * its own day-mates and decide whether it was the day's first — O(n²) over the
 * thread, recomputed on every render of every bubble, so one composer keystroke
 * re-ran the lot. Now the parent builds this once in a useMemo and each bubble
 * gets its own group (or undefined) as a prop.
 *
 * `now` is a parameter so the Aaj/Kal boundary is injectable rather than read
 * from the clock deep inside the loop.
 */
export function buildUnitDayGroups(messages: GroupMessage[], now: Date): Map<string, UnitDayGroup> {
  const byDate = new Map<string, { firstId: string; first: Date; items: GroupMessage[] }>();
  // The FlatList is not `inverted`, so array order is chronological ascending
  // and the first unit_update seen for a day is that day's earliest.
  for (const m of messages) {
    if (m.messageType !== 'unit_update' || !m.unitUpdate) continue;
    const d = new Date(m.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = localDateKey(d);
    const bucket = byDate.get(key);
    if (bucket) bucket.items.push(m);
    else byDate.set(key, { firstId: m.id, first: d, items: [m] });
  }

  const todayKey = localDateKey(now);
  const yesterdayKey = localDateKey(new Date(now.getTime() - 86400000));
  const out = new Map<string, UnitDayGroup>();

  byDate.forEach((bucket, dateKey) => {
    // Segments come from the statuses actually PRESENT, ordered by preference
    // with anything unknown appended (Infinity) rather than dropped.
    const counts = new Map<string, number>();
    for (const m of bucket.items) {
      const st = m.unitUpdate!.toStatus as string;
      counts.set(st, (counts.get(st) || 0) + 1);
    }
    const segments: UnitDaySegment[] = Array.from(counts.entries())
      .map(([key, count]) => {
        const meta = unitStatusMeta(key);
        return { key, label: meta.label, color: meta.color, count };
      })
      // A FINITE rank, not Infinity: `Infinity - Infinity` is NaN, and a
      // comparator that returns NaN leaves the order of two unknown statuses
      // undefined. This keeps them after the known ones and stable among
      // themselves (insertion order, i.e. first seen in the thread).
      .sort((a, b) => {
        const rank = (k: string) => {
          const i = UNIT_SUMMARY_ORDER.indexOf(k as UnitStatus);
          return i < 0 ? UNIT_SUMMARY_ORDER.length : i;
        };
        return rank(a.key) - rank(b.key);
      });

    // 'DD MMM' is formatted from the group's OWN first Date, never from
    // `new Date(dateKey)` — see localDateKey's comment for why that re-parse was
    // a second off-by-one-day bug.
    const dateLabel = dateKey === todayKey
      ? 'Aaj'
      : dateKey === yesterdayKey
        ? 'Kal'
        : `${bucket.first.getDate()} ${MONTH_SHORT[bucket.first.getMonth()]}`;

    out.set(bucket.firstId, { dateKey, dateLabel, segments, items: bucket.items });
  });

  return out;
}
