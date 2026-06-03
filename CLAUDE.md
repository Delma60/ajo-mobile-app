# Expo WebView Wrapper for Next.js (Native-like Mobile App)

This guide explains how to wrap your Next.js app in an Expo React Native WebView to produce a native-feeling mobile app while reusing the existing web frontend. It focuses on developer workflow, session handling, performance, native UX polish, and production builds.

**Goals**
- Ship a native wrapper (iOS & Android) that loads your Next.js site inside a WebView
- Preserve auth/session, deep links, and shareable URLs
- Make the app feel native (splash, status bar, gestures, safe areas)
- Allow incremental native features (push, offline, native payments) later

**Assumptions**
- Your Next.js app runs at a public URL (development: `http://localhost:3000`, production: `https://your-domain.com`)
- You have Node/npm installed and basic mobile dev tooling (Expo CLI; Xcode/Android Studio for device emulators when needed)
- The Next.js app supports session cookie auth (server-side session cookie `__session`) and CSRF-safe flows

---

## Quick start (dev)

1. Install Expo CLI (global) if you don't have it:

```bash
npm install -g expo-cli
# or
npx expo-cli --version
```

2. Create a new bare-bones Expo project inside the repo (adjacent folder or `mobile/`):

```bash
cd <repo-root>
npx expo-cli init mobile --template expo-template-blank --name "AjoMobile"
cd mobile
npm install react-native-webview
```

3. Minimal `App.tsx` using WebView (replace NEXT_PUBLIC_APP_URL when ready):

```tsx
import React from 'react';
import { SafeAreaView, Platform, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://10.0.2.2:3000';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {Platform.OS === 'android' && <StatusBar barStyle="light-content" />}
      <WebView
        originWhitelist={["*"]}
        source={{ uri: APP_URL }}
        startInLoadingState
        allowsInlineMediaPlayback
        sharedCookiesEnabled={true}
        javaScriptEnabled
        domStorageEnabled
      />
    </SafeAreaView>
  );
}
```

4. Run Expo on device/emulator:

```bash
npm start
# or
npx expo start
```

Open on an iOS/Android emulator or Expo Go on your phone.

---

## Important implementation details

### Localhost URLs for emulators
- Android emulator (Android Studio): use `http://10.0.2.2:3000` to reach your machine's localhost
- iOS simulator: `http://localhost:3000` works generally
- For Expo Go on a physical device, use your machine LAN IP (e.g. `http://192.168.x.y:3000`) and ensure firewall allows access

### Session cookies & auth
- To preserve auth, use cookies (httpOnly) from your Next.js server. Configure the WebView so cookies are shared:
  - `react-native-webview` with `sharedCookiesEnabled={true}` and `thirdPartyCookiesEnabled={true}` (Android)
  - For a robust approach, implement a short-lived token exchange endpoint on Next.js that issues a temporary app-only token (e.g., JWT in response body) which the app stores in SecureStore and injects into WebView headers via `injectedJavaScript` or `onShouldStartLoadWithRequest`.
- Avoid storing long-lived credentials in WebView localStorage; prefer native SecureStore for sensitive tokens.

### Deep linking and universal links
- Configure expo `app.json` with `scheme` and `intentFilters` / `associatedDomains` for universal links.
- In the WebView, listen to navigation changes (`onNavigationStateChange`) and map `myapp://` or deep link paths to native screens, or re-route them back into the WebView.

Example `app.json` fragment:

```json
{
  "expo": {
    "scheme": "ajosave",
    "ios": {
      "bundleIdentifier": "com.yourcompany.ajosave",
      "associatedDomains": ["applinks:your-domain.com"]
    },
    "android": {
      "package": "com.yourcompany.ajosave",
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [{ "scheme": "https", "host": "your-domain.com" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### Native UI polish
- Splash screen: use `expo-splash-screen` and match the Next.js brand color. Configure asset and native splash screens so the app doesn't show plain white during WebView load.
- Status bar: adjust with `expo-status-bar` or `StatusBar` from `react-native`.
- Gestures & back handling: intercept Android hardware back to navigate WebView history instead of closing app.
- Safe area: use `SafeAreaView` to avoid notch overlap.

### Performance
- Enable server-side caching and compress responses in Next.js.
- Use a small native loading indicator while WebView content loads.
- For faster perceived loads, implement lightweight native screens for critical flows (login, splash) and only use WebView for the main app shell.

### Offline behavior
- The WebView relies on the browser engine's cache; consider adding a native offline screen and detect connectivity with `expo-network`.
- Progressive enhancement: expose key read-only data through a native API or cached JSON endpoints when user is offline.

### Push notifications
- Use Expo Notifications (or bare React Native native SDKs) — this requires server-side support to send device push tokens from the native app to your backend.
- Keep push opt-in, and route push opens to deep links in the WebView.

### Analytics & Native integrations
- Add native analytics SDKs (Amplitude/Firebase Analytics) for better mobile metrics. Send events for app open, link click, and screen views (mirror web events if possible).

---

## Security recommendations
- Use HTTPS for all endpoints in production.
- Keep cookies SameSite=Lax (or None with secure) and set `Secure` in production.
- If you use `injectedJavaScript`, sanitize data paths and avoid exposing secrets to the web layer.
- Use `expo-secure-store` for any native tokens and never persist raw credentials in AsyncStorage.

---

## Build & publishing (high-level)

### Expo Managed (quick)
- `eas build --platform android` and `eas build --platform ios` (requires EAS and account setup)
- Use `expo publish` for OTA updates (note limitations for native code changes)

### Bare/native (more control)
- `expo prebuild` to generate native projects, then use Xcode / Android Studio for app store builds.

See Expo docs for detailed Play Store / App Store steps.

---

## Developer workflow recommendations
- Keep the `mobile/` project inside the monorepo; add `.env` entries like `NEXT_PUBLIC_APP_URL` for development.
- Use Metro bundler & Expo CLI to iterate quickly. Use the LAN URL for device testing.
- Add a small native screen for login that calls your Next.js auth endpoint and sets a cookie (if you choose to do native-first auth).

### Example dev URLs
- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`
- Physical device: `http://<YOUR_MACHINE_IP>:3000`

---

## Checklist (what to implement)
- [ ] Scaffold `mobile/` Expo project
- [ ] Implement WebView wrapper with `sharedCookiesEnabled` and proper `source.uri`
- [ ] Configure splash screen, status bar, and safe area
- [ ] Configure deep links & universal links
- [ ] Implement back handling and WebView navigation bridging
- [ ] Implement secure token exchange or cookie bridging if needed
- [ ] Add CI step to build Expo binaries for release
- [ ] Add push notifications and analytics (optional)

---

## Example commands summary

```bash
# create expo app
npx expo-cli init mobile --template expo-template-blank --name "AjoMobile"
cd mobile
npm install react-native-webview expo-secure-store expo-splash-screen expo-status-bar expo-network

# run locally
npx expo start
# build
npx eas build --platform android
npx eas build --platform ios
```

---

If you'd like, I can scaffold the `mobile/` Expo project with the WebView `App.tsx` and sample config in this repo, wire dev URLs and env examples, and implement the cookie/token exchange endpoint in your Next.js API. Which of these would you like me to do next?