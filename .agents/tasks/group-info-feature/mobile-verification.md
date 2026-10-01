# Mobile phase — verification note

Iteration: **2** — `mobile-review.json` was present with verdict `CHANGES_REQUESTED`, so this pass
fixed its findings on top of commit `550d5e3`. Iteration 1's record is kept below, unchanged, under
"Iteration 1".

A-9 (gradle release build + device install) was **deliberately NOT run** in either iteration — per
the step brief that happens in the dedicated verification step after the loop.

## Iteration 2 — review findings and what was done

| Finding | Status | Change |
| --- | --- | --- |
| **M1** builder-card Details opens nothing when the project fetch fails (blocking) | fixed | New module-level `portfolioFallback(p: OwnerPortfolioProject): InventoryCard` adapter next to `BuilderPropertyCard`, passed as the `fallback` arg, so a deleted / unpublished project or an offline device falls through to `sheetFromCard` instead of the bare toast. The "must ALWAYS open something" contract now holds on the builder path too. |
| **M2** no pending feedback while the card tap awaits `getById` (blocking) | fixed | New `detailsId` state + `handleBuilderCardDetails` wrapper (guards on `detailsId`, sets/clears it around the await), new `loadingDetails` prop on `BuilderPropertyCard`, and the Details button renders an `ActivityIndicator` in place of the eye+label while pending — the same one-id-in-state pattern as `sharing` / `sharingId`. |
| **M3** header 3-dot gate is tautologically false | fixed | The header `Group options` `Pressable` is **deleted outright**, same standard as `handleBuilderProjectDetails`. Replaced by a comment stating what it used to carry and that project rooms reach the media items from the banner dots, which drive the same `showRoomMenu` state. The `showRoomMenu` block's comment now says it is opened only by the banner dots. |
| **M4** `showGroupInfo` survives a remote group delete | fixed | `setShowGroupInfo(false)` added beside `setShowRoomMenu(false)` in the `socket.onGroupDeleted` handler, with a comment naming the old symptom (sheet re-mounting visible over the next room). |
| **M5** share from inside the detail sheet stacks two RN Modals (non-blocking, `possible`) | **deferred to the device step, no code change** | The review's own fix is conditional on a device check ("Verify on device (A-9 check 3); if it fails, `setViewProperty(null)` before `setShareProject`"). Closing the detail sheet unconditionally is a user-visible behaviour change, so it was not made speculatively. **Action for the verification step:** tap Share inside the detail sheet on `ebbbfc95`; if the share sheet comes up blank or behind the detail sheet, add `setViewProperty(null)` in the sheet's Share handler. |
| **M6** raw enum values in Status / Category / Payment Plan | fixed | New `label()` helper in `handlePropertyViewDetails` applying `String(v).replace(/[-_]/g, ' ')` — the same normalisation `sheetFromCard` already applies to `possessionStatus` — to `projectStatus`, `category` and `paymentPlan`. |
| **M7** A-9 runtime verification still open | **out of scope for this loop** | No gradle build, no install, nothing visual. The five on-device checks remain for the dedicated verification step (list repeated at the bottom of this note). |

### What was run in iteration 2

```powershell
cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile"; npx tsc --noEmit; "exit=$LASTEXITCODE"
```

**Result: clean.** No diagnostics printed, `exit=0`.

Supporting greps (all on `src/components/GroupChatEmbedded.tsx`):

- `handleBuilderProjectDetails` → **0 matches** (still gone).
- `onPress={handleLeave}` / `onPress={handleDelete}` → exactly one each, both in the group-info sheet
  footer (L3253 / L3259). No second leave/delete path.
- `accessibilityLabel="Group options"` → **1 match**, the banner dots (`colors.blueText`) at L2684.
  The header dots are gone, so no unreachable gate ships.
- `className=` / `tw(` / `styled(` → **0 matches**. No NativeWind.

### Files changed in iteration 2

Only `src/components/GroupChatEmbedded.tsx`. `src/lib/api.ts` needed nothing — the `fallback`
parameter already accepted an `InventoryCard`, so M1 was solved by adapting the card's data rather
than widening any signature (which would have broken `MessageBubble`'s
`onPropertyViewDetails: (projectId: string, fallback?: InventoryCard) => void` prop type, since a
function with more parameters is not assignable to one with fewer).

### Still open after iteration 2 — needs the phone

1. tapping the card **body** opens the detail sheet (not just the Details button);
2. the sheet shows Overview / Pricing & Charges / Configuration / Amenities / Media / Contact with no
   `—` rows, Status/Category read as words not slugs, and gallery + brochure open;
3. Share works from the card **and** from inside the sheet — this is the M5 check;
4. tapping the group header opens group info with admins, members and Exit/Delete at the bottom, and
   builder / area rooms no longer show a group 3-dot in the header at all;
5. the open builder header reads `N members · M projects · Verified`.

adb screenshots come back fully black on this phone and a locked screen swallows `input tap`, so none
of the five may be claimed from a screenshot.

---

## Iteration 1

Iteration 1 (no `mobile-review.json` was present, so this was a from-scratch implementation of
Phase A, items A-1 … A-8, built on top of the uncommitted baseline diff — nothing in
`app/(dashboard)/lead-matching.tsx` or `src/components/GroupChatEmbedded.tsx` was reverted).

## What was run

```powershell
cd "c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile"; npx tsc --noEmit
```

**Result: clean.** No diagnostics printed, `$LASTEXITCODE = 0`. Run twice (once after the main
implementation, once after the group-info sheet layout fix); both clean.

Supporting greps:

- `Select-String -Path src\components\GroupChatEmbedded.tsx -Pattern "handleBuilderProjectDetails"`
  → **no matches** (the dead compact handler is gone, no caller left behind).
- `handleLeave` / `handleDelete` → declared once each (L2140 / L2161) and invoked from exactly one
  place each, the group-info sheet footer. No second leave/delete path exists.

Not verified (cannot be, in this loop): anything visual. adb screenshots come back black on this
device and a locked screen swallows `input tap`, so the five runtime checks in A-9 are still open and
must be confirmed by the user on the phone.

## Files changed and why

### `src/lib/api.ts`

- `GroupRoom.projectCount?: number` + mapped in `transformGroupRoom` as
  `Number(raw?.projectCount) || undefined`. Builder-room project count for the groups-list rows.
  Kept optional/undefined (not `0`) so the list rows omit the segment entirely until the backend
  phase supplies the field — the mobile change ships and verifies on its own.
- `phone?: string` added to the `GroupRoom` member user type and mapped (as `|| undefined`). The
  group-info member rows need the field to compile; the server starts sending it in the backend
  phase, and the privacy rule (builder + project rooms only) is enforced **server-side**.
- New exported `GroupMedia` / `GroupLink` interfaces + `groupChatApi.getRoomMedia(roomId, params?)`,
  following the existing `fetch` + `authHeaders()` + `handleResponse` pattern. Commented that the
  endpoint lands in the backend phase and that callers must treat failure as "no media yet".

### `src/components/GroupChatEmbedded.tsx`

- **Imports**: `ShareModal` from `./ShareActions`; `Project`, `GroupMedia`, `GroupLink` types;
  `Share2` and `MessageCircle` icons.
- **`roomLines`** (A-6): builder branch renders `N projects` only when `room.projectCount` is a
  positive number. No per-row fetch.
- **`BuilderPropertyCard`** (A-4): cover + body wrapped in a `Pressable` → `onDetails`, with pressed
  opacity and an accessibility label. `bp.actions` is left outside that Pressable so the two buttons
  keep their own taps. New fixed-width icon-only Share button (`bp.btnIcon`) after Open Group, with a
  spinner while sharing — a third labelled button clipped at 186 dp / 9 px text.
- **Call site**: `onDetails={(p) => handlePropertyViewDetails(p.id)}` (was the compact handler),
  `onShare={(p) => handleShareProject(p.id)}`, `sharing={sharingId === p.id}`.
- **`handleBuilderProjectDetails` deleted** — it built a `compact: true` sheet, and because the media
  block is gated on `!compact`, a builder's own gallery / videos / brochure / layout never rendered.
- **`handlePropertyViewDetails`** (A-2): now emits `sections` — Overview, Pricing & Charges,
  Configuration, Amenities, Contact — built from the full `Project`, every field dropped when empty
  (the old version printed `'—'` for Property Type and Status). Also sets `shareProjectId` and
  `slug`. Media fields unchanged. The `sheetFromCard` fallback stays flat `fields`.
- **Detail sheet** (A-1): renders `viewProperty.sections` as titled blocks reusing
  `pd.detailList` / `detailRow` / `detailLabel` / `detailValue` when present, and falls back to the
  flat `fields` branch otherwise, so the other six `setViewProperty` callers are untouched. Share
  button in the sheet header, shown only when `shareProjectId` is set. The `!compact` gate on the
  media block is unchanged, so `handlePreviewMatch`'s short media-free Preview Info still works.
  Media heading now carries photo/video counts; Brochure reads "Brochure PDF" and toasts if the OS
  refuses the URL.
- **Share** (A-3): `shareProject` / `sharingId` state, `handleShareProject` (guards on `sharingId`,
  `projectsApiExtended.getById`, toast on failure, always clears), and `ShareModal` mounted beside the
  other modals. Commented that the fetch exists because the card only holds an
  `OwnerPortfolioProject` and that `getById` is cached so this is normally free. No URL is
  string-built — `ShareActions` derives it.
- **Open-room header project count** (A-5): `threadSubtitle` adds
  `${builderProjects.length} projects` for builder rooms, only when non-empty (the array is `[]`
  while the portfolio loads, and a flashing "0 projects" is worse than nothing). No request.
- **Group info sheet** (A-8): `showGroupInfo` / `groupMedia` / `loadingGroupMedia` state; media
  loaded in an effect that runs when the sheet opens (not on room open) and resolves a failure to an
  empty section; `groupMedia` reset when the active room changes. The header's avatar + title block
  is now a `Pressable` (`s.threadIdentity`) that opens the sheet for builder / project / area rooms
  and is disabled for the universal room; the back chevron and both 3-dots stay outside it. The sheet
  is a `Modal` reusing `pd.overlay` / `pd.sheet` / `pd.head`, with a **`FlatList`** root: members as
  `data`, everything above them in `ListHeaderComponent` (avatar, name, verified tick, member +
  project counts, Admins, Media & Links with loading/empty states, Members label), group actions in
  `ListFooterComponent`. Member rows show name, role, company, an Admin pill, a "(You)" marker, and
  Call (`tel:`) / WhatsApp (`wa.me`, 10-digit → `91` prefix, matching `AiAssistant`) **only when a
  phone is present** — commented that the privacy rule is server-side so nobody turns it into a
  UI-only check. The list uses `flexShrink: 1` rather than a percentage `maxHeight`, because RN
  children default to `flexShrink: 0` and the list would otherwise size to all rows and be clipped
  by the already-capped sheet.
- **Exit / Delete moved** out of the 3-dot menu into the sheet footer, wired to the existing
  `handleLeave` / `handleDelete` and the existing `canLeave` / `canDelete` / `isGroupOwner`
  derivations verbatim — no permission change. Both now also `setShowGroupInfo(false)` so the confirm
  `Alert` is not raised behind the modal, and `closeRoom` closes the sheet.
- **Header 3-dot gated on `hasProjectMedia`**: once Exit/Delete left it, a builder / area room's dots
  would have opened an empty menu.
- **New styles**: `bp.btnIcon`, `pd.section` / `pd.sectionTitle` / `pd.shareBtn`, `s.threadIdentity`,
  and a new `gi` StyleSheet. Plain `StyleSheet` with `src/theme.ts` tokens only; no NativeWind.

## Known limits carried forward

- `Media & Links` is empty until the backend phase adds `GET /group-chat/rooms/:roomId/media`
  (the client treats the current 404 as "nothing shared yet"). TODO comment in the effect ties it to
  that phase.
- Groups-list rows show no project count until the backend attaches `projectCount` to builder rooms.
- Member Call / WhatsApp will only appear once the server populates member `phone`.
