# Verification — AI Leads: one row of four text tabs

Date: 1 Oct 2026. Environment: Windows PowerShell 5.1.
Iteration 2 — after the review findings in `review.json` / `review.md`.

## Review findings addressed in this iteration

| # | Finding | Fix |
|---|---------|-----|
| 1 (blocking) | `hub.subTabText` had no `flexShrink`, so RN's `flexShrink: 0` default meant `numberOfLines={1}` could not truncate `Matching` inside its `flex: 1` cell — overflow / collision at ~320dp or font scale > 1.0 | `subTabText` now carries `flexShrink: 1`; new `subTabIcon: { flexShrink: 0 }` passed to the lucide icon so the 14px box never gives way instead of the label. `app/(dashboard)/lead-matching.tsx` |
| 2 (blocking) | Comment above `doPost` claimed the handlers are also reached "from the AI menu" — that menu only has Disappearing / End Chat / Exit Chat | Clause dropped; the comment now states the `onActionsReady` publish effect is the only path, and says explicitly that the 3-dot menu is not an entry point. `src/components/GroupChatEmbedded.tsx` (~line 1296) |
| 3 (blocking) | Inline label comment in `SubTab` promised shrink behaviour the stylesheet did not implement | Comment rewritten to explain the RN `flexShrink` default and to point at the `flexShrink: 1` that now backs it; code and comment agree |
| 4 (non-blocking) | Headerless AI bar now mounts/unmounts with AI mode and shifts thread content | Behaviour left as-is (an empty white strip is worse); the positional consequence and the now-redundant `aiAllowed` term are documented at the gate itself. No code change — changing it would alter what the user sees, which is not a loop decision |
| 5 (non-blocking) | `hub.subBar` had no `accessibilityRole="tablist"` | Added, so the two `accessibilityRole="tab"` items sit under a parent list. No visual change |
| 6 (non-blocking) | Install + visual check outstanding | Install and launch now DONE (section 3). Visual check still pending the user (section 4) |

## 1. Type check — CLEAN

```
cd c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile
npx tsc --noEmit
```

Output written to a file and read back: file length 0 characters, `EXIT=0`. No
errors, no warnings.

(Iteration 1 note, kept for the record: the first run of that iteration failed
with `TS2322` because `SubTab`'s `Icon` prop was hand-typed as
`React.ComponentType<{ size?: number; color?: string }>`; lucide's forward-ref
component is not assignable to that narrower shape, so the prop uses the
`LucideIcon` type exported by `lucide-react-native`.)

## 2. Release APK — BUILD SUCCESSFUL

```
cd c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile\android
.\gradlew.bat assembleRelease
```

Output filtered for `BUILD SUCCESSFUL` / `BUILD FAILED` / `error:` / `FAILURE`:

```
BUILD SUCCESSFUL in 4m 28s
```

Judged by the output text, not the exit code (gradle reports 1 when piped — here
it happened to report `EXIT=0`, but the text is what was trusted).

Artifact:

```
app-release.apk   58,124,097 bytes   10/1/2026 11:56:52 AM
c:\Users\Pranay Bhujade\Downloads\HIT\HIT_Mobile\android\app\build\outputs\apk\release\app-release.apk
```

## 3. Install + launch on device `ebbbfc95` — DONE, NO CRASH

```
& $adb devices
# List of devices attached
# ebbbfc95   device

& $adb -s ebbbfc95 install -r "...\app-release.apk"
# Performing Streamed Install
# Success

& $adb -s ebbbfc95 logcat -c
& $adb -s ebbbfc95 shell monkey -p in.homeintown.mobile -c android.intent.category.LAUNCHER 1
# Events injected: 1
Start-Sleep -Seconds 14
& $adb -s ebbbfc95 logcat -d -s AndroidRuntime:E ReactNativeJS:*
```

logcat after launch — no `AndroidRuntime:E`, no FATAL, no JS error:

```
10-01 11:57:36.623 I ReactNativeJS: Running "main"
10-01 11:57:38.586 I ReactNativeJS: '[Socket] connected', '6TXUXTA83LS3WfgQAABV'
10-01 11:57:43.374 I ReactNativeJS: 'VirtualizedList: You have a large list that is slow
                                     to update ...' { dt: 1999, prevDt: 744, ... }
```

The VirtualizedList line is a pre-existing RN performance warning, not an error
from this change. `adb shell pidof in.homeintown.mobile` → `19334`, so the process
was still alive ~15 s after launch. The unrelated `in.homeintown.app` package was
not touched.

## 4. Visual confirmation — PENDING THE USER

Not verified and not verifiable from here: `adb exec-out screencap` returns a
fully black image on this phone, and `adb shell input tap` is silently swallowed
while the screen is locked. No screenshot was taken and none would prove anything.
The app installing and launching clean says nothing about how the row looks.

What the user needs to look at in AI Leads:

- One row reading `Groups  Chats  My Post  Matching`, all four plain icon + text,
  no pills, no filled backgrounds, no borders.
- Nothing underlined on the landing view (unchanged from before — default `tab`
  is `'assistant'`, which is neither Groups nor Chats).
- Tapping `Groups` / `Chats` moves the orange underline to that tab and swaps the
  pane.
- `My Post` opens the My Posts sheet; it must NOT stay underlined afterwards.
- `Matching` either shows match results or toasts "Please complete your
  requirement first"; also must NOT stay underlined.
- Before the assistant room opens, the row falls back to just `Groups  Chats`
  filling the full width — no empty gap where the actions were.
- Labels must not wrap or clip; with `flexShrink: 1` a too-narrow cell now
  ellipsizes (`Matchi…`) instead of spilling into its neighbour.

## Behaviour-preservation check (read, not run)

- `aiPost` and `aiMatching` in `GroupChatEmbedded.tsx` are unchanged, as are
  `doPost`, `doMatching`, `pendingAiActionRef`, the drain effect, and the
  `onActionsReady` publish effect, which still passes
  `{ post: aiPost, matching: aiMatching, resetToLanding: aiResetToLanding }`.
  That effect is the only path to those two actions — now stated correctly in the
  comment above `doPost` (review finding 2).
- No handler was merged into `tab`. `My Post` / `Matching` call
  `groupActionsRef.current?.post()` / `.matching()` and never call `setTab`.
- Visibility gate preserved: the removed block was gated on
  `headerless && aiAllowed`; the hub renders the two action items on
  `tab === 'assistant' && groupOpen`. Only the assistant pane receives
  `headerless`/`hideThreadBack`, so inside it `aiAllowed` reduces to
  `!!activeRoom`, which the child reports up through
  `useEffect(() => { onRoomOpenChange?.(!!activeRoom) }, ...)` into `groupOpen`.
- `s.headerAiBtn` / `s.headerAiBtnText` deleted; grep confirmed no remaining
  consumer. `s.aiActionBar`, `s.headerAiRow`, `s.headerAiDots` kept.
- `Search` and `Building2` imports in `GroupChatEmbedded.tsx` left alone — both
  have many other usages.
- The headerless `aiActionBar` is gated on `aiActive` as well, because with the
  pills gone the row would otherwise paint as an empty white strip with a hairline
  whenever a room was open but AI mode was off. Its only remaining child (the
  3-dot) was already `aiActive`-gated, so no control changed availability. The
  resulting ~42px mount/unmount shift is documented at the gate (finding 4).

## Not done

No test framework exists in this repo (`package.json` has only expo scripts), so
there is nothing automated to extend. Nothing was committed and nothing was
pushed, per the task instructions.
