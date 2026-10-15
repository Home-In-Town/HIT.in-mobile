// Group-room list helpers lifted out of GroupChatEmbedded.tsx. Pure — the only
// runtime dependency is the shared price formatter; the api import is types
// only, because src/lib/api.ts pulls expo-constants in at module scope.
import { fmtPrice } from './formatting';
import type { GroupRoom } from '../api';

export const ROOM_ICON: Record<string, string> = { project: '🏗', builder: '🏢', area: '📍', universal: '🌐' };

// ── Groups-pane filter chips ──────────────────────────────────────────────────
//
// The ONE place these three labels are written, so renaming a chip is a
// one-word edit instead of a hunt through the render tree.
//
// Deliberately 'My Groups' and NOT 'Favourites': on the Project map the
// Favourites chip already means "the user's OWN uploads" (filtered on
// MapProperty.ownerId), so reusing the word here — where it would mean "groups I
// have joined" — would make one label mean two different things in the same app.
export const GROUP_FILTERS: Array<{ key: Exclude<GroupFilterKey, null>; label: string }> = [
  { key: 'mine', label: 'My Groups' },
  { key: 'discover', label: 'Discover' },
  { key: 'property', label: 'Property Groups' },
];

// Derived, never hand-written. The Property Groups section heading has to read
// the same as the chip that opened it, and a second literal spelling of the same
// label is exactly how a heading and its chip drift apart on a rename.
export const GROUP_FILTER_LABELS = GROUP_FILTERS.reduce(
  (acc, f) => { acc[f.key] = f.label; return acc; },
  {} as Record<Exclude<GroupFilterKey, null>, string>
);

// `null` is a real state, not a missing one: no chip active renders exactly the
// three sections the pane showed before chips existed. There is no fourth "All"
// chip to default to, and defaulting to any of the three would hide two of
// today's sections and make the pane look emptier than it used to.
export type GroupFilterKey = 'mine' | 'discover' | 'property' | null;

/**
 * "This group cannot present a complete identity on its own row."
 *
 * companyName and isVerified are picked because they are exactly the two things
 * a Groups row already renders — the company name IS the row's identity line and
 * the green BadgeCheck IS its verification state — so "incomplete" here is
 * something the user can see on the row, not something inferred behind it.
 *
 * The signals one would reach for first are simply NOT available client-side at
 * this point in the render, which is why they are not used:
 *   • businessLogoUrl / profilePictureUrl exist on models/User.js but no
 *     group-chat populate ever selects them, so a "no logo" rule would need a
 *     wider populate or a new endpoint — a backend change this task may not make.
 *   • the builder's phone is not on room.builder at all; phone only arrives on
 *     members[].user, and only for builder and project rooms, so a "no contact
 *     number" rule has nothing to read either.
 *   • verificationStatus.builder === 'verified' is semantically the truer test,
 *     but it is not mapped into GroupRoom and it would disagree with the green
 *     tick the row itself shows, which reads as a bug rather than a filter.
 *
 * Known breadth: isVerified defaults to false on the User model, so if most
 * builders are unverified this half of the rule is wide. Narrowing it to
 * companyName alone is a one-line edit — which is the whole reason the rule
 * lives in a single named predicate instead of being inlined at the call site.
 */
export function isOwnerProfileIncomplete(owner?: { companyName?: string; isVerified?: boolean } | null): boolean {
  return !owner?.companyName?.trim() || owner?.isVerified !== true;
}

/**
 * An "orphaned" property group: one the user would otherwise never find, because
 * it is a lone property or its owner has no company identity to group it under.
 *
 * Builder rooms read room.projectCount, which the server's getRooms aggregation
 * already supplies (builder rooms only). Project rooms have no count on their
 * payload, so the caller passes a map derived from the shared /public/projects
 * list. The two numbers agree by construction: ProjectRepository.getPublished()
 * filters status:'published', which is the same filter the server aggregation
 * counts on — this is not an approximation of the server's number, it is the
 * same number computed from the other end.
 *
 * `publishedCountByOwner` being null (not yet loaded) or lacking the owner only
 * drops the count half of the test; the profile half still decides, so the chip
 * shows something useful instead of nothing while the fetch is in flight.
 */
export function isOrphanedPropertyGroup(room: GroupRoom, publishedCountByOwner: Record<string, number> | null): boolean {
  if (room.roomType === 'builder') {
    return room.projectCount === 1 || isOwnerProfileIncomplete(room.builder);
  }
  if (room.roomType === 'project') {
    const ownerId = room.project?.owner?.id || '';
    return publishedCountByOwner?.[ownerId] === 1 || isOwnerProfileIncomplete(room.project?.owner);
  }
  // Area and universal rooms are not property groups in any sense, so they are
  // never pulled in by this chip.
  return false;
}

/**
 * Is this room a PROPERTY room at all — a company group or one of its property
 * groups? Area and universal rooms are excluded for the same reason the orphan
 * rule above excludes them: they are not property groups in any sense.
 *
 * This is a separate test rather than a widening of isOrphanedPropertyGroup()
 * because the two answer different questions. Orphan-ness answers "would the
 * user never find this group on their own"; joined-ness answers "is the user
 * already in it". The Property Groups chip now needs EITHER to be true, but
 * folding the membership question into the orphan predicate would silently
 * widen every other caller of that rule, and the orphan rule is the thing that
 * decides which UNJOINED rooms are worth surfacing — a joined room has already
 * been found, so it tells us nothing about discoverability.
 */
export function isPropertyRoomType(room: GroupRoom): boolean {
  return room.roomType === 'project' || room.roomType === 'builder';
}

// Display name override: the universal / "HIT Community" room shows as "AI Lead Matching".
export function roomDisplayName(room?: GroupRoom | null): string {
  if (!room) return '';
  if (room.isUniversal || /hit community/i.test(room.name)) return 'AI Lead Matching';
  // Builder rooms are shown by company. The server already names the room after
  // the company, but prefer the live builder record so a company name changed
  // moments ago still reads correctly.
  if (room.roomType === 'builder') {
    return room.builder?.companyName || room.builder?.name || room.name;
  }
  return room.name;
}

/**
 * One-line summary shown under a group name. Property groups lead with the
 * linked property's location, price and configuration; area groups fall back to
 * their locality.
 */
/**
 * Row text split across two lines. One long ' · '-joined string pushed the
 * price and configuration off the end of a narrow row, so the identity of the
 * group (who/where) now sits on line 1 and the commercial detail on line 2.
 *
 * Every field is guarded: a project room whose project failed to populate falls
 * back to the area/locality rather than rendering "undefined".
 */
export function roomLines(room: GroupRoom): { primary: string; secondary: string } {
  const memberText = `${room.members.length} member${room.members.length !== 1 ? 's' : ''}`;
  const p: any = room.project;

  if (room.roomType === 'builder') {
    const who = room.builder?.role === 'agent' ? 'Agent' : 'Builder';
    // "N projects" answers the first thing a user asks of a company row — how
    // much inventory is in there. The number is supplied by the server on the
    // room (one aggregation for the whole list); this component must NOT fetch a
    // portfolio per row. Until the server sends the field it is undefined and the
    // segment is simply absent, so this renders correctly before and after that
    // backend change.
    const projectText = typeof room.projectCount === 'number' && room.projectCount > 0
      ? `${room.projectCount} project${room.projectCount !== 1 ? 's' : ''}`
      : '';
    return {
      primary: [memberText, projectText, room.builder?.isVerified ? 'Verified' : ''].filter(Boolean).join(' · '),
      secondary: `${who} · Tap to see their properties`,
    };
  }

  if (room.roomType === 'project' && p) {
    const where = [p.location, p.city].filter(Boolean).join(', ');
    const price = p.pricing?.startingPrice ? `${fmtPrice(p.pricing.startingPrice)}+` : '';
    const bhk = (p.configuration?.bhkOptions || []).filter(Boolean).join('/');
    const size = p.configuration?.carpetAreaRange || p.configuration?.plotSizeRange || '';
    return {
      primary: [memberText, where].filter(Boolean).join(' · '),
      secondary: [price, bhk, size].filter(Boolean).join(' · '),
    };
  }

  const where = [room.area?.location, room.area?.city].filter(Boolean).join(', ');
  return {
    primary: [memberText, where].filter(Boolean).join(' · '),
    secondary: '',
  };
}

/**
 * "Active Today" / "Active 3d ago" for a match card. Returns '' when there is no
 * timestamp so the caller can drop the segment rather than print "Active ".
 */
export function activityLabel(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  if (then.toDateString() === now.toDateString()) return 'Active Today';

  const days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  if (days <= 1) return 'Active Yesterday';
  if (days < 7) return `Active ${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks < 5 ? `Active ${weeks}w ago` : 'Active a while ago';
}

/** Short label for the row's type chip. Universal rooms don't get one. */
export function roomTypeLabel(room: GroupRoom): string {
  if (room.isUniversal) return '';
  if (room.roomType === 'builder') return 'Company';
  if (room.roomType === 'project') return 'Project';
  if (room.roomType === 'area') return 'Area';
  return '';
}
