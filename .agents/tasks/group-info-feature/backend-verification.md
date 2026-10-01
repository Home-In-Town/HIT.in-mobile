# Backend phase — verification record

Iteration: **1** (no `backend-review.json` existed, so this was implemented from the plan, Phase B).

Repo: `c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Backend` — working tree was clean at `5fcd8ac`
before these edits. **Nothing committed, nothing pushed, nothing deployed, no migration run.**

## Files changed

| File | Change |
| --- | --- |
| `controllers/groupChatController.js` | `ROOM_MEMBER_FIELDS`, `PHONE_VISIBLE_ROOM_TYPES`, `sanitizeRoom()`; all 7 member populates; `getRooms` project-count aggregation; new `getRoomMedia` |
| `routes/groupChat.routes.js` | registered `GET /rooms/:roomId/media` |
| `scripts/test-group-info.js` | **new** — proves the privacy rule, the count, and the media gate |

No mobile change was needed: the mobile phase already shipped `members[].user.phone?`,
`projectCount?`, and `groupChatApi.getRoomMedia` in `HIT_Mobile/src/lib/api.ts`.

## Item 3 — phone privacy (hard requirement)

`phone` was added to the member populate via a single shared constant:

```js
const ROOM_MEMBER_FIELDS = 'name role companyName phone';
const PHONE_VISIBLE_ROOM_TYPES = new Set(['builder', 'project']);
```

All seven `populate('members.user', 'name role companyName')` literals were replaced
(`createRoom` ×4 — the 409 duplicate, the `ensureProjectGroup` 201, the generic 201, the `11000`
catch; `getRooms`; `joinRoom`; `joinProjectRoom`). Verified by grep that **zero** occurrences of the
old literal remain and that `populate('members` appears only with `ROOM_MEMBER_FIELDS`.

Sanitising happens in ONE function, `sanitizeRoom(room)`, modelled on the existing
`sanitizeMessage()`. It `toObject()`s when possible (so the delete cannot touch mongoose's cached
document), returns the room untouched for `builder` / `project`, and otherwise deletes
`members[].user.phone`. It **fails closed**: an unknown or missing `roomType` is stripped. Members
whose `user` is still an ObjectId (the discover list does not populate them) are skipped.

Every room-bearing response now routes through it. Confirmed by grepping every
`res.status(...).json({ … room … })` in the controller:

- `createRoom` — 409 duplicate, 201 ensured, 201 generic, 409 from the `code === 11000` catch
- `getRooms` — `myRoomsPayload` **and** `discoverRooms` (both via `withProjectCount`, which calls
  `sanitizeRoom` first; this replaced the bare `room.toObject()`)
- `joinRoom` — the "Already a member" 200 and the success 200
- `joinProjectRoom` — the 200

`leaveRoom` and `deleteRoom` return messages only, no room object, so there is nothing to sanitise.

Checked for other leak paths: `GroupRoom` is required by **no other controller**
(`grep GroupRoom HIT_Backend/controllers/*.js` → only `groupChatController.js`), and
`sockets/groupChat.socket.js` fetches rooms for membership checks but never populates members and
never emits a room object. `services/UniversalGroupService.js` only ever runs `updateOne` on
`members.user`. So `getRooms` / `joinRoom` / `joinProjectRoom` / `createRoom` are the complete set.

## Item 4 — project count from ONE aggregation

In `getRooms`, builder ids are collected across **both** `myRooms` and `discoverCandidates`, then:

```js
Project.aggregate([
  { $match: { owner: { $in: builderRoomIds }, status: 'published' } },
  { $group: { _id: '$owner', count: { $sum: 1 } } }
])
```

One query for the whole response, never one per room. `projectCount` is attached to builder rooms
only (a project room is one property, so a count there would be nonsense), matching the client,
which reads `Number(raw?.projectCount) || undefined`.

Per plan decision 8 the now-redundant `Project.distinct('owner', { status: 'published' })` was
**deleted** and `publishedBuilderIds` is derived from the aggregation keys with `count > 0`, so the
net query count for `getRooms` is unchanged.

## Item 5 — `GET /group-chat/rooms/:roomId/media`

Registered in `routes/groupChat.routes.js` next to `GET /rooms/:roomId/messages`, inside the existing
`router.use(protect)` + `router.use(restrictTo(...))` block, so an unauthenticated caller never
reaches the handler.

Membership gate is byte-for-byte the sibling pattern:
`GroupRoom.findOne({ _id: roomId, active: true, 'members.user': userId })` → `403 'Not a member of
this room'`. Invalid `roomId` → 400.

Bounded, never unbounded: `page = max(parseInt||1, 1)`,
`limit = max(min(parseInt||30, 60), 1)`, applied as `.skip().limit()` to both queries. Media uses
`messageType: { $in: ['image','file'] }` (served by the existing `{ messageType: 1, room: 1 }`
index); links use `messageType: 'text'` plus a `https?://` regex on `content`, scoped to one room and
bounded by skip/limit. Both are mapped through the existing `sanitizeMessage`, so the sender's phone
is stripped (these are not inventory cards). Returns `{ media, links, page, limit }`, matching A-7.

## Commands run and their results

```powershell
cd HIT_Backend
node --check controllers\groupChatController.js    # exit 0
node --check routes\groupChat.routes.js            # exit 0
node --check scripts\test-group-info.js            # exit 0
node -e "const c=require('./controllers/groupChatController'); console.log('loaded', typeof c.getRoomMedia, typeof c.sanitizeRoom);"
#   -> loaded function function      (controller requires cleanly, both exports present)

node scripts\test-group-info.js                    # exit 0  —  50 passed, 0 failed
```

```powershell
cd HIT_Mobile; npx tsc --noEmit                    # exit 0, no output
```

The test output was written to `$env:TEMP\hit-gi2.txt` and read back, per the PowerShell 5.1 note —
long inline output gets swallowed on this machine, and the aggregation operators had to live in a
script file rather than `node -e`.

### `node scripts/test-group-info.js` — 50 passed, 0 failed

Pure section, `sanitizeRoom()` (no DB), 12 assertions:

```
  PASS  builder room keeps phone
  PASS  project room keeps phone
  PASS  universal room drops phone
  PASS  area room drops phone
  PASS  universal room keeps the member name
  PASS  universal room keeps the member role
  PASS  unknown roomType drops phone
  PASS  raw member ref survives untouched
  PASS  empty members list is fine
  PASS  null room passes through
  PASS  document path drops phone
  PASS  source document untouched
```

DB section, `getRooms()` through the real handler with a throwaway builder (2 published + 1 draft
project) and four throwaway rooms, 18 assertions:

```
  PASS  responds 200
  PASS  builder room returned
  PASS  project room returned
  PASS  area room returned
  PASS  universal room returned
  PASS  builder room ships phone
  PASS  project room ships phone
  PASS  universal room ships NO phone
  PASS  area room ships NO phone
  PASS  no universal member has a phone
  PASS  every builder member has a phone
  PASS  phone absent from serialised universal room
  PASS  builder room projectCount excludes the draft
  PASS  project room has no projectCount
  PASS  area room has no projectCount
  PASS  published builder stays discoverable
  PASS  discover builder row carries projectCount
  PASS  draft-only builder stays hidden
```

**This is the proof the task asked for.** The privacy assertions are made on the handler's actual
response payload, not on a component: `builder room ships phone` reads the real number back out of
the builder room's payload while, in the **same response**, `universal room ships NO phone` and
`no universal member has a phone` confirm it is absent for every member — and
`phone absent from serialised universal room` runs `JSON.stringify` over the universal room and
asserts the number does not appear anywhere in the bytes that would go over the wire.

`builder room projectCount excludes the draft` = 2 with three projects seeded, so the aggregation
filters on `status: 'published'`. `draft-only builder stays hidden` is the regression guard for the
deleted `Project.distinct` call.

DB section, `getRoomMedia()`, 20 assertions:

```
  PASS  member gets 200
  PASS  three media messages
  PASS  soft-deleted media excluded
  PASS  one link message
  PASS  link-free text excluded
  PASS  system message excluded
  PASS  default page
  PASS  default limit
  PASS  media sender phone stripped
  PASS  link sender phone stripped
  PASS  non-member gets 403
  PASS  non-member gets no media
  PASS  inactive room gets 403
  PASS  invalid roomId gets 400
  PASS  oversized limit clamped to 60
  PASS  page 2 of 2 returns the third media
  PASS  page echoed back
  PASS  page 0 floors to 1 (no negative skip)
  PASS  negative limit floors to 1
  PASS  negative limit returns one row
```

`Cleanup done` printed; every user, project, room and message the script created was deleted in a
`finally` block. The only stderr output was mongoose's
`MongoDB disconnected unexpectedly` warning, emitted by the connection listener during the
deliberate `mongoose.connection.close()` at the end — not a failure (exit code 0).

Test-data safety note: the throwaway universal-type room is created with `roomType: 'universal'` but
`isUniversal: false`. `UniversalGroupService` finds the real community room by `isUniversal: true`
(`services/UniversalGroupService.js` L64, L100), so the test room is invisible to it and no real user
could be auto-joined to it during the run. `sanitizeRoom` keys off `roomType`, which is the thing
under test.

## Not verified here

- No device re-verification (plan item B-5) — that needs a rebuild against a deployed backend, which
  has not happened. The group-info sheet's Media & Links section and member Call/WhatsApp rows are
  therefore still unconfirmed visually against a live server.
- Known limit carried forward from the plan's pagination assessment, deliberately out of scope:
  `getRooms` still populates `members.user` for the universal room, which every user belongs to.
  The sanitiser stops that payload from growing (phone is deleted before serialisation), but the
  follow-up — stop populating universal members entirely and add
  `GET /group-chat/rooms/:roomId/members?page=` — remains open.

## Deploy

Backend is ready to deploy. **Not deployed** — the Cloud Build trigger on `^main$` is disabled and a
deploy is production-affecting, so the orchestrator runs this after user approval:

```powershell
cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Backend"
gcloud builds submit --config=cloudbuild.yaml --substitutions=COMMIT_SHA=<sha> --project=homeintown-486304 .
gcloud run services describe sales-website-backend --region=asia-south1 --project=homeintown-486304 `
  --format="value(status.traffic[0].revisionName,status.traffic[0].percent)"
```

Service `sales-website-backend`, region `asia-south1`, project `homeintown-486304`.
