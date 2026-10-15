// Group-avatar cache keys, types and precedence lifted out of
// GroupChatEmbedded.tsx. Reaches expo-file-system only; the api import is types
// only, because src/lib/api.ts pulls expo-constants in at module scope.
import * as FileSystem from 'expo-file-system';
import type { GroupRoom } from '../api';

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
export const PROPERTY_ICONS = ['🏠', '🏗', '🏢', '📍', '🏘', '🏡', '🏬', '🏭', '🏰', '🏯', '🏛', '🌆', '🏙', '🌇', '🎪'];

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
export const PROFILE_STORAGE_KEY = 'room_profile_pictures';

// Directory the picked photos are copied into. The ImagePicker hands back a path
// under the app's *cache* dir, which Android is free to purge and which does not
// survive a reinstall — persisting that URI produced avatars that silently went
// blank days later. documentDirectory survives app restarts and cache clears
// (though not an uninstall).
//
// This copy still matters now that uploads go to the server: it is the `localUri`
// offline fallback, the thing that renders when the device has no network and the
// public R2 URL cannot be fetched.
export const AVATAR_DIR = `${FileSystem.documentDirectory}group-avatars/`;

/**
 * One cached avatar.
 *
 * `type` / `value` mirror SERVER truth: the canonical emoji the server echoed
 * back, or the public R2 URL of the uploaded photo. `localUri` is OURS — the
 * durable copy of a photo this device uploaded — and exists only so the avatar
 * still draws when the R2 URL cannot be reached. Nothing should ever prefer
 * `localUri` over `value`; it is the second hop, not the first.
 */
export type RoomProfile = { type: 'icon' | 'image'; value: string; localUri?: string };

/**
 * The ONE canonical key for a room in the profile store, used on every read and
 * every write. Every GroupRoom comes out of `transformGroupRoom` in lib/api.ts as
 * `String(raw._id || raw.id || '')`, so list rows and the open room already agree
 * on the string — but that fallback can yield `''`, and a bad call site could
 * stringify an undefined id into the literal `'undefined'`. Either would make
 * unrelated rooms share one bucket, so both are rejected here and the caller is
 * expected to treat `null` as "no room to save against".
 */
export function roomProfileKey(room?: { id?: string } | null): string | null {
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
export type CacheWriteResult = { ok: true; previous: RoomProfile | null } | { ok: false };

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
export function discardReplacedAvatar(previous: RoomProfile | null, keep?: string) {
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
export function avatarErrorMessage(e: any, fallback: string): string {
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
export function resolveRoomAvatar(
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
