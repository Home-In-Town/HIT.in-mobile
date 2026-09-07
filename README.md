# HomeInTown Mobile (Expo)

Native mobile app for the HomeInTown Sales Intelligence platform, built with **Expo + expo-router + NativeWind**. It reuses the same brand design (amber `#B45309`, cream `#FAF7F2`) and connects to the same backend API as the web app.

This is a **true native app** — it renders with React Native primitives (`View`, `Text`, `Pressable`, `TextInput`, `Image`), not a webview. NativeWind lets us keep the exact Tailwind class names and colors from the web frontend so the UI matches.

## What's included (Phase 1 — Option A)

- **Auth**: login (phone + MPIN), register (Investor / Field / Builder), forgot MPIN, OTP verify, reset MPIN. Employee login captures GPS location.
- **CRM Dashboard**: AI Leads Manager (metrics + recent activity) and Human Lead Manager toggle.
- **Human Lead Manager**: lead list with search + stage filter pills, Add Lead form (name, phone, alt number, email, budget, home type, buying type, location, project interest from uploaded projects, source with custom option, stage), site visit scheduling with red alerts for missing/close dates, Advanced button.
- **Lead Detail**: sales journey with 3 tracks (Inbound / Outbound / AI Guide), 8-stage pipeline, stage change, editable journey steps (admin), photo upload per stage (admin only, visible to all), notes, reminders, Call/WhatsApp actions.

## Tech

| Concern | Web (Next.js) | Mobile (Expo) |
| --- | --- | --- |
| Rendering | DOM + Tailwind | React Native + NativeWind |
| Routing | App Router | expo-router (file-based) |
| Auth transport | httpOnly cookie | JWT in `expo-secure-store` + `Authorization: Bearer` header |
| Icons | lucide-react | lucide-react-native |
| Toasts | react-hot-toast | custom `ToastProvider` |
| Location | `navigator.geolocation` | `expo-location` |
| Image upload | `<input type=file>` | `expo-image-picker` |

## Prerequisites

- Node.js 18+
- Expo Go app on your phone (iOS App Store / Google Play), or an Android emulator / iOS simulator

## Setup

```bash
cd HIT_Mobile
npm install
```

### Configure the backend URL

The API base URL is read from `app.json` under `expo.extra.apiUrl`. It defaults to the production Cloud Run backend:

```json
"extra": { "apiUrl": "https://sales-website-backend-624770114041.asia-south1.run.app/api" }
```

To point at a local backend during development, change it to your machine's LAN IP (not `localhost`, since the phone can't reach the dev machine's localhost):

```json
"extra": { "apiUrl": "http://192.168.1.20:5001/api" }
```

## Run

```bash
npm start        # opens Expo Dev Tools + QR code
npm run android  # open on Android emulator/device
npm run ios      # open on iOS simulator (macOS only)
```

Scan the QR code with Expo Go to run on a physical device.

## Backend requirement (important)

The web app authenticates with httpOnly cookies. Mobile can't use cookies, so this app expects the backend to **return a JWT `token` in the response body** for `POST /auth/login`, `/auth/register`, and `/auth/verify-otp`, and to accept `Authorization: Bearer <token>` on protected routes (including `/auth/session` or `/users/me`).

If the backend currently only sets a cookie, add the token to the JSON response (the JWT is already generated server-side for the cookie). No other backend change is needed — `crm-bridge`, `projects`, and `employee` routes already read the token via the auth middleware.

## Project structure

```
HIT_Mobile/
├── app/                          # expo-router routes
│   ├── _layout.tsx               # providers + auth-based navigation
│   ├── index.tsx                 # entry redirect
│   ├── login.tsx                 # auth flows
│   └── (dashboard)/
│       ├── _layout.tsx           # dashboard shell (top bar + sign out)
│       └── crm.tsx               # CRM dashboard (AI / Human toggle)
├── src/
│   ├── lib/
│   │   ├── api.ts                # API client (token-based)
│   │   ├── authContext.tsx       # auth provider + useAuth
│   │   └── storage.ts            # SecureStore token helper
│   └── components/
│       ├── Toast.tsx             # toast provider
│       └── crm/
│           ├── CrmMetricsBar.tsx
│           ├── HumanLeadManager.tsx
│           └── LeadDetailView.tsx
├── app.json  babel.config.js  metro.config.js
├── tailwind.config.js  global.css  nativewind-env.d.ts
└── tsconfig.json  package.json
```

## Assets (optional)

No app icon / splash image is bundled yet, so the app runs with Expo defaults. To add branding, create an `assets/` folder with `icon.png` (1024×1024) and `splash.png`, then re-add the `icon`, `splash`, and `android.adaptiveIcon` keys to `app.json`.

## Roadmap (next phases)

The CRM/Human Lead Manager and auth are ported. Remaining web screens to bring over incrementally: role dashboards (admin/agent/builder/captain/employee), Chat, Group Chat, Marketplace, Projects, Analytics, Organizations, Profile. Each reuses the same `src/lib/api.ts` client, so porting is UI-only.
