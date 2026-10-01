# Mobile phase — verification note

Iteration: 1 (no `mobile-review.json` was present, so this was a from-scratch implementation of
Phase A, items A-1 … A-8, built on top of the uncommitted baseline diff — nothing in
`app/(dashboard)/lead-matching.tsx` or `src/components/GroupChatEmbedded.tsx` was reverted).

A-9 (gradle release build + device install) was **deliberately NOT run** here — per the step brief
that happens in the dedicated verification step after the loop.

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
