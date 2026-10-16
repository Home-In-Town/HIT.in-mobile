// Pure decision logic for the admin Role Distribution screen.
//
// It lives outside the screen on purpose: jest here is `testEnvironment: node`
// with a `**/src/**/__tests__/**/*.test.ts` matcher and no
// @testing-library/react-native, so logic kept inline in a .tsx screen cannot
// be tested at all. Search, counting, the two hard blocks and the confirmation
// copy are therefore all plain functions over plain data.
import type { AdminUser, AdminUserRole } from './api';

// Display order for the picker and the chip row: most privileged first, with
// `unassigned` last because it is the dead-end state.
export const ROLE_ORDER: readonly AdminUserRole[] = [
  'admin', 'captain', 'builder', 'agent', 'employee', 'user', 'unassigned',
];

// Roles are the seven lowercase strings in Mongo, but a hand-edited document can
// carry padding or odd casing, so every comparison goes through this. NOTE: this
// is not the "role casing" theory projects.tsx records as a disproven myth — the
// sidebar still compares `user.role` directly and keeps working; this is only
// about not splitting a count across two buckets.
export function normaliseRole(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

// The chip row's filter predicate. It lives here rather than inline in the
// screen because an inline copy was the one piece of this feature with no test
// coverage, while everything else in this module is pinned. `'all'` (and any
// empty filter) passes everything through.
export function matchesRoleFilter(user: Pick<AdminUser, 'role'>, roleFilter: string): boolean {
  const f = normaliseRole(roleFilter);
  if (!f || f === 'all') return true;
  return normaliseRole(user.role) === f;
}

// Case-insensitive substring search across the four fields an admin would
// actually type. Both sides are trimmed: stored names and phones in this DB
// carry trailing whitespace, so an untrimmed compare misses real matches.
export function matchesUserSearch(
  user: Pick<AdminUser, 'name' | 'phone' | 'email' | 'companyName'>,
  query: string,
): boolean {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const fields = [user.name, user.phone, user.companyName, user.email];
  return fields.some(f => String(f ?? '').trim().toLowerCase().includes(q));
}

// Count per role from the already-loaded array. Every one of the seven is
// present with 0 when absent so the chip row never changes width as the list
// filters, and an unknown value gets its own bucket so a stray role is visible
// on screen instead of silently dropped.
export function roleDistribution(users: Pick<AdminUser, 'role'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const role of ROLE_ORDER) out[role] = 0;
  for (const u of users) {
    const key = normaliseRole(u.role);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// Last 10 digits of a phone number, or '' when there are fewer than 10.
// WHY: the app sends `+91` + whatever was typed and the backend registers with a
// bare `findOne({ phone })` and no normalisation, so the same person exists
// twice as `9970119846` and `+919970119846`. Comparing the last 10 digits is
// what makes those two rows recognisable as one human.
export function phoneKey(phone: unknown): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// Phone keys that appear on more than one row, so the list can flag the
// duplicate accounts rather than leaving the admin to spot them by eye.
export function duplicatePhoneKeys(users: Pick<AdminUser, 'phone'>[]): Set<string> {
  const seen = new Map<string, number>();
  for (const u of users) {
    const key = phoneKey(u.phone);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const dupes = new Set<string>();
  seen.forEach((count, key) => { if (count > 1) dupes.add(key); });
  return dupes;
}

// The two hard blocks. These are refusals, not warnings: the message is shown
// and the API is never called.
//
// `adminCount` can only be derived from the loaded list, and the server has no
// last-admin guard of its own, so this is defence in depth rather than a
// guarantee — but it is the difference between an accident and a lockout.
export function roleChangeBlock(args: {
  target: Pick<AdminUser, 'id' | 'role'>;
  // Widened from `string` so the empty/missing case is representable instead of
  // being hidden behind the screen's `me?.id || ''`.
  currentUserId: string | null | undefined;
  adminCount: number;
}): string | null {
  const { target, currentUserId, adminCount } = args;
  const actorId = String(currentUserId ?? '').trim();
  const targetId = String(target.id ?? '').trim();

  // FAIL CLOSED when either id is unknown. PREVIOUS BEHAVIOUR: the condition was
  // `target.id && currentUserId && target.id === currentUserId`, so an empty
  // actor id (auth context not resolved) short-circuited the comparison and the
  // self-change was *allowed* — the guard quietly stopped being a guard exactly
  // when it could not tell who was acting. That direction of failure is not
  // acceptable here: PUT /api/users/:id/role is itself restrictTo('admin'), so a
  // self-demotion locks the actor out of this screen and every admin endpoint
  // permanently, with no route back from inside the app. The last-admin block
  // below already fails closed (adminCount 0 on an unloaded list blocks any
  // admin demotion); this now matches it.
  if (!actorId || !targetId) {
    return 'Could not confirm which account you are signed in as. Reload the screen and try again.';
  }
  // Self-demotion takes the actor out of this screen and every admin endpoint
  // with no route back, so it is blocked outright rather than confirmed.
  if (targetId === actorId) {
    return 'You cannot change your own role. Ask another admin.';
  }
  if (normaliseRole(target.role) === 'admin' && adminCount <= 1) {
    return 'This is the last admin. Promote someone else to admin first.';
  }
  return null;
}

// Confirmation copy naming the consequence of THIS transition. A generic "are
// you sure" tells the admin nothing: the interesting part is that `captain` is
// the app's real builder (assign-agent, My Agents, team-up, business branding)
// while `builder` is the legacy role that has CRM but cannot assign agents — so
// builder ↔ captain is very much not a no-op.
export function roleChangeConsequence(from: string, to: string): { title: string; message: string } | null {
  const f = normaliseRole(from);
  const t = normaliseRole(to);
  if (f === t) return null;

  const title = `Change ${f || 'unknown'} → ${t}?`;
  const lines: string[] = [];

  if (f === 'captain') {
    // The Assign-Captain relabel is not cosmetic: projects.tsx derives
    // "Captain: <name> · Change" from `project.owner?.role === 'captain'`, so
    // the moment the owner stops being a captain their projects read as
    // unassigned again.
    lines.push('Loses assign-agent, My Agents, captain team-up and business branding (logo, city, rating, verification). Their projects will show "Assign Captain" again.');
  }
  if (t === 'unassigned') {
    lines.push("Can do nothing except confirm an employer's assignment request.");
  } else if (t === 'user') {
    lines.push('Loses chat, CRM, groups, marketplace, leads and site visits.');
  } else if (t === 'admin') {
    lines.push("Full access, including changing everyone's roles.");
  }
  if (lines.length === 0) {
    lines.push(`Access changes from ${f || 'unknown'} to ${t}.`);
  }

  return { title, message: lines.join('\n\n') };
}
