// AI Lead Matching — Group Chat (full port of the website group-chat).
// Room list → open a room → full-screen thread with:
//   • one 3-dot menu: Share link, Download PDF, Download QR, Download Gallery,
//     and Exit Group (Delete Group instead, for the owner)
//   • bottom composer: Text / Requirement / Inventory (role-gated)
//   • requirement cards render their auto-match results + "Interested" button
//
// When a room is open we call onRoomOpenChange(true) so the hub hides its top tabs.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, SectionList, Pressable, StyleSheet, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Modal, ScrollView, Switch, Alert, Share, Animated,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, Linking } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  Users, Plus, Globe, ChevronLeft, Send, X, MoreVertical, Building2,
  Link as LinkIcon, FileText, QrCode, Image as ImageIcon, LogOut, Trash2,
  Search, MapPin, Check, Camera, Paperclip, Sparkles, ChevronDown, ChevronUp, Clock,
  Phone, Eye, UserPlus, BadgeCheck, Share2, MessageCircle, Download, Edit3, Pencil, ExternalLink,
} from 'lucide-react-native';
import { groupChatApi, shareApi, mediaApi, leadMatchingApi, invalidateLeadsCache, projectsApiExtended, fetchPublicProjectsRaw, GroupRoom, GroupMessage, InventoryCard, OwnerPortfolioProject, Project, GroupMedia, GroupLink } from '../lib/api';
import { ShareModal } from './ShareActions';
import AiAssistant, { AiAssistantApi, AiPostDraft, InventoryMatchCard, MatchCard, MatchResultCard, aiOwnsInput } from './AiAssistant';
import { postedListStorage, disappearStorage } from '../lib/storage';
import { useAuth } from '../lib/authContext';
import { useSocket } from '../hooks/useSocket';
import { useToast } from './Toast';
import { colors } from '../theme';

const ROOM_ICON: Record<string, string> = { project: '🏗', builder: '🏢', area: '📍', universal: '🌐' };

// Icon choices offered by the group profile-picture sheet. This used to be
// declared inside the component body, so a brand-new array was built on every
// single render of a 4000-line component for a value that never changes. It also
// listed '🏢' twice (old indices 2 and 8), which drew the same office block in
// two cells of the picker and made the grid look broken.
//
// COUPLED ACROSS REPOS — these fifteen are duplicated as the server's avatar
// allow-list, with the codepoint table recorded in
// HIT_Backend/.agents/tasks/group-avatar-backend/api-contract.md. There is no
// shared package between HIT_Mobile and HIT_Backend, so the duplication cannot
// be factored out; anything outside the list comes back 400 "Unsupported group
// icon". Verified byte-identical against the contract's codepoints (1F3E0,
// 1F3D7, 1F3E2, 1F4CD, 1F3D8, 1F3E1, 1F3EC, 1F3ED, 1F3F0, 1F3EF, 1F3DB, 1F306,
// 1F3D9, 1F307, 1F3AA) with no stray U+FE0F presentation selectors. If the icon
// set ever changes, BOTH repos must change in the same commit.
const PROPERTY_ICONS = ['🏠', '🏗', '🏢', '📍', '🏘', '🏡', '🏬', '🏭', '🏰', '🏯', '🏛', '🌆', '🏙', '🌇', '🎪'];

// ── Groups-pane filter chips ──────────────────────────────────────────────────
//
// The ONE place these three labels are written, so renaming a chip is a
// one-word edit instead of a hunt through the render tree.
//
// Deliberately 'My Groups' and NOT 'Favourites': on the Project map the
// Favourites chip already means "the user's OWN uploads" (filtered on
// MapProperty.ownerId), so reusing the word here — where it would mean "groups I
// have joined" — would make one label mean two different things in the same app.
const GROUP_FILTERS: Array<{ key: Exclude<GroupFilterKey, null>; label: string }> = [
  { key: 'mine', label: 'My Groups' },
  { key: 'discover', label: 'Discover' },
  { key: 'property', label: 'Property Groups' },
];

// Derived, never hand-written. The Property Groups section heading has to read
// the same as the chip that opened it, and a second literal spelling of the same
// label is exactly how a heading and its chip drift apart on a rename.
const GROUP_FILTER_LABELS = GROUP_FILTERS.reduce(
  (acc, f) => { acc[f.key] = f.label; return acc; },
  {} as Record<Exclude<GroupFilterKey, null>, string>
);

// `null` is a real state, not a missing one: no chip active renders exactly the
// three sections the pane showed before chips existed. There is no fourth "All"
// chip to default to, and defaulting to any of the three would hide two of
// today's sections and make the pane look emptier than it used to.
type GroupFilterKey = 'mine' | 'discover' | 'property' | null;

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
function isOwnerProfileIncomplete(owner?: { companyName?: string; isVerified?: boolean } | null): boolean {
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
function isOrphanedPropertyGroup(room: GroupRoom, publishedCountByOwner: Record<string, number> | null): boolean {
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
function isPropertyRoomType(room: GroupRoom): boolean {
  return room.roomType === 'project' || room.roomType === 'builder';
}

// Profile picture cache.
//
// THE DECISION HERE HAS BEEN REVERSED. This block used to read "DELIBERATELY
// LOCAL-ONLY" and warned the next developer not to add an API call or a
// HIT_Backend field until the product question was settled. It has now been
// settled the other way: a group's picture must be visible to every member, so
// the SERVER is the source of truth. It lives on the room as `room.avatar` and
// is written through the three endpoints under /api/group-chat —
// PUT /rooms/:roomId/avatar (emoji), POST /rooms/:roomId/avatar/image (photo),
// DELETE /rooms/:roomId/avatar (clear) — documented in
// HIT_Backend/.agents/tasks/group-avatar-backend/api-contract.md. That warning
// is obsolete; this comment replaces it so nobody re-applies it.
//
// What the old behaviour actually cost: the picture sat in AsyncStorage on one
// device, so it did not follow the user to another phone, was lost on uninstall,
// and — the part that mattered — no other member of the group ever saw it. An
// admin would set a group photo and be the only person on earth looking at it.
//
// This map is now demoted to a strictly SUBORDINATE offline/optimistic cache.
// Its only job is to keep the avatar from flickering or vanishing on a cold
// start, in the window before GET /rooms answers. It never wins against
// `room.avatar` — see resolveRoomAvatar, which encodes that precedence once for
// every surface in this file.
//
// The storage key is unchanged on purpose, so pictures already saved by the old
// local-only build still render as cache entries instead of disappearing on
// upgrade. Nothing migrates them to the server: an admin re-picking the picture
// once is what publishes it to the group.
const PROFILE_STORAGE_KEY = 'room_profile_pictures';

// Directory the picked photos are copied into. The ImagePicker hands back a path
// under the app's *cache* dir, which Android is free to purge and which does not
// survive a reinstall — persisting that URI produced avatars that silently went
// blank days later. documentDirectory survives app restarts and cache clears
// (though not an uninstall).
//
// This copy still matters now that uploads go to the server: it is the `localUri`
// offline fallback, the thing that renders when the device has no network and the
// public R2 URL cannot be fetched.
const AVATAR_DIR = `${FileSystem.documentDirectory}group-avatars/`;

/**
 * One cached avatar.
 *
 * `type` / `value` mirror SERVER truth: the canonical emoji the server echoed
 * back, or the public R2 URL of the uploaded photo. `localUri` is OURS — the
 * durable copy of a photo this device uploaded — and exists only so the avatar
 * still draws when the R2 URL cannot be reached. Nothing should ever prefer
 * `localUri` over `value`; it is the second hop, not the first.
 */
type RoomProfile = { type: 'icon' | 'image'; value: string; localUri?: string };

/**
 * The ONE canonical key for a room in the profile store, used on every read and
 * every write. Every GroupRoom comes out of `transformGroupRoom` in lib/api.ts as
 * `String(raw._id || raw.id || '')`, so list rows and the open room already agree
 * on the string — but that fallback can yield `''`, and a bad call site could
 * stringify an undefined id into the literal `'undefined'`. Either would make
 * unrelated rooms share one bucket, so both are rejected here and the caller is
 * expected to treat `null` as "no room to save against".
 */
function roomProfileKey(room?: { id?: string } | null): string | null {
  const k = String(room?.id || '').trim();
  return k && k !== 'undefined' && k !== 'null' ? k : null;
}

/**
 * The result of a cache write.
 *
 * WHY THIS IS A DISCRIMINATED UNION and not just `RoomProfile | null`. The old
 * `saveRoomProfilePicture` caught its own write failure, logged it, and returned
 * `null` — which is byte-for-byte what it returned on a perfectly successful
 * write to a room that simply had no previous picture. The caller could not tell
 * the two apart, so a failed write looked like a clean one: the success toast
 * fired, and the orphan-file cleanup below ran against a `previous` that was
 * never actually read. `ok` separates "did the write land" from "what did it
 * replace", so the caller can only reach `previous` when the write really
 * happened.
 */
type CacheWriteResult = { ok: true; previous: RoomProfile | null } | { ok: false };

/**
 * Caches one room's avatar locally and reports what it replaced, so the caller
 * can clean up a now-orphaned photo file. The previous entry is read back from
 * storage rather than from React state on purpose: storage is the single source
 * of truth for this map, and reading it avoids capturing `avatarCache` in a
 * closure — which is precisely how this feature broke in the first place.
 *
 * This is a cache write, not the save. The save is the server call the caller
 * has already awaited; if this fails the picture is still published to the
 * group, only the offline fallback is missing.
 */
async function cacheRoomAvatar(roomId: string, entry: RoomProfile): Promise<CacheWriteResult> {
  try {
    const stored = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
    const profiles: Record<string, RoomProfile> = stored ? JSON.parse(stored) : {};
    const previous = profiles[roomId] || null;
    profiles[roomId] = entry;
    await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
    return { ok: true, previous };
  } catch (error) {
    console.error('Failed to cache group avatar:', error);
    return { ok: false };
  }
}

/**
 * Drops one room's cache entry — used after a successful server-side clear, so
 * the local copy cannot keep rendering a picture the group no longer has. Same
 * honest-failure contract as cacheRoomAvatar.
 */
async function removeCachedRoomAvatar(roomId: string): Promise<CacheWriteResult> {
  try {
    const stored = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
    const profiles: Record<string, RoomProfile> = stored ? JSON.parse(stored) : {};
    const previous = profiles[roomId] || null;
    delete profiles[roomId];
    await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
    return { ok: true, previous };
  } catch {
    // Nothing is logged here on purpose: `ok: false` is the report, and the
    // caller is the only place that knows what the user should be told. A
    // console.error would be a second, silent channel for the same event.
    return { ok: false };
  }
}

/**
 * Persists an avatar learned from the server's `group_avatar_updated` push.
 *
 * The socket handler used to update the in-memory map only, which made a
 * live-learned picture session-only: an admin changed the photo, this user
 * watched it change, and at the next cold start it was absent from storage and
 * the avatar fell back to the room-type emoji until GET /rooms answered. That
 * cold-start window is the cache's one documented reason to exist, so the one
 * write path that skipped it was the one undermining it.
 *
 * `localUri` is carried over ONLY when the push describes the same picture the
 * stored entry already does — which is what this device's own upload echoing
 * back off the socket looks like. For anyone else's new picture there is no
 * local copy, and offering the replaced photo's file as its fallback would show
 * the wrong image offline. Fire-and-forget: it never throws, and a failed cache
 * write costs nothing the user can see right now.
 */
async function cacheServerPushedAvatar(roomId: string, entry: { type: 'icon' | 'image'; value: string }): Promise<void> {
  const written = await cacheRoomAvatar(roomId, entry);
  if (!written.ok) return;
  const previous = written.previous;
  if (previous?.type === 'image' && previous.value === entry.value && previous.localUri) {
    await cacheRoomAvatar(roomId, { ...entry, localUri: previous.localUri });
  }
}

/**
 * Removes a replaced avatar's local file. Guarded on the AVATAR_DIR prefix for
 * the same reason the R2 deletes elsewhere in this project are guarded on
 * `groups/{roomId}/`: a path this feature did not write (a legacy picker cache
 * path, anything else) must never be deleted by it. Best-effort — a failed
 * delete only leaves a stray file behind.
 *
 * It now guards on `previous.localUri` rather than `previous.value`, because
 * from the server-backed version onwards `value` on an image entry is a remote
 * R2 URL, not a file path — there is nothing on this device to delete there, and
 * the server handles its own object cleanup through its own prefix guard.
 *
 * Only call this when the cache write returned `ok: true`. On `ok: false` the
 * `previous` entry was never read, so there is no reliable statement about what
 * was replaced and deleting anything would be a guess.
 */
function discardReplacedAvatar(previous: RoomProfile | null, keep?: string) {
  const localUri = previous?.localUri;
  if (!localUri) return;
  if (!localUri.startsWith(AVATAR_DIR) || localUri === keep) return;
  FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
}

/**
 * Turns an avatar-endpoint failure into something worth showing a person.
 *
 * The server's own sentence comes first: handleResponse in lib/api.ts already
 * lifts `body.error` into ApiError.message, and the contract fixes those strings
 * ("Only a group admin can change the group photo", "The community group photo
 * cannot be changed", "Group photo must be 5 MB or smaller"), so they are more
 * specific than anything that could be written here. The status map is only for
 * the cases with a status but no readable body — a proxy 413, a gateway error.
 * The point of the whole function is that there is no silent path: a failure
 * always produces a message that says it failed.
 *
 * `message` is trusted ONLY when the error carries a numeric `status`, i.e. only
 * when it is an ApiError the server actually answered. Previously any non-empty
 * message won, and an RN fetch rejection has one — so a dead signal reached the
 * user verbatim as "Network request failed", skipping the status map on exactly
 * the class of failure that map was written for. A transport failure has no
 * status, so it now falls through to the caller's fallback sentence.
 */
function avatarErrorMessage(e: any, fallback: string): string {
  const status = typeof e?.status === 'number' ? e.status : null;
  const message = status !== null && typeof e?.message === 'string' ? e.message.trim() : '';
  if (message) return message;
  switch (status) {
    case 403: return 'Only a group admin can change the group photo';
    case 413: return 'Group photo must be 5 MB or smaller';
    case 400: return 'That picture could not be used';
    case 503: return 'Photo storage is unavailable right now';
    default: return fallback;
  }
}

async function loadRoomProfilePictures(): Promise<Record<string, RoomProfile>> {
  try {
    const stored = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
    const profiles: Record<string, RoomProfile> = stored ? JSON.parse(stored) : {};

    // Prune dead local files. Two distinct cases now, and they are NOT handled
    // the same way:
    let dropped = false;
    for (const [key, profile] of Object.entries(profiles)) {
      if (profile?.type !== 'image') continue;

      // Case 1 — the CURRENT shape. `value` is a remote R2 URL and `localUri` is
      // our durable copy. If the copy is gone the entry still has a perfectly
      // good remote URL, so only the dead fallback is cleared and the entry is
      // kept. Dropping the whole entry here would needlessly lose the cached
      // value and make the avatar blink to the default icon on a cold start.
      if (profile.localUri) {
        try {
          const info = await FileSystem.getInfoAsync(profile.localUri);
          if (!info.exists) { profiles[key] = { type: profile.type, value: profile.value }; dropped = true; }
        } catch {
          profiles[key] = { type: profile.type, value: profile.value };
          dropped = true;
        }
        continue;
      }

      // Case 2 — the LEGACY, pre-server shape, written by the local-only build:
      // `value` is itself a file:// path and there is no localUri. There is no
      // remote URL to fall back on, so a missing file makes the entry worthless
      // and it is dropped entirely. Without this an absent file renders as an
      // empty circle forever, with no way back to the default icon.
      if (!profile.value?.startsWith('file://')) continue;
      try {
        const info = await FileSystem.getInfoAsync(profile.value);
        if (!info.exists) { delete profiles[key]; dropped = true; }
      } catch {
        // A path we cannot even stat is no more usable than a missing one.
        delete profiles[key];
        dropped = true;
      }
    }
    // Only write back when something actually changed — this runs on every room
    // open and close.
    if (dropped) await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));

    return profiles;
  } catch (error) {
    console.error('Failed to load profile pictures:', error);
    return {};
  }
}

/**
 * THE one place the avatar precedence is written down, so the room list row, the
 * thread header and the group-info sheet cannot disagree about which picture a
 * group has. Precedence: the server's `room.avatar`, then the local cache, then
 * `null` meaning "render the default room-type icon".
 *
 * The server wins because it is the only value every member of the group can
 * see. Before this, the local AsyncStorage map was the ONLY source, which is how
 * two members ended up looking at two different pictures for the same group —
 * and how one member's header and the room list beside it could disagree.
 *
 * The first parameter used to be typed `any`, which meant passing a raw room id
 * STRING where the room object belonged compiled cleanly and then silently
 * resolved nothing. The `Pick<GroupRoom, …>` below makes that a compile error.
 */
function resolveRoomAvatar(
  room: Pick<GroupRoom, 'id' | 'avatar' | 'isUniversal'> | null | undefined,
  cache: Record<string, RoomProfile>,
): RoomProfile | null {
  const key = roomProfileKey(room);
  const cached = key ? (cache?.[key] || null) : null;

  const server = room?.avatar;
  if (server) {
    // Carry the cached localUri across only when the cache is describing THIS
    // same picture. A localUri from a previous, replaced photo would otherwise
    // be offered as the offline fallback for the current one.
    const localUri = cached?.type === 'image' && cached.value === server.value ? cached.localUri : undefined;
    return { type: server.type, value: server.value, localUri };
  }

  return cached;
}

/**
 * Renders a group's avatar: server picture if there is one, otherwise the cached
 * one, otherwise the room-type emoji.
 *
 * `cache` is named for what it is — the subordinate fallback — rather than the
 * old `profilePictures`, which read like the source of truth it is no longer.
 *
 * THIS IS THE ONLY PLACE AN AVATAR IS RENDERED. It used to serve the room list
 * row alone, while the thread header and the group-info sheet each hand-rolled
 * their own `<Image>` from the same resolved value. Those two copies had no
 * `onError` and never reached for `localUri`, so an unreachable R2 URL left a
 * blank circle on exactly the two surfaces the offline fallback was built for,
 * while the list row two taps away degraded correctly. Sharing the resolver was
 * not enough — the failure walk has to be shared too, so all three now come
 * through here.
 *
 * `size` is the emoji font size and the image diameter is derived from it, which
 * held for the list row but not for the other two (38 px image beside a 15 pt
 * emoji in the header, 70 px beside 30 pt in the sheet). `imageSize` overrides
 * the derived diameter so those call sites keep their existing pixel values
 * instead of being nudged to fit a formula.
 */
function RoomAvatar({ room, cache, size = 17, imageSize, style }: {
  room: GroupRoom;
  cache: Record<string, RoomProfile>;
  size?: number;
  imageSize?: number;
  style?: any;
}) {
  const profile = resolveRoomAvatar(room, cache);
  // There are TWO fallback hops now, not one. `value` is a remote R2 URL, so it
  // needs the network and can fail on a flight or a dead signal; `localUri` is
  // this device's own copy and needs nothing. So a failed remote load tries the
  // local copy first, and only when that ALSO fails do we degrade to the
  // room-type emoji. Never an empty circle, which is what a single hop produced.
  // `onError` is the only signal RN gives at render time, hence the state.
  const [failedRemote, setFailedRemote] = useState(false);
  const [failedLocal, setFailedLocal] = useState(false);
  // Reset on either URI changing, so picking a new picture clears a previous
  // failure instead of inheriting it.
  useEffect(() => { setFailedRemote(false); setFailedLocal(false); }, [profile?.value, profile?.localUri]);

  const dimension = imageSize ?? size * 2.7;
  const imageStyle = [{ width: dimension, height: dimension, borderRadius: dimension / 2 }, style];

  if (!room.isUniversal && profile) {
    if (profile.type === 'image' && !failedRemote) {
      return (
        <Image
          source={{ uri: profile.value }}
          style={imageStyle}
          resizeMode="cover"
          onError={() => setFailedRemote(true)}
        />
      );
    }
    if (profile.type === 'image' && profile.localUri && !failedLocal) {
      return (
        <Image
          source={{ uri: profile.localUri }}
          style={imageStyle}
          resizeMode="cover"
          onError={() => setFailedLocal(true)}
        />
      );
    }
    if (profile.type === 'icon') {
      return <Text style={{ fontSize: size }}>{profile.value}</Text>;
    }
  }

  return (
    <Text style={{ fontSize: size }}>
      {room.isUniversal ? '🌐' : (ROOM_ICON[room.roomType] || '💬')}
    </Text>
  );
}

function timeStr(iso: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function messageClock(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtPrice(v: number): string {
  if (!v) return '—';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(0)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// Display name override: the universal / "HIT Community" room shows as "AI Lead Matching".
/** Stable no-op, so passing one as a prop doesn't change identity each render. */
const noop = () => {};

function roomDisplayName(room?: GroupRoom | null): string {
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
function roomLines(room: GroupRoom): { primary: string; secondary: string } {
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

/** Group info the backend attaches to each match result. */
type MatchGroupInfo = {
  id: string;
  name: string;
  membersCount: number;
  lastActivity?: string;
};

/**
 * "Active Today" / "Active 3d ago" for a match card. Returns '' when there is no
 * timestamp so the caller can drop the segment rather than print "Active ".
 */
function activityLabel(iso?: string): string {
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

/**
 * Explains WHY a property matched, quoting the requirement the user actually
 * entered. Built from the requirement card on the same message, so it needs no
 * extra data from the server.
 */
function matchReason(req: any): string {
  if (!req) return '';
  const need = [
    req.bhkType,
    req.area ? `in ${req.area}` : '',
    req.budget ? `under ${req.budget}L` : '',
  ].filter(Boolean).join(' ');
  return need ? `Teri need "${need}" se match` : '';
}

/** Short label for the row's type chip. Universal rooms don't get one. */
function roomTypeLabel(room: GroupRoom): string {
  if (room.isUniversal) return '';
  if (room.roomType === 'builder') return 'Company';
  if (room.roomType === 'project') return 'Project';
  if (room.roomType === 'area') return 'Area';
  return '';
}

type PostMode = 'text' | 'requirement' | 'inventory';

const BHK_TYPES = ['1BHK', '2BHK', '3BHK', '4BHK', 'Plot', 'Shop'];
const POSSESSION_NEEDED = [
  { v: 'immediate', l: 'Immediate' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' },
];
const URGENCY = [
  { v: 'normal', l: 'Normal' }, { v: 'urgent', l: 'Urgent' }, { v: 'very_urgent', l: 'Very Urgent' },
];
const POSSESSION_STATUS = [
  { v: 'ready', l: 'Ready to Move' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' }, { v: '2year+', l: '2+ Years' },
];

// Per-property "Post to Group" cooldown (8 hours). After posting, the button is
// disabled/faded until this elapses, then returns to normal.
const POST_COOLDOWN_MS = 8 * 60 * 60 * 1000;

// Format a lakh amount the way the rest of the app does.
function fmtLakhs(lakhs?: number | null): string {
  if (!lakhs || lakhs <= 0) return '—';
  if (lakhs >= 100) return `₹${(lakhs / 100).toFixed(1)} Cr`;
  return `₹${Math.round(lakhs)} L`;
}

// Map a backend ExtractedLead (sell/rent) into the shape PostCard renders.
// This is what makes the Post list survive a reinstall — the data comes from
// the server, not from local storage.
function leadToDisplay(lead: any) {
  const p = lead?.params || {};
  const bhk = p.bhkType || '';
  const type = p.propertyType || '';
  const areaTxt = p.area ? `${p.area} ${p.areaUnit || 'sqft'}` : '';

  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === '' ) return;
    fields.push({ label, value: String(value) });
  };
  push('Listing For', lead?.direction === 'rent' || p.transactionType === 'rent' ? 'Rent' : 'Sale');
  push('Property Type', type);
  push('BHK', bhk);
  push('Area', areaTxt);
  push('Location', p.location || p.locationRaw);
  push('City', p.city);
  push('Full Address', p.formattedAddress);
  push('State', p.state);
  push('Postal Code', p.postalCode);
  push('Category', p.category);
  push('Construction Status', p.projectStatus);
  const minPrice = p.expectedPrice ?? p.budget;
  const maxPrice = p.budgetMax;
  push('Expected Price', minPrice ? `${fmtLakhs(minPrice)}${maxPrice ? ` - ${fmtLakhs(maxPrice)}` : ''}` : '');
  push('Possession Needed', p.possessionNeeded);
  push('Loan Required', p.loanRequired === true ? 'Yes' : p.loanRequired === false ? 'No' : '');
  push('RERA Approved', p.reraApproved === true ? 'Yes' : p.reraApproved === false ? 'No' : '');
  push('RERA Number', p.reraNumber);
  push('Bank Loan Available', p.bankLoanAvailable === true ? 'Yes' : p.bankLoanAvailable === false ? 'No' : '');
  push('Amenities', Array.isArray(p.amenities) && p.amenities.length ? p.amenities.join(', ') : '');
  push('Urgency', p.urgency);
  if (p.latitude && p.longitude) push('Coordinates', `${p.latitude}, ${p.longitude}`);

  return {
    id: String(lead?._id || lead?.id || ''),
    leadId: String(lead?._id || lead?.id || ''),
    title: [bhk, type].filter(Boolean).join(' ') || 'Property',
    subtitle: [p.location || p.locationRaw, p.city].filter(Boolean).join(', '),
    price: fmtLakhs(p.expectedPrice ?? p.budget),
    tags: [lead?.direction === 'rent' ? 'Rent' : 'Sale', bhk, areaTxt, type].filter(Boolean),
    fields,
    direction: lead?.direction || 'sell',
    createdAt: lead?.createdAt,
    source: 'lead',
  };
}

// WhatsApp-style disappearing-message durations for the AI Assist chat.
const DISAPPEAR_OPTIONS: { label: string; ms: number }[] = [
  { label: '6 hours', ms: 6 * 3600000 },
  { label: '12 hours', ms: 12 * 3600000 },
  { label: '1 day', ms: 24 * 3600000 },
  { label: '7 days', ms: 7 * 24 * 3600000 },
  { label: '1 month', ms: 30 * 24 * 3600000 },
  { label: 'Never', ms: 0 },
];
const disappearLabel = (ms: number) => DISAPPEAR_OPTIONS.find(o => o.ms === ms)?.label || 'Never';

function fmtCooldownLeft(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Rupees → short label (₹80L / ₹1.2Cr).
function fmtMoney(v: number): string {
  if (!v || v <= 0) return '';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(v % 10000000 === 0 ? 0 : 1)}Cr`;
  if (v >= 100000) return `₹${Math.round(v / 100000)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// A backend project → the common display shape used by PostCard / View Property.
// Every non-empty field comes from the real Project document. Raw AI prompts and
// questionnaire text are never included.
function projectToDisplay(p: any) {
  const mediaUrl = (m: any): string => typeof m === 'string' ? m : (m?.url || '');
  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === '') return;
    fields.push({ label, value: String(value) });
  };

  push('Listing Status', p.isPublished ? 'Published' : 'Draft');
  push('Property Type', p.propertyType || p.type);
  push('Category', p.category);
  push('BHK / Configuration', p.bhkOptions?.length ? p.bhkOptions.join(', ') : '');
  push('Carpet Area', p.carpetAreaRange);
  push('Plot Size', p.plotSizeRange);
  push('Floor Range', p.floorRange);
  push('Facing', p.facingOptions?.length ? p.facingOptions.join(', ') : '');
  push('Location', p.location);
  push('City', p.city);
  push('Starting Price', fmtMoney(p.startingPrice));
  push('Price per sq.ft', p.pricePerSqFt ? `₹${Number(p.pricePerSqFt).toLocaleString('en-IN')}` : '');
  push('Total Price Range', p.totalPriceRange);
  push('Payment Plan', p.paymentPlan);
  push('Bank Loan', p.bankLoanAvailable ? 'Available' : 'Not available');
  push('GST', p.gstPercentage != null ? `${p.gstPercentage}%` : '');
  push('Stamp Duty', p.stampDutyPercentage != null ? `${p.stampDutyPercentage}%` : '');
  push('Registration Charges', p.registrationCharges ? `₹${Number(p.registrationCharges).toLocaleString('en-IN')}` : '');
  push('Maintenance Charges', p.maintenanceCharges);
  push('Other Charges', p.otherCharges);
  push('Construction Status', p.projectStatus);
  push('RERA Approved', p.reraApproved ? 'Yes' : 'No');
  push('RERA Number', p.reraNumber);
  push('Gated Community', p.gatedCommunity ? 'Yes' : 'No');
  push('Amenities', p.amenities?.length ? p.amenities.join(', ') : '');
  push('Landmarks', p.landmarks?.length ? p.landmarks.map((l: any) => l.name || l.address).filter(Boolean).join(', ') : '');
  push('Google Map', p.googleMapLink);
  if (p.latitude && p.longitude) push('Coordinates', `${p.latitude}, ${p.longitude}`);
  push('Call Number', p.cta?.callNumber);
  push('WhatsApp Number', p.cta?.whatsappNumber);
  push('Contact Button', p.cta?.buttonText);
  push('Owner', p.owner?.companyName || p.owner?.name);
  push('Gallery Photos', p.galleryImages?.length || '');
  push('Videos', p.videos?.length || '');
  push('Brochure PDF', mediaUrl(p.brochureUrl));
  push('Created', p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '');

  return {
    id: String(p.id || ''),
    projectId: String(p.id || ''),
    title: p.name || 'Property',
    subtitle: [p.location, p.city].filter(Boolean).join(', '),
    price: fmtMoney(p.startingPrice),
    image: mediaUrl(p.coverImage),
    galleryImages: (p.galleryImages || []).map(mediaUrl).filter(Boolean),
    videos: (p.videos || []).map(mediaUrl).filter(Boolean),
    brochureUrl: mediaUrl(p.brochureUrl),
    layoutImage: mediaUrl(p.layoutImage),
    tags: [
      ...(Array.isArray(p.bhkOptions) && p.bhkOptions.length ? [p.bhkOptions.join(', ')] : []),
      p.carpetAreaRange || p.plotSizeRange || '',
      p.propertyType || p.category || p.type || '',
    ].filter(Boolean),
    fields,
    direction: 'sell',
    source: 'project',
    posted: true,
    postedAt: p.createdAt ? new Date(p.createdAt).getTime() : 0,
  };
}

// Map an AI-collected sell draft (labeled fields) → a real project create payload
// (same shape as add-project) + a group inventory card. Price is normalized to
// full rupees so the property matches correctly.
function buildProjectFromDraft(draft: AiPostDraft): { payload: any; card: any } {
  const get = (re: RegExp) => draft.fields.find(f => re.test(f.label))?.value || '';
  const propType = get(/property type|^type$/i) || 'Apartment / Flat';
  const bhk = get(/bhk/i);
  const location = get(/location/i) || get(/area/i);
  const city = get(/city/i) || 'Nagpur';
  const category = get(/category/i) || 'Residential';
  const statusRaw = get(/status|possession|construction/i);
  const rera = /yes|haan|approved/i.test(get(/rera/i));
  const loan = /yes|haan|available/i.test(get(/loan/i));

  // Price → full rupees. AI collects price in lakh (unit 'lakh'); handle cr too.
  const priceStr = get(/price|budget/i);
  const priceNum = Number((priceStr.match(/[\d.]+/) || [])[0]) || 0;
  const isCr = /cr|crore/i.test(priceStr);
  const priceRupees = Math.round(priceNum * (isCr ? 10000000 : 100000));

  const isPlot = /plot|land|zameen/i.test(propType);
  const projectStatus = /ready/i.test(statusRaw) ? 'ready-to-move'
    : /under|construction/i.test(statusRaw) ? 'under-construction'
    : 'ready-to-move';

  // Auto project name: "{BHK} {PropertyType} - {Location}"
  const namePieces = [bhk, propType].filter(Boolean).join(' ');
  const projectName = [namePieces, location].filter(Boolean).join(' - ') || (draft.title || 'Property');

  const payload = {
    projectName,
    projectType: isPlot ? 'plot' : 'flat',
    city: city.trim(),
    location: location.trim(),
    latitude: 0,
    longitude: 0,
    googleMapLink: '',
    category,
    propertyType: propType,
    reraApproved: rera,
    reraNumber: '',
    projectStatus,
    amenities: (get(/amenit/i) || '').split(',').map(s => s.trim()).filter(Boolean),
    pricing: {
      startingPrice: priceRupees, // full rupees
      totalPriceRange: '',
      paymentPlan: '',
      bankLoanAvailable: loan,
    },
    configuration: {
      bhkOptions: bhk ? [bhk] : [],
      carpetAreaRange: get(/area/i) || '',
      floorRange: '',
      plotSizeRange: '',
      facingOptions: [],
      gatedCommunity: false,
    },
    cta: { buttonText: '', whatsappNumber: '', callNumber: '' },
  };

  const card = {
    projectName,
    propertyType: propType,
    carpetAreaRange: get(/area/i) || '',
    bhkOptions: bhk ? [bhk] : [],
    priceRange: { min: Math.round(priceRupees / 100000), max: 0 }, // card shows lakhs
    area: location,
    city,
    possessionStatus: /ready/i.test(statusRaw) ? 'ready' : (statusRaw || 'ready'),
    urgency: 'normal' as const,
    bankLoanAvailable: loan,
    commissionPercent: 0,
    description: draft.fields.map(f => `${f.label}: ${f.value}`).join(' • '),
  };

  return { payload, card };
}

// ─── Draggable "AI Lead Assist" FAB ──────────────────────────────────────────
// ─── Compact posted-property card (with expand toggle) ──────────────────────
// Marketplace-style property card for the Post view.
// - Draft (not yet posted): shows "Post to Group" (green) + "View Property".
// - Posted: shows a "LISTED" badge; "Post to Group" is faded/disabled during the
//   8h cooldown (shows remaining time), then re-enables.
function PostCard({ item, posted, cooldownLeftMs, posting, onPost, onView }: {
  item: { title?: string; subtitle?: string; price?: string; tags?: string[]; image?: string; fields?: Array<{ label: string; value: string }> };
  posted: boolean;
  cooldownLeftMs: number;
  posting: boolean;
  onPost: () => void;
  onView: () => void;
}) {
  const inCooldown = cooldownLeftMs > 0;
  const postDisabled = posting || inCooldown;
  return (
    <View style={pd.card}>
      <View style={pd.cardTop}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={pd.cardThumb} resizeMode="cover" />
        ) : (
          <View style={pd.cardIcon}><Building2 size={22} color={colors.brand} /></View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[pd.badge, { backgroundColor: posted ? `${colors.greenText}18` : `${colors.brand}18` }]}>
              <Text style={[pd.badgeText, { color: posted ? colors.greenText : colors.brand }]}>{posted ? 'LISTED' : 'READY'}</Text>
            </View>
            <Text style={pd.cardTitle} numberOfLines={1}>{item.title || 'Property'}</Text>
          </View>
          {item.subtitle ? <Text style={pd.cardLoc} numberOfLines={1}>📍 {item.subtitle}</Text> : null}
        </View>
        {item.price ? <Text style={pd.cardPrice}>{item.price}</Text> : null}
      </View>

      {/* Tags row (BHK / area / type) */}
      {item.tags && item.tags.length > 0 && (
        <View style={pd.tagsRow}>
          {item.tags.slice(0, 3).map((t, i) => (
            <View key={i} style={pd.tag}><Text style={pd.tagText} numberOfLines={1}>{t}</Text></View>
          ))}
        </View>
      )}

      {/* Actions: Post to Group + View Property */}
      <View style={pd.actionsRow}>
        <Pressable
          onPress={onPost}
          disabled={postDisabled}
          style={[pd.postBtn, postDisabled && pd.postBtnDim]}
        >
          {posting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={pd.postBtnText}>{inCooldown ? `Posted · ${fmtCooldownLeft(cooldownLeftMs)}` : 'Post to Group 📢'}</Text>}
        </Pressable>
        <Pressable onPress={onView} style={pd.viewBtn}>
          <Text style={pd.viewBtnText}>View Property</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Adapts a builder card's thin OwnerPortfolioProject to the InventoryCard shape
 * handlePropertyViewDetails already accepts as its fallback.
 *
 * Needed because the card's Details now goes through a project fetch instead of
 * building a sheet synchronously: with no fallback, a deleted or unpublished
 * project — or just an offline device — opened NO sheet at all, only a "Could not
 * load property details" toast. That is the same dead-button behaviour
 * ("card pr click kiya to detail nahi dhikhti") this change set out to remove, so
 * the card's own data stands in whenever the fetch cannot answer.
 *
 * priceRange is in LAKHS on InventoryCard (the inventory form's unit) while
 * startingPrice is in rupees, hence the divide.
 */
const portfolioFallback = (p: OwnerPortfolioProject): InventoryCard => ({
  projectName: p.name,
  area: p.location,
  city: p.city,
  propertyType: p.propertyType,
  possessionStatus: p.projectStatus,
  carpetAreaRange: p.carpetAreaRange,
  bhkOptions: p.bhkOptions,
  priceRange: p.startingPrice ? { min: p.startingPrice / 100000 } : undefined,
});

// Geometry of the builder property strip, lifted out of the StyleSheet because
// the auto-scroll stride is derived from it. The timer used to carry its own
// hardcoded `const cardWidth = 196` (186 card + 10 gap) with no link back to
// `bp.card` / `bp.stripRow`, so the two could silently disagree the moment either
// style was touched. Now the styles and the stride math read the same constants
// and the stride itself is derived from the ScrollView's MEASURED content width —
// see cardStride() below.
const CARD_GAP = 10;
const STRIP_PADDING_H = 14;

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
const BUILDER_STRIP_AUTOSCROLL_MS = 2000;

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
function cardStride(contentWidth: number, count: number): number {
  if (count < 1 || contentWidth <= 0) return 186 + CARD_GAP;
  const measured = (contentWidth - 2 * STRIP_PADDING_H + CARD_GAP) / count;
  return measured > 1 ? measured : 186 + CARD_GAP;
}

// ── Builder property card ──
// Shown as a horizontal strip inside a company group: the properties that
// builder has published. Three actions, because they answer different questions —
// Details is "what is this property", Open Group is "take me to its discussion",
// Share is "send this to a client".
//
// The cover + body are now a Pressable that opens the SAME detail view as the
// Details button. Before this, the card body was inert: tapping the photo or the
// name did nothing, which read as "card pr click kiya to detail nahi dhikhti".
// `bp.actions` is deliberately left OUTSIDE that Pressable — nesting the two
// buttons inside a pressable parent swallows their own taps.
const BuilderPropertyCard = React.memo(function BuilderPropertyCard({ project, opening, sharing, loadingDetails, onDetails, onOpenGroup, onShare }: {
  project: OwnerPortfolioProject;
  opening: boolean;
  sharing: boolean;
  /** Details is awaiting the project fetch for THIS card — see onDetails below. */
  loadingDetails: boolean;
  onDetails: (project: OwnerPortfolioProject) => void;
  onOpenGroup: (project: OwnerPortfolioProject) => void;
  onShare: (project: OwnerPortfolioProject) => void;
}) {
  const where = [project.location, project.city].filter(Boolean).join(', ');
  const price = project.startingPrice ? fmtPrice(project.startingPrice) : '';
  const bhk = (project.bhkOptions || []).filter(Boolean).join('/');

  return (
    <View style={bp.card}>
      {/* Card body tap now opens Share sheet instead of Details. Previous
          behavior: tapping the card body opened a detail view, and the three
          buttons below offered Details / Open Group / Share. User requirement:
          remove ALL three buttons and make the card body itself open Share.
          This consolidates the share action into the only tap target on the
          card, making the interaction model simpler — one card, one action. */}
      <Pressable
        onPress={() => onShare(project)}
        disabled={sharing}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`Share ${project.name}`}
      >
        {project.coverImage ? (
          <Image source={{ uri: project.coverImage }} style={bp.cover} resizeMode="cover" />
        ) : (
          <View style={[bp.cover, bp.coverFallback]}>
            <Building2 size={18} color={colors.greenText} />
          </View>
        )}

        <View style={bp.body}>
          <Text style={bp.name} numberOfLines={1}>{project.name}</Text>
          {!!where && <Text style={bp.meta} numberOfLines={1}>📍 {where}</Text>}
          {!!(price || bhk) && (
            <Text style={bp.price} numberOfLines={1}>
              {[price, bhk].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
});

// ── Room list row ──
// One row for BOTH sections. Joined and discoverable rows previously had their
// own near-identical components (and the discover variant was additionally
// duplicated between an inline list and a modal), which let the two drift apart.
// `joined` is the only thing that differs: the trailing slot shows either
// activity time + unread badge, or a Join button.
const RoomSeparator = () => (
  <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 64 }} />
);

const GroupRow = React.memo(function GroupRow({ room, joined, joining, onPress, onJoin, cache }: {
  room: GroupRoom;
  joined: boolean;
  joining?: boolean;
  onPress?: (room: GroupRoom) => void;
  onJoin?: (room: GroupRoom) => void;
  // The avatar fallback cache, not the avatar itself — the row's picture comes
  // from room.avatar when the server has one. Renamed from `profilePictures`
  // (and off `any`) so that subordinate role is legible at the call site.
  cache: Record<string, RoomProfile>;
}) {
  const { primary, secondary } = roomLines(room);
  const typeLabel = roomTypeLabel(room);
  const unread = joined ? (room.unreadCount || 0) : 0;

  return (
    <Pressable
      onPress={joined ? () => onPress?.(room) : undefined}
      disabled={!joined}
      style={[s.roomRow, room.isUniversal && s.roomRowPinned]}
    >
      <View style={[s.roomAvatar, room.isUniversal && { backgroundColor: colors.brand }]}>
        <RoomAvatar room={room} cache={cache} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.roomNameRow}>
          <Text style={[s.roomName, room.isUniversal && { color: colors.brand }]} numberOfLines={1}>
            {roomDisplayName(room)}
          </Text>
          {!!typeLabel && (
            <View style={s.roomTypeChip}>
              <Text style={s.roomTypeChipText}>{typeLabel}</Text>
            </View>
          )}
        </View>

        <Text style={s.roomMeta} numberOfLines={1}>{primary}</Text>
        {!!secondary && <Text style={s.roomMetaSecondary} numberOfLines={1}>{secondary}</Text>}
      </View>

      {joined ? (
        <View style={s.roomTrailing}>
          <Text style={s.roomTime}>{timeStr(room.lastActivity)}</Text>
          {unread > 0 && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </View>
      ) : (
        <Pressable
          onPress={() => onJoin?.(room)}
          disabled={joining}
          style={[s.smallJoin, joining && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Join ${roomDisplayName(room)}`}
        >
          {joining
            ? <ActivityIndicator size="small" color={colors.brand} />
            : <Text style={s.smallJoinText}>Join Group</Text>}
        </Pressable>
      )}
    </Pressable>
  );
});

export default function GroupChatEmbedded({ onRoomOpenChange, topInset = 0, autoOpenUniversal = false, hideThreadBack = false, headerless = false, onActionsReady, onMatchCountChange, onAiAvailableChange, autoOpenProjectId, onAutoJoinFailed }: {
  onRoomOpenChange?: (open: boolean) => void;
  topInset?: number;
  // When true, the Universal ("AI Lead Matching") room opens automatically and
  // the thread's back button is hidden — used when this component IS the
  // AI Lead Matching section (no separate room-list step).
  autoOpenUniversal?: boolean;
  hideThreadBack?: boolean;
  // When true, the whole thread header (avatar, member count) is hidden — used
  // when the parent (AI Leads hub) provides its own single sub-row of
  // Groups · Chats · My Post · Matching above this component. In that mode only
  // the AI 3-dot remains here; the My Post / Matching buttons that used to sit in
  // this component's own row are rendered by the hub instead.
  headerless?: boolean;
  // Exposes the post/matching triggers to the parent so its sub-row can drive
  // them. In headerless mode this is the ONLY way those two actions are reachable
  // — nothing in this component renders them any more. Called once ready.
  onActionsReady?: (actions: {
    post: () => void;
    matching: () => void;
    // Return to the default landing view (no AI conversation in progress).
    resetToLanding: () => void;
  }) => void;
  // How many projects this user's own requirements currently match, reported
  // upward so the hub can put a number on its Matching pill. `null` means "not
  // known" (never loaded, or the request failed) — deliberately distinct from 0,
  // because a failed load must not render as "you have no matches".
  onMatchCountChange?: (n: number | null) => void;
  // Whether AI Assist is available in the room currently open, so the hub can
  // hide its My Post / Matching pills when it is not. The hub used to derive this
  // itself as `tab === 'assistant' && groupOpen`, which reproduced the old
  // prop-based `aiAllowed`; that rule stopped being true once this component
  // could open a PROPERTY room inside the AI pane, where My Post would set
  // aiMode only for the safety-net effect to clear it again — a visibly dead
  // button. Only this component knows which room is open, so it reports the fact.
  onAiAvailableChange?: (available: boolean) => void;
  // Open this property's group room immediately on mount, skipping the room
  // list. Used by the Project-map card's Join Group button, which knows a project
  // id and nothing else.
  autoOpenProjectId?: string;
  // Called when that autoOpenProjectId join FAILS. The host mounted this
  // component for one specific room, so with no room there is nothing worth
  // showing — the error toast has already been raised, and the host should get
  // out of the way rather than fall back to this component's room list.
  onAutoJoinFailed?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const socket = useSocket();

  const [myRooms, setMyRooms] = useState<GroupRoom[]>([]);
  const [discoverRooms, setDiscoverRooms] = useState<GroupRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<GroupRoom | null>(null);
  // The room AI Assist belongs to, captured when the autoOpenUniversal effect
  // resolves it. This exists because `aiAllowed` used to be decided by the
  // `autoOpenUniversal` PROP, which is a fact about the pane and not about the
  // room currently open — so every room opened in that pane inherited "AI is
  // allowed here". Holding the resolved room lets the render path ask the only
  // question that matters: "is the open room the AI room?" It is also the room
  // the thread's back control returns to, which is why it is state and not a ref
  // (the header must re-render when it appears).
  const [aiRoom, setAiRoom] = useState<GroupRoom | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', city: '', location: '' });
  const [search, setSearch] = useState('');
  // Active filter chip under the search bar. null = no chip, which is the
  // pre-chip behaviour (all three sections) — see GROUP_FILTERS above.
  const [groupFilter, setGroupFilter] = useState<GroupFilterKey>(null);
  // Published-project count per owner id, needed only to judge project rooms for
  // the Property Groups chip. null means "never loaded"; {} means "we tried and
  // failed", which is a different thing and must not retrigger the fetch.
  const [publishedCountByOwner, setPublishedCountByOwner] = useState<Record<string, number> | null>(null);
  // Which discoverable room is mid-join (shows a spinner on its Join button).
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Thread UI state
  const [postMode, setPostMode] = useState<PostMode>('text');
  const [text, setText] = useState('');
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  // QR export is rendered off-screen just long enough for react-native-qrcode-svg
  // to produce a PNG. This avoids opening the generic Share bottom sheet when
  // the user explicitly chose "Download QR" from the project menu.
  const [qrExport, setQrExport] = useState<{ url: string; fileName: string } | null>(null);
  const qrRef = useRef<any>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  // AI Assist mode — when on, the composer + a private inline panel drive the
  // existing AI Lead Matching assistant instead of posting to the group.
  const [aiMode, setAiMode] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  // Input type of the assistant's current question. When the assistant renders
  // its own rich control (chips / unit picker / place search) or is in a locked
  // state, this composer must hide — otherwise TWO input rows stack up.
  const [aiInputType, setAiInputType] = useState<string | undefined>(undefined);
  const handleAiTemplate = useCallback((t?: { inputType?: string }) => {
    setAiInputType(t?.inputType);
  }, []);
  // True once the embedded assistant has published its imperative API. Deferred
  // actions (My Post / Matching / a chosen intent) are drained off this, rather
  // than from inside onReady — see the drain effect below.
  const [aiReady, setAiReady] = useState(false);
  // Mirror of aiMode for stable callbacks. The action handlers below are exposed
  // to the parent hub through an effect that runs ONCE, so reading `aiMode`
  // directly would capture the first render's value (always false) forever.
  const aiModeRef = useRef(false);
  useEffect(() => { aiModeRef.current = aiMode; }, [aiMode]);
  // Disappearing messages setting for the AI Assist chat (ms; 0 = Never).
  const [disappearMs, setDisappearMs] = useState(0);
  const [showDisappear, setShowDisappear] = useState(false);

  // Post card built from the AI-collected property details (no manual form).
  const [postDraft, setPostDraft] = useState<AiPostDraft | null>(null);
  const [postingDraft, setPostingDraft] = useState(false);
  // "Post" view: all properties the user has posted so far + the current draft.
  const [showPost, setShowPost] = useState(false);
  // True while the two backend loads behind My Posts are in flight. They used to
  // be fired un-awaited with nothing on screen to say so, so the sheet opened
  // blank with "0 posted" and filled in a second later.
  const [postsLoading, setPostsLoading] = useState(false);
  const [postedList, setPostedList] = useState<any[]>([]); // AiPostDraft + { projectId, postedAt, id }
  const [postedLeads, setPostedLeads] = useState<any[]>([]); // backend ExtractedLeads (sell/rent)
  const [myProjects, setMyProjects] = useState<any[]>([]); // backend published projects (source of truth)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewProperty, setViewProperty] = useState<any | null>(null); // View Property detail sheet
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  // Properties of the builder whose company group is open. Loaded per room, so
  // switching groups never shows the previous builder's inventory.
  const [builderProjects, setBuilderProjects] = useState<OwnerPortfolioProject[]>([]);
  const builderScrollRef = useRef<ScrollView>(null);
  const autoScrollTimer = useRef<NodeJS.Timeout | null>(null);
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const currentCardIndex = useRef(0);
  // Measured geometry of the property strip. This is STATE, not a ref, on purpose:
  // the auto-scroll effect used to start only `if (builderScrollRef.current)`, and
  // reading a ref cannot schedule a re-run — see the effect's comment below. These
  // two numbers come from onLayout / onContentSizeChange, which can only fire
  // after the ScrollView exists, so writing them to state is the mount-proof
  // signal the effect needs.
  const [stripMetrics, setStripMetrics] = useState({ viewport: 0, content: 0 });
  // Handle for the "resume ~1s after the finger lifts" timer. The previous code
  // called a bare setTimeout in four inline handlers with no stored handle, so it
  // could neither be cleared on unmount nor coalesced between rapid touches.
  const resumeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [loadingBuilderProjects, setLoadingBuilderProjects] = useState(false);
  // Share sheet. ShareModal needs a real `Project` (it reads id / name / slug /
  // brochureUrl and mints a tracked token), but a builder card only carries the
  // thin OwnerPortfolioProject — hence the fetch in handleShareProject.
  const [shareProject, setShareProject] = useState<Project | null>(null);
  // Which builder card is waiting on its project fetch for Details. The card used
  // to open its sheet from portfolio data already in memory, so there was nothing
  // to indicate; now it fetches, and a tap with no feedback reads as a dead card.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  // WhatsApp-style group info, opened by tapping the thread header. Exit / Delete
  // Group live in here now (they used to be in the 3-dot menu).
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupMedia, setGroupMedia] = useState<{ media: GroupMedia[]; links: GroupLink[] } | null>(null);
  const [loadingGroupMedia, setLoadingGroupMedia] = useState(false);
  
  // Profile picture upload modal states
  const [showProfilePicModal, setShowProfilePicModal] = useState(false);
  const [updatingProfilePic, setUpdatingProfilePic] = useState(false);
  // Keyed by roomProfileKey(room) — the same key the write path uses. Renamed
  // from `allRoomProfiles`: it is the offline fallback cache, not the list of
  // group pictures, which now comes down on room.avatar.
  //
  // There used to be two more states here, `customProfileIcon` and
  // `customProfileImage`, holding the OPEN room's picture for the thread header
  // and the group-info sheet. They were a second source of truth for the same
  // pixel and the room list did not share them, which is how a freshly picked
  // picture showed in the header while the list row kept the default icon. Both
  // are gone; all three surfaces now read resolveRoomAvatar, so they cannot
  // disagree.
  const [avatarCache, setAvatarCache] = useState<Record<string, RoomProfile>>({});
  // Matching results state. Typed as MatchCard[] now — it used to be `any[]`
  // holding raw `{ project, score, matchedOn }` rows for a local lookalike card;
  // it holds the shape the one shared MatchResultCard renders.
  const [showMatching, setShowMatching] = useState(false);
  const [matchingResults, setMatchingResults] = useState<MatchCard[]>([]);
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [matchingError, setMatchingError] = useState<string | null>(null);
  // Has a match load ever SUCCEEDED? This is what separates "you have no
  // matches" (0) from "we do not know" (null) for the hub's pill badge. An empty
  // `matchingResults` cannot answer it on its own — that is also the initial
  // state and the state after a failure.
  const [matchCountKnown, setMatchCountKnown] = useState(false);
  // Free-text lead detection (mirrors the website's extract → confirm → match).
  // When a typed message like "i need a flat in besa" is detected as a lead,
  // we show a confirm sheet; on confirm we run matching (leadMatchingApi.confirm).
  const [leadDetect, setLeadDetect] = useState<{ extraction: any; messageId?: string } | null>(null);
  const [confirmingLead, setConfirmingLead] = useState(false);
  const aiApiRef = useRef<AiAssistantApi | null>(null);
  // Action to run once AI mode is activated from a header button. Used to be
  // 'post' | 'match'; 'match' was never actually queued (the line that set it was
  // commented out) and Matching no longer enters AI mode at all, so only My Post
  // defers through here now.
  const pendingAiActionRef = useRef<'post' | null>(null);
  // Intent chosen from the Sell/Buy/Rent quick-start, applied once AI is ready.
  const pendingAiIntentRef = useRef<'sell' | 'buy' | 'rent' | null>(null);
  const flatRef = useRef<FlatList>(null);

  // AI Assist belongs to the AI Lead Matching room only — it is a private
  // slot-filling conversation, not a group feature. It must never run inside an
  // individual property or area group, where its greeting, intent chips and
  // My Post / Matching buttons make no sense.
  //
  // This is answered by ROOM IDENTITY: `isUniversal` for the universal room
  // however it was opened, plus an id match against `aiRoom` — the room the
  // autoOpenUniversal effect actually resolved, which covers the `/hit community/`
  // name fallback that effect uses when the server sends no isUniversal flag.
  //
  // Previous behaviour, and why it was wrong. This read
  // `activeRoom.isUniversal || autoOpenUniversal`. `autoOpenUniversal` is a prop
  // of the PANE, not a fact about the open room, so once the user opened any
  // other room inside the AI Leads pane — which is exactly what Join Group on a
  // match row does — `aiAllowed` stayed true for that property room. Three things
  // followed: the Sell/Buy/Rent starter chips kept rendering inside a property
  // group (the note above says that must never happen), the safety-net effect
  // below could never fire, and the room looked like it had not opened at all.
  // (The even earlier version read `hideThreadBack`, which was wrong for the same
  // reason one step removed — it is chrome, not identity.)
  //
  // Accepted consequence, deliberately: now that this is honest, joining a
  // property group from the AI pane ENDS an in-progress AI Assist conversation,
  // because the safety-net effect clears aiMode and unmounts AiAssistant. That is
  // precisely what the safety net was written for; a stale assistant painted over
  // someone else's property group is the worse outcome.
  const isAiRoom = !!activeRoom && (activeRoom.isUniversal || (!!aiRoom && activeRoom.id === aiRoom.id));
  const aiAllowed = isAiRoom;

  // Use this — never raw `aiMode` — for anything in the render path. It prevents
  // a frame where the assistant UI paints over a property group before the
  // safety-net effect below has run.
  const aiActive = aiMode && aiAllowed;

  // Safety net: if the active room changes to one where AI Assist doesn't belong,
  // shut it down rather than leaving a stale assistant mounted over the thread.
  useEffect(() => {
    if (!aiMode || aiAllowed) return;
    setAiMode(false);
    setAiInputType(undefined);
    setAiReady(false);
    aiApiRef.current = null;
    pendingAiActionRef.current = null;
    pendingAiIntentRef.current = null;
  }, [aiMode, aiAllowed]);

  const role = user?.role ?? '';
  const canRequirement = ['agent', 'admin', 'captain'].includes(role);
  const canInventory = ['builder', 'admin', 'captain', 'agent'].includes(role);
  /**
   * Who may publish (and remove) media in the room on screen.
   *
   * Admins and captains anywhere; beyond that a builder owns the media in THEIR
   * rooms — their company group and the groups of properties they own. Mirrors
   * the server's canPublishMedia exactly, so the paperclip is only hidden where
   * the request would have been refused anyway.
   */
  const canUploadMedia = useMemo(() => {
    if (['admin', 'captain'].includes(role)) return true;
    if (!activeRoom || !user?.id) return false;
    if (activeRoom.builder?.id && activeRoom.builder.id === user.id) return true;
    const ownerId = activeRoom.project?.owner?.id;
    return !!ownerId && ownerId === user.id;
  }, [role, activeRoom, user?.id]);

  /**
   * Who may change the group's profile picture on screen.
   *
   * THIS IS NOT THE SECURITY BOUNDARY. The server enforces the identical rule in
   * groupChatController and answers 403 to anyone else, and it would do so even
   * if this memo were deleted. The only reason it exists is so the UI does not
   * offer a tap target whose entire outcome is an error toast — hiding a button
   * is never a permission check.
   *
   * Mirrors the contract's rule in the contract's own order: a platform admin
   * (the same emergency override DELETE /rooms/:roomId already has, and exempt
   * from membership), or the room's creator, or a member whose own row says
   * role: 'admin'.
   *
   * The universal / community room is refused for EVERYONE including platform
   * admins — it has no owner and its picture is the app's own. That clause is
   * belt-and-braces: canOpenGroupInfo below is already `!activeRoom.isUniversal`
   * so the sheet holding the picker cannot be opened there at all. It is stated
   * anyway, because the next person to add a second entry point to the picker
   * should not have to rediscover the rule.
   */
  const canManageRoomAvatar = useMemo(() => {
    if (!activeRoom) return false;
    if (activeRoom.isUniversal || activeRoom.roomType === 'universal') return false;
    if (role === 'admin') return true;
    if (!user?.id) return false;
    if (activeRoom.createdBy?.id === user.id) return true;
    return (activeRoom.members || []).some(m => m.user.id === user.id && m.role === 'admin');
  }, [activeRoom, user?.id, role]);

  // Requirement / inventory composer state
  const [reqForm, setReqForm] = useState({ bhkType: '2BHK', budget: '', area: '', city: '', possessionNeeded: 'immediate', loanRequired: false, urgency: 'normal', clientNotes: '' });
  const [invForm, setInvForm] = useState({ bhkOptions: '', min: '', max: '', area: '', city: '', possessionStatus: 'ready', bankLoanAvailable: false, commissionPercent: '2', description: '' });

  useEffect(() => { onRoomOpenChange?.(!!activeRoom); }, [activeRoom, onRoomOpenChange]);
  // Publish AI availability upward (see the prop's comment). Derived from
  // aiAllowed so the hub's pills and this component's own AI chrome can never
  // disagree about whether the open room is the AI room.
  useEffect(() => { onAiAvailableChange?.(aiAllowed); }, [aiAllowed, onAiAvailableChange]);

  // Load the avatar fallback cache from storage. Re-runs whenever a room opens
  // or closes (activeRoom?.id goes to undefined on close), so returning to the
  // list always re-reads AsyncStorage and the rows reflect whatever was just
  // cached.
  //
  // This used to ALSO copy the open room's entry into customProfileIcon /
  // customProfileImage for the header and the group-info sheet. That second
  // mirror is gone — those surfaces resolve from room.avatar plus this cache
  // directly now, so there is nothing left to keep in sync here.
  useEffect(() => {
    const loadProfiles = async () => {
      setAvatarCache(await loadRoomProfilePictures());
    };
    loadProfiles();
  }, [activeRoom?.id]);

  // Sequence guard: a slow earlier response must not overwrite a newer one.
  const roomsSeqRef = useRef(0);

  const loadRooms = useCallback(async (query?: string) => {
    const seq = ++roomsSeqRef.current;
    try {
      const q = query !== undefined ? query : search;
      const data = await groupChatApi.getRooms(q ? { search: q } : undefined);
      if (seq !== roomsSeqRef.current) return; // a newer request already answered
      setMyRooms(data.myRooms);
      setDiscoverRooms(data.discoverRooms);
    } catch { /* silent */ }
    finally { if (seq === roomsSeqRef.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Debounced search. `search` is bound directly to the input, so this used to
  // fire one request per keystroke with no debounce and no ordering guarantee —
  // typing "besa" issued four requests and whichever landed last won.
  useEffect(() => {
    if (!search) { loadRooms(''); return; }
    const t = setTimeout(() => loadRooms(search), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Owner → published-project-count map, for the Property Groups chip only.
  //
  // Lazy on purpose: the Groups pane mounts every time the hub opens, and only
  // the Property Groups chip ever needs this number, so paying for the request
  // on mount would charge every user for a filter most of them never tap. It
  // runs once — the `=== null` guard stops a second run when the chip is tapped
  // again — and goes through fetchPublicProjectsRaw(), which already holds a
  // shared 60 s cache over /public/projects. Do NOT add another fetch of that
  // list; four screens used to request it independently and that is exactly the
  // duplication the shared cache exists to prevent.
  useEffect(() => {
    if (groupFilter !== 'property' || publishedCountByOwner !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const projects = await fetchPublicProjectsRaw();
        const counts: Record<string, number> = {};
        for (const p of projects || []) {
          // owner arrives populated (an object with _id) from getPublished(), but
          // a bare id string is still possible, so both shapes are normalised to
          // the same string the room transform produces for project.owner.id.
          const ownerId = String((p as any)?.owner?._id || (p as any)?.owner?.id || (p as any)?.owner || '');
          if (!ownerId) continue;
          counts[ownerId] = (counts[ownerId] || 0) + 1;
        }
        if (!cancelled) setPublishedCountByOwner(counts);
      } catch {
        // An empty map, not null: the chip then judges rooms on the profile half
        // of the rule alone, which still surfaces something. Leaving it null
        // would both show nothing and retry the failed request on every render.
        if (!cancelled) setPublishedCountByOwner({});
      }
    })();
    return () => { cancelled = true; };
  }, [groupFilter, publishedCountByOwner]);

  // Load the saved disappearing-messages setting once.
  useEffect(() => { disappearStorage.get().then(setDisappearMs); }, []);

  // Append a message only if it isn't already present (dedup by id). Prevents
  // duplicates from optimistic append + socket echo, and stray double-renders.
  const appendMessage = useCallback((msg: GroupMessage) => {
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // Real-time incoming messages
  // `socket.ready` is in the deps on purpose: on a cold start this effect can run
  // before getSocket() resolves, in which case the subscription was a silent
  // no-op and the room received no live messages until it was reopened.
  useEffect(() => {
    const unsub = socket.onGroupMessage((msg: any) => {
      const incomingRoom = String(msg.room || msg.roomId || '');
      if (!incomingRoom) return;

      // A message for the room on screen is appended; one for any OTHER room
      // bumps that room's unread badge instead of being dropped. Without this the
      // badge only refreshed on a full room-list reload.
      if (activeRoom?.id && incomingRoom === activeRoom.id) {
        // appendMessage dedups by id, so an echo of our own optimistic message
        // won't create a duplicate.
        appendMessage(normalizeMsg(msg, activeRoom.id));
        return;
      }

      // Mirrors the server-side count: own messages and system notices never
      // contribute to unread.
      const senderId = String(msg.sender?._id || msg.sender?.id || '');
      if (senderId && user?.id && senderId === user.id) return;
      if (msg.messageType === 'system') return;

      setMyRooms(prev => prev.map(r => (
        r.id === incomingRoom
          ? { ...r, unreadCount: (r.unreadCount || 0) + 1, lastActivity: msg.createdAt || r.lastActivity }
          : r
      )));
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupMessage, socket.ready, appendMessage, user?.id]);

  // Someone removed a message (e.g. a builder taking their photo down). Drop it
  // from the open thread so every member's view converges without a reload.
  useEffect(() => {
    const unsub = socket.onGroupMessageDeleted(({ roomId, messageId }) => {
      if (!activeRoom?.id || String(roomId) !== activeRoom.id) return;
      setMessages(prev => prev.filter(m => m.id !== String(messageId)));
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupMessageDeleted, socket.ready]);

  /**
   * Writes a server-authoritative avatar onto the open room and both cached room
   * lists at once, so the thread header and every list row converge in the same
   * commit without a refetch. The server returns the full room on all three
   * avatar endpoints precisely so this is possible.
   *
   * `avatar: undefined` is the cleared state, matching the contract: the field is
   * absent rather than set to a default, because what the default LOOKS like is
   * a rendering decision and resolveRoomAvatar owns it.
   *
   * Declared HERE, above the socket effect that depends on it, rather than down
   * with the three write handlers that also use it: a `const` in a component
   * body is in its temporal dead zone until the line that initialises it runs,
   * and an effect's dependency array is evaluated during render — so listing it
   * from an effect placed earlier in the body would throw on first render.
   */
  const applyRoomAvatar = useCallback((roomId: string, avatar: GroupRoom['avatar']) => {
    const patch = (r: GroupRoom): GroupRoom => (r.id === roomId ? { ...r, avatar } : r);
    setActiveRoom(prev => (prev ? patch(prev) : prev));
    setMyRooms(prev => prev.map(patch));
    setDiscoverRooms(prev => prev.map(patch));
  }, []);

  // An admin changed the group's photo. Patch it in place so the thread header
  // and the list row both follow without a refetch.
  //
  // `socket.ready` is in the deps for the same cold-start reason the neighbouring
  // effects document: the subscription silently no-ops if the socket did not
  // exist on the first run. activeRoom?.id deliberately is NOT — this handler
  // patches the cached room lists as well as the open room, so re-registering it
  // every time a room opens would be pure churn for no extra coverage.
  //
  // The server emits on channel `group_<roomId>`, which trackJoinGroup already
  // joins for the open room, so this only ever fires for the room the user is
  // in. It is NOT a substitute for the `avatar` field on the GET /rooms payload,
  // which is how every other row in the list learns its picture.
  //
  // No toast: another member changing a picture is not worth interrupting
  // whatever this user is doing.
  //
  // AsyncStorage is written as well as the in-memory map. Updating memory alone
  // made a live-learned picture last only for the session — see
  // cacheServerPushedAvatar for why that defeated the cache's only purpose.
  useEffect(() => {
    const unsub = socket.onGroupAvatarUpdated(({ roomId, avatar }) => {
      const id = String(roomId || '');
      if (!id) return;
      const next = avatar && (avatar.type === 'icon' || avatar.type === 'image') && avatar.value
        ? { type: avatar.type, value: avatar.value, key: avatar.key ?? null }
        : undefined;
      applyRoomAvatar(id, next);
      // Deliberately outside the setAvatarCache updater below: a state updater
      // must stay pure, and React may call it more than once for one dispatch.
      void (next
        ? cacheServerPushedAvatar(id, { type: next.type, value: next.value })
        : removeCachedRoomAvatar(id));
      setAvatarCache(prev => {
        if (!next) {
          if (!prev[id]) return prev;
          const cleared = { ...prev };
          delete cleared[id];
          return cleared;
        }
        // A localUri from this device's own previous upload must not be carried
        // onto someone else's new picture, so it is dropped unless the value is
        // unchanged.
        const keepLocal = prev[id]?.type === 'image' && prev[id]?.value === next.value ? prev[id].localUri : undefined;
        return { ...prev, [id]: { type: next.type, value: next.value, localUri: keepLocal } };
      });
    });
    return unsub;
  }, [socket.onGroupAvatarUpdated, socket.ready, applyRoomAvatar]);

  // Another member may delete the group while this screen is open. Close the
  // thread immediately instead of leaving a dead composer that only fails on
  // the next send.
  useEffect(() => {
    const unsub = socket.onGroupDeleted((data) => {
      if (!activeRoom?.id || String(data.roomId) !== activeRoom.id) return;
      socket.leaveGroup(activeRoom.id);
      setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
      setActiveRoom(null);
      setMessages([]);
      setShowRoomMenu(false);
      // Group info has to close too. It only cleared showRoomMenu before, so the
      // sheet unmounted with the thread while its flag stayed true — and then
      // re-mounted already visible over the next room the user opened.
      setShowGroupInfo(false);
      toast.show(data.message || 'This group was deleted', 'info');
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupDeleted, socket.ready, socket.leaveGroup, toast]);

  // Re-assert room membership once the socket becomes available, for the case
  // where openRoom ran before it existed.
  useEffect(() => {
    if (socket.ready && activeRoom?.id) socket.joinGroup(activeRoom.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket.ready, activeRoom?.id]);

  // Stable identity: this is the onPress passed to every memoised room row, so a
  // fresh function each render would change the rows' props and defeat the memo.
  // The previously-open room is read from a ref instead of the `activeRoom` state
  // so the callback does not need to change when a room opens.
  const activeRoomIdRef = useRef<string | null>(null);
  useEffect(() => { activeRoomIdRef.current = activeRoom?.id ?? null; }, [activeRoom?.id]);
  // Same mirror trick as aiModeRef: aiResetToLanding is handed to the parent hub
  // ONCE through onActionsReady and called much later, so reading `aiRoom` from
  // the closure would capture the first render's null forever. Keeping the
  // callback identity stable also matters — the hub's publish effect depends on
  // it, so a fresh identity per room change would re-fire that effect.
  const aiRoomRef = useRef<GroupRoom | null>(null);
  useEffect(() => { aiRoomRef.current = aiRoom; }, [aiRoom]);

  const openRoom = useCallback(async (room: GroupRoom) => {
    const previousId = activeRoomIdRef.current;
    if (previousId) socket.leaveGroup(previousId);
    setActiveRoom(room);
    setMessages([]);
    setLoadingMsgs(true);
    setPostMode('text');
    socket.joinGroup(room.id);

    // Clear the unread badge locally straight away so the list is already
    // correct when the user comes back, then persist it. A failed mark-read is
    // deliberately silent — a stale badge is not worth an error toast.
    setMyRooms(prev => prev.map(r => (r.id === room.id ? { ...r, unreadCount: 0 } : r)));
    groupChatApi.markRoomRead(room.id).catch(() => {});

    // A company group shows that builder's properties as cards. Reset first so
    // the previous builder's inventory is never visible while this one loads.
    setBuilderProjects([]);
    // Reset the carousel too. `currentCardIndex` was never cleared here, so
    // switching from a builder with 8 properties to one with 2 resumed the
    // auto-scroll at index 5 and the strip sat parked past its own content. The
    // measurements belong to the strip that is going away, so they go with it.
    currentCardIndex.current = 0;
    setStripMetrics({ viewport: 0, content: 0 });
    // …and un-pause it. The pause flag was NOT reset here, and that made the
    // pause permanent: tapping a property card's Open Group fires the strip's
    // onTouchStart (the touch is a descendant of the ScrollView), so
    // pauseAutoScroll sets autoScrollPaused = true and onTouchEnd arms the 1 s
    // resume. The join lands inside that second and this reset changes the
    // auto-scroll effect's deps — and an effect cleanup runs before every
    // re-run, not only on unmount, so it cancelled the armed resume while the
    // flag stayed true. canScroll was then false in every builder strip for the
    // life of the component, since only another touch-release clears it.
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setAutoScrollPaused(false);
    const builderId = room.roomType === 'builder' ? room.builder?.id : '';
    if (builderId) {
      setLoadingBuilderProjects(true);
      projectsApiExtended.getOwnerPortfolio(builderId)
        .then(res => setBuilderProjects(res.projects))
        .catch(() => setBuilderProjects([]))
        .finally(() => setLoadingBuilderProjects(false));
    }

    try {
      setMessages(await groupChatApi.getMessages(room.id));
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
    } catch { /* silent */ }
    finally { setLoadingMsgs(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket.joinGroup, socket.leaveGroup]);

  // Pause / resume helpers for the property strip. Declared above the effect so
  // the ScrollView's four touch handlers share ONE resume timer. Previously each
  // of onTouchEnd / onScrollEndDrag called its own anonymous setTimeout with no
  // stored handle, so two of them could race and neither could be cleared — a
  // resume could fire after the thread had unmounted and call setState on a dead
  // component.
  const pauseAutoScroll = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setAutoScrollPaused(true);
  }, []);
  const scheduleResume = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      setAutoScrollPaused(false);
    }, 1000);
  }, []);

  /**
   * Auto-scroll for the builder property-card carousel: advance one card every
   * BUILDER_STRIP_AUTOSCROLL_MS, pause while the user has a finger down, resume
   * ~1 s after release, and loop back to the start at the end.
   *
   * The dwell used to be spelled "3.5 s" here in prose AND as a bare `3500` in
   * the setInterval below, so the comment could go stale the moment the literal
   * was tuned. Both now point at the one module-level constant.
   *
   * WHY THIS WAS REWRITTEN — two previous attempts never scrolled at all.
   * The old effect's start condition was
   * `builderProjects.length > 1 && !autoScrollPaused && builderScrollRef.current`.
   * That last term is a REF, and reading a ref cannot schedule a re-run, so the
   * effect only ever got the one pass its state deps gave it. And on that pass
   * the ref was always null: `openRoom` resolves the portfolio with
   * `.then(setBuilderProjects)` and `.finally(() => setLoadingBuilderProjects(false))`,
   * which are two separate microtasks and therefore two separate React renders.
   * On the first render `builderProjects.length` is already N (the dep changed, so
   * the effect ran) but `loadingBuilderProjects` is still true, so the JSX below
   * was still rendering the ActivityIndicator and the ScrollView did not exist.
   * On the second render the ScrollView mounted and attached the ref — but no dep
   * had changed, so the effect never ran again. No interval was ever created.
   *
   * The fix is to gate on STATE that can only be written after the ScrollView has
   * laid out (`stripMetrics`, fed by onLayout / onContentSizeChange) and to read
   * the ref inside the interval instead of gating on it. The per-tick distance
   * also comes from that measurement now (cardStride) instead of the old
   * hardcoded 196.
   */
  useEffect(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }

    // `content > viewport` is both the "ScrollView has laid out" proof and the
    // "there is actually somewhere to scroll" check — a strip whose cards all fit
    // on screen must not twitch.
    const canScroll =
      builderProjects.length > 1 &&
      !autoScrollPaused &&
      stripMetrics.content > stripMetrics.viewport;

    if (canScroll) {
      autoScrollTimer.current = setInterval(() => {
        const sv = builderScrollRef.current;
        if (!sv) return;
        const stride = cardStride(stripMetrics.content, builderProjects.length);
        const maxOffset = Math.max(0, stripMetrics.content - stripMetrics.viewport);
        // Wrap on real content width rather than on card count: `index % length`
        // produced a final tick that asked for an offset the ScrollView clamped
        // away, so the strip looked stuck for one beat before jumping back to 0.
        //
        // But wrapping the moment `next * stride` merely EXCEEDS maxOffset threw
        // away the last bit of travel: 3×186dp cards in a 360dp viewport give
        // content 606, maxOffset 246, stride 196 — the tick for the third card
        // wants 392, overshoots, and used to jump straight home, so the offset
        // that finally brings the last card fully into view was never reached.
        // Now the target is CLAMPED to maxOffset (that end position gets its own
        // beat) and we only loop once we are already sitting there.
        const currentX = Math.min(currentCardIndex.current * stride, maxOffset);
        const atEnd = currentX >= maxOffset - 1; // -1 absorbs sub-pixel layout
        const next = atEnd ? 0 : currentCardIndex.current + 1;
        const x = atEnd ? 0 : Math.min(next * stride, maxOffset);
        currentCardIndex.current = next;
        sv.scrollTo({ x, animated: true });
      }, BUILDER_STRIP_AUTOSCROLL_MS);
    }

    return () => {
      if (autoScrollTimer.current) {
        clearInterval(autoScrollTimer.current);
        autoScrollTimer.current = null;
      }
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [builderProjects.length, autoScrollPaused, stripMetrics.viewport, stripMetrics.content]);

  const closeRoom = () => {
    if (activeRoom) socket.leaveGroup(activeRoom.id);
    setActiveRoom(null);
    setShowRoomMenu(false);
    // Group info describes the room being left — leaving it open over the room
    // list would show a sheet whose Exit/Delete actions no longer have a target.
    setShowGroupInfo(false);
  };

  /**
   * The thread header's back control.
   *
   * In the AI Leads pane the user can now land in a PROPERTY room (Join Group on
   * a match row), and that room is not somewhere this pane can simply close out
   * of: `closeRoom()` would strand the pane on this component's own room list —
   * search bar, Discover rows, Create Group — which is not a view the AI Leads
   * pane is supposed to have at all. So from a non-AI room we go back to the AI
   * room instead, which is the view the user came from. Everywhere else (the
   * Groups pane) the behaviour is unchanged: close the thread, return to the list.
   */
  const handleThreadBack = () => {
    const ai = aiRoomRef.current;
    if (ai && activeRoom && activeRoom.id !== ai.id) {
      openRoom(ai);
      return;
    }
    closeRoom();
  };

  /**
   * Media & Links for the group-info sheet, loaded only when that sheet is
   * actually opened. Deliberately NOT loaded on room open: the Groups list and
   * thread must not get slower for a section most taps never reach.
   *
   * The endpoint lands in the backend phase of this feature, so a failure here is
   * expected on the current server and is treated as "no media yet" — an empty
   * section, never an error toast. TODO(backend phase): once
   * GET /group-chat/rooms/:roomId/media ships, this starts returning real data
   * with no client change.
   */
  useEffect(() => {
    if (!showGroupInfo || !activeRoom?.id) return;
    let cancelled = false;
    setLoadingGroupMedia(true);
    groupChatApi.getRoomMedia(activeRoom.id)
      .then(res => { if (!cancelled) setGroupMedia({ media: res.media, links: res.links }); })
      .catch(() => { if (!cancelled) setGroupMedia({ media: [], links: [] }); })
      .finally(() => { if (!cancelled) setLoadingGroupMedia(false); });
    return () => { cancelled = true; };
  }, [showGroupInfo, activeRoom?.id]);

  // A different room's media must never show under this room's name.
  useEffect(() => { setGroupMedia(null); }, [activeRoom?.id]);

  // When used as the AI Lead Matching section, auto-open the Universal room so
  // the group chat shows directly (no room-list step). Runs once after rooms load.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenUniversal || autoOpenedRef.current || activeRoom || loading) return;
    const universal = myRooms.find(r => r.isUniversal) || myRooms.find(r => /hit community/i.test(r.name));
    if (universal) {
      autoOpenedRef.current = true;
      // Remember WHICH room this was before opening it. `aiAllowed` used to be
      // derived from the autoOpenUniversal prop, which stayed true for every
      // room this pane later opened; capturing the resolved room here is what
      // lets isAiRoom above be an identity test and still honour the
      // `/hit community/` name fallback on the line before.
      setAiRoom(universal);
      openRoom(universal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenUniversal, myRooms, loading, activeRoom]);

  // (The match-count prefetch effect that used to sit here now lives directly
  // below the loadMyMatches declaration — it calls that callback, and up here it
  // referenced it ~400 lines before it was declared.)

  // Single composer handler: routes to AI when AI mode is on, else to the group.
  const handleComposerSend = () => {
    const t = text.trim();
    if (!t) return;
    // aiActive, not aiMode: routing on raw aiMode meant that if the assistant was
    // still mounted from another pane, a message typed in a PROPERTY group would
    // be swallowed as an AI answer instead of being posted to the group.
    if (aiActive) {
      // Private AI answer — never posted to the group.
      setText('');
      aiApiRef.current?.submitFreeText(t);
      return;
    }
    sendText();
  };

  const sendText = async () => {
    if (!text.trim() || !activeRoom) return;
    const content = text.trim();
    const roomId = activeRoom.id;
    setText('');
    let postedMessageId: string | undefined;
    try {
      // Persist via REST and append the created message immediately, so the
      // sender always sees their own message (independent of socket echo).
      // appendMessage dedups if the socket also echoes it back.
      const res = await groupChatApi.postMessage(roomId, { messageType: 'text', content });
      postedMessageId = res?.message?._id || res?.message?.id;
      if (res?.message) appendMessage(normalizeMsg(res.message, roomId));
    } catch {
      // Fallback: try the socket, and still show the message locally.
      socket.sendGroupMessage({ roomId, content, messageType: 'text' });
      appendMessage(normalizeMsg({ _id: `local_${Date.now()}`, sender: { _id: user?.id, name: user?.name, role: user?.role }, messageType: 'text', content, createdAt: new Date().toISOString() }, roomId));
    }

    // Free-text lead detection (same as the website): after sending, run NLP
    // extraction. If a buy/sell/rent requirement is detected, offer to find
    // matches. Non-blocking — the message is already sent.
    try {
      const extraction = await leadMatchingApi.extract(content);
      if (extraction?.detected) {
        setLeadDetect({ extraction, messageId: postedMessageId });
      }
    } catch {
      // Extraction is non-blocking — ignore failures.
    }
  };

  // Confirm a detected free-text lead → run matching + persist (mirrors website).
  const confirmDetectedLead = async () => {
    if (!leadDetect || !activeRoom) return;
    setConfirmingLead(true);
    try {
      const ex = leadDetect.extraction;
      const res = await leadMatchingApi.confirm({
        originalText: ex.extractedFrom || '',
        messageId: leadDetect.messageId,
        roomId: activeRoom.id,
        source: 'group_chat',
        intent: ex.intent || 'requirement',
        params: ex.params,
      });
      const n = res?.matchCount ?? (res?.matches?.length || 0);
      toast.show(
        n > 0
          ? `✓ Lead saved — ${n} match${n > 1 ? 'es' : ''} found 🎯`
          : '✓ Lead saved — naya inventory aane par match batayenge',
        'success',
      );
      setLeadDetect(null);
      // Confirming wrote a new lead. leadMatchingApi.confirm already dropped the
      // api-level leads cache; this drops My Posts' own freshness window too, so
      // a sell/rent lead confirmed from chat shows up on the next sheet open
      // instead of waiting out the minute.
      postsFetchedAtRef.current = 0;
    } catch (e: any) {
      toast.show(e?.message || 'Could not find matches', 'error');
    } finally {
      setConfirmingLead(false);
    }
  };

  // ── Attachments: Camera / Gallery / PDF ──
  // Uploads to a GROUP-scoped R2 key, then posts the returned URL + metadata.
  // This works in universal/area rooms (no projectId required) and does not
  // mutate the linked project's gallery or brochure.
  const uploadAndSendAttachment = async (
    file: { uri: string; name: string; mimeType: string },
    kind: 'image' | 'file',
  ) => {
    if (!activeRoom) return;
    setUploading(true);
    setShowAttachMenu(false);
    try {
      const uploaded = await mediaApi.uploadGroupAttachment({
        roomId: activeRoom.id,
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        kind,
      });
      if (!uploaded.url) throw new Error('Upload failed');

      const response = await groupChatApi.postMessage(activeRoom.id, {
        messageType: kind,
        content: uploaded.url,
        attachment: uploaded.attachment,
      });
      if (response?.message) appendMessage(normalizeMsg(response.message, activeRoom.id));

      toast.show(kind === 'image' ? 'Photo sent 📷' : 'PDF sent 📎', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Could not send attachment', 'error');
    } finally {
      setUploading(false);
    }
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.show('Camera permission needed', 'error'); return; }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.fileName || `photo_${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' },
      'image',
    );
  };

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.show('Photos permission needed', 'error'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' },
      'image',
    );
  };

  const pickFile = async () => {
    // Backend intentionally accepts PDF here. Advertising */* caused Word/ZIP
    // files to be selectable and then fail after upload.
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: 'application/pdf',
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.name || `document_${Date.now()}.pdf`, mimeType: a.mimeType || 'application/pdf' },
      'file',
    );
  };

  const postRequirement = async () => {
    if (!activeRoom) return;
    if (!reqForm.budget || !reqForm.area) { toast.show('Budget and Area are required', 'error'); return; }
    const card = {
      bhkType: reqForm.bhkType,
      budget: Number(reqForm.budget),
      area: reqForm.area.trim(),
      city: reqForm.city.trim(),
      possessionNeeded: reqForm.possessionNeeded,
      loanRequired: reqForm.loanRequired,
      urgency: reqForm.urgency,
      clientNotes: reqForm.clientNotes.trim(),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'requirement_card', requirementCard: card });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      const n = res?.message?.matchResults?.length || 0;
      toast.show(n > 0 ? `Posted — ${n} match${n > 1 ? 'es' : ''} found 🚀` : 'Posted — no matches yet', 'success');
      setReqForm({ bhkType: '2BHK', budget: '', area: '', city: '', possessionNeeded: 'immediate', loanRequired: false, urgency: 'normal', clientNotes: '' });
      setPostMode('text');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) { toast.show(e?.message || 'Failed to post', 'error'); }
  };

  const postInventory = async () => {
    if (!activeRoom) return;
    if (!invForm.area || !invForm.min) { toast.show('Area and Min Price are required', 'error'); return; }
    const card = {
      bhkOptions: invForm.bhkOptions.split(',').map(s => s.trim()).filter(Boolean),
      priceRange: { min: Number(invForm.min), max: Number(invForm.max) || 0 },
      area: invForm.area.trim(),
      city: invForm.city.trim(),
      possessionStatus: invForm.possessionStatus,
      urgency: 'normal' as const,
      bankLoanAvailable: invForm.bankLoanAvailable,
      commissionPercent: Number(invForm.commissionPercent) || 0,
      description: invForm.description.trim(),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard: card });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      toast.show('Inventory posted 📢', 'success');
      setInvForm({ bhkOptions: '', min: '', max: '', area: '', city: '', possessionStatus: 'ready', bankLoanAvailable: false, commissionPercent: '2', description: '' });
      setPostMode('text');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) { toast.show(e?.message || 'Failed to post', 'error'); }
  };

  // Publish the AI-collected property draft as a REAL published project (so it
  // shows in Projects + becomes a match candidate) AND posts a group card.
  // Details come from the AI conversation — no manual form.
  const publishDraft = async () => {
    if (!activeRoom || !postDraft) return;
    setPostingDraft(true);
    try {
      const built = buildProjectFromDraft(postDraft);

      // 1) Create the project and publish it (real, matchable inventory).
      let projectId: string | undefined;
      try {
        const created = await projectsApiExtended.create(built.payload);
        projectId = created?.id;
        if (projectId) {
          try { await projectsApiExtended.publish(projectId); } catch { /* publish is best-effort */ }
        }
      } catch (e: any) {
        // Non-fatal: still post the group card so the user isn't blocked.
        console.warn('project create failed, posting card only:', e?.message);
      }

      // 2) Post the inventory card into the group (visible to members).
      // Attach the stable project ObjectId created above. Without this, cards in
      // the universal room had no way to open details, start a deal chat or call
      // the project's contact — all three buttons acted on an empty id.
      const inventoryCard: InventoryCard = {
        ...built.card,
        project: projectId || undefined,
      };
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));

      // 3) Save to the local posted list with a cooldown timestamp (per-property).
      const updated = await postedListStorage.add({ ...postDraft, projectId, postedAt: Date.now() });
      // Refresh the durable backend list so the new post shows even after a reinstall.
      // Both caches have to be dropped first or the refresh is a no-op: the leads
      // list is cached for 60 s in api.ts, and My Posts skips its loads entirely
      // while postsFetchedAtRef is fresh — either one on its own would hide the
      // user's brand-new post until the minute was up.
      invalidateLeadsCache();
      postsFetchedAtRef.current = 0;
      loadPostedLeads();
      setPostedList(updated);

      // 4) Clear the AI draft so it stops re-appearing as "Ready to post".
      aiApiRef.current?.clearDraft();
      toast.show(projectId ? 'Property posted & published 📢' : 'Property posted 📢', 'success');
      setPostDraft(null);
      // Refresh backend-sourced posted projects.
      loadMyProjects();
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    } finally {
      setPostingDraft(false);
    }
  };

  // Re-post an already-published project's card into the group (after cooldown).
  const repostProject = async (project: any, disp: any) => {
    if (!activeRoom) return;
    try {
      const card: InventoryCard = {
        project: project.id,
        projectName: project.name || project.projectName || disp.title,
        propertyType: project.propertyType || project.type || '',
        carpetAreaRange: project.carpetAreaRange || '',
        bhkOptions: Array.isArray(project.bhkOptions) ? project.bhkOptions : [],
        priceRange: { min: Math.round((project.startingPrice || 0) / 100000), max: 0 },
        area: project.location || '',
        city: project.city || '',
        possessionStatus: /ready/i.test(project.projectStatus || '') ? 'ready' : (project.projectStatus || 'ready'),
        urgency: 'normal',
        bankLoanAvailable: !!project.bankLoanAvailable,
        commissionPercent: 0,
        callNumber: project.cta?.callNumber || project.cta?.whatsappNumber || '',
        description: disp.fields.map((f: any) => `${f.label}: ${f.value}`).join(' • '),
      };
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard: card });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      // Record a fresh cooldown timestamp for this project.
      const updated = await postedListStorage.add({
        title: disp.title, subtitle: disp.subtitle, price: disp.price,
        fields: disp.fields, isSellable: true, intent: 'sell',
        projectId: project.id, postedAt: Date.now(),
      } as any);
      setPostedList(updated);
      // A re-post rewrites this property's cooldown, which My Posts reads, so the
      // sheet's freshness marker is dropped — otherwise a re-open within the
      // minute could show the card with a stale cooldown.
      postsFetchedAtRef.current = 0;
      toast.show('Property re-posted to group 📢', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    }
  };

  // Re-post a posted-list entry that has no backend project (create had failed),
  // rebuilding the inventory card from its saved AI fields, and refresh cooldown.
  const repostFromEntry = async (entry: any, disp: any) => {
    if (!activeRoom) return;
    try {
      const built = buildProjectFromDraft(entry);
      const inventoryCard: InventoryCard = {
        ...built.card,
        project: entry.projectId || undefined,
      };
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      const updated = await postedListStorage.add({ ...entry, postedAt: Date.now() } as any);
      setPostedList(updated);
      // Same reason as repostProject: the cooldown changed, so My Posts must
      // re-read rather than reuse its freshness window.
      postsFetchedAtRef.current = 0;
      toast.show('Property re-posted to group 📢', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    }
  };

  // Load the user's own published properties from the backend (source of truth,
  // survives reinstall). Server filters projects to the requesting user for agents.
  const loadMyProjects = useCallback(async () => {
    try {
      const all = await projectsApiExtended.getAll();
      setMyProjects(Array.isArray(all) ? all : []);
    } catch {
      setMyProjects([]);
    }
  }, []);

  // Load the user's AI-posted properties from the BACKEND.
  //
  // Every sell/rent conversation persists an ExtractedLead server-side, so this
  // is the durable record of "what I told the AI to sell" — it survives app
  // reinstall, unlike the local posted list (AsyncStorage gets wiped). Normal
  // add-project projects are not ExtractedLeads, so Post stays separate from
  // the Project section.
  //
  // `page: 1` is not cosmetic. loadMyMatches below asks for
  // `{ mineOnly: true, limit: 50, page: 1 }`, and leadMatchingApi.getLeads now
  // caches on the built query string — so stating page 1 explicitly makes this
  // request byte-identical to that one and the two collapse onto a single
  // response. Without it the only difference was a missing `page=1`, and the
  // component fetched the same page of the same list twice.
  const loadPostedLeads = useCallback(async () => {
    try {
      const res = await leadMatchingApi.getLeads({ mineOnly: true, limit: 50, page: 1 });
      const leads = Array.isArray(res?.leads) ? res.leads : [];
      // Only sellable inventory (sell / rent) — buyer requirements aren't "posts".
      const sellable = leads.filter((l: any) => {
        const dir = String(l?.direction || '').toLowerCase();
        return dir === 'sell' || dir === 'rent' || l?.intent === 'inventory';
      });
      setPostedLeads(sellable);
    } catch {
      setPostedLeads([]);
    }
  }, []);

  // ── AI action handlers ──
  // Reached only from the AI Leads hub's tab row, through the triggers this
  // component publishes via onActionsReady. They used to also be wired to My Post
  // / Matching pills rendered by this component; those moved into the hub's single
  // tab row, but the handlers themselves are unchanged. (The AI 3-dot menu is NOT
  // another entry point — it only offers Disappearing messages / End / Exit Chat.)
  // Post = show ALL properties the user has posted so far, plus (if present) the
  // current AI-collected draft as a postable card.
  /**
   * Freshness marker for the two backend lists behind My Posts. 0 = "never
   * loaded, or a write invalidated them".
   *
   * Every open of this sheet used to re-issue both requests, so closing and
   * re-opening it paid the full network cost again for data that had not changed.
   * A component-local marker is deliberate rather than a TTL cache on
   * projectsApiExtended.getAll(): that call is shared with projects.tsx and
   * marketplace.tsx and would need invalidating on every create / update /
   * publish / delete path in the app, which is a much larger blast radius than
   * this one sheet is worth. Each of the three post/re-post paths clears this
   * marker instead, so a property the user just posted is never hidden by it.
   */
  const postsFetchedAtRef = useRef(0);
  const POSTS_FRESH_MS = 60_000;

  const doPost = async () => {
    const list = await postedListStorage.getAll();
    setPostedList(list);
    // Awaited now, with a spinner in the sheet. Both were fire-and-forget before,
    // which is why the sheet opened empty and the count jumped from 0 to 32 a
    // moment later. allSettled is enough and no error branch is needed because
    // both loaders already swallow their own failures into empty arrays.
    const fresh = Date.now() - postsFetchedAtRef.current < POSTS_FRESH_MS;
    if (!fresh) {
      setPostsLoading(true);
      // Not awaited before the sheet opens below: the open must not wait on the
      // network, so this promise is handled on its own and only toggles the body.
      Promise.allSettled([loadMyProjects(), loadPostedLeads()])
        .then(() => { postsFetchedAtRef.current = Date.now(); })
        .finally(() => setPostsLoading(false));
    }
    const draft = aiApiRef.current?.getPostDraft();
    // Only treat the draft as postable if it's a new sellable draft not already
    // in the posted list (avoid showing a just-posted item twice as "draft").
    if (draft && draft.isSellable && draft.fields.length > 0) {
      setPostDraft(draft);
    } else {
      setPostDraft(null);
    }
    setExpandedId(null);
    setShowPost(true);
  };
  /**
   * Every project the current user's own requirements have matched, flattened
   * into the one real match card (MatchResultCard) and counted.
   *
   * WHY THIS REPLACED `doMatching`. The Matching pill used to call a `doMatching`
   * that read `aiApiRef.current.getCurrentParams()` and bailed with
   * "Please complete your requirement first" whenever no AI conversation was in
   * progress — which is the state the pill is normally tapped in, so the pill
   * showed a toast and no sheet. Its other branch fabricated rows from
   * `builderProjects`, a list only ever populated for `roomType: 'builder'` rooms,
   * while the pill only exists in the universal room — so that array was always
   * empty and the sheet reliably ended on "No matching properties available"
   * after a 1.5 s fake delay. Both branches are gone.
   *
   * `mineOnly: true` makes the server force `extractedBy = me`, so this is
   * strictly the signed-in user's own leads, even for admin/captain. The endpoint
   * populates each match's project, which is what the card needs. No backend
   * change was required.
   *
   * `silent` skips opening the sheet and the spinner — that is the mount-time
   * prefetch whose only job is to put a number on the pill.
   */
  const loadMyMatches = useCallback(async (opts?: { silent?: boolean }) => {
    console.log('[MATCHING] loadMyMatches called, opts:', opts);
    const silent = !!opts?.silent;
    if (!silent) {
      console.log('[MATCHING] Setting showMatching=true, matchingLoading=true');
      setShowMatching(true);
      setMatchingLoading(true);
      setMatchingError(null);
    }
    try {
      // PAGE THROUGH, do not read one number off the envelope.
      //
      // This used to be a single `getLeads({ limit: 50 })` whose `pagination` was
      // thrown away, so a user with 51+ leads silently had everything past the
      // first page dropped and the pill under-reported — the bug only hid because
      // small accounts never cross the page boundary.
      //
      // And `pagination.total` is NOT the pill's number: the endpoint counts
      // LEADS (requirements the user recorded), while the pill counts the
      // de-duplicated PROJECTS those leads matched. One lead can match twelve
      // projects and twelve leads can match one, so the two figures are unrelated.
      // That is why the fix is to fetch every page and feed the existing
      // de-duplication the full list, rather than to read a field.
      const LIMIT = 50;
      // Hard stop at 20 pages / 1000 leads. A server that reports a bad `pages`
      // (or starts ignoring `page`) would otherwise spin this loop forever on a
      // screen the user is waiting on; truncating a 1000-lead account is the far
      // less harmful failure.
      const MAX_PAGES = 20;

      console.log('[MATCHING] Fetching leads from API...');
      const first = await leadMatchingApi.getLeads({ mineOnly: true, limit: LIMIT, page: 1 });
      const leads = Array.isArray(first?.leads) ? [...first.leads] : [];
      console.log('[MATCHING] First page leads count:', leads.length);

      // Trust `pages` when the server sends it; derive it from total/limit only as
      // a fallback, because an older deploy may send one and not the other.
      const reportedPages = Number(first?.pagination?.pages);
      const reportedTotal = Number(first?.pagination?.total);
      const pageCount = Number.isFinite(reportedPages) && reportedPages > 0
        ? reportedPages
        : (Number.isFinite(reportedTotal) && reportedTotal > 0 ? Math.ceil(reportedTotal / LIMIT) : 1);

      // Sequential, not Promise.all: this is a background prefetch competing with
      // the room list and the thread for the same connection, and a user with
      // hundreds of leads would otherwise fire a burst big enough to matter to the
      // rate limiter.
      for (let page = 2; page <= Math.min(pageCount, MAX_PAGES); page++) {
        const next = await leadMatchingApi.getLeads({ mineOnly: true, limit: LIMIT, page });
        const batch = Array.isArray(next?.leads) ? next.leads : [];
        // An empty page means the list ran out earlier than `pages` claimed —
        // stop rather than keep asking for pages that cannot exist.
        if (batch.length === 0) break;
        leads.push(...batch);
      }

      // One project can match several of this user's requirements (a 2BHK Besa
      // lead and a 2BHK Nagpur lead both hit the same tower), so the flat list
      // has duplicates. Counting them twice would inflate the pill's number and
      // repeat the same card, so de-duplicate by projectId and keep the highest
      // score — the strongest reason the project matched at all.
      const byProject = new Map<string, MatchCard>();
      for (const lead of leads) {
        for (const m of (Array.isArray(lead?.matches) ? lead.matches : [])) {
          const p = m?.project;
          const projectId = String(p?._id || p?.id || '');
          // A dangling populate (the project was deleted after the match was
          // written) gives a row with no id and nothing to open. Drop it rather
          // than rendering a card whose Join Group cannot work.
          if (!projectId) continue;
          const card: MatchCard = {
            projectId,
            projectName: p?.projectName || 'Property',
            city: p?.city,
            location: p?.location,
            score: Number(m?.score || 0),
            slug: p?.slug,
            startingPrice: p?.pricing?.startingPrice,
            bhkOptions: p?.configuration?.bhkOptions,
            projectStatus: p?.projectStatus,
          };
          const existing = byProject.get(projectId);
          if (!existing || card.score > existing.score) byProject.set(projectId, card);
        }
      }
      const cards = Array.from(byProject.values()).sort((a, b) => b.score - a.score);

      setMatchingResults(cards);
      setMatchingError(null);
      setMatchCountKnown(true);
    } catch (e: any) {
      console.log('[MATCHING] Error:', e?.message || e);
      // Only a THROWN request is an error. An empty list is a legitimate answer
      // and gets the honest empty state in the sheet instead — showing an error
      // for it would read as "something broke" when nothing did.
      setMatchingResults([]);
      if (!silent) setMatchingError(e?.message || 'Could not load your matches');
      // Mark the count UNKNOWN regardless of `silent`. A silent failure must
      // still publish null, never 0 — the pill's badge treats 0 and null
      // differently on purpose, and `matchingError` cannot carry this because it
      // is deliberately only set when !silent (the prefetch has no sheet to
      // explain itself in).
      setMatchCountKnown(false);
    } finally {
      if (!silent) setMatchingLoading(false);
    }
    // onMatchCountChange is no longer called from in here: the count is published
    // by the effect below, derived from the SAME array the sheet renders. It used
    // to be pushed from these two branches using `cards.length`, which is the
    // pre-filter total — so once a joined match stopped being rendered the badge
    // still counted it and the pill said 9 over a list of 8.
    //
    // WHY the dep array was changed from [] to explicit state setters:
    // The empty array captured stale closures of setState functions from the first
    // render. When the Matching button was tapped, setShowMatching(true) targeted
    // a stale reference that no longer updated the live state, so the modal never
    // opened. React setState functions ARE stable, but explicitly listing them
    // documents the closure's actual dependencies and prevents future refactors
    // from breaking this assumption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setShowMatching, setMatchingLoading, setMatchingError, setMatchingResults, setMatchCountKnown]);

  // Prefetch the match count once, so the hub's Matching pill can carry a number
  // before anyone taps it and the sheet then opens straight from state instead of
  // showing a spinner. Only in headerless mode — that is the AI Leads hub pane,
  // the one surface that renders the pill; the Groups pane has no pill and must
  // not pay for this request. The ref guard keeps it to ONE request per mount:
  // without it a failure would retry on every render.
  //
  // Declared HERE, immediately after loadMyMatches, deliberately: this effect
  // used to sit ~400 lines above that declaration. It worked only because an
  // effect body is a closure that runs after render, while the dep array is
  // evaluated DURING render — so adding loadMyMatches to the deps, which is
  // exactly what the suppressed exhaustive-deps rule asks for, would have thrown
  // a temporal-dead-zone ReferenceError before the component could mount. With
  // the declaration above it, the dep list below is now a safe thing to touch.
  const matchCountLoadedRef = useRef(false);
  useEffect(() => {
    if (!headerless || !activeRoom || matchCountLoadedRef.current) return;
    matchCountLoadedRef.current = true;
    loadMyMatches({ silent: true });
    // Intentionally not depending on loadMyMatches: the ref guard already makes
    // this once-per-mount, so a new callback identity must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerless, activeRoom]);

  /**
   * Which of this user's matches are still worth showing, and how many.
   *
   * Once the user has joined a property's group there is nothing left for the
   * match row to offer — its only action is Join Group — so the row used to sit
   * there forever advertising a group the user is already inside. It now drops
   * out of the list the moment the join lands.
   *
   * "Already joined" comes from SERVER truth, not a local joined-set:
   * `myRooms` is GET /group-chat/rooms, which the backend answers with every room
   * where this user is a member (`getRooms` filters on `members.user`, with no
   * roomType filter), so a project room the user joined on another device or
   * before a reinstall is still counted. It also costs zero extra requests — the
   * list is already loaded on mount — and `handleJoinPropertyGroup` prepends the
   * freshly joined room to it, which is what makes the row vanish instantly
   * rather than on the next refresh.
   */
  const joinedProjectIds = useMemo(
    () => new Set(myRooms.map(r => String(r.project?.id || '')).filter(Boolean)),
    [myRooms],
  );
  // WHY: Previously filtered out joined properties, showing empty state even when matches existed.
  // User requirement: "jo join he use view group kr skte he" — show ALL matches, change button
  // to "View Group" for already-joined properties instead of hiding them.
  const visibleMatches = useMemo(
    () => matchingResults, // Show all matches, don't filter joined ones
    [matchingResults],
  );

  // ONE number feeds the pill badge, the sheet's "N matches…" subtitle and the
  // rendered rows, so they cannot disagree. This used to be pushed from inside
  // loadMyMatches as `cards.length` — the unfiltered total — which is how a badge
  // of 9 could sit above a list of 8 once a joined match stopped rendering.
  // `null` (not 0) while the count is unknown: the hub renders the badge only for
  // count > 0, so an emptied list drops the badge instead of showing a zero.
  useEffect(() => {
    onMatchCountChange?.(matchCountKnown ? visibleMatches.length : null);
  }, [matchCountKnown, visibleMatches.length, onMatchCountChange]);

  // Expose post/matching to the parent hub (headerless mode) so its sub-row can
  // trigger them. aiPost/aiMatching are defined below; a stable wrapper is fine
  // because they read refs/state at call time.
  // (The onActionsReady publish effect lives further down, after aiPost /
  // aiMatching / aiResetToLanding are declared — it depends on their identities.)

  // Members who joined in the last 7 days — shown in the room header next to the
  // total. Members without a joinedAt (older records) simply aren't counted.
  const newJoinCount = React.useMemo(() => {
    if (!activeRoom) return 0;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return activeRoom.members.reduce((n, m) => {
      const t = m.joinedAt ? new Date(m.joinedAt).getTime() : NaN;
      return !isNaN(t) && t >= cutoff ? n + 1 : n;
    }, 0);
  }, [activeRoom]);

  // My Posts = every real Project owned by the current user + their own
  // backend inventory leads + any local draft/cooldown entry not yet represented
  // on the server. De-duplicate by stable ids first, then title/location only as
  // a compatibility fallback for old records that have no relationship id.
  const postedCards = React.useMemo(() => {
    const cards: any[] = [];
    const seenIds = new Set<string>();
    const seenFallback = new Set<string>();

    const add = (card: any) => {
      const ids = [card.projectId, card.leadId, card.id].filter(Boolean).map(String);
      if (ids.some(id => seenIds.has(id))) return;
      const fallback = `${card.title || ''}|${card.subtitle || ''}`.toLowerCase();
      if (fallback !== '|' && seenFallback.has(fallback)) return;
      ids.forEach(id => seenIds.add(id));
      if (fallback !== '|') seenFallback.add(fallback);
      cards.push(card);
    };

    // `/projects` is broader for admins/co-captains. "My" means primary owner,
    // so never show another user's property in this modal.
    myProjects
      .filter((p: any) => String(p.owner?.id || '') === String(user?.id || ''))
      .map(projectToDisplay)
      .forEach(add);

    postedLeads.map(leadToDisplay).forEach(add);

    for (const entry of postedList) {
      add({
        id: entry.id || entry.projectId || String(entry.postedAt || Date.now()),
        projectId: entry.projectId,
        leadId: entry.leadId,
        title: entry.title,
        subtitle: entry.subtitle,
        price: entry.price,
        image: entry.image,
        tags: (entry.fields || []).filter((f: any) => /bhk|area|type/i.test(f.label)).map((f: any) => f.value),
        fields: entry.fields || [],
        direction: entry.intent || 'sell',
        source: 'local',
        createdAt: entry.postedAt ? new Date(entry.postedAt).toISOString() : undefined,
      });
    }

    return cards;
  }, [postedLeads, postedList, myProjects, user?.id]);

  // When Post/Matching is tapped while AI mode is OFF, we turn AI on and defer
  // the action until the assistant API is ready (fired from onReady below).
  // These read aiModeRef, not aiMode: they are handed to the parent hub once and
  // then called much later, so a captured `aiMode` would be permanently stale.
  // When AI mode is already on they act immediately; otherwise the action is
  // queued and the drain effect below runs it as soon as the assistant is ready.
  const aiPost = useCallback(() => {
    if (aiModeRef.current && aiApiRef.current) { doPost(); return; }
    pendingAiActionRef.current = 'post';
    setAiMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Matching = show this user's real matches, always. It no longer gates on AI
  // mode: the old version only worked mid-conversation (it needed params the
  // assistant had collected) and otherwise fell through to fabricated rows built
  // from `builderProjects`, which is permanently empty in the universal room
  // where this pill lives — so the pill either toasted or showed an error sheet.
  // The pill also no longer enters AI mode as a side effect; it is a read of
  // existing data, not the start of a conversation. (The dep array was
  // `[builderProjects]`, which changed identity on every portfolio load and
  // needlessly re-fired the onActionsReady publish effect below.)
  const aiMatching = useCallback(() => {
    console.log('[MATCHING] aiMatching called');
    loadMyMatches();
  }, [loadMyMatches]);
  // Quick-start: user picked Sell / Buy / Rent. Enter AI mode and let the
  // assistant answer the intent question itself, so the chat continues from the
  // next question instead of asking "what would you like to do?" again.
  const aiStartWithIntent = useCallback((intent: 'sell' | 'buy' | 'rent') => {
    if (aiModeRef.current && aiApiRef.current) { aiApiRef.current.startWithIntent(intent); return; }
    pendingAiIntentRef.current = intent;
    setAiMode(true);
  }, []);

  // Stable onReady. It used to be an inline arrow, which gave the prop a new
  // identity on every render of this component — and because the composer's
  // `text` state lives here, that meant every keystroke re-ran the assistant's
  // publish effect and re-allocated its whole API object. Mirrors the pattern
  // already used for onTemplateChange.
  const handleAiReady = useCallback((api: AiAssistantApi) => {
    aiApiRef.current = api;
    setAiReady(true);
  }, []);

  // Drain deferred actions once the assistant is genuinely mounted and ready.
  // Previously this lived inside onReady and fired on a blind setTimeout(300),
  // which raced the assistant's own session open() — and only worked at all
  // because the unstable onReady kept re-firing the effect.
  useEffect(() => {
    if (!aiMode || !aiReady) return;
    const api = aiApiRef.current;
    if (!api) return;

    if (pendingAiIntentRef.current) {
      const intent = pendingAiIntentRef.current;
      pendingAiIntentRef.current = null;
      api.startWithIntent(intent);
      return;
    }
    if (pendingAiActionRef.current) {
      const action = pendingAiActionRef.current;
      pendingAiActionRef.current = null;
      // 'post' is the only action that still defers through here. The 'match'
      // branch called doMatching, which is gone: Matching no longer enters AI
      // mode, so nothing ever queues 'match' and the branch was dead code.
      if (action === 'post') doPost();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, aiReady]);

  const aiEndChat = () => { aiApiRef.current?.endChat(); };
  // Exit Chat: reset the conversation (so re-entering starts fresh at step 1),
  // then leave AI mode and return to the group thread.
  const aiExitChat = () => {
    const api = aiApiRef.current;
    Promise.resolve(api?.exitChat?.()).finally(() => {
      setAiMode(false);
      setAiInputType(undefined);
      setAiReady(false);
      aiApiRef.current = null;
    });
  };

  // Return to the default landing view — the same state the section shows when
  // the app is first opened: group thread visible, Sell/Buy/Rent starters above
  // the composer, no AI conversation in progress. Used when the user taps the
  // "AI Leads" section button. Resets the backend flow too, so re-entering starts
  // at step 1 instead of resuming a half-finished question.
  const aiResetToLanding = useCallback(() => {
    const api = aiApiRef.current;
    setShowPost(false);
    console.log('[MATCHING] aiResetToLanding clearing showMatching');
    setShowMatching(false);
    setShowAiMenu(false);
    setShowDisappear(false);
    setText('');
    pendingAiActionRef.current = null;
    pendingAiIntentRef.current = null;
    // The landing view is the AI room's thread. Since Join Group on a match row
    // can leave this pane sitting in a PROPERTY room, "reset" has to put the AI
    // room back on screen as well — previously it only cleared the conversation
    // state, so tapping "AI Leads" while inside a property group reset the
    // assistant but left the user looking at the property thread.
    const ai = aiRoomRef.current;
    if (ai && activeRoomIdRef.current && activeRoomIdRef.current !== ai.id) openRoom(ai);
    Promise.resolve(api?.exitChat?.()).finally(() => {
      setAiMode(false);
      setAiInputType(undefined);
      setAiReady(false);
      aiApiRef.current = null;
    });
    // openRoom is the only dependency: it is useCallback-stable (its own deps are
    // socket.joinGroup / socket.leaveGroup, both useCallback([]) in useSocket), so
    // naming it keeps this callback's identity stable and the hub's publish effect
    // below does not re-fire. Room identity is read through refs for the same
    // reason.
  }, [openRoom]);

  // Expose post / matching / reset to the parent hub. All three are
  // useCallback-stable and read live state through refs, so publishing them is
  // safe — the previous version captured the first render's `aiMode` (always
  // false), which is why "My Post" and "Matching" sometimes did nothing.
  useEffect(() => {
    console.log('[MATCHING] Publishing actions to parent, aiPost:', !!aiPost, 'aiMatching:', !!aiMatching, 'aiResetToLanding:', !!aiResetToLanding);
    onActionsReady?.({ post: aiPost, matching: aiMatching, resetToLanding: aiResetToLanding });
  }, [onActionsReady, aiPost, aiMatching, aiResetToLanding]);

  const handleInterested = useCallback(async (projectId: string, messageId: string) => {
    if (!projectId) {
      toast.show('This older card is not linked to a project', 'error');
      return;
    }
    try {
      const res = await groupChatApi.showInterest({ projectId, messageId, roomId: activeRoom?.id });
      toast.show(res?.message || 'Builder notified! Deal room created.', 'success');
    } catch (e: any) {
      toast.show(e?.message?.includes('exists') ? 'Deal already exists' : (e?.message || 'Failed'), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom?.id, toast]);

  /**
   * View Details must ALWAYS open something. Cards posted from the manual
   * inventory form carry no project id, and older cards can point at a deleted
   * project — both used to only raise "not linked to a project", which read as a
   * dead button. The card's own data is a valid fallback detail view.
   */
  const handlePropertyViewDetails = useCallback(async (projectId: string, fallback?: InventoryCard, sourceMessageId?: string) => {
    const sheetFromCard = (inv?: InventoryCard) => {
      const price = inv?.priceRange?.min ? fmtPrice(inv.priceRange.min * 100000) : '';
      const bhk = inv?.bhkOptions?.filter(Boolean).join(' / ') || '';
      return {
        title: inv?.projectName || 'Property',
        subtitle: [inv?.area, inv?.city].filter(Boolean).join(', '),
        price,
        image: '',
        fields: [
          ...(inv?.propertyType ? [{ label: 'Property Type', value: inv.propertyType }] : []),
          ...(bhk ? [{ label: 'Configuration', value: bhk }] : []),
          ...(inv?.carpetAreaRange ? [{ label: 'Area', value: inv.carpetAreaRange }] : []),
          ...(inv?.possessionStatus ? [{ label: 'Possession', value: String(inv.possessionStatus).replace(/[-_]/g, ' ') }] : []),
          { label: 'Bank Loan', value: inv?.bankLoanAvailable ? 'Available' : 'Not specified' },
          ...(inv?.commissionPercent ? [{ label: 'Commission', value: `${inv.commissionPercent}%` }] : []),
          ...(inv?.description ? [{ label: 'Details', value: inv.description }] : []),
        ],
      };
    };

    if (!projectId) {
      if (!fallback) { toast.show('No details available for this card', 'error'); return; }
      setViewProperty({ ...sheetFromCard(fallback), sourceMessageId });
      return;
    }

    // Media is included so the detail sheet shows gallery / layout / brochure
    // instead of just a list of text fields.
    const mediaUrls = (arr: any): string[] =>
      (Array.isArray(arr) ? arr : []).map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean);
    const oneUrl = (v: any): string => (typeof v === 'string' ? v : v?.url || '');

    try {
      const p = await projectsApiExtended.getById(projectId);
      const cover = typeof p.coverImage === 'string' ? p.coverImage : p.coverImage?.url;

      // The sheet used to show ONE flat list of ~6 fields, two of which printed
      // '—' when empty (Property Type, Status) — so a detail view of a fully
      // filled property hid almost everything the builder had entered, and a
      // sparse one was full of dashes. Now the full project is grouped into
      // labelled sections and every field is dropped when empty, so what shows
      // is exactly what exists. Only this path sets `sections`; the other
      // viewProperty callers keep their flat `fields` and are untouched.
      const rows = () => {
        const out: { label: string; value: string }[] = [];
        return {
          out,
          push(label: string, value: any) {
            if (value === null || value === undefined || value === '') return;
            out.push({ label, value: String(value) });
          },
        };
      };
      const money = (v: any) => (v ? `₹${Number(v).toLocaleString('en-IN')}` : '');
      // These three are stored as enum slugs ('ready-to-move', 'under-construction',
      // 'construction_linked'), and printing them verbatim put storage values in
      // front of the user. Same normalisation sheetFromCard already applies to
      // possessionStatus, so the two paths read alike.
      const label = (v: any) => (v ? String(v).replace(/[-_]/g, ' ') : '');

      const overview = rows();
      overview.push('Property Type', p.propertyType || p.type);
      overview.push('Status', label(p.projectStatus));
      overview.push('Category', label(p.category));
      overview.push('RERA', p.reraApproved ? 'Approved' : '');
      overview.push('RERA Number', p.reraNumber);
      overview.push('Gated Community', p.gatedCommunity ? 'Yes' : '');
      overview.push('Builder', p.owner?.companyName || p.owner?.name);

      const pricing = rows();
      pricing.push('Starting Price', p.startingPrice ? fmtPrice(p.startingPrice) : '');
      pricing.push('Total Price Range', p.totalPriceRange);
      pricing.push('Price per sq.ft', p.pricePerSqFt ? money(p.pricePerSqFt) : '');
      pricing.push('Payment Plan', label(p.paymentPlan));
      pricing.push('GST', p.gstPercentage != null ? `${p.gstPercentage}%` : '');
      pricing.push('Stamp Duty', p.stampDutyPercentage != null ? `${p.stampDutyPercentage}%` : '');
      pricing.push('Registration', money(p.registrationCharges));
      pricing.push('Maintenance', p.maintenanceCharges);
      pricing.push('Other Charges', p.otherCharges);
      pricing.push('Bank Loan', p.bankLoanAvailable ? 'Available' : '');

      const config = rows();
      config.push('Configuration', p.bhkOptions?.length ? p.bhkOptions.join(' / ') : '');
      config.push('Carpet Area', p.carpetAreaRange);
      config.push('Floor Range', p.floorRange);
      config.push('Plot Size', p.plotSizeRange);
      config.push('Facing', p.facingOptions?.length ? p.facingOptions.join(', ') : '');

      const amenities = rows();
      amenities.push('Amenities', p.amenities?.length ? p.amenities.join(', ') : '');

      const contact = rows();
      contact.push('Call', p.cta?.callNumber);
      contact.push('WhatsApp', p.cta?.whatsappNumber);
      contact.push('Enquiry', p.cta?.buttonText);

      const sections = [
        { title: 'Overview', fields: overview.out },
        { title: 'Pricing & Charges', fields: pricing.out },
        { title: 'Configuration', fields: config.out },
        { title: 'Amenities', fields: amenities.out },
        { title: 'Contact', fields: contact.out },
      ].filter(sec => sec.fields.length > 0);

      setViewProperty({
        title: p.name || fallback?.projectName || 'Property',
        subtitle: [p.location, p.city].filter(Boolean).join(', '),
        price: fmtPrice(p.startingPrice),
        image: cover || '',
        sections,
        // Lets the sheet offer Share for a real project. Absent on every other
        // caller's sheet, so no Share button appears where there is nothing to share.
        shareProjectId: p.id,
        slug: p.slug,
        galleryImages: mediaUrls((p as any).galleryImages),
        videos: mediaUrls((p as any).videos),
        layoutImage: oneUrl((p as any).layoutImage),
        brochureUrl: oneUrl((p as any).brochureUrl),
        googleMapLink: p.googleMapLink || '',
        latitude: p.latitude,
        longitude: p.longitude,
        sourceMessageId,
      });
    } catch {
      // Project fetch failed (deleted / not visible) — still show the card data
      // rather than leaving the button looking broken.
      if (fallback) setViewProperty({ ...sheetFromCard(fallback), sourceMessageId });
      else toast.show('Could not load property details', 'error');
    }
  }, [toast]);

  /**
   * "Preview Info" on a match card — the same sheet as View Details but short:
   * only the basics, and no media section. Everything is built from data the
   * match already carries, so it opens instantly with no network call.
   */
  const handlePreviewMatch = useCallback((match: any) => {
    const p = match?.project || {};
    const group: MatchGroupInfo | null = match?.group || null;
    const bhk = (p.configuration?.bhkOptions || []).filter(Boolean).join(' / ');
    const size = p.configuration?.carpetAreaRange || p.configuration?.plotSizeRange || '';

    setViewProperty({
      compact: true,
      title: p.projectName || 'Property',
      subtitle: [p.location, p.city].filter(Boolean).join(', '),
      price: p.pricing?.startingPrice ? fmtPrice(p.pricing.startingPrice) : '',
      image: p.media?.coverImage?.url || '',
      fields: [
        { label: 'Match Score', value: `${Math.round(Number(match?.score) || 0)}%` },
        ...(bhk ? [{ label: 'Configuration', value: bhk }] : []),
        ...(size ? [{ label: 'Area', value: size }] : []),
        ...(p.owner?.name ? [{ label: 'Builder', value: p.owner.name }] : []),
        ...(group ? [{ label: 'Group', value: `${group.name} · ${group.membersCount} members` }] : []),
      ],
    });
  }, []);

  /**
   * Share a property (from a builder card, or from inside the detail sheet).
   *
   * A fetch is needed because the card only holds an OwnerPortfolioProject,
   * while ShareModal works on a real `Project` — it reads slug / brochureUrl and
   * mints a tracked share token. `getById` is behind a 60 s cache with in-flight
   * de-duping and the card's own tap already warmed it, so this is normally free.
   * Nothing here string-builds a URL: ShareActions derives it.
   */
  const handleShareProject = useCallback(async (projectId: string) => {
    if (!projectId || sharingId) return;
    setSharingId(projectId);
    try {
      setShareProject(await projectsApiExtended.getById(projectId));
    } catch {
      toast.show('Could not load this property to share', 'error');
    } finally {
      setSharingId(null);
    }
  }, [sharingId, toast]);

  /**
   * Auto-scroll to source message when property detail sheet opens.
   * 
   * Triggers when viewProperty changes from null to an object with sourceMessageId.
   * The 300ms delay allows the modal slide-in animation to start before scrolling,
   * so the scroll doesn't compete with the modal animation. Highlight fades after 2.5s.
   */
  useEffect(() => {
    if (viewProperty?.sourceMessageId && messages.length > 0 && flatRef.current) {
      const srcMsgId = viewProperty.sourceMessageId;
      const idx = messages.findIndex(m => m.id === srcMsgId);
      if (idx >= 0 && idx < messages.length) {
        setTimeout(() => {
          if (flatRef.current) {
            flatRef.current.scrollToIndex({
              index: idx,
              animated: true,
              viewPosition: 0.5,
            });
            setHighlightedMessageId(srcMsgId);
            setTimeout(() => setHighlightedMessageId(null), 2500);
          }
        }, 300);
      }
    }
  }, [viewProperty?.sourceMessageId, messages]);

  /**
   * Close property detail sheet.
   * 
   * Extracted from three duplicate blocks (onRequestClose, backdrop onPress, X
   * button onPress). Auto-scroll now happens on sheet open (useEffect above),
   * not on close.
   */
  const handleClosePropertyDetail = useCallback(() => {
    setViewProperty(null);
  }, []);

  /**
   * Details / card-body tap on a builder property card.
   *
   * Wraps handlePropertyViewDetails for two reasons the inventory cards do not
   * have. First, it marks the card pending while the project fetch runs — the old
   * builder handler opened its sheet synchronously from portfolio data, so there
   * was nothing to wait for and no spinner was needed. Second, it hands over a
   * fallback built from the card's own data, so a deleted / unpublished project or
   * a dropped connection still opens a sheet instead of only raising a toast,
   * which is the "ALWAYS open something" contract the handler documents.
   */
  const handleBuilderCardDetails = useCallback(async (p: OwnerPortfolioProject) => {
    if (detailsId) return;
    setDetailsId(p.id);
    try {
      await handlePropertyViewDetails(p.id, portfolioFallback(p));
    } finally {
      setDetailsId(null);
    }
  }, [detailsId, handlePropertyViewDetails]);

  /** "View Details" on an AI match card — reuses the property detail sheet. */
  const handleViewMatchedProject = useCallback((projectId: string, projectName?: string) => {
    handlePropertyViewDetails(projectId, projectName ? ({ projectName } as InventoryCard) : undefined);
  }, [handlePropertyViewDetails]);

  /**
   * "View Details" on an "Also posted by members" card. These are leads, not
   * published projects, so there is no project page to open — the card's own
   * fields are the detail view.
   */
  const handleViewInventoryMatch = useCallback((card: InventoryMatchCard) => {
    setViewProperty({
      title: card.projectName || 'Property',
      subtitle: [card.location, card.city].filter(Boolean).join(', '),
      price: card.startingPrice ? fmtPrice(card.startingPrice) : '',
      image: '',
      fields: [
        ...(card.bhkOptions?.length ? [{ label: 'Configuration', value: card.bhkOptions.join(' / ') }] : []),
        ...(card.area ? [{ label: 'Area', value: `${card.area} ${card.areaUnit || 'sqft'}` }] : []),
        ...(card.builderName ? [{ label: 'Posted by', value: card.builderName }] : []),
        ...(card.postedByRole ? [{ label: 'Role', value: card.postedByRole }] : []),
        { label: 'Match Score', value: `${Math.round(card.score)}%` },
        { label: 'Listing Type', value: 'Posted by a member' },
      ],
    });
  }, []);

  /**
   * "Join Group" on an inventory card. The card only knows its projectId, so the
   * backend resolves (or creates) that property's canonical group, adds the user
   * and returns the room, which we then open.
   */
  /*
   * Resolves to whether a room was actually opened. Callers that render this
   * component ONLY to show that one room (the Project-map modal, via
   * autoOpenProjectId) need to know a failure happened, because otherwise they
   * sit there with activeRoom still null. Everything else ignores the result and
   * keeps its old fire-and-forget behaviour — a function returning a promise is
   * still assignable to the `(projectId: string) => void` props the cards use.
   */
  const handleJoinPropertyGroup = useCallback(async (projectId: string): Promise<boolean> => {
    if (!projectId) {
      toast.show('This card is not linked to a property group', 'error');
      return false;
    }
    if (joiningId) return false;
    setJoiningId(projectId);
    try {
      const { room, joined } = await groupChatApi.joinProjectRoom(projectId);
      setMyRooms(prev => [room, ...prev.filter(x => x.id !== room.id)]);
      setDiscoverRooms(prev => prev.filter(x => x.id !== room.id));
      toast.show(joined ? `Joined ${roomDisplayName(room)}` : `Opening ${roomDisplayName(room)}`, 'success');
      openRoom(room);
      return true;
    } catch (e: any) {
      toast.show(e?.message || 'Could not join the property group', 'error');
      return false;
    } finally {
      setJoiningId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joiningId, toast]);

  /**
   * Long-press on a photo or file removes it. Confirmed first, because it also
   * deletes the stored file server-side and cannot be undone.
   */
  const handleDeleteMessage = useCallback((msg: GroupMessage) => {
    if (!activeRoom) return;
    const isMedia = msg.messageType === 'image' || msg.messageType === 'file';
    Alert.alert(
      isMedia ? 'Delete this media?' : 'Delete this message?',
      isMedia
        ? 'It will be removed for everyone in the group and the file will be deleted.'
        : 'It will be removed for everyone in the group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistic: drop it locally, restore on failure so a network error
            // never silently hides a message that still exists.
            const snapshot = msg;
            setMessages(prev => prev.filter(m => m.id !== msg.id));
            try {
              await groupChatApi.deleteMessage(activeRoom.id, msg.id);
              toast.show('Deleted', 'success');
            } catch (e: any) {
              setMessages(prev => (prev.some(m => m.id === snapshot.id) ? prev : [...prev, snapshot]));
              toast.show(e?.message || 'Could not delete', 'error');
            }
          },
        },
      ],
    );
  }, [activeRoom, toast]);

  /**
   * "Open Group" on a builder's property card. Declared here, after
   * handleJoinPropertyGroup, because it delegates to it.
   */
  const handleOpenProjectGroup = useCallback((project: OwnerPortfolioProject) => {
    handleJoinPropertyGroup(project.id);
  }, [handleJoinPropertyGroup]);

  /**
   * `autoOpenProjectId`: open one specific property's group straight away,
   * skipping the room list. Modelled on the autoOpenUniversal effect above and
   * declared here, below handleJoinPropertyGroup, because it delegates to it —
   * so the Project map reuses the exact join path the inventory cards already
   * use (POST /group-chat/projects/:projectId/join resolves-or-creates the
   * canonical room, adds the user, returns it) with no new API surface.
   *
   * The ref guard is load-bearing: `handleJoinPropertyGroup` leaves `activeRoom`
   * null when the join fails, so without it a failed join would retry on every
   * render and spray toasts.
   *
   * And because activeRoom stays null on failure, the caller is TOLD about it.
   * Previously a failed join just toasted and left this component rendering its
   * own full room list — search bar, Groups/Chats, Discover rows — inside a modal
   * captioned "Property Group", with no way back except the host's chevron. The
   * host now closes itself instead (see onAutoJoinFailed).
   */
  const autoOpenedProjectRef = useRef(false);
  useEffect(() => {
    if (!autoOpenProjectId || autoOpenedProjectRef.current || activeRoom) return;
    autoOpenedProjectRef.current = true;
    handleJoinPropertyGroup(autoOpenProjectId).then(ok => { if (!ok) onAutoJoinFailed?.(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenProjectId, activeRoom, handleJoinPropertyGroup]);

  /**
   * Call dials the person who POSTED the property first (sender phone, sent by
   * the backend for inventory cards only), then the card's own callNumber, and
   * finally the project's CTA numbers.
   */
  const handlePropertyCall = useCallback(async (projectId: string, fallbackNumber?: string, posterPhone?: string) => {
    const clean = (v?: string) => String(v || '').replace(/[^0-9+]/g, '');
    let number = clean(posterPhone) || clean(fallbackNumber);

    if (!number && projectId) {
      try {
        const p = await projectsApiExtended.getById(projectId);
        number = clean(p.cta?.callNumber || p.cta?.whatsappNumber);
      } catch {
        // The user-facing message below is clearer than exposing a fetch error.
      }
    }

    if (!number) {
      toast.show('No contact number is available for this property', 'error');
      return;
    }

    // Android dialer links are not always reported as openable by canOpenURL,
    // and refusing on that basis is what made Call look dead. Try the dial
    // intent directly and only report a failure if the OS actually rejects it.
    const telUrl = `tel:${number}`;
    try {
      await Linking.openURL(telUrl);
    } catch {
      toast.show('Could not open the dialer on this device', 'error');
    }
  }, [toast]);

  /**
   * Call / WhatsApp a member from group info.
   *
   * Only ever invoked when the member actually carries a phone. The privacy rule
   * (phone is sent for builder and project rooms only, stripped for universal and
   * area) is enforced on the SERVER — hiding the number in this component alone
   * would still ship every universal member's number over the wire. So do not
   * "simplify" this into a client-side room-type check: it is a render-if-present
   * check on purpose.
   *
   * The dialer is opened without a canOpenURL gate for the reason documented on
   * handlePropertyCall: Android does not always report tel: as openable, and
   * refusing on that basis is what made Call look dead.
   */
  const handleMemberCall = useCallback(async (phone?: string) => {
    const number = String(phone || '').replace(/[^0-9+]/g, '');
    if (!number) { toast.show('No number available for this member', 'error'); return; }
    try {
      await Linking.openURL(`tel:${number}`);
    } catch {
      toast.show('Could not open the dialer on this device', 'error');
    }
  }, [toast]);

  const handleMemberWhatsApp = useCallback(async (phone?: string) => {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    if (!digits) { toast.show('No number available for this member', 'error'); return; }
    // Same normalisation as the AI match card: a bare 10-digit Indian number gets
    // the 91 country code, anything longer is assumed to already carry one.
    try {
      await Linking.openURL(`https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`);
    } catch {
      toast.show('WhatsApp is not available on this device', 'error');
    }
  }, [toast]);

  // Group profile picture — the write path.
  //
  // THE TWO BUGS THIS CODE HAS ALREADY BEEN THROUGH, kept on record because the
  // second one is the reason the whole feature moved to the server:
  //
  // 1. Both handlers used to declare `[toast]` as their only dependency. The
  //    component always mounts on the room LIST, where activeRoom is null, so the
  //    closure handed to the modal had captured activeRoom === null — the
  //    `if (activeRoom?.id)` guard was false and nothing was ever written to
  //    AsyncStorage. The useState setters still worked through the stale closure
  //    (they are referentially stable), which is why the header showed the new
  //    picture while the list kept the default icon. Fixed by depending on
  //    activeRoom?.id and using functional updaters, both of which are retained.
  // 2. The success toast fired off a LOCAL write that nobody else could see, and
  //    `saveRoomProfilePicture` returned null on a failed write — indistinguishable
  //    from "no previous entry" — so even a storage failure reported success.
  //
  // Both handlers now await the real server call FIRST and only touch local state
  // after it resolves. Every failure path says it failed, in the server's own
  // words where it has any. Authorization is the server's; canManageRoomAvatar is
  // only here to keep an unusable button off the screen.
  const handleProfilePicUpload = useCallback(async (option: 'gallery' | 'camera') => {
    const key = roomProfileKey(activeRoom);
    if (!key) {
      toast.show('Open a group first', 'error');
      return;
    }
    // Defensive only — the picker lives behind an affordance that is not
    // rendered for a caller who fails this check. The server's 403 is the
    // boundary; this just avoids spending a request to be refused.
    if (!canManageRoomAvatar) {
      toast.show('Only a group admin can change the group photo', 'error');
      return;
    }
    try {
      const permissionType = option === 'camera' 
        ? ImagePicker.requestCameraPermissionsAsync()
        : ImagePicker.requestMediaLibraryPermissionsAsync();
      
      const { status } = await permissionType;
      if (status !== 'granted') {
        toast.show('Permission required to access photos', 'error');
        return;
      }

      setUpdatingProfilePic(true);
      const result = option === 'camera'
        ? await ImagePicker.launchCameraAsync({
            allowsEditing: false, // Remove editor to avoid stuck issue
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false, // Remove editor to avoid stuck issue  
            quality: 0.8,
          });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const imageUri = asset.uri;

        // Pre-flight against the contract's own limits, before the file is copied
        // or a request is spent. The server accepts only JPEG / PNG / WebP at up
        // to 5 MB and sniffs magic bytes, so these two checks just move a refusal
        // that would happen anyway to somewhere it can be explained.
        //
        // HEIC is REFUSED rather than converted: there is no image transcoder in
        // this project (no expo-image-manipulator), so an iPhone pick saved as
        // HEIC cannot be made acceptable here. A clear sentence beats a server
        // 400 the user cannot act on.
        //
        // A missing mimeType defaults to image/jpeg, exactly as the chat
        // attachment path does, and the server's magic-byte sniff is then the
        // real gate — guessing wrong there is a clean 400, not a corrupt upload.
        const mimeType = asset.mimeType || 'image/jpeg';
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
          toast.show('Only JPEG, PNG and WebP photos can be used', 'error');
          return;
        }
        if (typeof asset.fileSize === 'number' && asset.fileSize > 5 * 1024 * 1024) {
          toast.show('Group photo must be 5 MB or smaller', 'error');
          return;
        }

        // Copy the pick out of the picker's cache before anything is persisted.
        // The URI handed back lives under .../cache/ImagePicker/, which Android
        // purges at will and which does not survive a reinstall, so storing it
        // produced avatars that went blank later with no explanation. The
        // timestamp in the filename matters: reusing one filename lets RN's
        // Image serve the previously cached bitmap, so a new photo would appear
        // not to have changed.
        //
        // The copy earns its keep twice over now: it is what gets uploaded (so a
        // purge mid-request cannot pull the file out from under the upload) and
        // it becomes the entry's `localUri` offline fallback afterwards.
        let storedUri: string;
        let name: string;
        try {
          await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true }); // idempotent
          // The extension comes from the CAPTURE GROUP, not the whole match. The
          // previous expression took `?.[0]`, which for a URI carrying a query
          // string ("…/photo.jpg?token=abc") matched '.jpg?' including the
          // question mark — producing a file literally named `…jpg?` on disk.
          //
          // `heic` is NOT in the alternation, and that is not an oversight: the
          // mime pre-flight above already refuses a declared HEIC, so the branch
          // could only ever fire when asset.mimeType was absent — naming the
          // file `.heic` on a payload this code declares as image/jpeg. The
          // alternation now lists exactly the three types the contract accepts
          // and anything else falls to the 'jpg' default, which matches that
          // declared mime.
          const extMatch = imageUri.match(/\.(jpe?g|png|webp)(?:\?|$)/i);
          const ext = `.${(extMatch?.[1] || 'jpg').toLowerCase()}`;
          name = `${key}-${Date.now()}${ext}`;
          storedUri = `${AVATAR_DIR}${name}`;
          await FileSystem.copyAsync({ from: imageUri, to: storedUri });
        } catch (copyError) {
          // Persisting the cache URI as a fallback would just recreate the decay
          // this copy exists to prevent, so nothing is saved at all.
          console.error('Profile pic copy error:', copyError);
          toast.show('Could not save that photo', 'error');
          return;
        }

        try {
          // The durable copy is what gets uploaded, never the picker-cache URI.
          const res = await groupChatApi.uploadRoomAvatarImage({ roomId: key, uri: storedUri, name, mimeType });
          if (!res.avatar) throw new Error('The server did not return the new photo');

          // Server first, and only AFTER it answered. room.avatar is what every
          // other member will see; the cache entry below is only this device's
          // offline fallback.
          applyRoomAvatar(key, res.avatar);
          const written = await cacheRoomAvatar(key, { type: 'image', value: res.avatar.value, localUri: storedUri });
          if (written.ok) {
            // Only reachable on ok: on a failed cache write `previous` was never
            // read, so deleting anything would be a guess.
            discardReplacedAvatar(written.previous, storedUri);
          }
          // Functional updater, so `avatarCache` is never read from this closure
          // and a stale snapshot can never drop another room's entry.
          setAvatarCache(prev => ({ ...prev, [key]: { type: 'image', value: res.avatar!.value, localUri: storedUri } }));

          toast.show('Group photo updated', 'success');
          setShowProfilePicModal(false);
        } catch (uploadError) {
          // Nothing landed, so nothing changes: no room patch, no cache write,
          // and the local copy is removed rather than left as a file nobody will
          // ever read.
          FileSystem.deleteAsync(storedUri, { idempotent: true }).catch(() => {});
          toast.show(avatarErrorMessage(uploadError, 'Could not update the group photo'), 'error');
        }
      }
    } catch (error) {
      console.error('Profile pic upload error:', error);
      toast.show('Failed to update profile picture', 'error');
    } finally {
      setUpdatingProfilePic(false);
    }
  }, [toast, activeRoom?.id, canManageRoomAvatar, applyRoomAvatar]);

  const handleIconSelect = useCallback(async (icon: string) => {
    const key = roomProfileKey(activeRoom);
    if (!key) {
      toast.show('Open a group first', 'error');
      return;
    }
    if (!canManageRoomAvatar) {
      toast.show('Only a group admin can change the group photo', 'error');
      return;
    }
    try {
      setUpdatingProfilePic(true);
      // There used to be an artificial 500ms sleep here commented "Simulate API
      // call". It was removed because there was no API call to simulate. There
      // is a real one now — do NOT reintroduce a sleep beside it.
      const res = await groupChatApi.setRoomAvatarIcon(key, icon);
      if (!res.avatar) throw new Error('The server did not return the new icon');

      // The server's echoed value is stored, not the local `icon` string: the
      // contract says a trailing U+FE0F presentation selector is tolerated and
      // stripped, so the server's value is the canonical one and caching ours
      // would mean the cache and the room disagreed by a codepoint.
      applyRoomAvatar(key, res.avatar);
      const written = await cacheRoomAvatar(key, { type: 'icon', value: res.avatar.value });
      if (written.ok) {
        // Switching to an emoji orphans whatever photo this room had locally.
        discardReplacedAvatar(written.previous);
      }
      setAvatarCache(prev => ({ ...prev, [key]: { type: 'icon', value: res.avatar!.value } }));
      toast.show('Group photo updated', 'success');
      setShowProfilePicModal(false);
    } catch (error) {
      // No state change and no cache write on this path — the group's picture is
      // whatever the server still says it is.
      toast.show(avatarErrorMessage(error, 'Could not update the group photo'), 'error');
    } finally {
      setUpdatingProfilePic(false);
    }
  }, [toast, activeRoom?.id, canManageRoomAvatar, applyRoomAvatar]);

  /**
   * Returns the group to its default room-type icon. Without this an uploaded
   * photo could never be undone — the picker only ever offered replacements.
   *
   * DELETE is idempotent per the contract (a room with no picture also answers
   * 200) and the returned room carries no `avatar` key at all, which is why the
   * room patch below is an explicit `undefined` rather than anything derived
   * from the response.
   */
  const handleClearAvatar = useCallback(async () => {
    const key = roomProfileKey(activeRoom);
    if (!key) {
      toast.show('Open a group first', 'error');
      return;
    }
    if (!canManageRoomAvatar) {
      toast.show('Only a group admin can change the group photo', 'error');
      return;
    }
    try {
      setUpdatingProfilePic(true);
      await groupChatApi.clearRoomAvatar(key);
      applyRoomAvatar(key, undefined);
      const written = await removeCachedRoomAvatar(key);
      if (written.ok) {
        // The in-memory delete is INSIDE the ok branch. It used to run before
        // this check, so a failed storage removal left the session showing no
        // picture while AsyncStorage still held one — the two disagreed until
        // the next read, and the old photo then came back out of nowhere. They
        // now move together or not at all, and the toast below says which.
        setAvatarCache(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        discardReplacedAvatar(written.previous);
        toast.show('Group photo removed', 'success');
      } else {
        // The clear itself DID land — the group no longer has a photo for anyone.
        // But the stored fallback entry survived, and resolveRoomAvatar falls
        // back to the cache precisely when room.avatar is absent, so this device
        // keeps rendering the old picture. The in-memory entry is left in place
        // to match that, rather than hiding a discrepancy the user would meet
        // again on the next cold start. Reporting a clean removal here would be
        // the same false-success this whole rewrite exists to kill.
        toast.show('Removed for the group, but the copy on this device could not be cleared', 'error');
      }
      setShowProfilePicModal(false);
    } catch (error) {
      toast.show(avatarErrorMessage(error, 'Could not remove the group photo'), 'error');
    } finally {
      setUpdatingProfilePic(false);
    }
  }, [toast, activeRoom?.id, canManageRoomAvatar, applyRoomAvatar]);

  // Stable renderItem so the memoised MessageBubble can actually bail out.
  // Previously this was an inline arrow with a fresh onInterested on every
  // render, which defeated memoisation entirely.
  const renderMessage = useCallback(
    ({ item: msg }: { item: GroupMessage }) => (
      <MessageBubble 
        msg={msg} 
        meId={user?.id || ''} 
        onInterested={handleInterested}
        onPropertyViewDetails={handlePropertyViewDetails}
        onPropertyCall={handlePropertyCall}
        onJoinPropertyGroup={handleJoinPropertyGroup}
        onPreviewMatch={handlePreviewMatch}
        onDeleteMessage={handleDeleteMessage}
        canModerate={canUploadMedia}
        projectId={(activeRoom?.project as any)?.id || (activeRoom?.project as any)?._id || ''}
        highlighted={msg.id === highlightedMessageId}
      />
    ),
    [user?.id, handleInterested, handlePropertyViewDetails, handlePropertyCall, handleJoinPropertyGroup, handlePreviewMatch, handleDeleteMessage, canUploadMedia, activeRoom?.project, highlightedMessageId]
  );

  // ── Project media menu ──
  const activeProject = () => (activeRoom?.project as any) || {};
  const activeProjectId = () => String(activeProject().id || activeProject()._id || '');
  const safeProjectFileName = (suffix: string) => {
    const base = String(activeProject().projectName || activeRoom?.name || 'project')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${base}_${suffix}`;
  };
  const plainProjectUrl = () => {
    const slug = activeProject().slug;
    return slug ? `https://homeintown.in/visit/${slug}` : 'https://homeintown.in';
  };

  /** Resolve a tracked share URL, with a stable public project URL fallback. */
  const resolveShareUrl = async (type: 'link' | 'pdf' | 'qr') => {
    const pid = activeProjectId();
    if (!pid) throw new Error('No project linked to this group');
    try {
      const result = await shareApi.generateToken(pid, type);
      return result.shareUrl || plainProjectUrl();
    } catch {
      if (type === 'link' || type === 'qr') return plainProjectUrl();
      throw new Error('No PDF brochure available for this project');
    }
  };

  /**
   * Share link opens the OS share sheet with the tracked project URL, and falls
   * back to copying it if the sheet cannot be shown. (Download QR deliberately
   * does NOT use the share sheet — that was a separate bug.)
   */
  const handleShareLink = async () => {
    setShowRoomMenu(false);
    try {
      const url = await resolveShareUrl('link');
      const name = activeProject().projectName || activeRoom?.name || 'this property';
      try {
        await Share.share({ message: `${name}\n${url}`, url });
      } catch {
        await Clipboard.setStringAsync(url);
        toast.show('Project link copied', 'success');
      }
    } catch (e: any) {
      toast.show(e?.message || 'Could not share the project link', 'error');
    }
  };

  /** Download the real brochure/token PDF and hand the file to the OS. */
  const handleDownloadPdf = async () => {
    setShowRoomMenu(false);
    const pid = activeProjectId();
    if (!pid) { toast.show('No project linked to this group', 'error'); return; }

    toast.show('Downloading PDF…', 'info');
    try {
      const p = activeProject();
      const rawBrochure = p.media?.brochurePdf;
      const brochureUrl = typeof rawBrochure === 'string' ? rawBrochure : rawBrochure?.url;
      const url = brochureUrl || await resolveShareUrl('pdf');
      const target = `${FileSystem.cacheDirectory}${safeProjectFileName('Brochure.pdf')}`;
      const result = await FileSystem.downloadAsync(url, target);
      if (result.status !== 200) throw new Error('PDF download failed');

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Project Brochure',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Linking.openURL(result.uri);
      }
    } catch (e: any) {
      toast.show(e?.message || 'Failed to download PDF', 'error');
    }
  };

  /** Generate a QR token and render it off-screen for PNG export. */
  const handleDownloadQr = async () => {
    setShowRoomMenu(false);
    if (!activeProjectId()) { toast.show('No project linked to this group', 'error'); return; }
    toast.show('Generating QR…', 'info');
    try {
      const url = await resolveShareUrl('qr');
      qrRef.current = null;
      setQrExport({ url, fileName: safeProjectFileName('QR.png') });
    } catch (e: any) {
      toast.show(e?.message || 'Failed to generate QR', 'error');
    }
  };

  // QRCode's toDataURL API is ref-based. The off-screen component mounts after
  // qrExport is set; wait one frame, convert it, write a real PNG, then clear it.
  useEffect(() => {
    if (!qrExport) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const node = qrRef.current;
      if (!node?.toDataURL) {
        if (!cancelled) {
          toast.show('Could not render QR code', 'error');
          setQrExport(null);
        }
        return;
      }

      node.toDataURL(async (base64: string) => {
        if (cancelled) return;
        try {
          const target = `${FileSystem.cacheDirectory}${qrExport.fileName}`;
          await FileSystem.writeAsStringAsync(target, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(target, {
              mimeType: 'image/png',
              dialogTitle: 'Project QR Code',
              UTI: 'public.png',
            });
          } else {
            toast.show('QR generated', 'success');
          }
        } catch (e: any) {
          toast.show(e?.message || 'Failed to save QR', 'error');
        } finally {
          setQrExport(null);
        }
      });
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [qrExport, toast]);

  const handleDownloadGallery = async () => {
    setShowRoomMenu(false);
    const pid = (activeRoom?.project as any)?.id || (activeRoom?.project as any)?._id;
    if (!pid) { toast.show('No project linked to this group', 'error'); return; }
    toast.show('Downloading gallery…', 'info');
    try {
      const { url, token } = await shareApi.galleryDownload(String(pid));
      const name = ((activeRoom?.project as any)?.projectName || 'project').replace(/[^a-zA-Z0-9]/g, '_');
      const target = `${FileSystem.cacheDirectory}${name}_Gallery.zip`;
      const res = await FileSystem.downloadAsync(url, target, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status !== 200) throw new Error('Download failed');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, { mimeType: 'application/zip', dialogTitle: 'Project Gallery' });
      } else {
        toast.show('Gallery saved', 'success');
      }
    } catch (e: any) {
      toast.show(e?.message || 'Failed to download gallery', 'error');
    }
  };

  // ── Room options ──
  // Project groups are canonically created by the property owner. Prefer the
  // explicit project.owner id and fall back to room.createdBy for older/area
  // groups. Role or room-admin status must not be treated as property ownership.
  const groupOwnerId = activeRoom?.project?.owner?.id || activeRoom?.createdBy?.id || '';
  const isGroupOwner = !!activeRoom && !!user?.id && groupOwnerId === user.id;
  const canDelete = !!activeRoom && !activeRoom.isUniversal && isGroupOwner;
  const canLeave = !!activeRoom && !activeRoom.isUniversal && !isGroupOwner && activeRoom.canLeave !== false;

  const handleLeave = () => {
    setShowRoomMenu(false);
    // Both actions are now reached from group info, so that sheet has to come
    // down before the confirm alert — otherwise the alert sits behind the modal.
    setShowGroupInfo(false);
    if (!activeRoom) return;
    Alert.alert('Exit group?', `Exit "${roomDisplayName(activeRoom)}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit', style: 'destructive', onPress: async () => {
          try {
            await groupChatApi.leaveRoom(activeRoom.id);
            setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
            toast.show('Exited group', 'success');
            closeRoom();
          } catch (e: any) { toast.show(e?.message || 'Failed to leave', 'error'); }
        },
      },
    ]);
  };

  const handleDelete = () => {
    setShowRoomMenu(false);
    setShowGroupInfo(false);
    if (!activeRoom) return;
    Alert.alert('Delete group?', `This will close "${roomDisplayName(activeRoom)}" for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await groupChatApi.deleteRoom(activeRoom.id);
            setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
            toast.show('Group deleted', 'success');
            closeRoom();
          } catch (e: any) { toast.show(e?.message || 'Failed to delete', 'error'); }
        },
      },
    ]);
  };

  const handleJoin = useCallback(async (room: GroupRoom) => {
    if (joiningId) return; // guard against double-taps creating duplicate joins
    setJoiningId(room.id);
    try {
      const r = await groupChatApi.joinRoom(room.id);
      // Move the room from Discover into My Groups, de-duping in case the list
      // already has it (e.g. a refresh landed mid-join).
      setMyRooms(prev => [r, ...prev.filter(x => x.id !== r.id)]);
      setDiscoverRooms(prev => prev.filter(x => x.id !== room.id));
      toast.show(`Joined ${roomDisplayName(r)}`, 'success');
      openRoom(r);
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
    finally { setJoiningId(null); }
  }, [joiningId, toast, openRoom]);

  // One stable renderItem for the whole SectionList. `section.joined` decides
  // which variant the row shows, so both sections share a single row component.
  // The Property Groups section is the one place that mixes joined and joinable
  // rows in a single heading, so it passes `joinedIds` and the row answers for
  // itself; every other section leaves it undefined and keeps the flat flag.
  const renderGroupRow = useCallback(
    ({ item: room, section }: { item: GroupRoom; section: { joined: boolean; joinedIds?: Set<string> } }) => (
      <GroupRow
        room={room}
        joined={section.joinedIds ? section.joinedIds.has(room.id) : section.joined}
        joining={joiningId === room.id}
        onPress={openRoom}
        onJoin={handleJoin}
        cache={avatarCache}
      />
    ),
    [joiningId, openRoom, handleJoin, avatarCache]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; data: GroupRoom[]; joined: boolean } }) => (
      <View style={s.sectionHeader}>
        {!section.joined
          ? <Globe size={13} color={colors.brand} />
          : section.title === 'Builders'
            ? <Building2 size={13} color={colors.brand} />
            : <MapPin size={13} color={colors.brand} />}
        <Text style={s.sectionTitle}>{section.title}</Text>
        <View style={s.sectionCountPill}>
          <Text style={s.sectionCountText}>{section.data.length}</Text>
        </View>
      </View>
    ),
    []
  );

  const handleCreate = async () => {
    if (!roomForm.name || !roomForm.city || !roomForm.location) {
      toast.show('Name, city, location required', 'error'); return;
    }
    setCreating(true);
    try {
      const r = await groupChatApi.createRoom({ name: roomForm.name, roomType: 'area', area: { city: roomForm.city, location: roomForm.location } });
      setMyRooms(prev => [r, ...prev]);
      setShowCreate(false);
      setRoomForm({ name: '', city: '', location: '' });
      openRoom(r);
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
    finally { setCreating(false); }
  };

  // ═══════════ ROOM LIST ═══════════
  if (!activeRoom) {
    // The universal ("AI Lead Matching") room is the AI Leads section itself, so
    // it must NOT appear in the Groups list. Only real, joinable groups here.
    const listRooms = myRooms.filter(r => !r.isUniversal);

    // Public groups the user hasn't joined. The backend already excludes joined
    // rooms and the universal room; this second guard keeps the list correct if
    // a join resolves while a refresh is in flight, so a group can never show up
    // in both My Groups and Discover.
    const joinedIds = new Set(myRooms.map(r => r.id));

    // The list is organised by COMPANY. Property groups are deliberately not
    // top-level rows any more — they are reached from inside their builder's
    // group, through the property cards. Listing both would show the same
    // property twice: once under its company and once on its own.
    const myBuilders = listRooms.filter(r => r.roomType === 'builder');
    const myAreas = listRooms.filter(r => r.roomType === 'area');

    // Project rooms are excluded here for the same reason.
    const discoverList = discoverRooms.filter(r =>
      !r.isUniversal && !joinedIds.has(r.id) && r.roomType !== 'project'
    );

    // Property Groups chip: the ONLY top-level path to a roomType 'project'
    // room. Project rooms stay out of the unfiltered discoverList above, and out
    // of My Groups' Builders/Area sections — one builder can have eighteen
    // properties, and listing them all alongside their company group showed the
    // same property twice. That decision is NOT reversed here; this chip is a
    // deliberate narrow exception layered on top of it, and it only ever applies
    // when the user has explicitly picked the chip.
    //
    // The bug this fixes: the chip used to admit a property room ONLY when
    // isOrphanedPropertyGroup() said so. A user who joined a project group from
    // the Project tab's map (Sai Dham Developers) could open it fine from the map
    // but then could not find it ANYWHERE in the Groups list — the orphan rule
    // correctly answered "not orphaned" for a verified owner with two published
    // projects, and the top-level exclusion above hid it from every other
    // section. A group you are a member of must be findable.
    //
    // So admission is now: a property-type room (company or property) that the
    // user has JOINED, **or** one that is ORPHANED. The orphan half is untouched,
    // so unjoined single-property groups and groups from builders without a
    // complete profile are still discoverable here — those stay the rooms a user
    // would otherwise never reach, because someone who never opens the builder's
    // group never sees them.
    //
    // Built from myRooms AND discoverRooms so a joined room and a joinable one
    // sit in the same list. De-duplication is the byId map, keyed on the
    // canonical id minted once in transformGroupRoom(), so a room that is both
    // joined and orphaned is drawn exactly once. The joined pass runs LAST on
    // purpose: its copy is the richer one — populated members plus unreadCount —
    // so it overwrites any discover copy of the same room.
    const propertyGroups = (() => {
      const byId = new Map<string, GroupRoom>();
      for (const r of discoverRooms) {
        if (r.isUniversal || joinedIds.has(r.id)) continue;
        if (isOrphanedPropertyGroup(r, publishedCountByOwner)) byId.set(r.id, r);
      }
      for (const r of listRooms) {
        if (!isPropertyRoomType(r)) continue;
        byId.set(r.id, r);
      }
      // Joined groups first, discoverable ones after.
      //
      // Both passes and the byId de-duplication above are deliberately unchanged
      // — the joined pass must still run LAST so its richer copy (populated
      // members, unreadCount) wins — but Map.set keeps an existing key's original
      // insertion position, so a room that was also in Discover kept its discover
      // slot and a purely-joined room was simply appended at the end. Either way
      // the groups the user is actually a member of sank to the bottom of a list
      // whose top rows they cannot even open without joining.
      //
      // Partitioning after the fact, rather than reordering the passes, is what
      // keeps admission identical: isOrphanedPropertyGroup() and
      // isOwnerProfileIncomplete() still decide WHICH rooms appear, this only
      // decides the order. Inside each half the server's lastActivity order is
      // preserved.
      const all = Array.from(byId.values());
      return [...all.filter(r => joinedIds.has(r.id)), ...all.filter(r => !joinedIds.has(r.id))];
    })();

    // ONE list for everything. Empty sections drop out, so a user with no area
    // groups simply never sees that heading.
    //
    // The chip narrows this; no chip (groupFilter === null) is byte-for-byte the
    // three sections this pane always showed.
    const sections = (
      groupFilter === 'mine'
        ? [
          { title: 'Builders', data: myBuilders, joined: true },
          { title: 'Area Groups', data: myAreas, joined: true },
        ]
        : groupFilter === 'discover'
          ? [{ title: 'Discover Groups', data: discoverList, joined: false }]
          : groupFilter === 'property'
            // One section, mixing joined and joinable rows. A section carries a
            // single `joined` flag for all its rows, which would have forced a
            // joined orphan to render a "Join" button it does not need — so this
            // section also hands renderGroupRow the joined-id set and the row
            // resolves its own state. `joined: false` only picks the heading's
            // globe icon, which is right for a discovery surface — it does NOT
            // decide any row, so a joined project room renders Open (tappable
            // row, time and unread badge) while an unjoined orphan next to it
            // still renders its Join Group button.
            ? [{ title: GROUP_FILTER_LABELS.property, data: propertyGroups, joined: false, joinedIds }]
            : [
              { title: 'Builders', data: myBuilders, joined: true },
              { title: 'Area Groups', data: myAreas, joined: true },
              { title: 'Discover Groups', data: discoverList, joined: false },
            ]
    ).filter(sec => sec.data.length > 0);

    const nothingToShow = sections.length === 0;

    // An active chip with no matches must explain ITSELF. The empty state used to
    // read "No groups yet" unconditionally, which under a chip was simply false —
    // the user may have plenty of groups and just none of this kind.
    const emptyLabel = search
      ? `No groups match "${search}"`
      : groupFilter === 'mine'
        ? 'No groups you have joined yet'
        : groupFilter === 'discover'
          ? 'No new groups to discover'
          : groupFilter === 'property'
            ? 'No property groups to show'
            : 'No groups yet';

    const emptyHint = search
      ? 'Try a different area or project name.'
      : groupFilter === 'mine'
        ? 'Join a group from Discover and it will show up here.'
        : groupFilter === 'discover'
          ? 'You have already joined every public group we can see.'
          : groupFilter === 'property'
            ? 'Property groups you have joined show up here, along with single-property groups and builders without a complete profile.'
            : 'Groups you join appear here, and public groups show up under Discover Groups.';

    return (
      <View style={{ flex: 1 }}>
        {/* Header: always-visible search + New. The search used to be a magnifier
            that expanded over the whole header, hiding the other actions while
            typing, and a globe opened a duplicate Discover sheet. */}
        {/* The header used to BE the search + New row. It is now a column, so the
            filter chips can sit directly under the search field where they read
            as narrowing that search rather than as unrelated header actions. */}
        <View style={s.listHeaderWrap}>
          <View style={s.listHeader}>
            <View style={s.searchInline}>
              <Search size={15} color={colors.muted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search groups…"
                placeholderTextColor={colors.muted}
                style={s.searchInput}
                onSubmitEditing={() => loadRooms(search)}
                returnKeyType="search"
              />
              {!!search && (
                <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
                  <X size={16} color={colors.muted2} />
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => setShowCreate(true)}
              style={s.newBtn}
              accessibilityRole="button"
              accessibilityLabel="Create a new group"
            >
              <Plus size={14} color={colors.brand} />
              <Text style={s.newBtnText}>New</Text>
            </Pressable>
          </View>

          {/* Single-select, and tapping the ACTIVE chip clears it. There is no
              "All" chip to go back to, so the chip itself has to be the way out —
              otherwise the first tap would be a one-way door. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.filterBar}
            contentContainerStyle={s.filterContent}
            keyboardShouldPersistTaps="handled"
          >
            {GROUP_FILTERS.map(f => {
              const active = groupFilter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setGroupFilter(active ? null : f.key)}
                  style={[s.filterPill, active && s.filterPillActive]}
                  accessibilityRole="button"
                  accessibilityLabel={active ? `${f.label} filter active, tap to clear` : `Filter by ${f.label}`}
                >
                  <Text style={[s.filterPillText, active && s.filterPillTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
          nothingToShow ? (
            <View style={s.empty}>
              <Users size={28} color={colors.muted} />
              <Text style={s.emptyText}>{emptyLabel}</Text>
              <Text style={s.emptyHint}>{emptyHint}</Text>
              {/* Also hidden while a chip is active: Create only ever makes an
                  AREA group, so offering it as the answer to "no property
                  groups" would be a non-sequitur. The chip row stays on screen,
                  so clearing the filter is the available next step. */}
              {!search && !groupFilter && (
                <Pressable onPress={() => setShowCreate(true)} style={s.joinBtn}>
                  <Text style={s.joinBtnText}>Create a group</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={r => r.id}
              renderItem={renderGroupRow}
              renderSectionHeader={renderSectionHeader}
              ItemSeparatorComponent={RoomSeparator}
              stickySectionHeadersEnabled
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            />
          )
        )}

        {/* Create */}
        <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
          <View style={{ flex: 1, backgroundColor: colors.cream }}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Create Group</Text>
              <Pressable onPress={() => setShowCreate(false)}><X size={20} color={colors.ink} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              {[{ k: 'name', lbl: 'Group Name *', ph: 'e.g. Baner Builders' }, { k: 'city', lbl: 'City *', ph: 'e.g. Pune' }, { k: 'location', lbl: 'Area / Location *', ph: 'e.g. Baner' }].map(f => (
                <View key={f.k} style={{ gap: 4 }}>
                  <Text style={s.fieldLabel}>{f.lbl}</Text>
                  <TextInput value={(roomForm as any)[f.k]} onChangeText={v => setRoomForm(r => ({ ...r, [f.k]: v }))} placeholder={f.ph} placeholderTextColor={colors.muted} style={s.fieldInput} />
                </View>
              ))}
              <Pressable onPress={handleCreate} disabled={creating} style={[s.primaryBtn, creating && { opacity: 0.6 }]}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Create Group</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════ THREAD (full-screen) ═══════════
  const proj = (activeRoom.project as any) || null;

  // Subtitle under the thread title. The universal room has no name of its own to
  // show, so it keeps the old wording; named groups lead with their membership
  // count followed by whatever identifies them (company, location, area).
  const threadSubtitle = (() => {
    if (activeRoom.isUniversal) {
      return newJoinCount > 0 ? `+${newJoinCount} new this week` : 'Universal group';
    }

    const memberText = `${activeRoom.members.length} member${activeRoom.members.length !== 1 ? 's' : ''}`;
    const joined = newJoinCount > 0 ? `+${newJoinCount} new` : '';

    // Builder rooms also report how much inventory the company has, reading e.g.
    // "1 member · 18 projects · Verified". No request: builderProjects is already
    // loaded for the strip below. Rendered only when non-empty, because the array
    // is [] while the portfolio is still loading and a "0 projects" that flips to
    // "18 projects" a moment later is worse than no segment at all.
    const projectText = activeRoom.roomType === 'builder' && builderProjects.length > 0
      ? `${builderProjects.length} project${builderProjects.length !== 1 ? 's' : ''}`
      : '';

    let context = '';
    if (activeRoom.roomType === 'builder') {
      context = activeRoom.builder?.isVerified
        ? 'Verified'
        : (activeRoom.builder?.role === 'agent' ? 'Agent' : 'Builder');
    } else if (activeRoom.roomType === 'project') {
      context = [proj?.location, proj?.city].filter(Boolean).join(', ') || 'Project group';
    } else {
      context = activeRoom.area?.location || activeRoom.area?.city || 'Group';
    }

    return [memberText, projectText, joined, context].filter(Boolean).join(' · ');
  })();
  // Share link / PDF / QR / Gallery all act on the linked project, so they are
  // only offered when the group actually has one (area groups do not).
  const hasProjectMedia = !!(proj?.slug || proj?.id || proj?._id);
  // Group info exists for every real group. Area rooms are included because
  // Exit Group moved into this sheet — leaving them out would strand area members
  // with no way to leave, since their 3-dot no longer carries it.
  const canOpenGroupInfo = !activeRoom.isUniversal;
  const infoMembers = activeRoom.members || [];
  const infoAdmins = infoMembers.filter(m => m.role === 'admin');
  // The group-info avatar, built once and placed into whichever wrapper the
  // caller's permission selects below. It used to be two verbatim ~20-line
  // copies of the same image/emoji block, one inside the admin Pressable and one
  // inside the non-admin View, which meant any fix to the avatar's failure
  // behaviour had to land twice — and the first time round it landed in neither.
  // The branches now differ ONLY in the wrapper element, which is the only thing
  // the permission actually changes.
  const groupInfoAvatar = <RoomAvatar room={activeRoom} cache={avatarCache} size={30} imageSize={70} />;

  // Header / back visibility. Both props describe the AI Leads pane's chrome for
  // its OWN room; neither was ever meant to apply to a second room opened inside
  // that pane, which is what Join Group on a match row now does. So the
  // suppression is narrowed to the AI room and every other room keeps a real
  // header with a working back control (see handleThreadBack for where it goes).
  const showThreadHeader = !headerless || !isAiRoom;
  const showThreadBack = !hideThreadBack || (!isAiRoom && !!aiRoom);

  return (
    <KeyboardAvoidingView style={{ flex: 1, paddingTop: topInset }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Thread header — hidden in headerless mode ONLY for the AI room, where the
          AI Leads hub supplies the single Groups · Chats · My Post · Matching tab
          row instead (it used to supply only Groups · Chats).

          `!headerless` alone was wrong once the AI pane could open a second room.
          Join Group on a match row opens that property's thread in this pane, and
          with the header suppressed it arrived with NO title and NO back control —
          the user saw a nameless thread with the hub's AI chrome on top and read
          it as "the sheet closed and nothing happened". A room the hub does not
          name has to name itself, so any non-AI room gets the real header back.

          The two other callers are unaffected: the Groups pane passes neither
          prop (header and back exactly as before), and PropertyMap's modal passes
          hideThreadBack with headerless false and no autoOpenUniversal — so
          aiRoom is null there, showThreadBack stays false, and the modal keeps
          owning the only back control. */}
      {showThreadHeader && (
      <View style={s.threadHeader}>
        {showThreadBack && (
          <Pressable onPress={handleThreadBack} style={{ padding: 4 }}><ChevronLeft size={22} color={colors.ink} /></Pressable>
        )}
        {/* Avatar + title are one tap target that opens group info, the way
            WhatsApp does it. They used to be inert Views, so there was no way to
            see members, admins or shared media at all. The back chevron and the
            3-dots stay OUTSIDE this Pressable so they keep their own taps.
            The universal room is deliberately NOT pressable: it has no owner, no
            Exit (canLeave === false), a member list that grows with every signup,
            and member numbers that must never be shown there. */}
        <Pressable
          onPress={canOpenGroupInfo ? () => setShowGroupInfo(true) : undefined}
          disabled={!canOpenGroupInfo}
          style={s.threadIdentity}
          accessibilityRole="button"
          accessibilityLabel="Group info"
        >
          {/* Universal room gets the globe symbol (matches the room list) so this
              header reads as "the shared room", not a repeat of the tab name. */}
          {/* Rendered by the SHARED RoomAvatar, like the list row and the
              group-info sheet. This used to read two component-level states
              (customProfileIcon / customProfileImage) that the room list had no
              access to, so a freshly picked picture appeared here and in the
              info sheet while the list row beside it kept the default icon.

              The first pass at that fix routed this site through the shared
              RESOLVER but kept its own hand-rolled <Image>, which had no
              onError and never tried the cached localUri — so once `value`
              became a remote R2 URL instead of a file:// path, an offline open
              showed a blank 38×38 circle here while the list row behind it
              showed the local copy. The whole component is shared now, so the
              remote → localUri → room-type emoji walk is too.

              Pixel values and s.threadAvatar are unchanged: imageSize={38} is
              the diameter this site always used, and size={15} the emoji's. */}
          <View style={[s.threadAvatar, activeRoom.isUniversal && { backgroundColor: colors.brand }]}>
            <RoomAvatar room={activeRoom} cache={avatarCache} size={15} imageSize={38} />
          </View>
          {/* The universal room keeps membership stats as its title — the tab above
              already names it, so repeating "AI Lead Matching" here said nothing.
              Every other group is a NAMED thing (a company, a property, an area),
              so the name leads and the membership count moves to the subtitle. */}
          <View style={{ flex: 1 }}>
            <Text style={s.threadTitle} numberOfLines={1}>
              {activeRoom.isUniversal
                ? `${activeRoom.members.length} members`
                : roomDisplayName(activeRoom)}
            </Text>
            <Text style={s.threadSub} numberOfLines={1}>
              {threadSubtitle}
            </Text>
          </View>
        </Pressable>

        {/* AI 3-dot menu in the header (only visible when AI mode is active) */}
        {aiAllowed && aiActive && (
          <View style={s.headerAiRow}>
            <Pressable onPress={() => setShowAiMenu(v => !v)} style={s.headerAiDots}>
              <MoreVertical size={18} color={colors.ink} />
            </Pressable>
          </View>
        )}

        {/* The temporary orange "📸 Test" button that opened the profile-picture
            sheet from here has been removed. It was debug scaffolding from when
            the save path was broken; the real entry point is the WhatsApp-style
            avatar tap inside the group-info sheet, reached by tapping this
            header. */}

        {/* There is deliberately no group 3-dot in the thread header any more.
            It used to carry Exit / Delete Group for builder and area rooms; those
            moved into the group-info sheet, and the only items left (Share link /
            PDF / QR / Gallery) all act on a linked project, which builder and area
            rooms do not have — so the button could only ever open an empty sheet.
            Project rooms still reach those items from the dots on the blue banner
            below, which drive the same showRoomMenu state. */}

        {/* AI 3-dot dropdown (End Chat / Exit Chat) */}
        {aiActive && showAiMenu && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAiMenu(false)} />
            <View style={s.menu}>
              <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); setShowDisappear(true); }}>
                <Clock size={15} color={colors.muted2} />
                <Text style={s.menuText}>Disappearing messages</Text>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.brand }}>{disappearLabel(disappearMs)}</Text>
              </Pressable>
              <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiEndChat(); }}>
                <X size={15} color={colors.muted2} /><Text style={s.menuText}>End Chat</Text>
              </Pressable>
              <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiExitChat(); }}>
                <LogOut size={15} color={colors.muted2} /><Text style={s.menuText}>Exit Chat</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* Project-media menu, opened only by the banner dots now that the header
            dots are gone. The media actions used to sit behind a nested "Project
            media" item, so the first tap showed only two options and the download
            actions needed a second hop.
            Exit Group / Delete Group used to be here too. They now live ONLY in
            the group-info sheet, so each action exists in exactly one place
            instead of the menu and the sheet both offering it. */}
        {showRoomMenu && (
          <View style={s.menu}>
            {hasProjectMedia && (
              <>
                <Pressable style={s.menuItem} onPress={handleShareLink}>
                  <LinkIcon size={15} color={colors.muted2} /><Text style={s.menuText}>Share link</Text>
                </Pressable>
                <Pressable style={s.menuItem} onPress={handleDownloadPdf}>
                  <FileText size={15} color={colors.muted2} /><Text style={s.menuText}>Download PDF</Text>
                </Pressable>
                <Pressable style={s.menuItem} onPress={handleDownloadQr}>
                  <QrCode size={15} color={colors.muted2} /><Text style={s.menuText}>Download QR</Text>
                </Pressable>
                <Pressable style={s.menuItem} onPress={handleDownloadGallery}>
                  <ImageIcon size={15} color={colors.muted2} /><Text style={s.menuText}>Download Gallery</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>
      )}

      {/* Headerless mode: AI 3-dot row below the hub's tab row.
          This row used to also carry the "My Post" and "Matching" pills (filled
          green / orange-bordered). They now live at the right-hand end of the
          hub's single sub-row, alongside the Groups · Chats tabs and keeping this
          exact pill styling, because the user asked for all four controls on one
          line — keeping them here as well would have shown each action twice.
          aiPost / aiMatching are untouched; the hub calls them through
          onActionsReady. Only the 3-dot menu stays, because its dropdown
          is anchored inside this component, so the row is now rendered only when
          AI mode is actually active (it was `headerless && aiAllowed` before,
          which kept an empty bar on screen once the pills were gone).
          Known consequence: the whole ~42px bar now mounts/unmounts with AI mode
          and shifts the thread down/up, where before the bar was stable and only
          the 3-dot inside it toggled. Accepted over painting an empty white strip.
          `aiAllowed` is kept for readability even though aiActive = aiMode &&
          aiAllowed already implies it. */}
      {headerless && aiAllowed && aiActive && (
        <View style={s.aiActionBar}>
          <Pressable onPress={() => setShowAiMenu(v => !v)} style={s.headerAiDots}>
            <MoreVertical size={18} color={colors.ink} />
          </Pressable>
        </View>
      )}

      {/* AI 3-dot menu (Disappearing / End / Exit) appears when AI is active */}
      {headerless && aiAllowed && aiActive && showAiMenu && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAiMenu(false)} />
          <View style={s.menu}>
            <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); setShowDisappear(true); }}>
              <Clock size={15} color={colors.muted2} />
              <Text style={s.menuText}>Disappearing messages</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.brand }}>{disappearLabel(disappearMs)}</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiEndChat(); }}>
              <X size={15} color={colors.muted2} /><Text style={s.menuText}>End Chat</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiExitChat(); }}>
              <LogOut size={15} color={colors.muted2} /><Text style={s.menuText}>Exit Chat</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Property banner — the group's linked project, straight from the DB.
          Shows the cover image plus every detail that exists on the project, so
          the group always reflects the latest property data. */}
      {proj && (
        <View style={s.banner}>
          {proj.media?.coverImage?.url ? (
            <Image source={{ uri: proj.media.coverImage.url }} style={s.bannerThumb} />
          ) : (
            <View style={s.bannerIcon}><Building2 size={16} color={colors.blueText} /></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.bannerName} numberOfLines={1}>{proj.projectName || activeRoom.name}</Text>

            {!![proj.location, proj.city].filter(Boolean).length && (
              <Text style={s.bannerMeta} numberOfLines={1}>
                📍 {[proj.location, proj.city].filter(Boolean).join(', ')}
              </Text>
            )}

            <Text style={s.bannerMeta} numberOfLines={1}>
              {[
                proj.pricing?.startingPrice ? `💰 ${fmtPrice(proj.pricing.startingPrice)}+` : '',
                proj.configuration?.bhkOptions?.length ? `🏠 ${proj.configuration.bhkOptions.join('/')}` : '',
                proj.configuration?.carpetAreaRange || proj.configuration?.plotSizeRange
                  ? `📐 ${proj.configuration.carpetAreaRange || proj.configuration.plotSizeRange}` : '',
              ].filter(Boolean).join('  ')}
            </Text>

            <Text style={s.bannerMeta} numberOfLines={1}>
              {[
                proj.propertyType || proj.category ? `🏷️ ${proj.propertyType || proj.category}` : '',
                proj.projectStatus ? `🔄 ${proj.projectStatus}` : '',
                proj.pricing?.bankLoanAvailable ? '🏦 Loan' : '',
                proj.reraNumber || proj.reraApproved ? '📑 RERA' : '',
              ].filter(Boolean).join('  ')}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowRoomMenu(v => !v)}
            style={s.bannerMenuBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Group options"
          >
            <MoreVertical size={18} color={colors.blueText} />
          </Pressable>
        </View>
      )}

      {/* ── Company group: that builder's properties ──
          A company group's purpose is to show what the builder has, so their
          published properties sit above the conversation. Details answers "what
          is this"; Open Group goes to that property's own discussion, which is
          how property groups stay reachable now that the list is by company. ── */}
      {activeRoom.roomType === 'builder' && (
        <View style={bp.strip}>
          <View style={bp.stripHead}>
            <Building2 size={12} color={colors.brand} />
            <Text style={bp.stripTitle}>Properties</Text>
            {builderProjects.length > 0 && (
              <Text style={bp.stripCount}>{builderProjects.length}</Text>
            )}
          </View>

          {loadingBuilderProjects ? (
            <ActivityIndicator color={colors.brand} style={{ paddingVertical: 12 }} />
          ) : builderProjects.length === 0 ? (
            <Text style={bp.stripEmpty}>No published properties yet.</Text>
          ) : (
            <ScrollView
              ref={builderScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={bp.stripRow}
              // These two feed the auto-scroll effect's start condition. They are
              // the only signal that can report "the ScrollView exists and has a
              // size" through state — the old effect tested builderScrollRef,
              // which can never trigger a re-run (see the effect's comment).
              onLayout={e => {
                const w = e.nativeEvent.layout.width;
                setStripMetrics(m => (m.viewport === w ? m : { ...m, viewport: w }));
              }}
              onContentSizeChange={w => {
                setStripMetrics(m => (m.content === w ? m : { ...m, content: w }));
              }}
              onTouchStart={pauseAutoScroll}
              onTouchEnd={scheduleResume}
              onScrollBeginDrag={pauseAutoScroll}
              onScrollEndDrag={scheduleResume}
              // Keep the timer's idea of "where we are" in sync with a manual
              // swipe. Without this the first auto-tick after a swipe yanked the
              // strip back to whatever index the timer last set.
              onMomentumScrollEnd={e => {
                const stride = cardStride(stripMetrics.content, builderProjects.length);
                const maxOffset = Math.max(0, stripMetrics.content - stripMetrics.viewport);
                const x = e.nativeEvent.contentOffset.x;
                // At the very end the offset is a CLAMPED one (maxOffset is not a
                // whole number of strides), so rounding it would report an index
                // one short of the end and the next tick would re-request the same
                // position — a dead beat before the loop. Snap to the first index
                // that the tick's own clamp maps onto maxOffset instead, so the
                // next tick wraps home.
                currentCardIndex.current = x >= maxOffset - 1 && maxOffset > 0
                  ? Math.ceil(maxOffset / stride)
                  : Math.max(0, Math.round(x / stride));
              }}
            >
              {/* Details now goes through handlePropertyViewDetails, the SAME path
                  the inventory cards use. It used to call a local compact handler
                  that built a four-field `compact: true` sheet — and because the
                  media block is gated on !compact, the gallery, videos, brochure
                  and layout of a builder's own property never rendered.
                  handleBuilderCardDetails is the wrapper that adds the pending flag
                  and the card-data fallback that path needs. */}
              {builderProjects.map(project => (
                <BuilderPropertyCard
                  key={project.id}
                  project={project}
                  opening={joiningId === project.id}
                  sharing={sharingId === project.id}
                  loadingDetails={detailsId === project.id}
                  onDetails={handleBuilderCardDetails}
                  onOpenGroup={handleOpenProjectGroup}
                  onShare={(p) => handleShareProject(p.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Tap-catcher to close the menu */}
      {showRoomMenu && (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowRoomMenu(false)} />
      )}

      {/* Messages — the group chat is ALWAYS the base view. */}
      {loadingMsgs ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 14, gap: 10 }}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            onScrollToIndexFailed={(info) => {
              // Avoid computing a negative offset when the message was deleted
              // between detail-sheet open and close (findIndex returns -1).
              if (info.index >= 0 && flatRef.current) {
                flatRef.current.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true,
                });
              }
            }}
            renderItem={renderMessage}
          />

          {/* ── AI Assist (inline, private) — overlays the message area while
              active. Runs the existing AI Lead Matching assistant via the user's
              own private thread (leadChatApi); other members see nothing. Only a
              shared match becomes public. Uses the SAME group composer below. ── */}
          {aiActive && (
            <View style={s.aiOverlay}>
              {/* AI actions moved to the Universal Group header (Post / Matching / 3-dot). */}
              <View style={{ flex: 1 }}>
                <AiAssistant
                  hideOwnChrome
                  disappearMs={disappearMs}
                  groupContext={{ roomId: activeRoom.id, roomName: roomDisplayName(activeRoom) }}
                  onTemplateChange={handleAiTemplate}
                  onReady={handleAiReady}
                  onMatchShared={noop}
                  onViewProject={handleViewMatchedProject}
                  onViewInventoryMatch={handleViewInventoryMatch}
                  onJoinProjectGroup={handleJoinPropertyGroup}
                />
              </View>
            </View>
          )}

          {/* The floating "AI Lead Assist" button was removed — the Sell / Buy /
              Rent starter chips above the composer are now the entry point. */}
        </View>
      )}

      {/* ── Sell / Buy / Rent starters ──
          Sits right above the input on the AI Lead Matching landing page, so a
          new user immediately sees what this section does. Tapping one opens the
          assistant with that intent already answered, continuing the flow. ── */}
      {!aiActive && aiAllowed && (
        <View style={ip.stripWrap}>
          <Text style={ip.stripLabel}>Shuru karein — tap karein</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ip.stripRow}
            keyboardShouldPersistTaps="handled"
          >
            {([
              // `v` is the intent sent to the assistant — only the label is
              // presentational, so these values must stay as they are.
              { v: 'buy', icon: '🔑', label: 'Buy Property' },
              { v: 'sell', icon: '🏷️', label: 'Sell Property' },
              { v: 'rent', icon: '🏠', label: 'Rent Property' },
            ] as const).map((opt) => (
              <Pressable key={opt.v} style={ip.chip} onPress={() => aiStartWithIntent(opt.v)}>
                <Text style={ip.chipIcon}>{opt.icon}</Text>
                <Text style={ip.chipText}>{opt.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Composer — the SINGLE input box. Routes to the group when in normal
          mode, and to the AI assistant when AI mode is active.
          Hidden while the assistant question renders its OWN input (option
          chips, the amount + unit picker, city/locality search) or is in a
          locked state. Without this gate the rich control and this composer both
          showed, giving two stacked input rows. */}
      {!(aiActive && aiOwnsInput({ inputType: aiInputType })) && (
      <View style={s.composer}>
        {/* Attachment options: Camera / Gallery / Files (group mode only) */}
        {!aiActive && showAttachMenu && canUploadMedia && (
          <View style={s.attachRow}>
            <Pressable onPress={pickFromCamera} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#EFF6FF' }]}><Camera size={17} color="#2563EB" /></View>
              <Text style={s.attachLabel}>Camera</Text>
            </Pressable>
            <Pressable onPress={pickFromGallery} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#F0FDF4' }]}><ImageIcon size={17} color={colors.greenText} /></View>
              <Text style={s.attachLabel}>Gallery</Text>
            </Pressable>
            <Pressable onPress={pickFile} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#FFF8F0' }]}><FileText size={17} color={colors.brand} /></View>
              <Text style={s.attachLabel}>PDF</Text>
            </Pressable>
          </View>
        )}

        <View style={s.textRow}>
          {!aiActive ? (
            canUploadMedia ? (
              <Pressable
                onPress={() => setShowAttachMenu(v => !v)}
                disabled={uploading}
                style={[s.attachBtn, showAttachMenu && { backgroundColor: colors.brandTint }]}
              >
                {uploading
                  ? <ActivityIndicator size="small" color={colors.brand} />
                  : <Paperclip size={18} color={showAttachMenu ? colors.brand : colors.muted2} />}
              </Pressable>
            ) : null
          ) : (
            <View style={[s.attachBtn, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
              <Sparkles size={16} color={colors.brand} />
            </View>
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={aiActive ? 'Answer the AI…' : 'Type a message…'}
            placeholderTextColor={colors.muted}
            style={s.textInput}
            multiline
            onSubmitEditing={handleComposerSend}
          />
          <Pressable onPress={handleComposerSend} disabled={!text.trim()} style={[s.sendBtn, !text.trim() && { opacity: 0.4 }]}>
            <Send size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
      )}

      {/* Requirement composer sheet */}
      <RequirementSheet
        visible={postMode === 'requirement'}
        form={reqForm}
        setForm={setReqForm}
        onClose={() => setPostMode('text')}
        onSubmit={postRequirement}
      />

      {/* Inventory composer sheet */}
      <InventorySheet
        visible={postMode === 'inventory'}
        form={invForm}
        setForm={setInvForm}
        onClose={() => setPostMode('text')}
        onSubmit={postInventory}
      />

      {/* ── Post view — lists ALL properties the user has posted so far, plus
          (if present) the current AI-collected draft as a postable card. Each
          card is compact with an expand toggle for full details. ── */}
      <Modal visible={showPost} transparent animationType="slide" onRequestClose={() => setShowPost(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowPost(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Building2 size={18} color={colors.greenText} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>My Posts</Text>
                <Text style={pd.headSub}>{postedCards.length} posted{postDraft ? ' · 1 ready to post' : ''} · AI Assist</Text>
              </View>
              <Pressable onPress={() => setShowPost(false)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            {/* Loading state. Both loads used to be fired WITHOUT await and with
                no indicator, so the sheet opened on an empty body with "0 posted"
                in the header and the cards plus the real count appeared a second
                later — which is what "posts load lene me time lagta hai / tut
                gaya" was describing. The sheet still opens immediately (so its
                slide animation is not held up by the network); only the body
                waits, and it says so. Shown only while there is genuinely nothing
                to show yet — a re-open that already has cards keeps rendering
                them rather than flashing a spinner over them. */}
            {postsLoading && postedCards.length === 0 && !postDraft ? (
              <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator color={colors.brand} size="large" />
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 12 }}>Loading your posts…</Text>
              </View>
            ) : (
            <ScrollView
              /* flexShrink: 1, not a percentage maxHeight. `maxHeight: '78%'`
                 could not resolve to anything meaningful: pd.sheet has NO definite
                 height (it is content-driven and only clamped by
                 maxHeight: '88%'), so a percentage on its child had no definite
                 base to resolve against. The list was laid out at a height
                 unrelated to the space the sheet actually had, the sheet's own 88%
                 clamp then cut the third card through its button row, and the
                 sheet space left under the cropped list painted plain white —
                 the "blank ghagha" in the screenshot.

                 flexShrink: 1 makes the list give way to the real available space
                 instead (RN defaults children to flexShrink: 0), so it fills the
                 sheet, scrolls through every post, and still lets the sheet sit
                 short when the user has only one or two. Same fix and same
                 reasoning as the group-info FlatList and the Your Matches list. */
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {/* Draft ready to post (from the current AI conversation) */}
              {postDraft && (
                <PostCard
                  item={{ title: postDraft.title, subtitle: postDraft.subtitle, price: postDraft.price, tags: postDraft.fields.filter(f => /bhk|area|type/i.test(f.label)).map(f => f.value) }}
                  posted={false}
                  cooldownLeftMs={0}
                  posting={postingDraft}
                  onPost={publishDraft}
                  onView={() => setViewProperty({ title: postDraft.title, subtitle: postDraft.subtitle, price: postDraft.price, fields: postDraft.fields })}
                />
              )}

              {/* Already-posted properties. Source = owned real Projects plus
                  this user's backend ExtractedLead inventory, so My Posts is
                  complete and survives reinstall. Local storage is consulted
                  only for the per-property 8h re-post cooldown. */}
              {postedCards.map((disp: any) => {
                // Cooldown comes from whichever local record matches this lead —
                // by leadId first, else by the property's title+location.
                const local = postedList.find((x: any) =>
                  (x.projectId && disp.projectId && String(x.projectId) === String(disp.projectId)) ||
                  (x.leadId && x.leadId === disp.id) ||
                  (x.title && disp.title && x.title === disp.title && x.subtitle === disp.subtitle)
                );
                const postedAt = local?.postedAt || 0;
                const leftMs = postedAt ? Math.max(0, POST_COOLDOWN_MS - (Date.now() - postedAt)) : 0;
                const backendProjectId = disp.projectId || local?.projectId;
                const backend = backendProjectId
                  ? myProjects.find((p) => String(p.id) === String(backendProjectId))
                  : null;
                return (
                  <PostCard
                    key={disp.id}
                    item={disp}
                    posted
                    cooldownLeftMs={leftMs}
                    posting={false}
                    onPost={() => {
                      // Re-post this property's card into the group (after cooldown).
                      if (backend) repostProject(backend, disp);
                      else repostFromEntry({ ...(local || {}), leadId: disp.id, title: disp.title, subtitle: disp.subtitle, price: disp.price, fields: disp.fields, isSellable: true, intent: 'sell' }, disp);
                    }}
                    onView={() => setViewProperty(disp)}
                  />
                );
              })}

              {postedCards.length === 0 && !postDraft && (
                <Text style={pd.empty}>Abhi tak koi property post nahi ki. AI ko apni sell/rent property batayein, phir yahan se post karein.</Text>
              )}
            </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── View Property detail sheet ── */}
      <Modal visible={!!viewProperty} transparent animationType="slide" onRequestClose={handleClosePropertyDetail}>
        <Pressable style={pd.overlay} onPress={handleClosePropertyDetail}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <View style={pd.cardIcon}><Building2 size={22} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle} numberOfLines={1}>{viewProperty?.title || 'Property'}</Text>
                {viewProperty?.subtitle ? <Text style={pd.headSub} numberOfLines={1}>📍 {viewProperty.subtitle}</Text> : null}
              </View>
              {viewProperty?.price ? <Text style={pd.cardPrice}>{viewProperty.price}</Text> : null}
              {/* Admin Edit button — role-gated. Previous behavior: property details
                  were read-only for everyone. New: admins see an Edit button that
                  opens the web dashboard edit screen, matching the Projects list
                  3-dot menu pattern. Non-admins see no Edit button at all. */}
              {user?.role === 'admin' && viewProperty?.shareProjectId && (
                <Pressable
                  onPress={() => {
                    const editUrl = `https://sales.homeintown.in/dashboard/projects/${viewProperty.shareProjectId}/edit`;
                    Linking.openURL(editUrl).catch(() => toast.show('Could not open edit page', 'error'));
                  }}
                  style={[pd.shareBtn, { marginRight: 8 }]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Edit property"
                >
                  <Edit3 size={16} color={colors.brand} />
                </Pressable>
              )}
              {/* Share is offered only when the sheet was built from a real
                  project. Card-only fallbacks and lead/match sheets have nothing
                  shareable, so no button appears there. */}
              {!!viewProperty?.shareProjectId && (
                <Pressable
                  onPress={() => handleShareProject(viewProperty.shareProjectId)}
                  disabled={sharingId === viewProperty.shareProjectId}
                  style={[pd.shareBtn, sharingId === viewProperty.shareProjectId && { opacity: 0.6 }]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Share ${viewProperty?.title || 'property'}`}
                >
                  {sharingId === viewProperty.shareProjectId
                    ? <ActivityIndicator size="small" color={colors.brand} />
                    : <Share2 size={16} color={colors.brand} />}
                </Pressable>
              )}
              <Pressable onPress={handleClosePropertyDetail} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 6, gap: 12 }} showsVerticalScrollIndicator={false}>
              {/* Cover image at the top */}
              {!!viewProperty?.image && (
                <Image source={{ uri: viewProperty.image }} style={pd.detailHero} resizeMode="cover" />
              )}

              {/* Clean action-button list replaces all text detail sections. Previous
                  behavior: showed text sections (Overview/Pricing/Configuration/
                  Amenities/Contact) with ~20+ fields, most empty, making the sheet
                  verbose and hard to scan. User requirement: "jo abhi details dhik
                  rahi he vo remove krna he" — remove the text details entirely and
                  show only actionable buttons. Each button opens/downloads the
                  resource or triggers the relevant action. Buttons appear ONLY when
                  the resource exists, so an empty section never renders. */}
              
              {/* Gallery section */}
              {viewProperty?.galleryImages?.length > 0 && (
                <View style={pd.actionSection}>
                  <Text style={pd.actionSectionTitle}>
                    📷 Gallery ({viewProperty.galleryImages.length} photos)
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {viewProperty.galleryImages.map((url: string, i: number) => (
                      <Pressable key={`${url}-${i}`} onPress={() => Linking.openURL(url)}>
                        <Image source={{ uri: url }} style={pd.mediaThumb} resizeMode="cover" />
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Action buttons — each row is icon + label, all brand-orange on white */}
              <View style={pd.actionSection}>
                {viewProperty?.brochureUrl && (
                  <Pressable
                    style={pd.actionRow}
                    onPress={() => Linking.openURL(viewProperty.brochureUrl).catch(() => toast.show('Could not open brochure', 'error'))}
                  >
                    <FileText size={18} color={colors.brand} />
                    <Text style={pd.actionLabel}>Download Brochure</Text>
                    <Download size={14} color={colors.muted} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                )}

                {viewProperty?.layoutImage && (
                  <Pressable
                    style={pd.actionRow}
                    onPress={() => Linking.openURL(viewProperty.layoutImage).catch(() => toast.show('Could not open layout', 'error'))}
                  >
                    <ImageIcon size={18} color={colors.brand} />
                    <Text style={pd.actionLabel}>View Layout Plan</Text>
                    <Download size={14} color={colors.muted} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                )}

                {(viewProperty?.videos || []).map((url: string, i: number) => (
                  <Pressable
                    key={`${url}-${i}`}
                    style={pd.actionRow}
                    onPress={() => Linking.openURL(url).catch(() => toast.show('Could not open video', 'error'))}
                  >
                    <FileText size={18} color={colors.brand} />
                    <Text style={pd.actionLabel}>Watch Video {i + 1}</Text>
                    <Eye size={14} color={colors.muted} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                ))}

                {viewProperty?.shareProjectId && (
                  <Pressable
                    style={pd.actionRow}
                    onPress={() => handleShareProject(viewProperty.shareProjectId)}
                    disabled={sharingId === viewProperty.shareProjectId}
                  >
                    {sharingId === viewProperty.shareProjectId ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Share2 size={18} color={colors.brand} />
                    )}
                    <Text style={pd.actionLabel}>Share Property Link</Text>
                    <LinkIcon size={14} color={colors.muted} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                )}

                {(viewProperty?.googleMapLink || (viewProperty?.latitude && viewProperty?.longitude)) && (
                  <Pressable
                    style={pd.actionRow}
                    onPress={() => {
                      const url = viewProperty.googleMapLink || 
                        `https://www.google.com/maps/search/?api=1&query=${viewProperty.latitude},${viewProperty.longitude}`;
                      Linking.openURL(url).catch(() => toast.show('Could not open maps', 'error'));
                    }}
                  >
                    <MapPin size={18} color={colors.brand} />
                    <Text style={pd.actionLabel}>Open in Maps</Text>
                    <Eye size={14} color={colors.muted} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                )}

                {/* Edit button — admin only, opens web dashboard edit URL. Previous behavior:
                    no edit access from property detail sheet in group chat. User requirement:
                    "admin edit kr ske" — admin needs ability to edit project from group context.
                    canManageRoomAvatar allows platform admins, group creators, and room admins to
                    moderate all projects in their group. This is intentional: builders who create
                    groups need the ability to moderate any property posted in their community,
                    not just their own properties. */}
                {viewProperty?.projectId && canManageRoomAvatar && (
                  <Pressable
                    style={pd.actionRow}
                    onPress={() => {
                      const editUrl = `https://sales.homeintown.in/dashboard/projects/${viewProperty.projectId}/edit`;
                      Linking.openURL(editUrl).catch(() => toast.show('Could not open editor', 'error'));
                    }}
                  >
                    <Pencil size={18} color={colors.brand} />
                    <Text style={pd.actionLabel}>Edit Project</Text>
                    <ExternalLink size={14} color={colors.muted} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                )}

                {/* Always show even if empty, so the sheet never looks completely blank */}
                {!viewProperty?.brochureUrl && !viewProperty?.layoutImage && 
                 (viewProperty?.videos || []).length === 0 && !viewProperty?.googleMapLink && 
                 !viewProperty?.latitude && (viewProperty?.galleryImages || []).length === 0 && (
                  <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: colors.muted }}>No resources available for this property yet.</Text>
                  </View>
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Group info (WhatsApp-style) ──
          Opened by tapping the thread header. Before this there was no way to see
          who is in a group, who runs it, or what has been shared in it — and Exit
          Group / Delete Group were buried in the 3-dot menu, which is where the
          user did not expect them. Both actions live here now, and ONLY here.

          The root scroller is a FlatList over the members, with everything above
          them in ListHeaderComponent and the group actions in ListFooterComponent.
          A .map() of members inside a ScrollView would render every row of a large
          group up front; nesting a FlatList inside a ScrollView would warn and
          defeat virtualization outright. ── */}
      <Modal visible={showGroupInfo} transparent animationType="slide" onRequestClose={() => setShowGroupInfo(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowGroupInfo(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Users size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>Group info</Text>
                <Text style={pd.headSub} numberOfLines={1}>{roomDisplayName(activeRoom)}</Text>
              </View>
              <Pressable onPress={() => setShowGroupInfo(false)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            <FlatList
              // flexShrink (not a percentage maxHeight): pd.sheet is already
              // capped at 88% of the overlay, and RN children default to
              // flexShrink: 0 — without this the list would size to ALL its rows
              // and get clipped by the sheet instead of scrolling inside it.
              style={{ flexShrink: 1 }}
              data={infoMembers}
              keyExtractor={(m, i) => `${m.user.id || 'member'}-${i}`}
              contentContainerStyle={{ paddingBottom: 12 }}
              showsVerticalScrollIndicator
              ListHeaderComponent={(
                <View style={gi.header}>
                  {/* The only entry point to the profile-picture sheet, the way
                      WhatsApp does it: tap the group's avatar in group info.

                      It is a Pressable ONLY for a caller who may actually change
                      the picture; everyone else gets a plain View with the same
                      style. Deliberately not a Pressable with no onPress — that
                      still announces itself as a button to TalkBack, which is a
                      lie to exactly the users who cannot see that nothing
                      happened. Same reasoning the Project-map card body records.

                      To be clear about what this is NOT: hiding the tap target
                      is not the permission check. The server refuses a
                      non-admin with 403 regardless, and would still refuse if
                      this branch were deleted.

                      Both branches render the SAME groupInfoAvatar element (a
                      shared RoomAvatar, built above). They each used to carry
                      their own copy of the image/emoji markup, and neither copy
                      had an onError or a localUri hop — so a 70×70 blank circle
                      was the normal offline outcome right where the user goes to
                      change the picture. */}
                  {canManageRoomAvatar ? (
                    <Pressable
                      style={gi.avatar}
                      onPress={() => setShowProfilePicModal(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Change group profile picture"
                    >
                      {groupInfoAvatar}
                    </Pressable>
                  ) : (
                    <View style={gi.avatar}>{groupInfoAvatar}</View>
                  )}
                  <View style={gi.nameRow}>
                    <Text style={gi.name} numberOfLines={2}>{roomDisplayName(activeRoom)}</Text>
                    {/* Green stays the verification colour everywhere in the app. */}
                    {activeRoom.builder?.isVerified && <BadgeCheck size={16} color={colors.greenText} />}
                  </View>
                  <Text style={gi.counts}>
                    {[
                      `${infoMembers.length} member${infoMembers.length !== 1 ? 's' : ''}`,
                      // Builder rooms only: a project room IS one property, so
                      // "18 projects" there would be nonsense.
                      activeRoom.roomType === 'builder' && builderProjects.length > 0
                        ? `${builderProjects.length} project${builderProjects.length !== 1 ? 's' : ''}`
                        : '',
                      activeRoom.builder?.isVerified ? 'Verified' : '',
                    ].filter(Boolean).join(' · ')}
                  </Text>

                  {infoAdmins.length > 0 && (
                    <View style={gi.block}>
                      <Text style={gi.blockTitle}>{infoAdmins.length === 1 ? 'Admin' : 'Admins'}</Text>
                      {infoAdmins.map((m, i) => (
                        <Text key={`${m.user.id || 'admin'}-${i}`} style={gi.adminLine} numberOfLines={1}>
                          {m.user.name || 'Member'}
                          {m.user.companyName ? ` · ${m.user.companyName}` : ''}
                        </Text>
                      ))}
                    </View>
                  )}

                  {/* Media & Links. The endpoint ships in the backend phase, so a
                      failure resolves to an empty list — this section is never an
                      error, and it never invents data it does not have. */}
                  <View style={gi.block}>
                    <Text style={gi.blockTitle}>Media & Links</Text>
                    {loadingGroupMedia ? (
                      <ActivityIndicator color={colors.brand} style={{ alignSelf: 'flex-start', paddingVertical: 6 }} />
                    ) : !groupMedia || (groupMedia.media.length === 0 && groupMedia.links.length === 0) ? (
                      <Text style={gi.emptyText}>Nothing shared in this group yet.</Text>
                    ) : (
                      <>
                        {groupMedia.media.length > 0 && (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                            {groupMedia.media.map(item => (
                              item.messageType === 'image' ? (
                                <Pressable key={item.id} onPress={() => Linking.openURL(item.url).catch(() => {})}>
                                  <Image source={{ uri: item.url }} style={pd.mediaThumb} resizeMode="cover" />
                                </Pressable>
                              ) : (
                                <Pressable key={item.id} style={pd.mediaBtn} onPress={() => Linking.openURL(item.url).catch(() => {})}>
                                  <FileText size={13} color={colors.brand} />
                                  <Text style={pd.mediaBtnText} numberOfLines={1}>{item.name || 'Document'}</Text>
                                </Pressable>
                              )
                            ))}
                          </ScrollView>
                        )}
                        {groupMedia.links.length > 0 && (
                          <View style={gi.linkList}>
                            {groupMedia.links.map(link => (
                              <Pressable key={link.id} onPress={() => Linking.openURL(link.url).catch(() => {})}>
                                <Text style={gi.linkText} numberOfLines={1}>{link.url}</Text>
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  <Text style={gi.blockTitle}>
                    {infoMembers.length === 1 ? 'Member' : 'Members'}
                  </Text>
                </View>
              )}
              renderItem={({ item: m }) => {
                const isMe = !!user?.id && m.user.id === user.id;
                const phone = m.user.phone;
                return (
                  <View style={gi.memberRow}>
                    <View style={gi.memberAvatar}>
                      <Text style={gi.memberInitial}>{(m.user.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={gi.memberName} numberOfLines={1}>
                        {m.user.name || 'Member'}{isMe ? ' (You)' : ''}
                      </Text>
                      <Text style={gi.memberMeta} numberOfLines={1}>
                        {[m.user.role, m.user.companyName].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {m.role === 'admin' && (
                      <View style={gi.adminPill}><Text style={gi.adminPillText}>Admin</Text></View>
                    )}
                    {/* Call / WhatsApp appear only when the server actually sent a
                        number for this member — it strips phone outside builder and
                        project rooms. Never gate these on roomType here instead:
                        that would hide the UI while still shipping the numbers. */}
                    {!!phone && !isMe && (
                      <>
                        <Pressable
                          onPress={() => handleMemberCall(phone)}
                          style={gi.contactBtn}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`Call ${m.user.name || 'member'}`}
                        >
                          <Phone size={13} color={colors.brand} />
                        </Pressable>
                        <Pressable
                          onPress={() => handleMemberWhatsApp(phone)}
                          style={[gi.contactBtn, gi.contactBtnWa]}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`WhatsApp ${m.user.name || 'member'}`}
                        >
                          <MessageCircle size={13} color={colors.greenText} />
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={gi.emptyText}>No members to show.</Text>}
              ListFooterComponent={(
                // Exactly the same canLeave / canDelete derivations the 3-dot menu
                // used, and the same handleLeave / handleDelete. Moving where an
                // action lives must not change who is allowed to perform it.
                (canLeave || canDelete) ? (
                  <View style={gi.actions}>
                    {canLeave && (
                      <Pressable style={gi.actionRow} onPress={handleLeave} accessibilityRole="button">
                        <LogOut size={16} color={colors.muted2} />
                        <Text style={gi.actionText}>Exit Group</Text>
                      </Pressable>
                    )}
                    {canDelete && (
                      <Pressable style={gi.actionRow} onPress={handleDelete} accessibilityRole="button">
                        <Trash2 size={16} color={colors.red} />
                        <Text style={[gi.actionText, { color: colors.red }]}>Delete Group</Text>
                      </Pressable>
                    )}
                  </View>
                ) : null
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Share sheet (tracked link, QR, brochure) for a builder's property —
          opened from the card's Share icon or the detail sheet's Share button.
          Join Group button appears only in property groups (roomType === 'project'),
          not in builder or area rooms, because property groups are the discussion space
          for a specific property's interested buyers. */}
      {shareProject && (
        <ShareModal
          project={shareProject}
          onClose={() => setShareProject(null)}
          showJoinGroup={activeRoom?.roomType === 'project'}
          onJoinGroup={() => {
            if (shareProject?.id) {
              handleJoinPropertyGroup(shareProject.id);
            }
          }}
        />
      )}

      {/* ── Disappearing messages options (WhatsApp-style) ── */}
      <Modal visible={showDisappear} transparent animationType="slide" onRequestClose={() => setShowDisappear(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowDisappear(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Clock size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>Disappearing messages</Text>
                <Text style={pd.headSub}>AI Assist ke messages chosen time ke baad apne aap gayab honge</Text>
              </View>
              <Pressable onPress={() => setShowDisappear(false)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>
            <View style={{ gap: 2 }}>
              {DISAPPEAR_OPTIONS.map(opt => (
                <Pressable
                  key={opt.ms}
                  style={dp.optRow}
                  onPress={async () => {
                    setDisappearMs(opt.ms);
                    await disappearStorage.set(opt.ms);
                    setShowDisappear(false);
                    toast.show(opt.ms ? `Messages disappear after ${opt.label}` : 'Disappearing off', 'success');
                  }}
                >
                  <Text style={dp.optLabel}>{opt.label}</Text>
                  {disappearMs === opt.ms && <Check size={17} color={colors.brand} />}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Off-screen QR renderer used only by Download QR. It is deliberately
          not a modal, so choosing a specific menu action never opens the generic
          Share bottom sheet shown in the bug screenshot. */}
      {qrExport && (
        <View pointerEvents="none" style={s.qrExporter}>
          <QRCode
            value={qrExport.url}
            size={320}
            color={colors.night}
            backgroundColor={colors.white}
            quietZone={16}
            getRef={(node: any) => { qrRef.current = node; }}
          />
        </View>
      )}

      {/* ── Lead detected from a free-text message (like the website) ──
          Shows the parsed requirement; confirming runs matching + saves the lead. */}
      <Modal visible={!!leadDetect} transparent animationType="slide" onRequestClose={() => setLeadDetect(null)}>
        <Pressable style={ld.overlay} onPress={() => setLeadDetect(null)}>
          <Pressable style={ld.sheet} onPress={() => {}}>
            <View style={ld.head}>
              <Sparkles size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={ld.title}>Requirement detected</Text>
                <Text style={ld.sub}>Aapke message se ye detail mili — confirm karke match dekhein</Text>
              </View>
              <Pressable onPress={() => setLeadDetect(null)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            {(() => {
              const p = leadDetect?.extraction?.params || {};
              const intent = leadDetect?.extraction?.intent || 'requirement';
              const rows: { label: string; value: string }[] = [];
              const push = (label: string, v: any) => { if (v != null && String(v).trim()) rows.push({ label, value: String(v) }); };
              push('Looking to', intent === 'inventory' ? 'Sell / List' : 'Buy / Rent');
              push('Property type', p.propertyType);
              push('BHK', p.bhkType);
              push('Location', p.location || p.locationRaw);
              push('City', p.city);
              push('Budget', p.budget ? `₹${p.budget}L${p.budgetMax ? ` – ₹${p.budgetMax}L` : ''}` : '');
              push('Possession', p.possessionNeeded);
              return (
                <View style={ld.card}>
                  {rows.length ? rows.map((r, i) => (
                    <View key={i} style={ld.row}>
                      <Text style={ld.rowLabel}>{r.label}</Text>
                      <Text style={ld.rowValue} numberOfLines={1}>{r.value}</Text>
                    </View>
                  )) : <Text style={ld.rowValue}>Basic requirement detected.</Text>}
                </View>
              );
            })()}

            <View style={ld.actions}>
              <Pressable onPress={() => setLeadDetect(null)} style={ld.dismissBtn}>
                <Text style={ld.dismissText}>Dismiss</Text>
              </Pressable>
              <Pressable onPress={confirmDetectedLead} disabled={confirmingLead} style={[ld.findBtn, confirmingLead && { opacity: 0.6 }]}>
                {confirmingLead
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Search size={14} color="#fff" /><Text style={ld.findText}>Find Matches</Text></>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Your Matches ──
          Opened by the hub's Matching pill. Rows are MatchResultCard, the SAME
          card the AI Assist results bubble renders, imported rather than
          re-implemented: this sheet used to draw its own `mts` lookalike that had
          already drifted (no cover image, no score pill, no Join Group) and was
          fed fabricated demo rows. Join Group runs through
          handleJoinPropertyGroup, so it works from here exactly as it does in
          the chat — wrapped to dismiss this sheet first, see the call site. ── */}
      {console.log('[MATCHING] Rendering modal, showMatching:', showMatching, 'matchingLoading:', matchingLoading, 'visibleMatches.length:', visibleMatches.length)}
      <Modal visible={showMatching} transparent animationType="slide" onRequestClose={() => { console.log('[MATCHING] Modal onRequestClose'); setShowMatching(false); }}>
        <Pressable style={pd.overlay} onPress={() => { console.log('[MATCHING] Overlay tapped'); setShowMatching(false); }}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Search size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>Your Matches</Text>
                {/* No "0 matches" line: a zero in the header reads as a failure.
                    An empty result is explained in the body instead. */}
                {/* visibleMatches, not matchingResults: the subtitle, the pill's
                    badge and the rows below are all derived from the one
                    post-filter array, so the header can never claim a match the
                    list does not show. */}
                <Text style={pd.headSub}>
                  {matchingLoading
                    ? 'Searching…'
                    : visibleMatches.length > 0
                      ? `${visibleMatches.length} ${visibleMatches.length === 1 ? 'match' : 'matches'} across your requirements`
                      : 'Lead → Inventory auto-match'}
                </Text>
              </View>
              <Pressable onPress={() => { console.log('[MATCHING] X button tapped'); setShowMatching(false); }} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            {matchingLoading ? (
              <View style={{ paddingVertical: 60, alignItems: 'center' }}>
                <ActivityIndicator color={colors.brand} size="large" />
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 12 }}>Loading your matches…</Text>
              </View>
            ) : matchingError ? (
              /* A failed request must never look like "you have no matches", so it
                 says what happened and offers a retry. */
              <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20, gap: 14 }}>
                <Text style={{ fontSize: 13, color: colors.muted2, textAlign: 'center' }}>{matchingError}</Text>
                <Pressable onPress={() => loadMyMatches()} style={ld.findBtn}>
                  <Search size={14} color="#fff" />
                  <Text style={ld.findText}>Retry</Text>
                </Pressable>
              </View>
            ) : visibleMatches.length > 0 ? (
              /* flexShrink: 1, not a fixed maxHeight. This was `maxHeight: 500` —
                 a dp constant that is dead white space below the last card on a
                 tall phone and a crop through the middle of a card on a short
                 one, because it is unrelated to the height pd.sheet actually got
                 (the sheet is content-driven, clamped at maxHeight: '88%'). RN
                 children default to flexShrink: 0, so without this the list sizes
                 to ALL its rows and the sheet's own clamp does the cropping.
                 Same reasoning as the group-info FlatList and the My Posts list. */
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }} showsVerticalScrollIndicator={false}>
                {visibleMatches.map(m => {
                  const isJoined = joinedProjectIds.has(String(m.projectId));
                  return (
                    /* Dismiss the sheet BEFORE joining. handleJoinPropertyGroup
                       ends in openRoom(), but nothing used to clear showMatching,
                       so this full-screen modal stayed on top of the thread it had
                       just opened and the tap read as a no-op apart from a toast —
                       the same "kuch bhi nahi hua" symptom this feature exists to
                       fix. The close is done HERE, not inside
                       handleJoinPropertyGroup, because the AI Assist results
                       bubble and the inventory cards share that handler and have
                       no modal in play.

                       Second round of the same report ("Join Group pe kuch nahi
                       hota"): this wiring was NOT the cause and is deliberately
                       left alone — there is one join path in this component and
                       this is it. The room really did open; what was missing was
                       its CHROME. In the AI Leads pane `aiAllowed` was decided by
                       the autoOpenUniversal prop, so the freshly opened property
                       room inherited the assistant's starter chips while
                       `headerless` hid its title and back arrow, leaving a
                       nameless thread that looked unchanged. Fixed at isAiRoom /
                       showThreadHeader instead of here. */
                    <MatchResultCard
                      key={m.projectId}
                      match={m}
                      isJoined={isJoined}
                      onJoinGroup={(id) => { setShowMatching(false); handleJoinPropertyGroup(id); }}
                    />
                  );
                })}
              </ScrollView>
            ) : (
              /* Honest empty state. The previous version reached
                 "No matching properties available" through fabricated data that
                 was always empty, so it was never telling the truth about the
                 user's account. This says what is actually missing and what to do
                 about it.

                 This branch is also where "I joined my last remaining match"
                 lands, because the chain above tests visibleMatches — so the
                 sheet shows this copy instead of an empty scroll area, and the
                 pill's badge disappears rather than rendering a 0. */
              <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24, gap: 12 }}>
                <Search size={26} color={colors.muted} />
                <Text style={{ fontSize: 13, color: colors.muted2, textAlign: 'center', lineHeight: 19 }}>
                  Koi match nahi mila abhi. Apni requirement AI Assist me complete karein — match milte hi yahan dikh jayega.
                </Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Profile Picture Upload Modal ────────────────────────────────────────── */}
      <Modal visible={showProfilePicModal} transparent animationType="slide" onRequestClose={() => setShowProfilePicModal(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowProfilePicModal(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.header}>
              <Text style={pd.title}>Update Profile Picture</Text>
              <Pressable onPress={() => setShowProfilePicModal(false)} hitSlop={8}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <View style={{ padding: 20, gap: 24 }}>
              {/* Upload Options */}
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>Upload Photo</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable 
                    style={[pd.optButton, updatingProfilePic && { opacity: 0.6 }]}
                    onPress={() => !updatingProfilePic && handleProfilePicUpload('gallery')}
                    disabled={updatingProfilePic}
                  >
                    <ImageIcon size={20} color={colors.brand} />
                    <Text style={pd.optText}>Gallery</Text>
                  </Pressable>
                  <Pressable 
                    style={[pd.optButton, updatingProfilePic && { opacity: 0.6 }]}
                    onPress={() => !updatingProfilePic && handleProfilePicUpload('camera')}
                    disabled={updatingProfilePic}
                  >
                    <Camera size={20} color={colors.brand} />
                    <Text style={pd.optText}>Camera</Text>
                  </Pressable>
                </View>
              </View>

              {/* Property Icons */}
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>Choose Icon</Text>
                <View style={{ 
                  flexDirection: 'row', 
                  flexWrap: 'wrap', 
                  gap: 12,
                  justifyContent: 'space-between'
                }}>
                  {PROPERTY_ICONS.map((icon, index) => (
                    <Pressable
                      key={index}
                      style={[
                        pd.iconButton,
                        updatingProfilePic && { opacity: 0.6 }
                      ]}
                      onPress={() => !updatingProfilePic && handleIconSelect(icon)}
                      disabled={updatingProfilePic}
                    >
                      <Text style={{ fontSize: 24 }}>{icon}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Remove photo. The picker only ever offered REPLACEMENTS before,
                  so once a group had a picture there was no way back to its
                  default room-type icon — DELETE /rooms/:roomId/avatar existed
                  on the server with nothing calling it.

                  Shown only when there is something to remove (activeRoom.avatar,
                  i.e. the SERVER has one — a stale local cache entry is not worth
                  offering a server delete for) and only to a caller who may
                  manage it. It is red rather than brand-orange because it is
                  destructive; the two upload buttons above keep the brand
                  treatment. */}
              {!!activeRoom?.avatar && canManageRoomAvatar && (
                <Pressable
                  style={[pd.removeRow, updatingProfilePic && { opacity: 0.6 }]}
                  onPress={() => !updatingProfilePic && handleClearAvatar()}
                  disabled={updatingProfilePic}
                  accessibilityRole="button"
                  accessibilityLabel="Remove group photo"
                >
                  <Trash2 size={18} color={colors.red} />
                  <Text style={pd.removeText}>Remove photo</Text>
                </Pressable>
              )}

              {updatingProfilePic && (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <ActivityIndicator color={colors.brand} />
                  <Text style={{ color: colors.muted, marginTop: 8 }}>Updating profile picture...</Text>
                </View>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

    </KeyboardAvoidingView>
  );
}

// ═══════════ Requirement composer (bottom sheet) ═══════════
function RequirementSheet({ visible, form, setForm, onClose, onSubmit }: {
  visible: boolean; form: any; setForm: (fn: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={sh.sheet}>
          <View style={[sh.head, { backgroundColor: colors.brand }]}>
            <Search size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={sh.headTitle}>Post Client Requirement</Text>
              <Text style={sh.headSub}>Auto-match with available inventory</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color="#fff" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label="Configuration" required>
              <View style={sh.chipsWrap}>
                {BHK_TYPES.map(o => (
                  <Pressable key={o} onPress={() => setForm((f: any) => ({ ...f, bhkType: o }))} style={[sh.chip, form.bhkType === o && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.bhkType === o && { color: '#fff' }]}>{o}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.row2}>
              <Field label="Budget (Lakhs)" required flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 85" placeholderTextColor={colors.muted} value={form.budget} onChangeText={(v: string) => setForm((f: any) => ({ ...f, budget: v }))} />
              </Field>
              <Field label="City" flex>
                <TextInput style={sh.input} placeholder="e.g. Nagpur" placeholderTextColor={colors.muted} value={form.city} onChangeText={(v: string) => setForm((f: any) => ({ ...f, city: v }))} />
              </Field>
            </View>

            <Field label="Area / Locality" required>
              <TextInput style={sh.input} placeholder="e.g. Manish Nagar" placeholderTextColor={colors.muted} value={form.area} onChangeText={(v: string) => setForm((f: any) => ({ ...f, area: v }))} />
            </Field>

            <Field label="Possession">
              <View style={sh.chipsWrap}>
                {POSSESSION_NEEDED.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, possessionNeeded: o.v }))} style={[sh.chip, form.possessionNeeded === o.v && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.possessionNeeded === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <Field label="Urgency">
              <View style={sh.chipsWrap}>
                {URGENCY.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, urgency: o.v }))} style={[sh.chip, form.urgency === o.v && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.urgency === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.switchRow}>
              <Text style={sh.switchLabel}>Loan Required</Text>
              <Switch value={form.loanRequired} onValueChange={(v: boolean) => setForm((f: any) => ({ ...f, loanRequired: v }))} trackColor={{ true: colors.brand }} thumbColor="#fff" />
            </View>

            <Field label="Client Notes">
              <TextInput style={[sh.input, { height: 66, textAlignVertical: 'top' }]} multiline placeholder="Any extra details…" placeholderTextColor={colors.muted} value={form.clientNotes} onChangeText={(v: string) => setForm((f: any) => ({ ...f, clientNotes: v }))} />
            </Field>
          </ScrollView>

          <View style={sh.footer}>
            <Pressable onPress={onSubmit} style={[sh.submitBtn, { backgroundColor: colors.brand }]}>
              <Text style={sh.submitText}>Post & Auto-Match 🚀</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ═══════════ Inventory composer (bottom sheet) ═══════════
function InventorySheet({ visible, form, setForm, onClose, onSubmit }: {
  visible: boolean; form: any; setForm: (fn: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={sh.sheet}>
          <View style={[sh.head, { backgroundColor: colors.green }]}>
            <Building2 size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={sh.headTitle}>Post Inventory Card</Text>
              <Text style={sh.headSub}>Share what you have available</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color="#fff" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label="BHK Options" required>
              <TextInput style={sh.input} placeholder="e.g. 2BHK, 3BHK" placeholderTextColor={colors.muted} value={form.bhkOptions} onChangeText={(v: string) => setForm((f: any) => ({ ...f, bhkOptions: v }))} />
            </Field>

            <View style={sh.row2}>
              <Field label="Min Price (L)" required flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 50" placeholderTextColor={colors.muted} value={form.min} onChangeText={(v: string) => setForm((f: any) => ({ ...f, min: v }))} />
              </Field>
              <Field label="Max Price (L)" flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 90" placeholderTextColor={colors.muted} value={form.max} onChangeText={(v: string) => setForm((f: any) => ({ ...f, max: v }))} />
              </Field>
            </View>

            <View style={sh.row2}>
              <Field label="Area / Location" required flex>
                <TextInput style={sh.input} placeholder="e.g. Baner" placeholderTextColor={colors.muted} value={form.area} onChangeText={(v: string) => setForm((f: any) => ({ ...f, area: v }))} />
              </Field>
              <Field label="City" flex>
                <TextInput style={sh.input} placeholder="e.g. Pune" placeholderTextColor={colors.muted} value={form.city} onChangeText={(v: string) => setForm((f: any) => ({ ...f, city: v }))} />
              </Field>
            </View>

            <Field label="Possession Status">
              <View style={sh.chipsWrap}>
                {POSSESSION_STATUS.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, possessionStatus: o.v }))} style={[sh.chip, form.possessionStatus === o.v && { backgroundColor: colors.green, borderColor: colors.green }]}>
                    <Text style={[sh.chipText, form.possessionStatus === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.row2}>
              <View style={[sh.switchRow, { flex: 1, marginTop: 0 }]}>
                <Text style={sh.switchLabel}>Bank Loan</Text>
                <Switch value={form.bankLoanAvailable} onValueChange={(v: boolean) => setForm((f: any) => ({ ...f, bankLoanAvailable: v }))} trackColor={{ true: colors.green }} thumbColor="#fff" />
              </View>
              <Field label="Commission %" flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 2" placeholderTextColor={colors.muted} value={form.commissionPercent} onChangeText={(v: string) => setForm((f: any) => ({ ...f, commissionPercent: v }))} />
              </Field>
            </View>

            <Field label="Description">
              <TextInput style={[sh.input, { height: 66, textAlignVertical: 'top' }]} multiline placeholder="Highlights, offers…" placeholderTextColor={colors.muted} value={form.description} onChangeText={(v: string) => setForm((f: any) => ({ ...f, description: v }))} />
            </Field>
          </ScrollView>

          <View style={sh.footer}>
            <Pressable onPress={onSubmit} style={[sh.submitBtn, { backgroundColor: colors.green }]}>
              <Text style={sh.submitText}>Post Inventory 📢</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, required, flex, children }: { label: string; required?: boolean; flex?: boolean; children: React.ReactNode }) {
  return (
    <View style={[{ gap: 7 }, flex && { flex: 1 }]}>
      <Text style={sh.label}>{label}{required ? <Text style={{ color: colors.red }}> *</Text> : null}</Text>
      {children}
    </View>
  );
}

// Normalize a posted message from REST/socket into our GroupMessage shape.
let _msgSeq = 0;
function normalizeMsg(m: any, roomId: string): GroupMessage {
  return {
    id: String(m._id || m.id || `tmp_${Date.now()}_${_msgSeq++}`),
    room: String(m.room || roomId),
    sender: {
      id: String(m.sender?._id || m.sender?.id || ''),
      name: m.sender?.name || '',
      role: m.sender?.role || '',
      companyName: m.sender?.companyName,
      isVerified: m.sender?.isVerified === true,
      verificationStatus: m.sender?.verificationStatus,
      // Present on inventory cards only — the card's Call button dials it.
      phone: m.sender?.phone,
    },
    messageType: m.messageType || 'text',
    content: m.content || '',
    attachment: m.attachment,
    requirementCard: m.requirementCard,
    inventoryCard: m.inventoryCard,
    matchResults: m.matchResults,
    createdAt: m.createdAt || new Date().toISOString(),
  };
}

// ── Shared card action row ──
// Used by all three property surfaces: the inventory card, the AI Match Found
// card and each requirement match row. Before this existed the inventory card
// hand-rolled its own button row, the match rows had a single Interested button,
// and the AI Match card had no actions at all — so "open this property" was
// missing exactly where matching results appear.
type CardActionIcon = 'details' | 'join' | 'call' | 'interested';

const CARD_ACTION_ICON = {
  details: Eye,
  join: UserPlus,
  call: Phone,
  interested: Check,
} as const;

const CardActions = React.memo(function CardActions({ actions, tone }: {
  actions: Array<{ key: string; label: string; icon: CardActionIcon; ghost?: boolean; onPress: () => void }>;
  tone: 'green' | 'brand';
}) {
  const solidBg = tone === 'green' ? colors.greenText : colors.brand;
  const accent = tone === 'green' ? colors.greenText : colors.brand;
  const ghostBorder = tone === 'green' ? colors.greenBorder : `${colors.brand}55`;
  const divider = tone === 'green' ? '#DCFCE7' : `${colors.brand}22`;

  return (
    <View style={[mbs.cardActions, { borderTopColor: divider }]}>
      {actions.map(action => {
        const Icon = CARD_ACTION_ICON[action.icon];
        const color = action.ghost ? accent : '#fff';
        return (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            style={[
              mbs.cardActionBtn,
              action.ghost
                ? { backgroundColor: colors.white, borderWidth: 1, borderColor: ghostBorder }
                : { backgroundColor: solidBg },
            ]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Icon size={12} color={color} />
            <Text style={[mbs.cardActionText, { color }]} numberOfLines={1} adjustsFontSizeToFit>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

// ── Group match card ──
// Shown for every matching result. A match advertises the property's GROUP, not
// just the property, because the point of a match is to get the user into the
// room where that inventory is discussed. The previous version was a plain
// property row with an Interested button, which gave no reason for the match and
// no way in.
//
// "N Flats available" from the agreed spec is deliberately absent: there is no
// unit-count field on Project yet, so the line shows the starting price only
// rather than inventing a number.
const GroupMatchCard = React.memo(function GroupMatchCard({
  match, requirement, messageId, onJoin, onPreview, onInterested,
}: {
  match: any;
  requirement: any;
  messageId: string;
  onJoin: (projectId: string) => void;
  onPreview: (match: any) => void;
  onInterested: (projectId: string, messageId: string) => void;
}) {
  const project = match?.project || {};
  const projectId = String(project._id || project.id || '');
  const group: MatchGroupInfo | null = match?.group || null;

  const score = Math.round(Number(match?.score) || 0);
  const scoreColor = score >= 75 ? colors.greenText : score >= 50 ? colors.brand : colors.muted2;

  // Fall back to the project name when the property has no group yet, so the
  // card still reads sensibly instead of showing an empty title.
  const title = group?.name || `${project.projectName || 'Property'} Group`;
  const where = [project.location, project.city].filter(Boolean).join(', ');

  const metaParts = [
    where,
    group?.membersCount ? `${group.membersCount} Members` : '',
    activityLabel(group?.lastActivity),
  ].filter(Boolean);

  const builderName = project.owner?.name || project.owner?.companyName || '';
  const startingPrice = project.pricing?.startingPrice
    ? `from ${fmtPrice(project.pricing.startingPrice)}`
    : '';
  const builderParts = [
    builderName ? `Builder: ${builderName}` : '',
    startingPrice,
  ].filter(Boolean);

  const reason = matchReason(requirement);

  return (
    <View style={mbs.matchCard}>
      <View style={mbs.matchCardHead}>
        <View style={[mbs.matchScorePill, { backgroundColor: `${scoreColor}1A`, borderColor: `${scoreColor}55` }]}>
          <Text style={[mbs.matchScorePillText, { color: scoreColor }]}>{score}% MATCH</Text>
        </View>
        <Text style={mbs.matchCardTitle} numberOfLines={1}>{title}</Text>
      </View>

      {metaParts.length > 0 && (
        <Text style={mbs.matchCardLine} numberOfLines={1}>📍 {metaParts.join(' | ')}</Text>
      )}

      {builderParts.length > 0 && (
        <Text style={mbs.matchCardLine} numberOfLines={1}>🏢 {builderParts.join(' | ')}</Text>
      )}

      {!!reason && (
        <Text style={mbs.matchCardReason} numberOfLines={2}>💡 Match Reason: {reason}</Text>
      )}

      {/* Join Group and Preview Info are the spec's two actions. Interested is
          kept because it is the only path that opens a deal room with the
          builder — dropping it would remove that flow from the group entirely. */}
      <CardActions
        tone="brand"
        actions={[
          { key: 'join', label: 'Join Group', icon: 'join', onPress: () => onJoin(projectId) },
          { key: 'preview', label: 'Preview Info', icon: 'details', ghost: true, onPress: () => onPreview(match) },
          { key: 'interested', label: 'Interested', icon: 'interested', onPress: () => onInterested(projectId, messageId) },
        ]}
      />
    </View>
  );
});

// ── Message bubble ──
// Memoised: without this, every keystroke in the composer (whose state lives in
// GroupChatEmbedded) re-rendered every visible bubble in the thread.
const MessageBubble = React.memo(function MessageBubble({ 
  msg, meId, onInterested, onPropertyViewDetails, onPropertyCall, onJoinPropertyGroup, onPreviewMatch, onDeleteMessage, canModerate, projectId, highlighted 
}: {
  msg: GroupMessage; 
  meId: string; 
  onInterested: (projectId: string, messageId: string) => void;
  onPropertyViewDetails: (projectId: string, fallback?: InventoryCard, sourceMessageId?: string) => void;
  onPropertyCall: (projectId: string, fallbackNumber?: string, posterPhone?: string) => void;
  onJoinPropertyGroup: (projectId: string) => void;
  onPreviewMatch: (match: any) => void;
  onDeleteMessage: (msg: GroupMessage) => void;
  /** True when this user may remove other people's media in this room. */
  canModerate: boolean;
  projectId: string;
  highlighted: boolean;
}) {
  // Toast context moved inside MessageBubble to avoid breaking memo on every
  // parent render. The ToastProvider returns { show, success, error } where
  // each method is stable (useCallback), but the wrapper object is created
  // fresh each render, so passing it as a prop broke memoization.
  const toast = useToast();
  const isMe = msg.sender.id === meId;

  if (msg.messageType === 'system') {
    if (msg.content?.startsWith('📋 Project:')) return null;
    return <Text style={mbs.system}>{msg.content}</Text>;
  }

  if (msg.messageType === 'inventory_card' && msg.inventoryCard) {
    const inv = msg.inventoryCard;
    // AI Match Found card — posted from the private AI Assist for the whole group.
    // This is a matching RESULT, so it carries the same two actions as a match
    // row. It previously returned with no actions at all, which meant a shared
    // match could be seen but not opened or joined. No Call: these cards are
    // posted by the sharer, not the property owner, so there is no poster phone.
    if (inv.aiMatch) {
      const matchRef = inv.project;
      const matchProjectId = typeof matchRef === 'string'
        ? matchRef
        : String(matchRef?._id || matchRef?.id || projectId || '');

      return (
        <View style={[mbs.cardWrap, { alignSelf: 'flex-start' }]}>
          <View style={[mbs.card, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[mbs.cardTag, { color: colors.brand }]}>🎯 AI Match Found · {msg.sender.name}</Text>
              {inv.score ? <Text style={[mbs.cardTag, { color: colors.brand }]}>{Math.round(inv.score)}%</Text> : null}
            </View>
            <Text style={mbs.cardMain}>{inv.projectName || 'Project'}</Text>
            {(inv.area || inv.city) ? <Text style={mbs.cardSub}>📍 {[inv.area, inv.city].filter(Boolean).join(', ')}</Text> : null}

            <CardActions
              tone="brand"
              actions={[
                { key: 'details', label: 'View Details', icon: 'details', ghost: true, onPress: () => onPropertyViewDetails(matchProjectId, inv) },
                { key: 'join', label: 'Join Group', icon: 'join', onPress: () => onJoinPropertyGroup(matchProjectId) },
              ]}
            />
          </View>
        </View>
      );
    }

    
    // Compact universal-group inventory card. All values below come from the
    // stored card/project — no raw AI questionnaire and no role-based guesses.
    const senderName = msg.sender.name || 'Unknown';
    const isVerified = msg.sender.isVerified === true ||
      msg.sender.verificationStatus?.builder === 'verified';

    // Highlight animation for auto-scroll-to-message
    // Lazy initialization ensures Animated.Value is created only once, not on
    // every render. The previous pattern (useRef(new Animated.Value(0)).current)
    // ran the initializer every time the component rendered.
    const highlightAnimRef = useRef<Animated.Value | null>(null);
    if (!highlightAnimRef.current) {
      highlightAnimRef.current = new Animated.Value(0);
    }
    const highlightAnim = highlightAnimRef.current;

    useEffect(() => {
      // Only animate when highlighted becomes true. Without this guard, the
      // animation would restart whenever highlighted changed (even false→false),
      // or if a different message was highlighted mid-animation, causing a flash.
      if (highlighted) {
        Animated.sequence([
          Animated.timing(highlightAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
          Animated.timing(highlightAnim, { toValue: 1, duration: 1900, useNativeDriver: false }),
          Animated.timing(highlightAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
        ]).start();
      }
    }, [highlighted, highlightAnim]);

    const bgColor = highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(254, 243, 199, 0)', 'rgba(254, 243, 199, 1)'],
    });

    // Actions must use the card's stable project id. Falling back to the active
    // room project made every universal-room card use an empty id, and made every
    // project-room card act on the room project even when it represented
    // something else.
    const projectRef = inv.project;
    const cardProjectId = typeof projectRef === 'string'
      ? projectRef
      : String(projectRef?._id || projectRef?.id || projectId || '');

    // Populated project (present on cards that reference a real project) gives
    // the card a cover image and a reliable name.
    const projObj = typeof projectRef === 'object' && projectRef ? projectRef : undefined;
    const coverUrl = projObj?.media?.coverImage?.url || '';
    const title = inv.projectName || projObj?.projectName || 'Property';

    const price = inv.priceRange?.min ? fmtPrice(inv.priceRange.min * 100000) : '';
    const priceMax = inv.priceRange?.max ? fmtPrice(inv.priceRange.max * 100000) : '';
    const priceText = price && priceMax && priceMax !== price ? `${price} – ${priceMax}` : price;

    // Older cards sometimes stored "1000 sqft" in `area` even though the schema
    // called that field a locality. Detect it so the UI puts it on the details
    // line instead of rendering "📍 1000 sqft, Nagpur".
    const areaLooksLikeSize = !!inv.area && /\d[\d,.]*\s*(?:sq\.?\s*ft|sqft|acre)/i.test(inv.area);
    const locality = areaLooksLikeSize ? '' : (inv.area || '');
    const location = [locality, inv.city].filter(Boolean).join(', ');
    const areaText = inv.carpetAreaRange || (areaLooksLikeSize ? inv.area : '');
    const bhk = inv.bhkOptions?.filter(Boolean).join(' / ') || '';
    const propertyType = inv.propertyType || '';

    // Single money line — "₹5.0 Cr | 500 sqft | Flat" — matching the agreed card
    // spec. filter(Boolean) is what keeps a card with only a price from rendering
    // a trailing "|". Cards that pre-date the propertyType/area snapshots fall
    // back to their BHK data rather than fabricating "Flat".
    const moneyParts = [priceText, areaText, propertyType || bhk].filter(Boolean);

    const possessionLabel = inv.possessionStatus === 'ready' ? 'Ready' :
      inv.possessionStatus === '6months' ? '6 Months' :
      inv.possessionStatus === '1year' ? '1 Year' :
      inv.possessionStatus === '2year+' ? '2+ Years' :
      inv.possessionStatus ? String(inv.possessionStatus).replace(/[-_]/g, ' ') : '';

    const urgencyLabel = inv.urgency === 'urgent' ? 'Urgent' :
      inv.urgency === 'very_urgent' ? 'Very Urgent' : 'Normal Urgency';

    const extraTags = [
      inv.bankLoanAvailable ? '🏦 Loan' : '',
      inv.commissionPercent ? `💼 ${inv.commissionPercent}%` : '',
    ].filter(Boolean);

    return (
      <View style={[mbs.cardWrap, { alignSelf: 'flex-start' }]}>
        <Animated.View style={[mbs.propertyCard, { backgroundColor: bgColor }]}>
          {/* Top strip: label + who posted it */}
          <View style={mbs.propertyHeaderRow}>
            <View style={mbs.propertyLabelPill}>
              <Building2 size={11} color={colors.brand} />
              <Text style={mbs.propertyLabel}>Inventory</Text>
            </View>
            <View style={mbs.propertySenderWrap}>
              <Text style={mbs.propertySender} numberOfLines={1}>{senderName}</Text>
              {isVerified && <BadgeCheck size={12} color={colors.greenText} />}
            </View>
          </View>

          {/* Hero row: cover thumb + title / location / price. The title and
              price were missing entirely before, which is why cards looked empty
              when a locality was all the card had. */}
          <View style={mbs.propertyBody}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={mbs.propertyThumb} resizeMode="cover" />
            ) : (
              <View style={[mbs.propertyThumb, mbs.propertyThumbFallback]}>
                <Building2 size={20} color={colors.brand} />
              </View>
            )}

            <View style={mbs.propertyInfo}>
              <Text style={mbs.propertyTitle} numberOfLines={1}>{title}</Text>

              {!!location && (
                <View style={mbs.propertyLine}>
                  <MapPin size={11} color={colors.muted2} />
                  <Text style={mbs.propertyLocation} numberOfLines={1}>{location}</Text>
                </View>
              )}

              {moneyParts.length > 0 && (
                <Text style={mbs.propertyMoney} numberOfLines={1}>💰 {moneyParts.join(' | ')}</Text>
              )}
            </View>
          </View>

          {!!inv.description && (
            <Text style={mbs.propertyDesc} numberOfLines={2}>{inv.description}</Text>
          )}

          {/* [Ready] [Normal Urgency] [Loan] [Commission] */}
          <View style={mbs.propertyTagsRow}>
            {!!possessionLabel && (
              <View style={[mbs.propertyTag, mbs.propertyTagPossession]}>
                <Text style={[mbs.propertyTagText, { color: colors.greenText }]}>{possessionLabel}</Text>
              </View>
            )}
            <View style={[mbs.propertyTag, mbs.propertyTagUrgency]}>
              <Text style={[mbs.propertyTagText, { color: '#92400E' }]}>{urgencyLabel}</Text>
            </View>
            {extraTags.map(t => (
              <View key={t} style={[mbs.propertyTag, mbs.propertyTagPlain]}>
                <Text style={[mbs.propertyTagText, { color: colors.slateText }]}>{t}</Text>
              </View>
            ))}
          </View>

          <CardActions
            tone="brand"
            actions={[
              { key: 'details', label: 'View Details', icon: 'details', ghost: true, onPress: () => onPropertyViewDetails(cardProjectId, inv, msg.id) },
              { key: 'join', label: 'Join Group', icon: 'join', onPress: () => onJoinPropertyGroup(cardProjectId) },
              { key: 'call', label: 'Call', icon: 'call', onPress: () => onPropertyCall(cardProjectId, inv.callNumber, msg.sender.phone) },
            ]}
          />

          {/* The CardActions row above is now the ONLY action row on this card.
              A second, icon-only `mbs.propertyActions` row used to render right
              beneath it with four bare icons — Phone, MessageCircle, MapPin and
              Share2 — which made Call appear TWICE on one card (labelled in
              CardActions, unlabelled here) and, worse, put an unlabelled green
              speech bubble next to Join Group. That bubble read as the `Chat Now`
              affordance we deliberately removed: it was never a chat, it deep-linked
              to WhatsApp. Two rows of the same actions also pushed the card's
              timestamp off the visible area in a dense thread.
              Everything dropped with that row is still reachable:
                • Call — in CardActions, with a label.
                • WhatsApp — the phone +91 normalisation it duplicated is owned by
                  handleMemberWhatsApp, reached from group info.
                • Location — the detail sheet already shows the full location, and
                  the icon only rendered when the project carried lat/lng anyway.
                • Share — the detail sheet's Share2 (verified above `shareProjectId`)
                  goes through shareApi and renders under exactly the same
                  condition this icon did, a real resolved project id. A plain
                  Share.share text blob was strictly the worse of the two. */}

          {!!messageClock(msg.createdAt) && (
            <Text style={mbs.propertyTime}>{messageClock(msg.createdAt)}</Text>
          )}
        </Animated.View>
      </View>
    );
  }

  if (msg.messageType === 'requirement_card' && msg.requirementCard) {
    const req = msg.requirementCard;
    const matches = msg.matchResults || [];
    return (
      <View style={[mbs.cardWrap, { alignSelf: 'flex-start', gap: 6 }]}>
        <View style={[mbs.card, { backgroundColor: '#FFF8F0', borderColor: `${colors.brand}44` }]}>
          <Text style={[mbs.cardTag, { color: colors.brand }]}>🔍 Requirement · {msg.sender.name}
            {req.urgency === 'urgent' ? '  ⚡ URGENT' : req.urgency === 'very_urgent' ? '  🔥 VERY URGENT' : ''}
          </Text>
          <Text style={mbs.cardMain}>{req.bhkType} · ₹{req.budget}L · {req.area}</Text>
          <View style={mbs.tagRow}>
            {req.city ? <Tag text={req.city} /> : null}
            <Tag text={`🕐 ${req.possessionNeeded}`} />
            {req.loanRequired && <Tag text="🏦 Loan" />}
          </View>
          {req.clientNotes ? <Text style={mbs.cardNote}>📝 {req.clientNotes}</Text> : null}
        </View>

        {matches.length > 0 && (
          <View style={mbs.matchBox}>
            <Text style={mbs.matchTitle}>⚡ {matches.length} Matches Found</Text>
            {matches.map((m: any, i: number) => (
              <GroupMatchCard
                key={String(m?.project?._id || m?.project || i)}
                match={m}
                requirement={req}
                messageId={msg.id}
                onJoin={onJoinPropertyGroup}
                onPreview={onPreviewMatch}
                onInterested={onInterested}
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  // Own media can always be removed; other people's only by a room owner or an
  // admin/captain. Matches the server, so a long-press never leads to a 403.
  const canDelete = isMe || canModerate;

  // image attachment
  if (msg.messageType === 'image' && msg.content) {
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem, { padding: 4 }]}>
          {!isMe && <Text style={[mbs.textSender, { marginHorizontal: 6, marginTop: 4 }]}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable
            onPress={() => Linking.openURL(msg.content)}
            onLongPress={canDelete ? () => onDeleteMessage(msg) : undefined}
            delayLongPress={400}
            accessibilityHint={canDelete ? 'Long press to delete' : undefined}
          >
            <Image source={{ uri: msg.content }} style={mbs.attachImage} resizeMode="cover" />
          </Pressable>
          {canDelete && <Text style={mbs.deleteHint}>Hold to delete</Text>}
        </View>
      </View>
    );
  }

  // file attachment
  if (msg.messageType === 'file' && msg.content) {
    const urlName = decodeURIComponent(String(msg.content).split('/').pop() || 'File').split('?')[0];
    const fileName = msg.attachment?.name || urlName;
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}>
          {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable
            onPress={() => Linking.openURL(msg.content)}
            onLongPress={canDelete ? () => onDeleteMessage(msg) : undefined}
            delayLongPress={400}
            style={mbs.fileRow}
            accessibilityHint={canDelete ? 'Long press to delete' : undefined}
          >
            <FileText size={18} color={isMe ? '#fff' : colors.brand} />
            <Text style={[mbs.fileName, { color: isMe ? '#fff' : colors.ink }]} numberOfLines={1}>{fileName}</Text>
          </Pressable>
          {canDelete && (
            <Text style={[mbs.deleteHint, { color: isMe ? 'rgba(255,255,255,0.7)' : colors.muted }]}>
              Hold to delete
            </Text>
          )}
        </View>
      </View>
    );
  }

  // text — long-press to delete, matching the image/file pattern already above.
  // Previously text messages had NO delete option, which meant only media could
  // be removed. This unifies the interaction: any message type can now be
  // long-pressed by its sender or a moderator.
  return (
    <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
      <Pressable
        onLongPress={canDelete ? () => onDeleteMessage(msg) : undefined}
        delayLongPress={400}
        style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}
        accessibilityHint={canDelete ? 'Long press to delete' : undefined}
      >
        {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
        <Text style={[mbs.textContent, { color: isMe ? '#fff' : colors.ink }]}>{msg.content}</Text>
        {canDelete && (
          <Text style={[mbs.deleteHint, { color: isMe ? 'rgba(255,255,255,0.7)' : colors.muted }]}>
            Hold to delete
          </Text>
        )}
      </Pressable>
    </View>
  );
});

function Tag({ text, brand }: { text: string; brand?: boolean }) {
  return (
    <View style={[mbs.tag, brand && { backgroundColor: colors.brandTint }]}>
      <Text style={[mbs.tagText, brand && { color: colors.brand }]}>{text}</Text>
    </View>
  );
}

function Chips({ options, value, onChange, small }: { options: string[]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)} style={[cs.chip, value === o && cs.chipOn, small && { paddingVertical: 6 }]}>
          <Text style={[cs.chipText, value === o && cs.chipTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SelectRow({ label, options, value, onChange }: { label: string; options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={cs.selLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map(o => (
          <Pressable key={o.v} onPress={() => onChange(o.v)} style={[cs.chip, value === o.v && cs.chipOn]}>
            <Text style={[cs.chipText, value === o.v && cs.chipTextOn]}>{o.l}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 6, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  // Inline (expanded) search that fills the header row when the magnifier is tapped.
  searchInline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8, minHeight: 46 },
  newBtn: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTint },
  newBtnText: { fontSize: 12, fontWeight: '800', color: colors.brand },
  // Column wrapper around the search+New row and the filter chips. listHeader
  // itself stays the row it always was, so nothing about the search field or the
  // New button moved.
  listHeaderWrap: { paddingBottom: 2 },
  // Chip row. The shape is lifted from the proven filter pills on the Projects
  // screen so the two screens do not drift apart: white fill with a neutral
  // border when inactive, brand fill when active.
  filterBar: { flexGrow: 0 },
  filterContent: { gap: 8, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
  filterPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  filterPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterPillText: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
  filterPillTextActive: { color: '#fff' },
  roomRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: colors.white },
  roomRowPinned: { backgroundColor: `${colors.brand}08` },
  roomAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  pinBadge: { backgroundColor: colors.brandTint, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  pinText: { fontSize: 9, fontWeight: '800', color: colors.brand },
  roomNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  roomName: { fontSize: 13.5, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  roomTypeChip: { flexShrink: 0, backgroundColor: colors.slateBg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  roomTypeChipText: { fontSize: 8.5, fontWeight: '800', color: colors.slateText, letterSpacing: 0.2 },
  roomMeta: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  roomMetaSecondary: { fontSize: 10.5, fontWeight: '700', color: colors.slateText, marginTop: 1 },
  roomTrailing: { alignItems: 'flex-end', gap: 5 },
  roomTime: { fontSize: 10, color: colors.muted },
  unreadBadge: { minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { fontSize: 9.5, fontWeight: '800', color: '#fff' },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  emptyText: { fontSize: 13, color: colors.muted },
  emptyHint: { fontSize: 11.5, color: colors.muted2, textAlign: 'center', paddingHorizontal: 32, lineHeight: 17 },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: colors.brand, borderRadius: 12, marginTop: 4 },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  smallJoin: { minWidth: 76, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  smallJoinText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },

  // Section headers for the single room SectionList (My Groups / Discover Groups).
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 7, backgroundColor: colors.cream },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.muted2, letterSpacing: 0.3 },
  sectionCountPill: { backgroundColor: colors.brandTint, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8 },
  sectionCountText: { fontSize: 9.5, fontWeight: '800', color: colors.brand },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  fieldInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 13, color: colors.ink, backgroundColor: colors.white },
  primaryBtn: { backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, zIndex: 20 },
  // Avatar + title/subtitle as ONE tap target that opens group info. It carries
  // the row layout the header itself used to provide for these two children.
  threadIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  threadAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  threadTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  threadSub: { fontSize: 10.5, color: colors.muted, marginTop: 1 },
  // AI 3-dot row in the group header. `headerAiBtn` / `headerAiBtnText` (the
  // rounded pill used for the old Post · Matching buttons) were dropped with
  // those buttons — the hub's tab row renders both as plain tabs now.
  headerAiRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerAiDots: { padding: 4 },
  // Standalone AI row used in headerless mode (the AI Leads hub supplies its own
  // navigation above). It used to hold the Post / Matching pills as well; now it
  // only carries the 3-dot, whose dropdown is anchored to this component.
  aiActionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line,
    zIndex: 20,
  },

  // Floating Action Buttons (FABs)
  fabContainer: {
    position: 'absolute',
    right: 16,
    bottom: 80, // Above the composer/input area
    gap: 12,
    zIndex: 100,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 28,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  fabMyPost: {
    backgroundColor: '#F0FDF4',
    borderColor: colors.greenBorder,
  },
  fabMatching: {
    backgroundColor: colors.brandTint,
    borderColor: `${colors.brand}88`,
  },
  fabText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  menu: { position: 'absolute', right: 8, top: 52, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, minWidth: 180, zIndex: 30, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuText: { fontSize: 12.5, fontWeight: '600', color: colors.muted2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.blueBg, borderBottomWidth: 1, borderBottomColor: colors.blueBorder, paddingHorizontal: 14, paddingVertical: 10 },
  bannerIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  bannerThumb: { width: 42, height: 42, borderRadius: 9, backgroundColor: colors.white },
  bannerName: { fontSize: 12.5, fontWeight: '800', color: colors.blueText },
  bannerMeta: { fontSize: 10, color: colors.blueText, marginTop: 1 },
  bannerMenuBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  // Kept mounted but visually outside the viewport only while exporting a QR.
  // opacity:0 is not used because some native SVG renderers skip rasterisation
  // for fully transparent trees.
  qrExporter: { position: 'absolute', left: -1000, top: -1000, width: 352, height: 352, padding: 16, backgroundColor: '#fff' },

  composer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 10 },
  quickRow: { flexDirection: 'row', gap: 8 },
  aiInlineBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.brandTint, borderBottomWidth: 1, borderBottomColor: `${colors.brand}33` },
  aiBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33` },
  aiBackText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },
  aiPrivatePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}44`, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  aiPrivateText: { fontSize: 10, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  aiMenuBtn: { padding: 6, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33` },
  // Small floating 3-dot menu button (top-right) after removing the banner bar.
  aiMenuFloat: { position: 'absolute', right: 10, top: 8, zIndex: 40, padding: 6, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33`, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  aiMenu: { position: 'absolute', right: 10, top: 40, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, minWidth: 190, zIndex: 40, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  aiMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  aiMenuText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  // AI Assist overlay (covers the message area while AI mode is active)
  aiOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.cream },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  quickChipText: { fontSize: 11.5, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  modeBtnActive: { backgroundColor: colors.night, borderColor: colors.night },
  modeText: { fontSize: 10.5, fontWeight: '800', color: colors.muted2 },
  modeTextActive: { color: '#fff' },
  textRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  attachBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  attachRow: { flexDirection: 'row', gap: 10, paddingBottom: 8, paddingHorizontal: 2 },
  attachOpt: { alignItems: 'center', gap: 4 },
  attachIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  attachLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
  textInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, fontSize: 13.5, color: colors.ink, backgroundColor: colors.cream, maxHeight: 100, minHeight: 42 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cardBox: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 9 },
  cardTitle: { fontSize: 12, fontWeight: '800' },
  grid2: { flexDirection: 'row', gap: 8 },
  miniInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, color: colors.ink, backgroundColor: colors.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  switchLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  postBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 2 },
  postBtnText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
});

const ld = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  card: { backgroundColor: colors.cream, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  rowValue: { fontSize: 12.5, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10 },
  dismissBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontSize: 13, fontWeight: '700', color: colors.muted2 },
  findBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.brand },
  findText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});

// Sell / Buy / Rent starter chips shown above the composer.
// Builder property cards — the horizontal strip inside a company group.
const bp = StyleSheet.create({
  strip: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, paddingTop: 10, paddingBottom: 10 },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, marginBottom: 8 },
  stripTitle: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  stripCount: { fontSize: 9.5, fontWeight: '800', color: colors.brand },
  stripRow: { paddingHorizontal: 14, gap: CARD_GAP },
  stripEmpty: { paddingHorizontal: 14, fontSize: 11.5, color: colors.muted },
  card: {
    width: 186,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 84, backgroundColor: '#DCFCE7' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 9, paddingTop: 7, gap: 1 },
  name: { fontSize: 12, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 10, color: colors.muted2 },
  price: { fontSize: 11, fontWeight: '800', color: colors.greenText, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 6, paddingHorizontal: 9, paddingVertical: 8 },
  btn: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 7,
    borderRadius: 8,
  },
  btnGhost: { backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}55` },
  btnSolid: { backgroundColor: colors.brand },
  btnText: { fontSize: 9, fontWeight: '800' },
  // Fixed width, no flex: the two labelled buttons keep their share of the 186 dp
  // card and this one takes only what an icon needs, so nothing clips.
  btnIcon: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: `${colors.brand}55`,
  },
});

const ip = StyleSheet.create({
  stripWrap: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9, paddingBottom: 3 },
  stripLabel: { fontSize: 9.5, fontWeight: '800', color: colors.muted, letterSpacing: 0.4, paddingHorizontal: 12, marginBottom: 7, textTransform: 'uppercase' },
  stripRow: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}55`, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipIcon: { fontSize: 14 },
  chipText: { fontSize: 12, fontWeight: '800', color: colors.brand },
});

const dp = StyleSheet.create({
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  optLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
});

const pd = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 14, maxHeight: '88%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  headSub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  card: { backgroundColor: colors.cream, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  cardThumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.line },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  cardLoc: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  cardPrice: { fontSize: 14, fontWeight: '800', color: colors.brand },
  detailList: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  detailValue: { fontSize: 12, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  detailHero: { width: '100%', height: 170, borderRadius: 14, backgroundColor: colors.line },
  // Labelled group of fields in the full-project detail view. Same weight/size
  // family as mediaTitle, so Overview / Pricing / Media read as one hierarchy.
  section: { gap: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.ink },
  shareBtn: { padding: 7, borderRadius: 9, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}33` },
  mediaSection: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  mediaTitle: { fontSize: 12, fontWeight: '800', color: colors.ink },
  mediaThumb: { width: 100, height: 72, borderRadius: 10, backgroundColor: colors.line },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}33` },
  mediaBtnText: { fontSize: 10.5, fontWeight: '700', color: colors.brand },
  // Action section styles — clean button-list view replacing text detail sections.
  // Previous: text dumps (Overview / Pricing / Configuration / Amenities) with ~20
  // label-value rows, most empty. New: one action button per resource, each opens
  // or downloads its target. White background, brand-orange icons, muted trailing
  // icon. Sectioned: gallery gets its own titled block, everything else in one list.
  actionSection: { gap: 0, paddingTop: 0 },
  actionSectionTitle: { fontSize: 12, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  actionLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.ink },
  // tags row (BHK / area / type)
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.muted2, maxWidth: 140 },
  // actions row (Post to Group + View Property)
  actionsRow: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  postBtn: { flex: 1, backgroundColor: colors.green, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  postBtnDim: { opacity: 0.45 },
  postBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  viewBtn: { flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}55`, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  viewBtnText: { color: colors.brand, fontSize: 12.5, fontWeight: '800' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.3 },
  empty: { fontSize: 12, color: colors.muted2, textAlign: 'center', paddingVertical: 28, paddingHorizontal: 10, lineHeight: 18 },
  // Profile picture modal styles
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink },
  optButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, backgroundColor: colors.brandTint, borderRadius: 12, borderWidth: 1, borderColor: `${colors.brand}33` },
  optText: { fontSize: 14, fontWeight: '700', color: colors.brand },
  iconButton: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  // Remove photo: the same geometry as optButton above, in the red tokens rather
  // than the brand ones, because it destroys something and the two buttons above
  // do not.
  removeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, backgroundColor: colors.redBg, borderRadius: 12, borderWidth: 1, borderColor: colors.redBorder },
  removeText: { fontSize: 14, fontWeight: '700', color: colors.redText },
});

// Group info sheet — avatar / counts / admins / media / member rows / actions.
// Plain StyleSheet with theme tokens only (NativeWind crashes production builds).
const gi = StyleSheet.create({
  header: { gap: 10, paddingBottom: 6 },
  avatar: { alignSelf: 'center', width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '800', color: colors.ink, textAlign: 'center', flexShrink: 1 },
  counts: { fontSize: 11.5, color: colors.muted2, textAlign: 'center', fontWeight: '700' },
  block: { gap: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  blockTitle: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  adminLine: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  emptyText: { fontSize: 11.5, color: colors.muted, paddingVertical: 4 },
  linkList: { gap: 5 },
  linkText: { fontSize: 11.5, fontWeight: '700', color: colors.brand },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  memberAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontSize: 13, fontWeight: '800', color: colors.brand },
  memberName: { fontSize: 13, fontWeight: '800', color: colors.ink },
  memberMeta: { fontSize: 10.5, color: colors.muted2, textTransform: 'capitalize' },
  adminPill: { backgroundColor: colors.brandTint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminPillText: { fontSize: 9, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  contactBtn: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}33` },
  contactBtnWa: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  actions: { paddingTop: 12, gap: 2 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  actionText: { fontSize: 13, fontWeight: '800', color: colors.muted2 },
});

const cs = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  chipTextOn: { color: '#fff' },
  selLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
});

const mbs = StyleSheet.create({
  system: { textAlign: 'center', fontSize: 10, color: colors.muted2, backgroundColor: colors.slateBg, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  cardWrap: { width: '92%', maxWidth: 380, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 4 },
  cardTag: { fontSize: 10, fontWeight: '800' },
  cardMain: { fontSize: 13, fontWeight: '800', color: colors.ink },
  cardSub: { fontSize: 11, color: colors.muted2 },
  cardNote: { fontSize: 10.5, color: colors.muted, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  tag: { backgroundColor: colors.slateBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  tagText: { fontSize: 8.5, fontWeight: '700', color: colors.slateText },
  // Compact universal-group inventory card styles
  // Same surface as the AI Assist match card: a white card on a neutral border,
  // with brand accents. The card used to be green end to end, which read as a
  // status colour on a card that carries no status.
  propertyCard: {
    width: '100%',
    minWidth: 0,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  propertyHeaderRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  propertyLabelPill: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.brandTint,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  propertyLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.brand,
    letterSpacing: 0.2,
  },
  propertySenderWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  propertySender: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.muted2,
  },
  // Hero row: cover thumbnail beside the title block.
  propertyBody: {
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  propertyThumb: {
    width: 62,
    height: 62,
    borderRadius: 10,
    backgroundColor: colors.brandTint,
  },
  propertyThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  propertyInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  propertyTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.ink,
  },
  propertyLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 0,
  },
  propertyLocation: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted2,
  },
  // Single "💰 price | area | type" line, per the agreed card spec.
  propertyMoney: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.greenText,
    marginTop: 2,
  },
  propertyDesc: {
    fontSize: 10.5,
    color: colors.muted2,
    lineHeight: 15,
  },
  propertyTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  propertyTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  // Status pills stay coloured — they carry meaning. Softened to a tinted pill
  // so they read as a badge on the white card instead of a solid block.
  propertyTagPossession: {
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.greenBorder,
  },
  propertyTagUrgency: {
    backgroundColor: '#FEF3C7',
  },
  propertyTagPlain: {
    backgroundColor: colors.slateBg,
  },
  propertyTagText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: colors.white,
  },
  // Shared CardActions row — one definition for the inventory card, the AI match
  // card and the requirement match rows. Colours come from the `tone` prop, so
  // only geometry lives here. minWidth:0 is what lets three buttons shrink
  // inside a narrow card instead of overflowing it.
  cardActions: {
    width: '100%',
    minWidth: 0,
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  cardActionBtn: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderRadius: 9,
  },
  cardActionText: {
    fontSize: 9.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  // `propertyActions` / `propertyActionBtn` lived here and styled the icon-only
  // second action row on the inventory card. That row is gone (see the comment in
  // the inventory_card branch), so the styles went with it rather than being left
  // behind for someone to re-render the duplicate row from.
  propertyTime: {
    alignSelf: 'flex-end',
    fontSize: 8.5,
    color: colors.muted,
    marginTop: -1,
  },
  matchBox: { backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33`, borderRadius: 16, padding: 10, gap: 8 },
  matchTitle: { fontSize: 11, fontWeight: '800', color: colors.brand },
  // Group match card — one per matching result.
  matchCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: `${colors.brand}33`, padding: 10, gap: 4 },
  matchCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  matchScorePill: { flexShrink: 0, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  matchScorePillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  matchCardTitle: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: colors.ink },
  matchCardLine: { fontSize: 10.5, color: colors.muted2, lineHeight: 15 },
  matchCardReason: { fontSize: 10.5, fontWeight: '700', color: colors.brand, lineHeight: 15, marginTop: 1 },
  textBubble: { maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  textMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  textThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  textSender: { fontSize: 9, fontWeight: '800', color: colors.brand, marginBottom: 2 },
  textContent: { fontSize: 13, lineHeight: 20 },
  attachImage: { width: 200, height: 200, borderRadius: 12 },
  // Long-press is invisible without a hint, so the affordance is spelled out.
  deleteHint: { fontSize: 8, color: colors.muted, textAlign: 'center', marginTop: 3, marginBottom: 1 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  fileName: { fontSize: 12.5, fontWeight: '600', maxWidth: 180 },
});

const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  headTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  headSub: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  label: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13.5, color: colors.ink, backgroundColor: colors.cream },
  row2: { flexDirection: 'row', gap: 12 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.muted2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  switchLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  footer: { padding: 14, borderTopWidth: 1, borderTopColor: colors.line },
  submitBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
