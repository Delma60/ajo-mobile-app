import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Platform, Linking, AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';

const APP_URL =
  process.env.EXPO_PUBLIC_APP_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

// The deep-link scheme registered in app.json
const DEEP_LINK_SCHEME = 'mobileapp';

// Build the Google OAuth URL server-side (the Next.js callback handles the exchange)
function buildGoogleAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '',
    redirect_uri: `${APP_URL}/api/auth/google-callback`,
    response_type: 'code',
    scope: 'openid email profile',
    // Pass the deep link as state so the server knows where to redirect back
    state: `${DEEP_LINK_SCHEME}://auth-complete`,
    access_type: 'offline',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export default function App() {
  const webviewRef = useRef(null);
  const [webviewKey, setWebviewKey] = useState(0); // bump to force reload

  // ── Listen for the deep link that arrives after OAuth completes ────────────
  useEffect(() => {
    const handleUrl = ({ url }) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        // mobileapp://auth-complete?session=ok
        if (
          parsed.protocol === `${DEEP_LINK_SCHEME}:` &&
          parsed.pathname.includes('auth-complete')
        ) {
          const sessionOk = parsed.searchParams.get('session') === 'ok';
          if (sessionOk) {
            // The __session cookie is now set on the domain.
            // Reload the WebView so Next.js middleware sees it.
            setWebviewKey((k) => k + 1);
          }
        }
      } catch {
        // ignore malformed URLs
      }
    };

    // Handle deep links while app is already open
    const sub = Linking.addEventListener('url', handleUrl);

    // Handle deep links that launched the app from cold
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    return () => sub.remove();
  }, []);

  // ── Handle postMessage from the WebView ────────────────────────────────────
  const handleMessage = async (event) => {
    let payload;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (payload.type === 'INITIATE_GOOGLE_LOGIN') {
      const authUrl = buildGoogleAuthUrl();
      // Open Google's consent screen in the system browser (not WebView).
      // The system browser will respect saved Google sessions; the in-app
      // browser avoids session sharing issues on Android.
      await Linking.openURL(authUrl);
    }
  };

  // ── Injected JS: flags the page as running inside the native wrapper ───────
  const injectedJavaScript = `
    (function() {
      window.__NATIVE_APP__ = true;
      // Polyfill ReactNativeWebView for the bridge (already present, but guard)
      true;
    })();
  `;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <WebView
        key={webviewKey}
        ref={webviewRef}
        source={{ uri: APP_URL }}
        style={styles.webview}
        // ── Cookie & session ──────────────────────────────────────────────
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // ── JS bridge ────────────────────────────────────────────────────
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={injectedJavaScript}
        onMessage={handleMessage}
        // ── UX ───────────────────────────────────────────────────────────
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
        // ── Back navigation on Android ────────────────────────────────────
        onShouldStartLoadWithRequest={(request) => {
          // Intercept deep links that may arrive via redirect inside WebView
          if (request.url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
            Linking.openURL(request.url);
            return false; // prevent WebView from trying to load mobileapp://
          }
          return true;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  webview: { flex: 1 },
});