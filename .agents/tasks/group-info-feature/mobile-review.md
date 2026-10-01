# Group info sheet, full-project detail sections, Share, project counts — review pass 2

Second pass over the mobile phase (plan items A-1 … A-8), now at commit `879a000` on top of
`550d5e3`. Iteration 2 made five code fixes against pass 1's findings: the builder card's Details
hands `handlePropertyViewDetails` a fallback adapted from the card's own `OwnerPortfolioProject`, the
card shows a per-card spinner while the project fetch runs, the unreachable header 3-dot is deleted
outright, `onGroupDeleted` closes group info, and Status / Category / Payment Plan are normalised out
of their enum slugs. All five land as described, and all four ITEM checks plus the convention
guardrails hold in the final tree.

Watch for: one pass-1 finding was deliberately **not** fixed in code — Share from inside the detail
sheet still mounts `ShareModal` as a second RN `Modal` over the open detail `Modal` (`possible`,
carried forward as a device check). Two new minor behaviours came in with the fix: a card tap is
silently dropped while another card's fetch is pending (`confirmed`), and a group-media entry whose
URL regex finds nothing renders a tappable row with an empty `url` (`confirmed`). Neither blocks.

**Verdict**: APPROVED

## High-level view

`portfolioFallback` adapts the thin portfolio record to the `InventoryCard` shape
`handlePropertyViewDetails` already accepts, so a deleted / unpublished project or an offline device
falls through to `sheetFromCard` instead of a bare toast — the "ALWAYS open something" contract
documented on that handler holds on the builder path for the first time. The adapter divides
`startingPrice` by 100000 because `InventoryCard.priceRange` is in lakhs and `sheetFromCard`
multiplies it back.

The pending guard the spinner is built on, `if (detailsId) return`, also swallows a tap on a
*different* card while the first is in flight, with no feedback on that second card.

The header `Group options` button was deleted rather than having its tautological gate fixed, the
standard already applied to `handleBuilderProjectDetails`. Nothing became unreachable: project rooms
reach Share link / PDF / QR / Gallery from the banner dots, which drive the same `showRoomMenu` state;
builder / area rooms never had those items; and the one pane that renders without a thread header
(`headerless`, the assistant pane at `lead-matching.tsx` L428) auto-opens the universal room, which is
deliberately not pressable and has `canLeave: false`, so no room is left without an exit.

M5 is the only pass-1 finding still in the tree. Closing the detail sheet before setting
`shareProject` is a user-visible behaviour change that pass 1 itself made conditional on a device
check, so deferring it is a judgement call, not a gap.

The gate checks all pass in the final tree: permissions are byte-identical to the 3-dot menu's
(`isGroupOwner` for delete, `!isUniversal && !isGroupOwner && canLeave !== false` for leave), members
render through a `FlatList` with the avatar / counts / Admins / Media block in
`ListHeaderComponent`, Call / WhatsApp are gated on `!!phone && !isMe` with both handlers re-checking
the number and the privacy rule documented as server-side, project counts come from
`builderProjects.length` in the open header and `room.projectCount` on list rows with no per-room
fetch, and the new `gi` sheet plus `bp.btnIcon` and the `pd` additions are plain `StyleSheet` on
`theme.ts` tokens with zero `className` / `tw(` / `styled(` in either changed file.

<details>
<summary>Issues (4)</summary>

1. **Stacked modals on the sheet's Share** (carried from pass 1, non-blocking, `possible`) — `ShareModal` is a sibling `Modal` mounted while the detail `Modal` is still visible. Tap Share inside the detail sheet on `ebbbfc95`; if it comes up blank or behind, add `setViewProperty(null)` in that handler.
2. **Second card tap dropped silently while one fetch is pending** (new, non-blocking, `confirmed`) — `handleBuilderCardDetails` returns early on any non-null `detailsId`, so tapping card B during card A's fetch does nothing and only A shows a spinner. Either let a new tap supersede the pending one, or disable the other cards' Details while `detailsId` is set.
3. **Group-media rows can carry an empty URL** (new, non-blocking, `confirmed`) — `api.ts` `getRoomMedia` maps a link's `url` from the first `https?://` match in the message content and falls back to `''` (media falls back through `attachment?.url || content || ''`). Such an entry renders a tappable row whose `Linking.openURL('')` rejects into `.catch(() => {})`. Drop entries with an empty `url` when mapping. Only reachable once the backend phase ships the endpoint.
4. **Runtime verification still open** (`confirmed`) — no gradle build, no install, nothing visual; adb screenshots are black on this phone. The five on-device checks (card-body tap opens the sheet, sections with no `—` rows and word-form Status, Share from card and sheet, group info with admins / members / Exit-Delete and no group 3-dot in the header, `N members · M projects · Verified`) belong to the dedicated verification step after this loop, not to this gate.

</details>

<details>
<summary>Details</summary>

### The fallback path

```
tap card / Details ─► setDetailsId(p.id)
                   └─► getById(p.id) ─┬─► sections sheet (+ shareProjectId, media)
                                      └─► sheetFromCard(portfolioFallback(p))   // deleted / offline
                   ─► finally setDetailsId(null)
```

`detailsId` clears on every path — `handlePropertyViewDetails` swallows its own errors, so the await
cannot reject and the spinner cannot stick. The fallback sheet carries no `shareProjectId` and no
media, so no Share button and no media block render on it; the fetch Share depends on is the one that
just failed.

### Header dots deletion and reachability

```
project room : banner dots ──► showRoomMenu ──► Share link / PDF / QR / Gallery
builder room : header identity ──► group info ──► Exit / Delete
area room    : header identity ──► group info ──► Exit / Delete
universal    : header NOT pressable (canLeave false, no owner, phones must not show)
```

The `showRoomMenu` dropdown markup lives inside the `!headerless` thread-header block while the banner
dots that open it sit outside it, so in headerless mode those dots set state that renders nothing.
That asymmetry predates this feature and the only headerless instance opens the universal room, which
has no project banner — out of scope, but worth not "fixing" by re-introducing a header-side opener.

### Enum normalisation

`label()` lowercases as it de-slugs, so Status reads `ready to move`, not `Ready To Move` — which is
what `sheetFromCard` has always produced for `possessionStatus`. Matching the existing path was the
point of the fix; a capitalised variant here would have made the two detail paths diverge.

### Scope and verification standing

Iteration 2 touched only `src/components/GroupChatEmbedded.tsx` (124 lines, all five fixes), with no
edit to `src/lib/api.ts`: the `fallback` parameter already accepted an `InventoryCard`, so widening
`MessageBubble`'s `onPropertyViewDetails` prop type was avoided. The known pre-existing issues in
`projects.tsx` and `AiAssistant` were left alone and `app/(dashboard)/lead-matching.tsx` is untouched
by this pass.

`npx tsc --noEmit` is recorded clean with `exit=0`, plus greps confirming `handleBuilderProjectDetails`
absent, exactly one `onPress={handleLeave}` and one `onPress={handleDelete}`, a single
`accessibilityLabel="Group options"` (the banner dots), and no NativeWind. That evidence was accepted,
not re-run; nothing in this pass raised a doubt needing a type spot-check.

</details>

<details>
<summary>File map</summary>

- `src/components/GroupChatEmbedded.tsx` — `portfolioFallback` adapter, `detailsId` state +
  `handleBuilderCardDetails` wrapper, `loadingDetails` prop and Details spinner on
  `BuilderPropertyCard`, header 3-dot deleted, `setShowGroupInfo(false)` in `onGroupDeleted`,
  `label()` applied to Status / Category / Payment Plan.
- `src/lib/api.ts` — unchanged in this pass (iteration 1: `projectCount`, member `phone`,
  `GroupMedia` / `GroupLink`, `getRoomMedia`).

Full diff: `git diff 550d5e3 879a000` (this pass), `git diff 0f4c243 879a000` (whole mobile phase).

</details>
