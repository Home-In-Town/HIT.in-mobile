# WhatsApp-style group info, full-project detail sections, Share on builder cards, project counts

Mobile phase (plan items A-1 … A-8) of the group-info feature, delivered as commit `550d5e3` on top
of `0f4c243`. The builder property card body became a tap target that opens the same detail path the
inventory cards use, that detail sheet grew labelled sections built from the whole `Project` with
empty fields dropped, Share moved onto both the card and the sheet by reusing `ShareModal`, and the
thread header became a pressable that opens a new group-info sheet holding admins, Media & Links, a
virtualized member list with Call / WhatsApp, and the Exit / Delete actions that used to sit in the
3-dot menu. Project counts appear in the open builder header (from state already loaded) and on the
groups-list rows (only when the server sends the field). All seven plan decisions were honoured,
permission derivations were reused verbatim, and the diff adds no NativeWind.

Watch for: the builder card's Details path is now gated on a network call with no pending indicator
and **no fallback sheet**, so a failed or slow `getById` reproduces the exact symptom the user
reported — tap the card, nothing appears (confirmed). The header 3-dot gate `!proj && hasProjectMedia`
is a tautological false, leaving the button and its branch permanently unreachable rather than
conditionally hidden (confirmed). A remote group delete clears `showRoomMenu` but not `showGroupInfo`,
so the sheet can pop open by itself over the next room opened (confirmed).

**Verdict**: NEEDS_CHANGES

## High-level view

The detail sheet was extended by *adding* a shape rather than changing one: `sections` renders when
present, the flat `fields` branch stays for the six other `setViewProperty` callers, and the
`!compact` gate on the media block is untouched so `handlePreviewMatch`'s short media-free Preview
Info is unaffected. That is the right call for a sheet with seven producers.

Routing the builder card's Details through `handlePropertyViewDetails` fixes the real bug (the old
compact handler built a `compact: true` sheet whose media block was gated out, so a builder's own
gallery, videos, brochure and layout never rendered) but swaps a synchronous open for an awaited
`projectsApiExtended.getById` with no pending state and no fallback. The handler's own doc comment
says "View Details must ALWAYS open something"; from the builder card that invariant no longer holds,
because the card has no `InventoryCard` to pass as `fallback`.

Share is wired correctly: no URL is string-built, `ShareModal` receives a real `Project`, and the
fetch is justified in a comment because the card only carries an `OwnerPortfolioProject`. The one
thing code reading cannot settle is that the sheet's Share mounts a second React Native `Modal` while
the detail `Modal` is still visible — a device check, not a code fix.

Group info satisfies the structural requirements: a `FlatList` over members with everything above
them in `ListHeaderComponent`, `canLeave` / `canDelete` / `isGroupOwner` reused verbatim from
lines 2136-2138, Call / WhatsApp rendered only when `m.user.phone` is present with the privacy rule
documented as server-side, and area rooms included so Exit Group does not become unreachable for
them. Headerless mode is not a reachability hole: only the assistant pane is headerless and it
auto-opens the universal room, which is deliberately not pressable.

The 3-dot cleanup overshot. Once Exit / Delete left the menu, the header dots were gated on
`hasProjectMedia` — but the same condition already requires `!proj`, and `hasProjectMedia` is derived
from `proj`, so the two can never both hold. The intended user-visible outcome (no empty menu) is
achieved, by code that can never run.

Project counts are plumbed as planned: `projectCount` optional on `GroupRoom`, mapped as
`Number(...) || undefined` so a server-absent field omits the segment instead of printing
"0 projects", one segment in `roomLines`, one in `threadSubtitle` from `builderProjects.length`, and
no per-room fetch anywhere. `getRoomMedia` tolerates the endpoint not existing yet by resolving
failure to an empty section.

The commit also carries the previously uncommitted AI-Leads tab-row work in
`app/(dashboard)/lead-matching.tsx` plus five `GroupChatEmbedded` hunks. Its hunk headers match
`mobile-baseline-diff.txt` exactly, so this phase added nothing there — bundling was the plan's
instruction, not scope creep.

<details>
<summary>Issues (7)</summary>

1. **Builder-card Details opens nothing on failure** — `onDetails={(p) => handlePropertyViewDetails(p.id)}` passes no `fallback`, so a deleted/invisible project or an offline device yields only a "Could not load property details" toast. Build a fallback sheet from the `OwnerPortfolioProject` the card already holds (adapt it to the `sheetFromCard` shape or add a second fallback branch) so the documented "must ALWAYS open something" contract holds.
2. **No pending feedback on the card tap** — the previous builder-card handler opened instantly from portfolio data; now the sheet waits on `getById` with only the press-down opacity as feedback. Add a per-card pending flag (the `sharing`/`sharingId` pattern already in the card works) or a spinner in the sheet.
3. **Header 3-dot is unreachable code** — `!activeRoom.isUniversal && !proj && hasProjectMedia` can never be true because `hasProjectMedia` is derived from `proj`. Delete the button outright (the standard applied to `handleBuilderProjectDetails`) rather than leaving a gate that reads as conditional.
4. **`showGroupInfo` survives a remote delete** — the `onGroupDeleted` socket handler clears `setShowRoomMenu(false)` but not `showGroupInfo`, so the sheet re-appears unprompted over the next room opened. Add `setShowGroupInfo(false)` beside it.
5. **Stacked modals on the sheet's Share** — `ShareModal` is a sibling `Modal` mounted while the detail `Modal` is still visible; Android window stacking for two simultaneous RN modals is not reliable across versions. Verify on the device, and if it fails, close the detail sheet before setting `shareProject`.
6. **Raw enum values in the new Status / Category rows** — `overview.push('Status', p.projectStatus)` prints `ready-to-move` / `under-construction` as stored, while the same file already normalises this class of value (`String(inv.possessionStatus).replace(/[-_]/g, ' ')` in `sheetFromCard`). Apply the same normalisation to Status, Category and Payment Plan.
7. **A-9 is still open** — no gradle build, no install, and nothing visual confirmed; adb screenshots are black on this device. The five runtime checks (card-body tap, section list with no dashes, Share from both places, group info with Exit/Delete, `N members · M projects · Verified`) need the user's eyes before this phase is done.

</details>

<details>
<summary>Details</summary>

### Builder card Details: right destination, weaker guarantees

Both the body `Pressable` and the Details button call `onDetails(project)`, and the call site routes
it to `handlePropertyViewDetails(p.id)`. `handleBuilderProjectDetails` is gone with no caller left
(grep over the file returns nothing), and `handlePreviewMatch` still sets `compact: true` at L1748, so
the short media-free Preview Info is intact. ITEM 1 is met on all three sub-checks.

What changed underneath is the failure and latency profile:

```
before:  tap Details ─► setViewProperty(from portfolio data)        // sync, always opens
after:   tap card  ───► await projectsApiExtended.getById(id) ─┬─► sections sheet
                                                              └─► toast, no sheet
```

The handler's own comment states the rule it was written to enforce:

> View Details must ALWAYS open something. Cards posted from the manual inventory form carry no
> project id, and older cards can point at a deleted project — both used to only raise "not linked to
> a project", which read as a dead button.

Inventory cards keep that guarantee because they pass `fallback?: InventoryCard`. The builder card
passes nothing, so a deleted project, a `status` change that hides it, or no connectivity lands in the
`else toast.show('Could not load property details')` branch. That is the reported symptom
("card pr click kiya to detail nahi dhikhti") re-created in a narrower case, in the one path the user
is going to test first.

The latency half is separate: `getById` is behind a 60 s cache, but the card tap is the call that
*populates* it, so the first tap per project pays full round-trip (the steering file records ~0.85 s
for a comparable Cloud Run call) with nothing on screen after the finger lifts. The card already has
the right pattern for this — `sharing`/`sharingId` drives a spinner inside the Share button.

### Detail sheet sections

Empty values are dropped by the `rows().push` helper (`null`, `undefined`, `''` all skipped) and
sections with no surviving rows are filtered out, so the `'—'` placeholders the old Property Type and
Status rows printed are gone. `money()` is applied only to `pricePerSqFt` and `registrationCharges`,
both typed `number?` in `src/lib/api.ts` (L870, L875), so there is no `₹NaN` path;
`maintenanceCharges` / `otherCharges` are strings and pass through raw. The gap is enum casing:
Status, Category and Payment Plan now surface storage values verbatim, and `projectStatus` is exactly
the field the steering file flags as holding `ready-to-move`.

Media stayed on the existing `Linking.openURL` thumbnails and buttons — no new viewer. The gallery,
layout and video presses still have no `.catch`, which is pre-existing, but it makes the brochure the
only one of the four that reports an OS refusal. Media also renders after Contact rather than between
Amenities and Contact as the user listed the groups, because it comes from a block that predates this
change.

### Share and modal stacking

`ShareModal` is itself a `Modal` (`ShareActions.tsx` L215-227)
mounted as a sibling of the detail `Modal`, so pressing Share inside the sheet asks Android to show a
second dialog window over a visible one while the first stays mounted. The other three call sites
(`projects.tsx`, `marketplace.tsx`, `PropertyReels.tsx`) mount it the same way, but not necessarily
over an already-open modal. If the share sheet comes up blank or behind the detail sheet on the
device, closing the detail sheet in the same handler is the fix.

### Group info sheet

Permissions are the same expressions the 3-dot menu used, untouched by this diff:

```
isGroupOwner = !!activeRoom && !!user?.id && groupOwnerId === user.id
canDelete    = !!activeRoom && !activeRoom.isUniversal && isGroupOwner
canLeave     = !!activeRoom && !activeRoom.isUniversal && !isGroupOwner && activeRoom.canLeave !== false
```

Member rows gate Call / WhatsApp on `!!phone && !isMe`, and both handlers re-check the number and
toast when it is missing, so an unpopulated or ObjectId-only member (the discover list does not
populate `members.user`) cannot throw. `tel:` is opened without a `canOpenURL` gate for the reason
carried over from `handlePropertyCall`, and the 10-digit → `91` normalisation matches `AiAssistant`.

`closeRoom`, `handleLeave` and `handleDelete` all close the sheet, the last two so the confirm
`Alert` is not raised behind the modal. The socket `onGroupDeleted` handler (L919-927) is the one that
was missed: it clears `activeRoom`, `messages` and `showRoomMenu`, so the sheet unmounts with the
thread, but `showGroupInfo` stays `true` and the sheet re-mounts visible the next time any room is
opened.

### The 3-dot gate that can never be true

```tsx
const proj = (activeRoom.project as any) || null;
const hasProjectMedia = !!(proj?.slug || proj?.id || proj?._id);
...
{!activeRoom.isUniversal && !proj && hasProjectMedia && ( /* header dots */ )}
```

`hasProjectMedia` is false whenever `proj` is null, so `!proj && hasProjectMedia` is false for every
room. Project rooms were already excluded by `!proj` and use the banner dots, which still drive the
same `showRoomMenu` state and still render the media items, so nothing a user can reach regressed and
decision 6's goal (never show an empty menu) is achieved. What ships is an unreachable `Pressable`
behind a comment that reads as a live condition.

### Conventions and scope

No `className`, `tw(` or `styled(` anywhere in the file; every colour in the three new style blocks
(`bp.btnIcon`, the `pd` additions, `s.threadIdentity`, the new `gi` sheet) resolves to an existing
`src/theme.ts` token. Comment density matches the file and each behavioural change states the previous
behaviour: the flat-list-of-six-fields history on the sections block, the inert card body and the
`compact`-gated media on the card, "Exit Group / Delete Group used to be here too" on the 3-dot, the
flexShrink rationale on the `FlatList`.

`app/(dashboard)/lead-matching.tsx` and five `GroupChatEmbedded` hunks in this commit are the
pre-existing tab-row work; their hunk headers are identical to `mobile-baseline-diff.txt`, so nothing
new was introduced there and nothing was reverted. The known pre-existing issues in `projects.tsx` and
`AiAssistant` were left alone.

### Verification standing

`npx tsc --noEmit` is recorded as clean, run twice, with `$LASTEXITCODE = 0`, plus the two greps that
matter (`handleBuilderProjectDetails` absent; one `handleLeave` and one `handleDelete` call site). That
evidence is sufficient and was not re-run here. A-9 — gradle release build, install on `ebbbfc95`, and
the five on-device confirmations — has not happened, and three findings above (stacked share modals,
the card-tap delay, the section layout) are things only the device can settle.

</details>

<details>
<summary>File map</summary>

- `src/lib/api.ts` — `GroupRoom.projectCount?`, member `user.phone?`, `GroupMedia` / `GroupLink`
  interfaces, `groupChatApi.getRoomMedia`.
- `src/components/GroupChatEmbedded.tsx` — card body pressable + Share icon button, Details rerouted,
  `handleBuilderProjectDetails` deleted, `handlePropertyViewDetails` emits sections, share state +
  `ShareModal`, group-info sheet, Exit/Delete moved out of the 3-dot, project-count segments, `gi`
  styles.
- `app/(dashboard)/lead-matching.tsx` — pre-existing tab-row work carried in this commit, unchanged by
  this phase.

Full diff: `git diff 0f4c243 550d5e3`.

</details>
