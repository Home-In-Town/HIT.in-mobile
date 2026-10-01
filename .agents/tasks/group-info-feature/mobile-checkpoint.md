# Mobile checkpoint (A-9) — build, install, launch

Run on 1 Oct 2026 against commit `879a000` (`fix(groups): builder-card details fallback, pending
spinner, drop dead header dots`) on top of `550d5e3` (`feat: group info sheet, full property detail
sections, share, project counts`). Nothing was committed, pushed or deployed in this step.

## Results

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` in `HIT_Mobile` | **clean** — no diagnostics, exit 0 |
| `gradlew.bat assembleRelease` | **`BUILD SUCCESSFUL in 5m 1s`** (literal text in `gradle-build.txt`; the piped exit code is not trusted) |
| APK | `android/app/build/outputs/apk/release/app-release.apk`, 58,130,161 bytes (55.4 MiB), written 14:30:28 |
| `adb devices` | `ebbbfc95  device` — present, authorised, no `reconnect` needed |
| `adb install -r` | **`Success`** (Streamed Install). `dumpsys` confirms `in.homeintown.mobile` `lastUpdateTime=2026-10-01 14:31:03`. `in.homeintown.app` untouched. |
| Launch (`monkey … LAUNCHER 1`) + 12 s | **no crash** |
| `logcat -d -s AndroidRuntime:E ReactNativeJS:*` | **zero `AndroidRuntime:E` lines.** `ReactNativeJS` shows `Running "main"`, then `'[Socket] connected', 'mPXN-vLUczbKTiWAAABn'`. One pre-existing perf warning only: `VirtualizedList: You have a large list that is slow to update` (`dt: 846`). `pidof in.homeintown.mobile` → `30287`, the same pid as the log lines, i.e. the process was still alive after the wait. |

The `VirtualizedList` warning is a soft RN warning, not a crash, and it fires on the long groups /
message list that predates this feature — worth noting, not blocking.

## Visual confirmation: PENDING the user

**Nothing in this feature was verified visually.** On this phone `adb shell screencap` returns an
all-black image and `input tap` is silently swallowed while the screen is locked, so no screenshot or
synthetic tap was used and none may be read as evidence. The APK is installed and the app boots; the
five on-device checks below are still open and need the user to look at `ebbbfc95`.

1. Tapping a builder property card **on its body** (not only the Details button) opens the detail
   sheet.
2. The sheet shows Overview / Pricing & Charges / Configuration / Amenities / Media / Contact, with
   no `—` placeholder rows, Status / Category / Payment Plan reading as words rather than slugs
   (`ready to move`, not `ready-to-move`), and gallery + brochure PDF opening.
3. Share works from the card's icon button **and** from inside the detail sheet. The sheet case is the
   open review finding **M5**: `ShareModal` mounts as a second RN `Modal` over the still-visible detail
   `Modal`. If it comes up blank or behind, the fix is `setViewProperty(null)` before
   `setShareProject(p)` in the sheet's Share handler — deliberately not applied speculatively because
   it changes what the user sees.
4. Tapping the group header (avatar + name block) opens group info with the avatar, verified tick,
   counts, Admins, Members and Exit / Delete Group at the bottom — and builder / area rooms show **no**
   group 3-dot in the header at all any more.
5. The open builder-room header subtitle reads `N members · M projects · Verified`.

## Per work item — what changed, and what is left to see

### Work item 1 — card tap opens the detail sheet (plan A-4)

`src/components/GroupChatEmbedded.tsx`. `BuilderPropertyCard`'s cover + body are wrapped in a
`Pressable` → `onDetails(project)` with a pressed opacity and `Details of {name}` accessibility
label; `bp.actions` stays outside it so the two buttons keep their own taps. The call site now points
Details at `handlePropertyViewDetails(p.id)` and the dead `handleBuilderProjectDetails` (which built a
`compact: true` sheet whose `!compact` gate hid gallery / video / brochure / layout) is deleted — grep
confirms zero remaining references. Iteration 2 added `portfolioFallback()` so a deleted / unpublished
project or an offline device falls through to `sheetFromCard` instead of a bare toast, plus a
`detailsId` guard and an `ActivityIndicator` on the Details button while the fetch runs.

Left to see: check 1 above. Also note a confirmed minor behaviour — tapping a second card while the
first card's fetch is in flight is silently dropped (only the first card spins).

### Work item 2 — full project detail sections + Share (plan A-1, A-2, A-3)

`src/components/GroupChatEmbedded.tsx`. `handlePropertyViewDetails` now emits `sections` (Overview,
Pricing & Charges, Configuration, Amenities, Contact) built from the full `Project`, omitting every
empty field instead of printing `'—'`, and normalising Status / Category / Payment Plan out of their
enum slugs via a `label()` helper. It also sets `shareProjectId` and `slug`. The detail `Modal`
renders `sections` as titled blocks when present and keeps the old flat `fields` branch for the other
six `setViewProperty` callers, so Preview Info and the match / post paths are visually unchanged. New
`shareProject` / `sharingId` state, `handleShareProject` (cached `projectsApiExtended.getById`, toast
on failure, always clears), `ShareModal` mounted beside the other modals, a Share button in the sheet
header gated on `shareProjectId`, and a fixed-width icon-only Share button in the card's action row
after Open Group (`bp.btnIcon` — a third labelled button clipped at 186 dp / 9 px).

Left to see: checks 2 and 3 above, M5 in particular.

### Work item 3, client half — group info sheet (plan A-8)

`src/components/GroupChatEmbedded.tsx` (sheet, header, Exit/Delete move) and `src/lib/api.ts`
(`phone?: string` on the member user type, `GroupMedia` / `GroupLink`, `groupChatApi.getRoomMedia`).
The header's avatar + title block is a `Pressable` (`s.threadIdentity`) that opens the sheet for
builder / project / area rooms and is disabled for the universal room; back chevron and banner dots
stay outside it. The sheet is a `Modal` reusing `pd.overlay` / `pd.sheet` / `pd.head` with a
`FlatList` root — members as `data`, avatar / name / verified tick / counts / Admins / Media & Links
in `ListHeaderComponent`, Exit / Delete in `ListFooterComponent` wired to the existing `handleLeave` /
`handleDelete` and the existing `canLeave` / `canDelete` / `isGroupOwner` derivations verbatim. Exit
and Delete were removed from the 3-dot menu so each action lives in exactly one place, and the now-
empty header 3-dot was deleted outright. `onGroupDeleted` and `closeRoom` both close the sheet.
Member rows render Call (`tel:`) and WhatsApp (`wa.me`, 10 digits get a `91` prefix) **only when a
phone is present**; the privacy rule itself is server-side and lands in the backend phase.

Left to see: check 4 above. Two things cannot appear yet by design — **Media & Links stays empty**
until the backend adds `GET /group-chat/rooms/:roomId/media` (the client treats the 404 as "nothing
shared yet"), and **Call / WhatsApp will not appear** until the server populates member `phone`.

### Work item 4, client half — project counts (plan A-5, A-6)

`src/components/GroupChatEmbedded.tsx`: `threadSubtitle` inserts `M projects` between the member
count and the Verified / Builder context for builder rooms, from `builderProjects.length` already in
state, rendered only when non-zero so a loading `[]` does not flash "0 projects". `roomLines` renders
an `N projects` segment on builder list rows when `room.projectCount` is a positive number.
`src/lib/api.ts`: `projectCount?: number` on `GroupRoom`, mapped as `Number(raw?.projectCount) ||
undefined`. No new request on either path.

Left to see: check 5 above (the open builder header). The **groups-list** rows will stay without a
project count until the backend aggregation ships — that is expected, not a bug.

## Standing

- Nothing committed in this step; working tree holds only the review / report docs and
  `gradle-build.txt`.
- Nothing pushed, nothing deployed. Backend phase (B-1 … B-5) has not started.
- `main` in `HIT_Mobile` is still unpushed — 10 commits ahead of `origin/main`.
