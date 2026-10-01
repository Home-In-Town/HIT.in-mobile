# Implementation Plan — Group info, full property detail, Share, project count

Built **on top of** the uncommitted edits recorded in `mobile-baseline-diff.txt`
(`app/(dashboard)/lead-matching.tsx` + `src/components/GroupChatEmbedded.tsx`). Nothing in those
two files is to be reverted, stashed or re-derived. All line numbers below are **approximate, from
the current working tree** (with the baseline diff applied) — locate by symbol name, not by number.

Repo roots:
- Mobile: `c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile`
- Backend: `c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Backend`

---

## Design decisions made while planning (do not re-litigate)

1. **Detail sheet gets an optional `sections` field, `fields` stays.** `viewProperty` is set from
   seven call sites (`handlePropertyViewDetails`, `handlePreviewMatch`, `handleViewInventoryMatch`,
   the two `PostCard` `onView` handlers, `handleViewMatchedProject`). Rewriting the shape would
   touch all of them. Instead the sheet renders `viewProperty.sections` (labelled groups) **when
   present** and falls back to the existing flat `viewProperty.fields` otherwise. Only the full-project
   path sets `sections`; every other caller is untouched. `compact: true` keeps meaning exactly what
   it means today — short, media-free — so `handlePreviewMatch` is not affected.
2. **Share from the card fetches the full `Project` on demand via `projectsApiExtended.getById`.**
   `ShareModal` needs a `Project` (it reads `project.id`, `project.name`, `project.slug`,
   `project.brochureUrl` and calls `shareApi.generateToken`). The card only has an
   `OwnerPortfolioProject`. `getById` is already behind a 60 s cache + in-flight dedupe
   (`api.ts` ~L965-1000), and the card-body tap already calls it, so the share tap is normally a
   cache hit and costs nothing. **Do not string-build a share URL** — `ShareActions.getVisitUrl` +
   `shareApi.generateToken` already derive it.
3. **The card's Share is an icon-only button, not a third full-width button.** `bp.card` is 186 dp
   wide and `bp.actions` already holds two `flex: 1` buttons at 9 px text. A third labelled button
   would clip. Share goes in the same row as a fixed-width (~30 dp) icon button after Open Group,
   with `accessibilityLabel`. Details / Open Group keep `flex: 1`.
4. **The group-info sheet's root scroller is a `FlatList` whose `ListHeaderComponent` carries
   everything above the member list** (avatar, name, verified, counts, Admins, Media & Links) and
   whose `data` is the members. This satisfies the virtualization requirement without nesting a
   `VirtualizedList` inside a `ScrollView` (which RN warns about and which defeats virtualization).
5. **Area rooms also open group info.** Work item 3 names builder + project, but the 3-dot menu is
   where Exit/Delete currently live for *area* rooms too (`!isUniversal && !proj` → header dots).
   Removing them from the 3-dot without making the area header pressable would strand area-group
   members with no way to leave. The sheet needs nothing type-specific except the project count, so
   area rooms get the same sheet minus that line. **Universal stays NOT pressable** — it has
   `canLeave: false`, no owner, a potentially huge member list, and its phone numbers must never be
   shown (see item 12).
6. **The lifecycle 3-dot must stop rendering when it would be empty.** Once Exit/Delete move out,
   the header dots for a builder or area room have nothing left (media items are gated on
   `hasProjectMedia`, which is false without a linked project). Gate the header dots on
   `hasProjectMedia` so no dead affordance ships.
7. **Project count on list rows is backend-supplied, read optionally on the client.** `roomLines` is
   pure over `room`. The client reads `room.projectCount` and renders the segment only when it is a
   positive number, so the mobile phase ships and verifies *before* any backend change and the number
   simply appears once the backend lands. No new mobile request.
8. **The single project-count aggregation also replaces the existing `Project.distinct('owner', …)`
   in `getRooms`.** That distinct already answers "which builders have a published project"; the
   aggregation answers it with a count. Deriving `publishedBuilderIds` from the aggregation keys
   removes one query instead of adding one.

### Pagination assessment for the universal room (asked for explicitly)

**Group info does not need server-side member pagination, and this change must not add it.** Reasons:

- The universal room's header is deliberately **not** pressable (decision 5), so its member list is
  never rendered. Builder / project / area rooms are the only ones that open the sheet, and their
  member lists are small enough that the `FlatList` in decision 4 is sufficient.
- The real scale problem is **pre-existing and in `getRooms`**: it populates `members.user` for every
  room the user is in, including the universal room that every user belongs to
  (`groupChatController.js` ~L331). Group info reads `activeRoom.members`, which is already in
  memory — it adds **zero** requests and does not make the Groups list slower.
- Adding `phone` to that populate would make the existing payload bigger per member. The
  universal-room sanitiser (item 12) **deletes** `phone` from universal members before the response
  is serialised, so for the one room that actually has a large member list the payload does not grow.

**Recommended follow-up, explicitly out of scope here:** stop populating `members.user` for the
universal room in `getRooms` (send `memberCount` instead) and add
`GET /group-chat/rooms/:roomId/members?page=`. That changes the shape `getRooms` returns for the
universal room and touches `computeUnreadCounts` (which reads `room.members` to find the caller's
`lastReadAt`) plus the universal header's `activeRoom.members.length`. Doing it in the same pass as
the privacy work would make the diff hard to review for the exact thing that most needs reviewing.
Record it in the final report as a known limit, do not silently ship it.

### Ambiguities resolved

- *"total project bhi dhakho"* → interpreted as **the builder's published project count**, shown on
  **builder** rooms only (open header + list rows). Project / area / universal rooms show no project
  count: a project room is one property, so "18 projects" there would be nonsense.
- *Member phone visibility* → the user asked for phone in builder + project groups. Area groups are
  not builder showcases, so **area rooms get no phone either** — same server rule as universal: strip
  unless `roomType` is `builder` or `project`. This is stricter than asked, never looser.
- *"Media & Links"* in the sheet depends on a backend endpoint that lands in the **backend** phase.
  During the mobile phase the section must render a loading state, then an empty state on failure —
  never an error toast and never a crash.

---

# PHASE A — MOBILE (do all of this, verify on the device, then stop)

Nothing in Phase A requires a backend change. Verify after each item with:

```powershell
cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile"; npx tsc --noEmit
```

(expected: no output, exit 0). The release build + device install happen once, at item A-9.

- [ ] **A-1. Make the detail sheet render labelled sections, and give it a Share button.**
      In `src/components/GroupChatEmbedded.tsx`, the View Property `Modal` (~L2689-2755). Render
      `viewProperty.sections` (`Array<{ title: string; fields: Array<{ label: string; value: string }> }>`)
      as a titled block per section reusing `pd.detailList` / `pd.detailRow` / `pd.detailLabel` /
      `pd.detailValue`; keep the existing flat `viewProperty.fields` branch for every caller that does
      not set `sections`. Add a section-title style next to `pd.mediaTitle` (same weight/size family).
      Add a Share button in the sheet header row, shown only when `viewProperty.shareProjectId` is
      set — it calls the share handler added in A-3. Leave the `!viewProperty?.compact` gate on the
      media block exactly as it is. Comment must say the previous behaviour was one flat list of
      ~6 fields and why sections replace it for the full-project path only.
      Files: `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean. Opening any existing Details / Preview Info path still shows
      the same flat fields (no visual change for them) — confirmed at A-9 on device.

- [ ] **A-2. Make `handlePropertyViewDetails` emit the FULL property as sections.**
      Same file, `handlePropertyViewDetails` (~L1536-1600). It already fetches
      `projectsApiExtended.getById(projectId)`. Replace its flat `fields` with `sections`:
      - **Overview** — `propertyType`/`type`, `projectStatus`, `category`, `reraApproved`/`reraNumber`,
        `gatedCommunity`, `owner.companyName || owner.name`
      - **Pricing & Charges** — `startingPrice` (via `fmtPrice`), `totalPriceRange`, `pricePerSqFt`,
        `paymentPlan`, `gstPercentage`, `stampDutyPercentage`, `registrationCharges`,
        `maintenanceCharges`, `otherCharges`, `bankLoanAvailable`
      - **Configuration** — `bhkOptions`, `carpetAreaRange`, `floorRange`, `plotSizeRange`,
        `facingOptions`
      - **Amenities** — `amenities` joined
      - **Contact** — `cta.buttonText`, `cta.callNumber`, `cta.whatsappNumber`
      Every field is **omitted when empty** (no `'—'` placeholders; the current code prints `'—'` for
      Property Type and Status — that is the behaviour being corrected, say so in the comment).
      Keep `galleryImages` / `videos` / `layoutImage` / `brochureUrl` exactly as they are built today
      (Media section already renders them). Set `shareProjectId: p.id` and `slug: p.slug`. Do **not**
      set `compact`. The `sheetFromCard` fallback path stays flat `fields` — it has no project to
      expand. Every field listed above already exists on the flat `Project` interface
      (`src/lib/api.ts` ~L863-907) and is populated by `transformProject` — no API change needed.
      Files: `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean.

- [ ] **A-3. Add Share state + handler, and mount `ShareModal`.**
      Same file. `import { ShareModal } from './ShareActions';` and `Project` from `../lib/api`.
      Add `const [shareProject, setShareProject] = useState<Project | null>(null);` and
      `const [sharingId, setSharingId] = useState<string | null>(null);`. Add
      `handleShareProject = useCallback(async (projectId: string) => { … })` — guards on `sharingId`,
      `await projectsApiExtended.getById(projectId)`, `setShareProject(p)`, toast on failure, always
      clears `sharingId`. Render `{shareProject && <ShareModal project={shareProject} onClose={() => setShareProject(null)} />}`
      alongside the other modals, following the usage in `app/(dashboard)/projects.tsx` (~L287).
      Comment why a fetch is needed (the card holds only an `OwnerPortfolioProject`) and that
      `getById` is cached so this is normally free.
      Files: `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean.

- [ ] **A-4. Work item 1 — make the whole builder card tappable, point Details at the full
      detail path, add Share to the card, delete the dead compact handler.**
      `BuilderPropertyCard` (~L490-556) and the strip that renders it (~L2425-2465):
      - Wrap the cover + `bp.body` in a `Pressable` with `onPress={() => onDetails(project)}`,
        `accessibilityRole="button"`, `accessibilityLabel={`Details of ${project.name}`}`, and a
        pressed opacity. Do **not** wrap `bp.actions` — nested pressables would swallow the two
        buttons' taps.
      - Add an `onShare` prop; render a fixed-width icon-only Share button in `bp.actions` after
        Open Group (per decision 3), with a spinner while `sharing`. Add `bp.btnIcon` (fixed width,
        no `flex`) to the `bp` StyleSheet (~L3799-3836). Plain `StyleSheet`, tokens from
        `src/theme.ts` only.
      - At the call site pass `onDetails={(p) => handlePropertyViewDetails(p.id)}` and
        `onShare={(p) => handleShareProject(p.id)}` and `sharing={sharingId === p.id}`.
      - **Delete `handleBuilderProjectDetails`** (~L1631-1648) — grep the file first to confirm it has
        no other caller; the only one is the strip.
      Comment must record the previous behaviour precisely: the card body was inert, and Details built
      a `compact: true` sheet whose four portfolio fields were gated out of the media block, so
      gallery / video / brochure / layout never rendered.
      Files: `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean; `grep handleBuilderProjectDetails` returns nothing.
      **Runtime check required at A-9** — the report "card pr click kiya to detail nahi dhikhti" is
      explained by both causes above, but if the sheet still fails to open on device after this item,
      treat that as a third, unverified cause and debug it; do not declare it fixed from code reading.

- [ ] **A-5. Work item 4 (client half) — project count in the open builder-room header.**
      Same file, `threadSubtitle` (~L2193-2214). In the `roomType === 'builder'` branch insert a
      `${builderProjects.length} project(s)` segment between `memberText` and the
      Verified/Builder/Agent context, producing e.g. `1 member · 18 projects · Verified`. Render the
      segment only when `builderProjects.length > 0` (it is `[]` while `loadingBuilderProjects` is
      true, ~L912-921 — a flashing "0 projects" is worse than nothing). No request: the array is
      already component state (~L714-716).
      Files: `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean; checked visually at A-9.

- [ ] **A-6. Work item 4 (client half) — project count on the groups-list rows, read optionally.**
      Add `projectCount?: number` to the `GroupRoom` interface (`src/lib/api.ts` ~L1403-1475) and map
      it in `transformGroupRoom` (~L1530) as `Number(raw?.projectCount) || undefined`. In
      `roomLines` (~L91-124) builder branch, add the `N projects` segment when
      `typeof room.projectCount === 'number' && room.projectCount > 0`. Comment that the backend
      supplies this (one aggregation, not a count per room) and that the segment is absent until it
      does, so the mobile change is independently shippable.
      Files: `src/lib/api.ts`, `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean. Rows still render correctly with the field absent.

- [ ] **A-7. Add the group-media API client, tolerant of a missing endpoint.**
      `src/lib/api.ts`, in `groupChatApi` (~L1581+) next to `getMessages`. Add
      `async getRoomMedia(roomId: string, params?: { page?: number; limit?: number }): Promise<{ media: GroupMedia[]; links: GroupLink[]; page: number; limit: number }>`
      plus the two small exported interfaces (`GroupMedia`: `id, messageType: 'image' | 'file', url,
      name?, mimeType?, size?, createdAt, sender`; `GroupLink`: `id, url, createdAt, sender`). Follow the
      existing fetch + `authHeaders()` + `handleResponse` pattern. Comment that the endpoint lands in
      the backend phase and that callers must treat a failure as "no media yet", not an error.
      Files: `src/lib/api.ts`
      Verify: `npx tsc --noEmit` clean.

- [ ] **A-8. Work item 3 (client half) — the group-info sheet; move Exit/Delete into it; make the
      header pressable.**
      All in `src/components/GroupChatEmbedded.tsx`. This is one item because the sheet and the 3-dot
      removal must land together — splitting them would ship a build where Exit Group is unreachable.
      - **New state:** `const [showGroupInfo, setShowGroupInfo] = useState(false);` plus
        `groupMedia` / `loadingGroupMedia` state. Load media in an effect that runs when
        `showGroupInfo` turns true (not on room open — the Groups list must not get slower), calling
        `groupChatApi.getRoomMedia(activeRoom.id)` and `.catch(() => setGroupMedia({ media: [], links: [] }))`.
      - **Header pressable:** wrap the avatar + title/subtitle block of `s.threadHeader` (~L2222-2250)
        in a `Pressable` → `setShowGroupInfo(true)`, enabled for `roomType` `builder` / `project` /
        `area` and **not** for `isUniversal` (decision 5). Keep the back chevron and the two dots
        outside that Pressable. `accessibilityRole="button"`,
        `accessibilityLabel="Group info"`. The whole header already sits behind `!headerless`, which
        is unchanged — AI-Leds headerless mode has no group header to tap.
      - **New sheet** — a `Modal` (transparent, `animationType="slide"`) reusing `pd.overlay` /
        `pd.sheet` / `pd.head`, with a `FlatList` root per decision 4:
        - `ListHeaderComponent`: group avatar (`ROOM_ICON[roomType]`), `roomDisplayName(activeRoom)`,
          verified tick (`BadgeCheck`, green — already imported) when `activeRoom.builder?.isVerified`,
          `N members · M projects` (members from `activeRoom.members.length`, projects from
          `builderProjects.length`, builder rooms only), an **Admins** block
          (`activeRoom.members.filter(m => m.role === 'admin')`), a **Media & Links** block driven by
          `groupMedia` with loading / empty states and `Linking.openURL` per entry (reuse
          `pd.mediaThumb` / `pd.mediaBtn` / `pd.mediaBtnText`), and a `Members` section label.
        - `data`: `activeRoom.members`. Row = name, `role`, an `Admin` pill when
          `m.role === 'admin'`, "You" marker when `m.user.id === user?.id`, and — **only when
          `m.user.phone` is present** — a Call and a WhatsApp action. Call: `Linking.openURL(`tel:${num}`)`
          inside try/catch with the toast-on-reject pattern already used by `handlePropertyCall`
          (~L1750-1775, which documents why `canOpenURL` must not gate it). WhatsApp:
          `https://wa.me/${digits.length === 10 ? '91' + digits : digits}` matching
          `AiAssistant.tsx` ~L1960. The client renders phone **if present** and nothing else — the
          privacy rule is enforced on the server (B-1); say that in the comment so nobody later
          "simplifies" it into a UI-only check.
        - **Group actions at the bottom** (`ListFooterComponent`): `Exit Group` when `canLeave`,
          `Delete Group` when `canDelete`. Wire to the **existing** `handleLeave` / `handleDelete`
          (~L1965-2000) unchanged, and use the **existing** `canLeave` / `canDelete` / `isGroupOwner`
          derivations (~L1961-1963) **verbatim** — do not re-derive, do not loosen, do not add a new
          permission path.
      - **Remove `Exit Group` and `Delete Group` from the 3-dot menu** (~L2313-2323) so each action
        lives in exactly one place. Then gate the **header** 3-dot (~L2404 region, the
        `!activeRoom.isUniversal && !proj` button) on `hasProjectMedia` so it is not rendered empty
        for builder / area rooms (decision 6). The banner dots for project rooms keep the four media
        items and stay as they are.
      - New styles go in a new `gi` StyleSheet next to `bp` / `pd` / `dp` (~L3799-3900), plain
        `StyleSheet`, `colors` from `src/theme.ts` only. **No NativeWind.**
      Comment density must match the file: state that Exit/Delete used to live in the 3-dot, that the
      user asked for WhatsApp-style group info, and that the header dots now hide when empty.
      Files: `src/components/GroupChatEmbedded.tsx`
      Verify: `npx tsc --noEmit` clean. Grep confirms exactly one `handleLeave` and one
      `handleDelete` call site each.

- [ ] **A-9. Build, install, and hand the device to the user — the mobile checkpoint.**
      ```powershell
      cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile"; npx tsc --noEmit
      cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile\android"; .\gradlew.bat assembleRelease
      $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"; & $adb devices
      & $adb -s ebbbfc95 install -r "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile\android\app\build\outputs\apk\release\app-release.apk"
      ```
      Gradle: judge success by the **output text** containing `BUILD SUCCESSFUL`, not the exit code
      (`gradlew.bat` piped through `Select-Object` exits 1 even on success). If adb reports
      `unauthorized`, run `adb reconnect`; if the device is absent, ask the user to plug in and unlock.
      Package is `in.homeintown.mobile` — never touch `in.homeintown.app`.
      Then **ask the user to look** and confirm, in a company group:
      1. tapping the card body opens the detail sheet (not just the Details button);
      2. the sheet shows Overview / Pricing & Charges / Configuration / Amenities / Media / Contact
         with no `—` rows, and gallery + brochure open;
      3. Share works from the card **and** from inside the sheet;
      4. tapping the group header opens group info with admins, members, and Exit/Delete at the
         bottom — and the 3-dot no longer offers them;
      5. the header reads `N members · M projects · Verified`.
      adb screenshots come back fully black on this phone and a locked screen swallows `input tap` —
      **do not claim any of this was verified from a screenshot.**
      Files: none (build/install only)
      Verify: `BUILD SUCCESSFUL` in the gradle output, `Success` from `adb install`, and the user's
      explicit confirmation of the five points above.

**STOP HERE until the user has looked.** Phase B begins only after that.

---

# PHASE B — BACKEND (only after the mobile checkpoint passes)

No test runner exists in `HIT_Backend` (`npm test` is a stub). The repo's convention is standalone
scripts under `scripts/` that assert with a `check()` helper and clean up after themselves — see
`scripts/test-builder-groups.js`, which exports-and-tests the pure `canPublishMedia` with no DB plus
a DB half behind `connectDB()`. Follow that pattern. Deploys stay manual and are **not** part of this
plan — ask the user before `gcloud builds submit` and before pushing `main`.

- [ ] **B-1. Work item 3 (server half) — populate member phone, then strip it per room type in ONE
      place.**
      `controllers/groupChatController.js`:
      - Add `const ROOM_MEMBER_FIELDS = 'name role companyName phone';` next to
        `ROOM_PROJECT_FIELDS` / `ROOM_BUILDER_FIELDS` (~L17-35) and replace the string literal at
        **all seven** `populate('members.user', 'name role companyName')` sites: ~L266, ~L277, ~L293,
        ~L300, ~L331, ~L439, ~L517.
      - Add `function sanitizeRoom(room)` next to the existing `sanitizeMessage` (~L76-88), modelled on
        it: `toObject()` when available, then **delete `members[].user.phone` unless
        `roomType` is `'builder'` or `'project'`** (so universal and area rooms never ship a number).
        Guard for members whose `user` is still an ObjectId (the discover list does not populate them).
        `exports.sanitizeRoom = sanitizeRoom;` for the test script, mirroring `exports.canPublishMedia`.
      - Route **every** room-bearing response through it: `createRoom` (the 409 duplicate, the
        `ensureProjectGroup` 201, the generic 201, the `code === 11000` catch), `getRooms` (both
        `myRoomsPayload` — which already calls `room.toObject()` — and `discoverRooms`), `joinRoom`,
        `joinProjectRoom`, and the leave/delete responses if they return a room.
      - Comment must state the rule and **why it is server-side**: hiding the number only in the
        component still ships every universal member's phone over the wire.
      Also add `phone?: string` to the member user type in `HIT_Mobile/src/lib/api.ts` `GroupRoom`
      (~L1465) and map it in `transformGroupRoom` (~L1527).
      Files: `HIT_Backend/controllers/groupChatController.js`, `HIT_Mobile/src/lib/api.ts`
      Verify: `node --check controllers/groupChatController.js`; the new `scripts/test-group-info.js`
      (B-4) asserts phone survives for `builder` and `project` and is gone for `universal` and
      `area`; `cd HIT_Mobile; npx tsc --noEmit` clean.

- [ ] **B-2. Work item 4 (server half) — `projectCount` on builder rooms from ONE aggregation.**
      `controllers/groupChatController.js`, `exports.getRooms` (~L313-395). Collect the builder ids of
      every `roomType === 'builder'` room across **both** `myRooms` and `discoverCandidates`, then run a
      single
      `Project.aggregate([{ $match: { owner: { $in: ids }, status: 'published' } }, { $group: { _id: '$owner', count: { $sum: 1 } } }])`.
      Build a `Map<ownerId, count>` and attach `projectCount` to each builder room in both payloads.
      Per decision 8, derive `publishedBuilderIds` from the map's keys (`count > 0`) and **delete the
      now-redundant `Project.distinct('owner', …)` call** (~L367-375) — net query count is unchanged.
      Comment that a count-per-room would be an N+1 on a list that routinely holds dozens of groups,
      the same reasoning `computeUnreadCounts` already documents (~L88-100).
      Files: `HIT_Backend/controllers/groupChatController.js`
      Verify: `node --check`; `scripts/test-group-info.js` asserts the count matches a known builder's
      published project total and that an unpublished project is not counted; the discover list still
      excludes a builder whose only project is a draft (the behaviour the deleted `distinct` provided).

- [ ] **B-3. Work item 5 — `GET /group-chat/rooms/:roomId/media`, membership-checked and bounded.**
      New `exports.getRoomMedia` in `controllers/groupChatController.js`, modelled on
      `exports.getMessages` (~L907-935):
      - Validate `roomId` with `mongoose.Types.ObjectId.isValid`, then
        `GroupRoom.findOne({ _id: roomId, active: true, 'members.user': userId })` → **403
        `'Not a member of this room'`** when absent, identical to its siblings.
      - Two bounded queries, never an unbounded list: media =
        `{ room, deleted: false, messageType: { $in: ['image', 'file'] } }` (served by the existing
        `{ messageType: 1, room: 1 }` index), links =
        `{ room, deleted: false, messageType: 'text', content: /https?:\/\//i }`. Both
        `.sort({ createdAt: -1 })`, `.populate('sender', MESSAGE_SENDER_FIELDS)`, `.skip((page-1)*limit)`,
        `.limit(limit)` with `limit = Math.min(parseInt(req.query.limit) || 30, 60)`.
      - Map through the existing `sanitizeMessage` so the sender's phone is stripped (these are not
        inventory cards) — that is exactly the leak `sanitizeMessage` was written for.
      - Return `{ media, links, page, limit }` matching the client shape from A-7.
      Register it in `routes/groupChat.routes.js` beside `GET /rooms/:roomId/messages` (~L32), inside
      the existing `protect` + `restrictTo` block. Comment why the link query is a bounded regex scan
      rather than extracting URLs from the whole history.
      Files: `HIT_Backend/controllers/groupChatController.js`, `HIT_Backend/routes/groupChat.routes.js`
      Verify: `node --check` on both; `scripts/test-group-info.js` asserts 403 for a non-member, a
      bounded result length for a seeded room, and that `limit` above 60 is clamped.

- [ ] **B-4. Add `HIT_Backend/scripts/test-group-info.js` covering B-1, B-2, B-3.**
      Follow `scripts/test-builder-groups.js` exactly: a doc comment with a `Usage:` line, a `check()`
      helper counting pass/fail, a pure section (`sanitizeRoom` over hand-built room objects for all
      four `roomType` values — no DB), a DB section behind `require('../config/db').connectDB()` using
      throwaway tagged users / projects / rooms for the aggregation and the media endpoint's handler,
      full cleanup, and a non-zero exit when anything fails.
      PowerShell 5.1 note: `$match` / `$group` break parsing inside an inline `node -e`, so this must
      be a **file**, never an inline command. Long output gets swallowed — tee to a file under
      `$env:TEMP` and read it back.
      Files: `HIT_Backend/scripts/test-group-info.js`
      Verify: `cd HIT_Backend; node scripts/test-group-info.js` prints all PASS and exits 0.

- [ ] **B-5. Re-verify mobile against the real backend, then report.**
      With the backend changes in place, rebuild and reinstall per A-9 and ask the user to confirm the
      two things that could only be verified once the server answers: member rows show Call /
      WhatsApp in a builder or project group (and no phone anywhere in **AI Lead Matching**), and the
      groups-list rows now show `N projects` on company rows. Then write the final report: what
      changed, what the user confirmed visually, the universal-room pagination follow-up from the
      assessment above, and the fact that **nothing was deployed or pushed** — Cloud Build's `^main$`
      trigger is disabled and both repos' `main` is unpushed. Ask before `gcloud builds submit` and
      before `git push`.
      Files: none
      Verify: user confirmation of both points; `cd HIT_Mobile; npx tsc --noEmit` clean and
      `BUILD SUCCESSFUL` in the gradle output.

---

## Guardrails for the implementer

- Plain `StyleSheet` + `src/theme.ts` tokens only. **Never** NativeWind or utility classes — it
  crashes production builds (the mobile README still mentions NativeWind; it is stale, steering wins).
- Comments explain **why**, and when behaviour changes they state the previous behaviour and why it
  was wrong. Match the surrounding density, which is high in both of these files.
- Reuse `ShareModal`, the existing `viewProperty` sheet, `fmtPrice`, `handleLeave` / `handleDelete`,
  `sanitizeMessage`, `handlePropertyCall`'s dialer pattern. No parallel implementations.
- Keep the diff focused. The known pre-existing issues (`projectStatus: 'ready-to-move'` vs the
  `'ready'` filter, the missing delete confirmation in `projects.tsx`, the unreachable
  `AiAssistant` add-to-group code, `project_announcement` having no `MessageBubble` branch) are **out
  of scope** — do not touch them.
- Do not loosen `isGroupOwner` / `canDelete` / `canLeave`. Do not add a second way to leave or delete.
- Ask before pushing `main` in either repo, and before any production deploy or data migration
  (show a `--dry-run` first).
- If any reported symptom survives the fix, treat it as a cause not yet found and debug at runtime.
  Never conclude "already working" from reading code alone.
