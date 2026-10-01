# Backend phase review — member-phone privacy, per-builder project count, room media endpoint

The backend half of the group-info feature does three things: it starts selecting `phone` on the
room member populate, then deletes it again for every room type that is not `builder` or `project`
in one shared `sanitizeRoom()` that every room-bearing response now passes through; it replaces the
`Project.distinct('owner', …)` in `getRooms` with a single `$group` aggregation that answers both
"how many published projects does this builder have" and "is this builder discoverable"; and it adds
`GET /group-chat/rooms/:roomId/media`, a members-only, page-capped query for the group-info sheet's
Media & Links section. The privacy rule is enforced server-side on purpose — the mobile component
only renders `phone` when it is present — and the aggregation keeps `getRooms` at the same query
count it had before rather than adding an N+1. All three items match the plan's Phase B, and the
coder's `scripts/test-group-info.js` (50 assertions, 0 failures) asserts the privacy rule in both
directions against the real handler's response payload.

Watch for: the `sanitizeRoom` ObjectId guard does not do what its comment says (confirmed, harmless
in practice); the media endpoint's link query is an unindexed regex scan over one room's whole text
history and is reachable for the universal room by any authenticated user (likely, low severity);
two comments overstate what bounds the work (confirmed).

**Verdict**: APPROVED

## High-level view

`phone` is selected in exactly one place
(`ROOM_MEMBER_FIELDS`), the strip happens in exactly one place (`sanitizeRoom`), and the allow-list
`PHONE_VISIBLE_ROOM_TYPES` fails closed — an unknown or missing `roomType` loses the number. All
seven member populates were converted, and every response in the controller that carries a `room`
key now wraps it. `GroupRoom` is required by only this controller plus `UniversalGroupService`
(which never returns a room to an HTTP response) and the socket layer (which never emits a room
object), so there is no second path to close.

The project count rides on the same pass. One aggregation over the builder ids of every `builder`
room in both `myRooms` and `discoverCandidates`, a `Map` keyed by owner id, and `publishedBuilderIds`
derived from the keys with `count > 0` so the deleted `distinct()` is not replaced by an extra query.
`projectCount` is attached to builder rooms only and the field name matches what
`transformGroupRoom` reads.

The media endpoint reuses the sibling membership gate verbatim and caps `limit` at 60 with floors on
both `page` and `limit`, so it cannot be turned into a history dump. The weak spot is cost, not
access: the link half is a `https?://` regex on `content` with no index that can serve it, and
`skip`/`limit` bound the rows returned, not the documents Mongo has to examine and sort. Every user
belongs to the universal room, so every user can legitimately call this endpoint against the
platform's largest message collection even though the UI never opens group info there.

Two comments describe guarantees the code does not provide. The ObjectId guard in `sanitizeRoom`
claims to skip unpopulated members but `typeof objectId === 'object'` is true, so the `delete` runs
on them (a no-op); and the media query's comment credits the `{ messageType: 1, room: 1 }` index,
which cannot serve the `createdAt` sort.

<details>
<summary>Issues (4)</summary>

1. **sanitizeRoom ObjectId guard is not a guard** — `typeof member.user === 'object'` is true for an
   ObjectId, so `delete member.user.phone` runs on unpopulated members. Harmless, but tighten the
   check (e.g. `member.user.phone !== undefined` or a `_bsontype` test) or correct the comment and
   the claim in `backend-verification.md` that those members are skipped.
2. **Link query cost is not bounded by skip/limit** — the unindexed `$regex` over one room's text
   messages plus the `createdAt` sort scales with room history, and the universal room is reachable
   by every authenticated member. Correct the comment, and consider refusing the universal room or
   capping the scan.
3. **Index attribution is wrong** — `{ messageType: 1, room: 1 }` cannot serve `sort({ createdAt: -1 })`;
   the planner will most likely use `{ room: 1, createdAt: -1 }` and filter on `messageType`. Fix the
   comment so a future reader does not rely on a non-existent guarantee.
4. **One page/limit for two independent lists** — media and links share the pagination cursor and the
   response carries no total or `hasMore`, so page 2 can return media with an empty `links` and the
   client cannot tell an exhausted list from a short page. Fine today (the sheet only asks for page 1)
   but worth a note or separate cursors before any "load more".

</details>

<details>
<summary>Details</summary>

### Phone is selected once and stripped once

The rule lives in two constants and one function:

```js
const ROOM_MEMBER_FIELDS = 'name role companyName phone';
const PHONE_VISIBLE_ROOM_TYPES = new Set(['builder', 'project']);
```

Because the membership test is an allow-list rather than a deny-list, a room with a missing or future
`roomType` loses the number instead of shipping it, and the test script pins that
(`unknown roomType drops phone`).

All seven populate sites now use the constant (controller lines 321, 332, 348, 355, 386, 533, 611),
and every response carrying a room is wrapped: `createRoom`'s 409 duplicate, the `ensureProjectGroup`
201, the generic 201 and the `code === 11000` 409; both `getRooms` payloads via `withProjectCount`;
`joinRoom`'s "Already a member" 200 and its success 200; `joinProjectRoom`'s 200. `leaveRoom` and
`deleteRoom` return messages only. The `DealRoom` populates further down the file (lines 1378-1409)
do include `phone`, but those are deal participants, not group members, and predate this change.

The one inaccuracy is the guard:

```js
// The discover list does not populate members, so `user` is still an
// ObjectId there — nothing to strip, and `delete` on it would be wrong.
if (member?.user && typeof member.user === 'object') delete member.user.phone;
```

An ObjectId *is* `typeof 'object'`, so the branch is taken for unpopulated members and `delete` runs
against the ObjectId instance. It has no own `phone` property, so nothing happens and no payload is
affected — but the code does not implement the rule the comment states, and
`backend-verification.md` repeats the same claim.

### Privacy evidence is on the payload, not on a component

The DB half of `test-group-info.js` creates a builder, two published projects and a draft, plus four
rooms (`builder`, `project`, `area`, `universal`) with the same two members, then calls the real
`getRooms` handler with a fake `req`/`res`. Within the *same* response it asserts
`builder room ships phone` and `every builder member has a phone` → 2 alongside
`universal room ships NO phone` and `no universal member has a phone` → 0, so the universal result
cannot be passing trivially through an unpopulated member list. `phone absent from serialised
universal room` runs `JSON.stringify` over the room and asserts the number does not appear in the
bytes. That is both directions, on the wire format, which is what the hard requirement asked for.

### One aggregation, and the discover gate rides on it

```js
const builderRoomIds = [...myRooms, ...discoverCandidates]
  .filter(room => room.roomType === 'builder' && room.builder)
  .map(room => room.builder._id || room.builder);
// … one Project.aggregate([$match, $group]) …
const publishedBuilderIds = new Set(
  [...projectCountByBuilder.entries()].filter(([, count]) => count > 0).map(([id]) => id)
);
```

No per-room count query. The union with `myRooms` widens the `$in` relative to the deleted
`distinct()` (which only looked at discover candidates), but the discover gate reads the same answer
for the same ids, and `draft-only builder stays hidden` is the regression guard for that behaviour.
`withProjectCount` runs `sanitizeRoom` first and attaches `projectCount` to builder rooms only;
`transformGroupRoom` reads `Number(raw?.projectCount) || undefined`, so the `0` the server sends for
a builder with no published projects collapses to "no segment" on the client rather than
"0 projects".

The discover list is routed through `withProjectCount` even though it does not populate members, so a
future `.populate('members.user', …)` added there cannot silently start leaking.

### Media endpoint: access is tight, cost is not

The gate is the sibling pattern byte for byte —
`GroupRoom.findOne({ _id: roomId, active: true, 'members.user': userId })` → 403 `'Not a member of
this room'` — behind the router's existing `protect` + `restrictTo`, with a 400 for a malformed
`roomId`. `page` and `limit` are both floored at 1 and `limit` is ceilinged at 60, so the worst a
caller can ask for is 60 media rows plus 60 link rows; the test script covers the 403 for a
non-member, the 403 for an inactive room, the 400, the clamp to 60, and the negative-value floors.
Results go through the existing `sanitizeMessage`, so the sender's phone is stripped on both lists.

The cost side is where the comments oversell. The media query's note credits the
`{ messageType: 1, room: 1 }` index, but that index cannot satisfy `sort({ createdAt: -1 })`; the
planner will most likely pick `{ room: 1, createdAt: -1 }` and filter `messageType` as a residual.
The link query is worse by design:

```js
GroupMessage.find({ room: roomId, deleted: false, messageType: 'text',
                    content: { $regex: 'https?://', $options: 'i' } })
  .sort({ createdAt: -1 }).skip(skip).limit(limit)
```

The comment says it "is bounded by skip/limit" — that bounds the rows returned, not the documents
examined. Matching still requires evaluating the regex across the room's text messages. For a
builder or project room that is trivial. For the universal room, which holds every user's messages
and which every user is a member of, the membership gate passes for everyone, so any authenticated
user can issue this query repeatedly. The group-info sheet never opens for the universal room (its
header is deliberately not pressable), so no client does this today — the exposure is the endpoint
itself, not the feature.

### Pagination shape

`{ media, links, page, limit }` matches the client interface: the mobile mapper reads `_id`,
`attachment.name/mimeType/size`, `content` as the URL fallback (the schema stores the R2 URL in
`content`, not in `attachment`), and extracts the first URL out of link text. The two lists share one `page`/`limit` and
the response carries no total or `hasMore`, so once a "load more" exists, page 2 will apply the same
skip to a 3-item link list and a 200-item media list and the client will have no way to tell which
one ran out.

### Scope and process

The diff is three files: the controller, one route line, the new test script. No commit (HEAD is
still `5fcd8ac`, `main` ahead 1 as it already was), no push, no `gcloud builds submit`, no migration.
The known limit the plan called out — `getRooms` still populating `members.user` for the universal
room — is carried forward in the verification note rather than silently fixed. Comment density matches
the surrounding file and the behaviour-change comments state what the previous code did (the repeated
`'name role companyName'` literal, the bare `room.toObject()`, the deleted `distinct()`).

</details>

<details>
<summary>Files changed</summary>

- `HIT_Backend/controllers/groupChatController.js` — `ROOM_MEMBER_FIELDS` /
  `PHONE_VISIBLE_ROOM_TYPES` / `sanitizeRoom()`, seven populate sites converted, every room response
  sanitised, `getRooms` project-count aggregation replacing `Project.distinct`, new `getRoomMedia`.
- `HIT_Backend/routes/groupChat.routes.js` — `GET /rooms/:roomId/media` registered inside the
  existing `protect` + `restrictTo` block.
- `HIT_Backend/scripts/test-group-info.js` — new, 50 assertions: `sanitizeRoom` without a DB, then
  `getRooms` and `getRoomMedia` through the real handlers with throwaway data and full cleanup.

Full diff: `git -C HIT_Backend diff` plus the untracked `scripts/test-group-info.js`.

</details>
