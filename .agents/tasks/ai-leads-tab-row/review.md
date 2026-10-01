# AI Leads header: four controls merged into one underline tab row

`Groups` / `Chats` / `My Post` / `Matching` now render as one row of four identical text+icon tabs in the AI Leads hub. The two coloured pills (`My Post` green-filled, `Matching` brand-tinted) that lived in `GroupChatEmbedded`'s own action row are gone; the hub drives those two actions through the `onActionsReady` → `groupActionsRef` channel that already existed, so no new props, no new state, and no handler was rewritten. A single module-scope `SubTab` renders all four, with an `isPane` flag deciding whether an item can hold an underline at all — panes can, one-shot actions never do. The behaviour contract holds: `aiPost` / `aiMatching` / `doPost` / `doMatching` / the pending-action refs / the drain effect are untouched, nothing calls `setTab` from an action item, and the action items' visibility gate (`tab === 'assistant' && groupOpen`) mirrors the child's old `headerless && aiAllowed`.

Watch for: the labels have no `flexShrink`, so RN's `flexShrink: 0` default means `numberOfLines={1}` cannot actually shrink `Matching` inside its `flex: 1` cell — it overflows instead of ellipsizing on a ~320dp screen or at a raised system font scale (likely), which contradicts the comment sitting right above it. A new comment above `doPost` claims the handlers are also reachable "from the AI menu" in non-headerless mode; that menu only has Disappearing / End Chat / Exit Chat, so the path does not exist (confirmed). The headerless AI bar gained an `aiActive` condition, which kills the empty strip but makes a ~42px bar mount and unmount as AI mode toggles where it used to be stable (confirmed). On-device install and the visual check are still outstanding — the phone was absent during verification.

**Verdict**: NEEDS_CHANGES

## High-level view

The merge direction is right. `tab` cannot move down into `GroupChatEmbedded` because the row has to stay visible on the `chats` pane where that component is not even mounted, so the actions moved up through the existing publish channel instead. The old in-code decision to keep navigation and actions apart is rewritten rather than deleted, so nobody reintroduces the split by accident.

Indicator semantics are chosen correctly and explained in a comment. `My Post` / `Matching` open modals and have no selected state, so they get no persistent underline and a shared pressed-opacity instead; `Groups` / `Chats` keep the mutually-exclusive brand underline, and both stay unlit on the default `assistant` landing view as before.

Behaviour preservation checks out. The two kinds of control were not merged into one state variable, the action items only ever call `groupActionsRef.current?.post()` / `.matching()`, and the publish effect that populates that ref is ungated and fires on the child's first commit — earlier than `groupOpen` can flip true — so there is no window where a visible action item taps into a null ref.

The layout gap is in the label metrics, not the structure: `subTabText` needs `flexShrink: 1` (and the icon `flexShrink: 0`) for the one-line clamp to behave as its comment describes.

Two comments landed inaccurate: the `doPost` header invents a reachability path that does not exist, and the label comment describes shrink behaviour the stylesheet does not produce.

<details>
<summary>Issues (5)</summary>

1. **Label cannot shrink** (likely) — `hub.subTabText` has no `flexShrink: 1` and RN defaults `flexShrink` to 0, so `numberOfLines={1}` will not truncate `Matching` inside its `flex: 1` cell; it overflows and can collide with the neighbouring tab on a ~320dp screen or at a raised font scale. Add `flexShrink: 1` to `subTabText` and `flexShrink: 0` to the icon, or give the `Text` `flex: 1` with `textAlign: 'center'`.
2. **Wrong reachability claim above `doPost`** (confirmed) — the new comment says the handlers are reached "in the non-headerless thread header, from the AI menu", but that menu only offers Disappearing messages / End Chat / Exit Chat. `aiPost` / `aiMatching` are referenced only by the `onActionsReady` effect. Drop the AI-menu clause.
3. **Comment promises shrink behaviour the style does not implement** (confirmed) — the inline comment on the label says `Matching` "must shrink the cell, never wrap it"; fix it together with issue 1 so comment and code agree.
4. **Headerless AI bar now mounts with AI mode** (confirmed) — adding `aiActive` to the `headerless && aiAllowed` gate removes the empty strip, but makes the whole ~42px bar appear/disappear on AI-mode toggle and shift the thread content, where previously only the 3-dot inside a stable bar toggled. Decide whether that shift is acceptable or keep the bar mounted at zero height.
5. **Install and visual confirmation outstanding** (confirmed from evidence) — `tsc` is clean and the release APK reports `BUILD SUCCESSFUL`, but device `ebbbfc95` never appeared on adb, so the APK was not installed and the row was never seen. The user has to plug in, unlock, install, and confirm the row visually (screenshots come back black on this phone).

</details>

<details>
<summary>Details</summary>

### One renderer, and the pane/action distinction it encodes

`SubTab` decides the underline in one place, `const lit = isPane && active`. The action items pass `active: false`, and even a future mistake that set them active could not light them because `lit` also demands `isPane`. No second tab implementation is left anywhere.

```
lead-matching.tsx (hub)
  tab: 'assistant' | 'groups' | 'chats'        ← ONLY panes write this
  SUB = [ Groups(pane), Chats(pane),
          ...(tab==='assistant' && groupOpen
              ? [ MyPost(action), Matching(action) ] : []) ]
            │                   │
            │ setTab()          │ groupActionsRef.current?.post()/.matching()
            ▼                   ▼
   content pane swap     GroupChatEmbedded.aiPost / aiMatching  (unchanged)
                               └─ published once via onActionsReady
```

### Visibility gate equivalence

Getting this gate wrong would put the actions on a pane where they do nothing, so the chain is worth stating precisely. In the child, `aiAllowed = !!activeRoom && (activeRoom.isUniversal || hideThreadBack)` (line 741), and only the assistant pane is passed `headerless` and `hideThreadBack`, so inside that pane `aiAllowed` reduces to `!!activeRoom`. The child reports exactly `!!activeRoom` upward through `onRoomOpenChange`, which the hub stores as `groupOpen`. Both panes are rendered by a ternary with distinct `key`s, so switching panes remounts and resets `activeRoom` → `onRoomOpenChange(false)`. `tab === 'assistant' && groupOpen` therefore matches the old gate without any new prop.

Spreading a conditional array rather than rendering a hidden placeholder leaves exactly two `flex: 1` cells when the actions are absent, so `Groups` / `Chats` reclaim the full width with no gap and no shift.

### Label metrics and the missing shrink

The metrics tightened as planned — icon 15 → 14, `gap` 5 → 4, `paddingHorizontal: 6` added — and every label is clamped with `numberOfLines={1}`. The clamp cannot do its job:

```js
subTab:     { flex: 1, flexDirection: 'row', ..., gap: 4, paddingHorizontal: 6, ... },
subTabText: { fontSize: 11, fontWeight: '700', color: colors.muted2 },   // no flexShrink
```

RN defaults `flexShrink` to 0 (unlike CSS), so the `Text` is laid out at its intrinsic width. At 320dp each cell is ~80px, leaving ~50px for the label after 12px padding, the 14px icon and the 4px gap; `Matching` at 11px/700 measures roughly 47px, so it only just fits, and any increase — a system font scale above 1.0, or a longer label later — overflows the cell instead of ellipsizing. `flexShrink: 1` on `subTabText` plus `flexShrink: 0` on the icon makes the clamp behave as the comment already claims.

### Accessibility

Panes get `accessibilityRole="tab"` with `accessibilityState={{ selected: active }}`, actions get `accessibilityRole="button"` and no state, and all four get an explicit `accessibilityLabel` — net new, since the old inline pane `Pressable`s carried no accessibility props at all. The container `hub.subBar` has no `accessibilityRole="tablist"`, so the two `tab` roles sit without a parent list; worth adding, though the selected state still announces.

### The headerless AI bar

```diff
-{headerless && aiAllowed && (
+{headerless && aiAllowed && aiActive && (
   <View style={s.aiActionBar}>
-    ...My Post pill...  ...Matching pill...
-    {aiActive && <Pressable ...><MoreVertical /></Pressable>}
+    <Pressable onPress={() => setShowAiMenu(v => !v)} style={s.headerAiDots}>
+      <MoreVertical size={18} color={colors.ink} />
+    </Pressable>
   </View>
 )}
```

No control changed availability: the 3-dot was already `aiActive`-gated, and since `aiActive = aiMode && aiAllowed` the retained `aiAllowed` term is now redundant. The consequence is positional. Before, with a room open and AI mode off, the bar painted as a white strip holding the two pills, and the 3-dot appeared inside it without moving anything. Now the bar is absent until AI mode turns on, so entering or exiting AI mode inserts or removes ~42px (8px padding ×2 + a 26px dots cell) above the thread and shifts the content. An empty hairline-bordered strip would have been worse, so the gate is the better of the two, but the shift is new.

### Verification evidence

`npx tsc --noEmit` exits 0 with empty output, and `assembleRelease` reports `BUILD SUCCESSFUL in 5m 5s` with a 58,123,957-byte APK, judged from the output text rather than the exit code. The install and launch were not run because adb listed no devices before or after `adb reconnect`, and the evidence says so plainly instead of claiming otherwise. No screenshot was taken, matching the known black-screencap behaviour on this phone. There is no test framework in the repo, so there is nothing automated to extend.

Not tested: every runtime claim about the row — that all four controls render on one line, that nothing is underlined on landing, that the underline tracks `Groups` / `Chats`, that `My Post` opens the sheet and `Matching` either shows results or toasts "Please complete your requirement first", that neither action stays lit, and that the row collapses cleanly to two items before the assistant room opens. Also untested: whether `Matching` clips on the narrowest layout, which is where issue 1 would surface.

### Scope

Two files, no unrelated cleanup, no reformatting drift. `s.headerAiBtn` / `s.headerAiBtnText` are deleted with no remaining consumer (the in-header row at line 2250 uses `headerAiRow` + `headerAiDots`), and the `Search` / `Building2` imports stay because both have many other usages in the file. The only change beyond the literal ask is the `aiActive` term on the headerless bar, a direct consequence of removing the pills and documented where it happens.

</details>

<details>
<summary>File map</summary>

- `app/(dashboard)/lead-matching.tsx` — new module-scope `SubTab`; `SUB` extended with `active` / `onPress` per item plus the two conditionally-spread action items; inline map body replaced with `<SubTab>`; `subTab` metrics tightened, `subTabPressed` added; `Building2` / `Search` / `LucideIcon` imported; comments rewritten to record the old navigation/action split and the indicator rules.
- `src/components/GroupChatEmbedded.tsx` — `My Post` / `Matching` pills removed from the headerless action row, which is now gated on `aiActive` and holds only the AI 3-dot; `headerAiBtn` / `headerAiBtnText` styles deleted; `headerless` / `onActionsReady` prop docs and the `aiActionBar` / thread-header comments updated. Handlers, refs, drain effect and publish effect unchanged.

Full diff: `git diff` in `HIT_Mobile` (working tree, uncommitted).

</details>
