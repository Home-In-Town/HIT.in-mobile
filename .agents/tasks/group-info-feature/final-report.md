# Group-info feature — final consolidated report

Date: 1 Oct 2026. Covers both phases (mobile A-1…A-9, backend B-1…B-4) of the five work items the
user asked for. **No code was changed in this step** — only the two verification gates below were
re-run.

## Final gate re-run (this step)

| Gate | Command | Result |
| --- | --- | --- |
| Backend controller loadable | `node --check controllers\groupChatController.js` | exit 0 |
| Backend route loadable | `node --check routes\groupChat.routes.js` | exit 0 |
| Backend test script loadable | `node --check scripts\test-group-info.js` | exit 0 |
| Mobile types | `cd HIT_Mobile; npx tsc --noEmit` | exit 0, no diagnostics |

File list taken from `backend-verification.md` ("Files changed") — those three are the complete set of
backend files touched. Nothing failed, so nothing was fixed.

## Repo state — IMPORTANT, differs from the brief

The brief said both repos still hold uncommitted working-tree changes. That is **no longer true**;
checked just now with `git status` / `git log`:

- **`HIT_Backend`: committed AND pushed.** HEAD is `a9a5aee` *"update ui changes"* (author
  pranay bhujade, 1 Oct 14:53), working tree **clean**, `main == origin/main`, 0 commits ahead. That
  commit contains exactly this feature's backend diff: `controllers/groupChatController.js` (+231/-27),
  `routes/groupChat.routes.js` (+4), `scripts/test-group-info.js` (+333 new). So the user pushed the
  backend themselves after the review pass. Nothing was pushed by an agent.
- **`HIT_Mobile`: committed locally, NOT pushed.** `550d5e3` (feature) + `879a000` (review-fix
  iteration) on `main`, which is **10 commits ahead of `origin/main`**. Working tree holds only this
  task's docs (`.agents/tasks/...`) and `gradle-build.txt`, no source changes.
- **Nothing deployed.** Cloud Run `sales-website-backend` is still on the old revision; the Cloud
  Build trigger on `^main$` is disabled, so the pushed backend code is live in git only, **not in
  production**. The installed APK on the device is the one built in this task.
- **No production data migration or backfill was run**, and none is needed: every change is
  read-path (populate + sanitise, one aggregation, one new GET endpoint). No schema write, no
  `--dry-run` migration to show.

---

## Work item 1 — tapping a property card opens the detail sheet

**Changed** — `HIT_Mobile/src/components/GroupChatEmbedded.tsx`

- `BuilderPropertyCard`'s cover + body wrapped in a `Pressable` → `onDetails(project)`, pressed
  opacity, `Details of {name}` accessibility label. `bp.actions` stays outside so Open Group / Share
  keep their own taps.
- Details now calls `handlePropertyViewDetails(p.id)`; the dead `handleBuilderProjectDetails` (which
  built a `compact: true` sheet whose `!compact` gate hid gallery / video / brochure / layout) was
  deleted — grep confirms zero references remain.
- Iteration 2 added `portfolioFallback()` so a deleted / unpublished project or an offline device
  falls through to `sheetFromCard` instead of a bare toast, plus a `detailsId` guard and a per-card
  `ActivityIndicator` while the fetch runs.

**Verified** — `mobile-review.md` pass 2 traced the fallback path and confirmed `detailsId` clears on
every branch (the handler swallows its own errors, so the spinner cannot stick); `tsc` clean;
`BUILD SUCCESSFUL in 5m 1s` at `gradle-build.txt:1429`; APK installed on `ebbbfc95` and the app
launched without a crash (`mobile-checkpoint.md`).

**Not verified** — that a tap on the card *body* actually opens the sheet. Device-visual, PENDING the
user. Known minor, accepted: tapping card B while card A's fetch is in flight is silently dropped
(`mobile-review.md` issue 2).

## Work item 2 — full project details + Share button

**Changed** — `HIT_Mobile/src/components/GroupChatEmbedded.tsx`

- `handlePropertyViewDetails` emits `sections` — Overview, Pricing & Charges, Configuration,
  Amenities, Contact — built from the full `Project`, omitting empty fields instead of printing `'—'`,
  with a `label()` helper de-slugging Status / Category / Payment Plan (`ready to move`, not
  `ready-to-move`). Also sets `shareProjectId` and `slug`.
- The detail `Modal` renders `sections` as titled blocks when present and keeps the old flat `fields`
  branch for the six other `setViewProperty` callers, so Preview Info and the match / post paths look
  unchanged.
- New `shareProject` / `sharingId` state, `handleShareProject` (cached `projectsApiExtended.getById`,
  toast on failure, always clears), `ShareModal` mounted beside the other modals, a Share button in
  the sheet header gated on `shareProjectId`, and an icon-only fixed-width Share in the card's action
  row after Open Group (`bp.btnIcon` — a third labelled button clipped at 186 dp / 9 px).
- Gallery + brochure PDF render because the `compact` gate is gone (item 1).

**Verified** — review pass 2 APPROVED, enum normalisation checked against what `sheetFromCard` has
always produced for `possessionStatus`; `tsc` clean; release build + install OK.

**Not verified** — the sections rendering with no `—` rows, gallery/PDF opening, and Share from the
sheet. Device-visual, PENDING the user. Open finding **M5** (`mobile-review.md` issue 1): Share from
*inside* the sheet mounts `ShareModal` as a second RN `Modal` over the still-visible detail `Modal`.
Deliberately **not** fixed speculatively — it changes what the user sees. If it comes up blank or
behind, the one-line fix is `setViewProperty(null)` before `setShareProject(p)` in the sheet's Share
handler.

## Work item 3 — group info sheet (header tap) + phone privacy

**Changed, client** — `HIT_Mobile/src/components/GroupChatEmbedded.tsx`, `HIT_Mobile/src/lib/api.ts`

- Header avatar + title block is a `Pressable` (`s.threadIdentity`) opening group info for builder /
  project / area rooms, disabled for the universal room. Back chevron and banner dots stay outside it.
- Sheet is a `Modal` reusing `pd.overlay` / `pd.sheet` / `pd.head` with a `FlatList` root: members as
  `data`; avatar, name, verified tick, counts, Admins, Media & Links in `ListHeaderComponent`; Exit /
  Delete Group in `ListFooterComponent`, wired to the existing `handleLeave` / `handleDelete` with the
  existing `canLeave` / `canDelete` / `isGroupOwner` derivations verbatim.
- Exit / Delete were **removed from the 3-dot menu** so each action lives in exactly one place, and
  the then-empty header 3-dot was deleted outright. `onGroupDeleted` and `closeRoom` both close the
  sheet.
- Member rows show Call (`tel:`) and WhatsApp (`wa.me`, 10-digit numbers get a `91` prefix) **only
  when a phone is present**.
- `api.ts`: `phone?: string` on the member user type, `GroupMedia` / `GroupLink`,
  `groupChatApi.getRoomMedia`.

**Changed, server** — `HIT_Backend/controllers/groupChatController.js`

- `ROOM_MEMBER_FIELDS = 'name role companyName phone'` replaces all **seven**
  `populate('members.user', 'name role companyName')` literals (createRoom ×4, getRooms, joinRoom,
  joinProjectRoom); grep confirms zero old literals remain.
- `PHONE_VISIBLE_ROOM_TYPES = new Set(['builder','project'])` + a single `sanitizeRoom()` (modelled on
  the existing `sanitizeMessage()`) that `toObject()`s, returns builder / project untouched and
  otherwise deletes `members[].user.phone`. It **fails closed**: unknown or missing `roomType` is
  stripped.
- Every room-bearing response routes through it: createRoom's 409-duplicate / ensured-201 /
  generic-201 / `11000`-409, both `getRooms` payloads via `withProjectCount`, joinRoom's
  "Already a member" 200 and success 200, joinProjectRoom's 200. `leaveRoom` / `deleteRoom` return
  messages only.

**Verified** — `scripts/test-group-info.js`: **50 assertions, 0 failures**, exit 0. The privacy rule
is asserted on the real `getRooms` handler's response payload in both directions within the *same*
response: `builder room ships phone` / `every builder member has a phone` (= 2) alongside
`universal room ships NO phone` / `no universal member has a phone` (= 0), plus
`phone absent from serialised universal room` which `JSON.stringify`s the universal room and asserts
the number is nowhere in the wire bytes. The pure section covers `unknown roomType drops phone`,
area rooms, documents and null input. `backend-review.md` independently confirmed `GroupRoom` is
required by no other controller, that the socket layer never populates or emits members, and that
`UniversalGroupService` only runs `updateOne` — i.e. there is no second leak path. Verdict APPROVED.
Test data was fully cleaned up in a `finally` block; the throwaway universal-type room used
`isUniversal: false`, so no real user could be auto-joined during the run.

**Not verified** — the sheet's appearance, the Admins / Members lists, Exit / Delete placement, and
that builder / area headers no longer show a group 3-dot. Device-visual, PENDING the user. Also
unverified end-to-end: Call / WhatsApp rows only appear once a server with this code is **deployed** —
the installed APK is talking to the old revision, so today those rows stay hidden.

Non-blocking backend review findings, left as-is (all comment/cost issues, no behaviour change):
`sanitizeRoom`'s ObjectId guard comment is wrong (`typeof objectId === 'object'` is true, so the
`delete` runs and no-ops — harmless); the media index attribution comment credits
`{ messageType: 1, room: 1 }`, which cannot serve `sort({ createdAt: -1 })`.

## Work item 4 — project count next to member count

**Changed, client** — `GroupChatEmbedded.tsx`: `threadSubtitle` inserts `M projects` between the
member count and the Verified / Builder context for builder rooms, from `builderProjects.length`
already in state, rendered only when non-zero so a loading `[]` does not flash "0 projects".
`roomLines` renders an `N projects` segment on builder list rows when `room.projectCount` is a
positive number. `api.ts`: `projectCount?: number` on `GroupRoom`, mapped as
`Number(raw?.projectCount) || undefined`. No new request on either path.

**Changed, server** — `getRooms` collects builder ids across **both** `myRooms` and
`discoverCandidates`, then runs **one** aggregation:

```js
Project.aggregate([
  { $match: { owner: { $in: builderRoomIds }, status: 'published' } },
  { $group: { _id: '$owner', count: { $sum: 1 } } }
])
```

`projectCount` is attached to builder rooms only (a project room is one property). Per plan decision
8 the now-redundant `Project.distinct('owner', { status: 'published' })` was **deleted** and
`publishedBuilderIds` is derived from the aggregation keys with `count > 0`, so `getRooms`' net query
count is unchanged — one aggregation for the whole response, never one per room.

**Verified** — `builder room projectCount excludes the draft` (= 2 with 3 projects seeded, so the
`status: 'published'` filter works), `project room has no projectCount`, `area room has no
projectCount`, `discover builder row carries projectCount`, and `draft-only builder stays hidden` as
the regression guard for the deleted `distinct()`. Review pass confirmed the field name matches what
`transformGroupRoom` reads and that the server's `0` collapses to "no segment" client-side.

**Not verified** — the open builder header reading `N members · M projects · Verified`. Device-visual,
PENDING the user. The groups-**list** `N projects` segment additionally needs the backend deployed.

## Work item 5 — `GET /group-chat/rooms/:roomId/media`

**Changed** — `HIT_Backend/controllers/groupChatController.js` (new `getRoomMedia`),
`HIT_Backend/routes/groupChat.routes.js` (one route line, registered next to
`GET /rooms/:roomId/messages` inside the existing `router.use(protect)` + `restrictTo(...)` block, so
an unauthenticated caller never reaches the handler).

- Membership gate is the sibling pattern byte-for-byte:
  `GroupRoom.findOne({ _id: roomId, active: true, 'members.user': userId })` → `403 'Not a member of
  this room'`. Invalid `roomId` → 400.
- Bounded, never unbounded: `page = max(parseInt||1, 1)`, `limit = max(min(parseInt||30, 60), 1)`,
  applied as `.skip().limit()` to both queries. Media uses `messageType: { $in: ['image','file'] }`;
  links use `messageType: 'text'` plus an `https?://` regex on `content`, scoped to one room.
- Both lists go through the existing `sanitizeMessage`, so the sender's phone is stripped.
- Returns `{ media, links, page, limit }`, matching the client mapper.

**Verified** — 20 of the 50 assertions cover this endpoint: 200 for a member, soft-deleted media
excluded, link-free text and system messages excluded, default page/limit, sender phone stripped on
both lists, **403 for a non-member** (and no media in that body), **403 for an inactive room**, 400
for an invalid id, oversized limit clamped to 60, page 2 of 2, page echoed back, and `page = 0` /
negative `limit` flooring to 1 (no negative skip).

**Not verified / known limits** — the sheet's Media & Links section has never rendered real data: the
client treats the current 404 as "nothing shared yet", and it will stay empty until the backend is
deployed. Review findings carried forward, non-blocking: the link query's `$regex` + `createdAt` sort
scans a room's text history (skip/limit bounds rows returned, not documents examined), and every
authenticated user is a member of the universal room, so the endpoint is callable there even though no
client opens group info for it; media and links also share one `page`/`limit` with no `hasMore`, which
will matter only if a "load more" is added. One client-side nit: a mapped entry whose URL regex finds
nothing renders a tappable row with an empty `url` (`Linking.openURL('')` rejects into a swallowed
catch) — `mobile-review.md` issue 3, only reachable once the endpoint is live.

---

## Universal-room member-list pagination — planner's assessment (surfaced as asked)

The planner's explicit conclusion: **group info does not need server-side member pagination, and this
change must not add it.** The universal room's header is deliberately not pressable, so its member
list is never rendered; builder / project / area member lists are small enough for the `FlatList`.
Group info reads `activeRoom.members`, already in memory — zero extra requests. The real scale
problem is pre-existing: `getRooms` populates `members.user` for every room including the universal
one. Adding `phone` would have grown that payload, which is exactly why the sanitiser deletes `phone`
from universal members before serialisation — so for the one room with a large member list the payload
does not grow.

**Open follow-up, deliberately out of scope:** stop populating `members.user` for the universal room
in `getRooms` (send `memberCount` instead) and add `GET /group-chat/rooms/:roomId/members?page=`. That
changes the shape `getRooms` returns for the universal room and touches `computeUnreadCounts` (reads
`room.members` for the caller's `lastReadAt`) and the universal header's `activeRoom.members.length`.
Shipping it alongside the privacy work would have made the diff hard to review for the thing that most
needed reviewing.

## What could NOT be verified at all

1. **Everything visual. PENDING the user looking at the phone.** `adb shell screencap` returns an
   all-black image on `ebbbfc95` and `input tap` is silently swallowed while the screen is locked. No
   screenshot or synthetic tap was used and none may be read as evidence. The APK is installed
   (`in.homeintown.mobile`, `lastUpdateTime=2026-10-01 14:31:03`) and the app boots clean (zero
   `AndroidRuntime:E` lines).
2. **Anything needing the new backend live** — member Call / WhatsApp rows, the groups-list
   `N projects` segment, and the Media & Links section. The installed APK talks to the current Cloud
   Run revision, which does not have this code yet.
3. One pre-existing soft warning seen in logcat, not a regression:
   `VirtualizedList: You have a large list that is slow to update` (`dt: 846`) on the long groups /
   message list.

## Deploy — run only after the user approves

```powershell
cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Backend"
gcloud builds submit --config=cloudbuild.yaml --substitutions=COMMIT_SHA=<sha> --project=homeintown-486304 .
```

Use `<sha>` = `a9a5aee` (current `HIT_Backend` HEAD, already on `origin/main`). Then confirm the new
revision took 100% of traffic:

```powershell
gcloud run services describe sales-website-backend --region=asia-south1 --project=homeintown-486304 `
  --format="value(status.traffic[0].revisionName,status.traffic[0].percent)"
```

Service `sales-website-backend`, region `asia-south1`, project `homeintown-486304`. Current live
revision before this deploy: `00162-m7l` at 100%.

`HIT_Mobile`'s `main` is 10 commits ahead of `origin/main` and needs the user's go-ahead before any
push.

## Device checklist for the user

On `ebbbfc95`, in a **builder** group:

1. Tap a property card **on its body** (not the Details button) — the detail sheet should open.
2. In the sheet: Overview / Pricing & Charges / Configuration / Amenities / Media / Contact, **no `—`
   placeholder rows**, Status / Category / Payment Plan in words (`ready to move`, not
   `ready-to-move`), gallery images and the brochure PDF open.
3. Share from the card's icon button **and** from inside the detail sheet. The sheet one is finding
   M5 — say so if it comes up blank or behind the sheet.
4. Tap the group **header** (avatar + name) — group info opens with avatar, verified tick, counts,
   Admins, Members, and Exit / Delete Group at the bottom. Confirm builder / area headers have **no**
   3-dot any more.
5. The open builder header subtitle reads `N members · M projects · Verified`.

Items that will only work after the backend deploy, so skip them for now: member Call / WhatsApp rows,
`N projects` on the groups-list rows, and the Media & Links section.
