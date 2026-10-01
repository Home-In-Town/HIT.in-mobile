# Implementation Plan — AI Leads: one row of four text tabs (Groups · Chats · My Post · Matching)

## What exists today (verified by reading the code)

**Row 1 — `Groups` / `Chats`** live in `HIT_Mobile/app/(dashboard)/lead-matching.tsx`:
- `SUB` array declared in `LeadMatchingHub` (currently lines ~238-241), two entries with `kind: 'pane' as const`.
- Rendered at lines ~266-285 inside `<View style={hub.subBar}>`; each item is a `Pressable` with `[hub.subTab, active && hub.subTabActive]`, a 15px lucide icon (`Users` / `MessageSquare`) and `hub.subTabText` / `hub.subTabTextActive`.
- Styles (lines ~342-347): `subBar` (row, white, bottom hairline `colors.line`), `subTab` (`flex: 1`, row, centered, `gap: 5`, `paddingVertical: 11`, `borderBottomWidth: 2` transparent), `subTabActive` (`borderBottomColor: colors.brand`), `subTabText` (11px/700 `colors.muted2`), `subTabTextActive` (`colors.brand`/800). This IS the underline treatment the user wants for all four.
- No accessibility props on these Pressables today.
- `onPress` → `setTab('groups' | 'chats')`, which swaps the content pane below (`ChatEmbedded` / `GroupChatEmbedded key="groups-pane"` / `GroupChatEmbedded key="assistant-pane"`). Default `tab` is `'assistant'`, so on the landing view **neither** Groups nor Chats is underlined — existing behaviour, keep it.
- The whole row is hidden when `chromeHidden = tab === 'groups' && groupOpen`.

**Row 2 — `My Post` / `Matching` pills** live in `HIT_Mobile/src/components/GroupChatEmbedded.tsx`, lines ~2320-2336:
```
{headerless && aiAllowed && (
  <View style={s.aiActionBar}>  // justifyContent: 'flex-end'
    <Pressable onPress={aiPost} ...#F0FDF4 / greenBorder>   Building2 13 + "My Post"  (greenText)
    <Pressable onPress={aiMatching} ...brandTint / brand55> Search 13   + "Matching" (brand)
    {aiActive && <Pressable onPress={() => setShowAiMenu(v => !v)}><MoreVertical 18/></Pressable>}
  </View>
)}
```
Styles: `s.aiActionBar` (line ~3666), `s.headerAiBtn` / `s.headerAiBtnText` (lines ~3660-3661) — after this change `headerAiBtn` / `headerAiBtnText` have **no remaining consumer** (grep confirms the only uses are these two pills; the in-thread-header row uses `headerAiRow` + `headerAiDots` only).

**Exactly what the two actions do (must not change):**
- `My Post` → `aiPost` (line ~1412). If AI mode is already on and the assistant API exists → `doPost()` immediately; otherwise it parks `pendingAiActionRef = 'post'` and `setAiMode(true)`, and the drain effect (lines ~1505 region, gated on `aiMode && aiReady`) runs `doPost()` once the assistant is mounted. `doPost` (line ~1295) loads `postedListStorage.getAll()`, `loadMyProjects()`, `loadPostedLeads()`, grabs `aiApiRef.current?.getPostDraft()`, then `setShowPost(true)` → opens the **My Posts modal sheet**. One-shot action, result is a modal.
- `Matching` → `aiMatching` (line ~1418), same deferral mechanism, then `doMatching()` (line ~1313): reads `aiApiRef.current?.getCurrentParams?.()`; if empty → `toast.show('Please complete your requirement first', 'error')` and returns; otherwise `setShowMatching(true)` + `leadMatchingApi.matchRequirement(params)` → results or error in the **Matching modal**. One-shot action, result is a modal.
- Neither is a filter. Neither has a persistent selected state (`showPost` / `showMatching` are modal visibility flags; the modal covers the row while open).
- `aiPost` / `aiMatching` are already published to the hub via `onActionsReady` (child line ~1505 → hub `handleActionsReady` → `groupActionsRef.current`). The hub currently only calls `resetToLanding`. **The wiring needed for this change already exists.**

**Visibility gate — why the hub can reproduce it without new props.** The child gate is `headerless && aiAllowed`, where `aiAllowed = !!activeRoom && (activeRoom.isUniversal || hideThreadBack)` (line ~738). Only the assistant pane passes `headerless` and `hideThreadBack`, so in that pane `aiAllowed ≡ !!activeRoom`. The child already reports exactly that upward: `useEffect(() => { onRoomOpenChange?.(!!activeRoom); }, [activeRoom, onRoomOpenChange])` (line ~780), and the hub stores it in `groupOpen`. The two panes are rendered by a ternary so they are never mounted at once, and the distinct `key` per pane forces a remount (resetting `activeRoom` → `onRoomOpenChange(false)`) on every switch. Therefore **`tab === 'assistant' && groupOpen` is an exact mirror of the child's old `headerless && aiAllowed`** — no new prop, no new state in `GroupChatEmbedded`.

## Design decisions

1. **The merged row lives in `lead-matching.tsx`** (the hub). Navigation state (`tab`) cannot move down into `GroupChatEmbedded` — the row must stay visible on the `chats` pane, where `GroupChatEmbedded` is not even mounted. So the actions move up instead, driven through the existing `groupActionsRef`. This deliberately reverses the note at hub lines ~233-237 ("keeping them here made a 4-item bar that mixed navigation with actions"); the user has now asked for exactly that single row, so the comment must be rewritten to record the old reasoning and why it was superseded.
2. **Indicator semantics**
   - `Groups` — pane switcher → underline when `tab === 'groups'`; mutually exclusive with `Chats`. `accessibilityRole="tab"`, `accessibilityState={{ selected }}`.
   - `Chats` — pane switcher → underline when `tab === 'chats'`.
   - (Both un-underlined on the default `'assistant'` landing view — unchanged from today.)
   - `My Post` — one-shot action that opens the My Posts modal → **no persistent underline ever**. Same text treatment as the tabs, `accessibilityRole="button"`.
   - `Matching` — one-shot action that runs the match request (or toasts "complete your requirement first") → **no persistent underline ever**. `accessibilityRole="button"`.
   - Because the two actions get no underline, all four share a pressed-state opacity so a tap on an action still gives feedback. This must be explained in a code comment.
3. **Shared rendering**: extract one module-scope `SubTab` component in `lead-matching.tsx` and use it for all four. `SubTab` owns the Pressable, styles, accessibility props and the `showIndicator = isPane && active` rule, so the pane/action distinction is encoded in one place and no second tab implementation exists.
4. **Icons stay** (`Users`, `MessageSquare`, `Building2`, `Search`) — they are part of the existing tab treatment and all four get one, so the four remain visually identical. Metrics tighten slightly (icon 15 → 14, `gap` 5 → 4, add `paddingHorizontal: 6`) so four `flex: 1` cells fit without clipping down to a 320dp-wide screen; `numberOfLines={1}` on every label.
5. **Pill colours are dropped entirely** — no green `#F0FDF4`, no `brandTint`, no borders. Labels use `colors.muted2`; only an active pane gets `colors.brand` + the 2px brand underline. Consistent with the project's white/neutral card palette decision.
6. **The AI 3-dot menu stays in `GroupChatEmbedded`.** It is not one of the four controls, and its dropdown (`s.menu`, `position: 'absolute', top: 52`) is anchored inside the child. Its row keeps the same height (padding 8 + 26px dots ≈ 42), so `top: 52` still clears it.

## Steps

- [ ] 1. Add the shared `SubTab` component and the four-item row to the hub.
      In `app/(dashboard)/lead-matching.tsx`: extend the lucide import with `Building2, Search`. Add a module-scope `function SubTab({ label, Icon, active, isPane, onPress })` that renders `<Pressable style={({ pressed }) => [hub.subTab, isPane && active && hub.subTabActive, pressed && hub.subTabPressed]} accessibilityRole={isPane ? 'tab' : 'button'} accessibilityState={isPane ? { selected: active } : undefined}>` with `<Icon size={14} color={isPane && active ? colors.brand : colors.muted2} />` and `<Text numberOfLines={1} style={[hub.subTabText, isPane && active && hub.subTabTextActive]}>`. Rewrite the `SUB` array to carry `active` + `onPress` per item and to append the two action items only when `tab === 'assistant' && groupOpen`: `{ key: 'post', label: 'My Post', icon: Building2, kind: 'action' as const, onPress: () => groupActionsRef.current?.post() }` and `{ key: 'matching', label: 'Matching', icon: Search, kind: 'action' as const, onPress: () => groupActionsRef.current?.matching() }` (spread a conditional array so the row has exactly 2 items when hidden — four `flex: 1` cells collapse back to two with no gap and no shift). Replace the inline map body with `<SubTab key={item.key} ... isPane={item.kind === 'pane'} />`. Update `hub.subTab` to `gap: 4, paddingHorizontal: 6` and add `subTabPressed: { opacity: 0.55 }`. Rewrite the comment above `SUB` (currently lines ~233-237) and the `subBar` style comment to state the old split (actions lived in the chat's own row below the tabs), why it is replaced (user asked for one row), why `tab === 'assistant' && groupOpen` reproduces the child's `headerless && aiAllowed` gate exactly, and the per-control indicator semantics from decision 2.
      Files: `HIT_Mobile/app/(dashboard)/lead-matching.tsx`
      Verify: `cd HIT_Mobile; npx tsc --noEmit` — exits clean with no new errors.

- [ ] 2. Remove the duplicate pill row from the chat component, leaving only the 3-dot.
      In `src/components/GroupChatEmbedded.tsx`, change the block at lines ~2320-2336 so the `My Post` and `Matching` `Pressable`s are gone and the row renders only when the menu button is needed: `{headerless && aiAllowed && aiActive && (<View style={s.aiActionBar}><Pressable onPress={() => setShowAiMenu(v => !v)} style={s.headerAiDots}><MoreVertical size={18} color={colors.ink} /></Pressable></View>)}`. Leave `aiPost` / `aiMatching` / `doPost` / `doMatching` / the pending-action refs / the drain effect / the `onActionsReady` publish effect **completely untouched** — they are now called only from the hub. Delete the now-unused `s.headerAiBtn` and `s.headerAiBtnText` style keys (grep-confirmed: no other consumer) and keep `s.aiActionBar`, `s.headerAiRow`, `s.headerAiDots`. Update the stale comments that describe the old layout: the `headerless` prop doc (lines ~634-637), the thread-header comment (line ~2211-2213), the comment above the removed block, the `aiActionBar` style comment (lines ~3663-3666) and the "group header buttons/menu" note above `doPost` (line ~1292) — each should say what the row used to contain and that the hub's single tab row now owns those two controls. Do not touch `Search` / `Building2` imports; both are still used elsewhere in the file.
      Files: `HIT_Mobile/src/components/GroupChatEmbedded.tsx`
      Verify: `cd HIT_Mobile; npx tsc --noEmit` — clean. Also confirm by reading the file that `aiPost` and `aiMatching` are still defined and still referenced by the `onActionsReady` effect (the hub's only path to them).

- [ ] 3. Build the release APK, install it, and have the user confirm the row visually.
      No test framework exists in this repo (`HIT_Mobile/package.json` has only expo scripts), so a release build plus an on-device look is the verification. Build with `cd HIT_Mobile\android; .\gradlew.bat assembleRelease` (check the output text for `BUILD SUCCESSFUL`, not the exit code), then install with `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s ebbbfc95 install -r "HIT_Mobile\android\app\build\outputs\apk\release\app-release.apk"` after checking `adb devices`.
      Files: none (verification only)
      Verify: APK builds and installs. Then ask the user to open AI Leads and confirm: one row reading `Groups  Chats  My Post  Matching`, all four plain text + icon with no pills/borders, nothing underlined on landing, underline moving to `Groups` / `Chats` when tapped, `My Post` opening the My Posts sheet, `Matching` either showing results or the "complete your requirement first" toast, and the row falling back to just `Groups  Chats` before the room opens. adb screenshots come back black on this device — do not claim visual verification from a screenshot.

## Assumptions / gaps

- The user's "same line" request intentionally reverses the earlier in-code decision to keep navigation and actions apart. No steering rule covers it, so it proceeds; the reasoning is preserved in the rewritten comment rather than deleted.
- Icons are kept (decision 4). If the user wants labels only, that is a one-line change inside `SubTab`.
- Not planned, out of scope: moving the 3-dot menu into the tab row, and any change to `aiPost` / `aiMatching` / `doPost` / `doMatching` behaviour.
