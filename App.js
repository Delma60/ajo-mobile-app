import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Network from 'expo-network';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { WebView } from 'react-native-webview';

// ─── Config ───────────────────────────────────────────────────────────────────
const APP_URL = 'https://ajo-app-ebo2.vercel.app';

// Custom URL scheme — must match app.json "scheme" field
// Register this in app.json: { "expo": { "scheme": "mobileapp" } }
const APP_SCHEME = 'mobileapp';

// After Google auth, your Next.js callback will redirect here.
// The in-app browser detects this scheme and closes automatically.
const AUTH_SUCCESS_SCHEME = `${APP_SCHEME}://auth-complete`;

// The Next.js route that handles the Google OAuth callback.
// It must: verify the token → set session cookie → redirect to AUTH_SUCCESS_SCHEME
const OAUTH_CALLBACK_URL = `${APP_URL}/api/auth/google-callback`;

// ─── Auth URL patterns that must never load inside the WebView ───────────────
const AUTH_URL_PATTERNS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  '__/auth/handler',
  'securetoken.googleapis.com',
];

// ─── Google OAuth URL ─────────────────────────────────────────────────────────
// We bypass Firebase's signInWithRedirect entirely and call Google OAuth directly.
// The Next.js callback route receives the code, exchanges it for tokens,
// calls firebase-admin to create a custom token or session, then redirects
// to AUTH_SUCCESS_SCHEME so the in-app browser closes.
function buildGoogleOAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '',
    redirect_uri: OAUTH_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    // Pass a state param so the callback can redirect to the right scheme
    state: encodeURIComponent(AUTH_SUCCESS_SCHEME),
  });
  console.log(OAUTH_CALLBACK_URL)
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export default function App() {
  const webviewRef = useRef(null);
  const [isConnected, setIsConnected] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [appIsReady, setAppIsReady] = useState(false);
  const [authInProgress, setAuthInProgress] = useState(false);

  // ── Warm up the browser for faster auth open ──────────────────────────────
  useEffect(() => {
    WebBrowser.warmUpAsync();
    return () => { WebBrowser.coolDownAsync(); };
  }, []);

  // ── Network & lifecycle setup ──────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function prepareApp() {
      try { await SplashScreen.preventAutoHideAsync(); } catch {}
    }

    async function checkNetwork() {
      try {
        const state = await Network.getNetworkStateAsync();
        if (mounted) {
          setIsConnected(!!state.isConnected && state.isInternetReachable !== false);
        }
      } catch {
        if (mounted) setIsConnected(true);
      }
    }

    // Handle deep links when the app is already open (foreground)
    const handleDeepLink = ({ url }) => {
      if (!mounted) return;
      console.log('[DeepLink] Received:', url);
      if (url.startsWith(AUTH_SUCCESS_SCHEME)) {
        setTimeout(() => webviewRef.current?.reload(), 400);
      }
    };

    async function handleInitialUrl() {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl?.startsWith(AUTH_SUCCESS_SCHEME)) {
          console.log('[DeepLink] Cold start from auth callback:', initialUrl);
          setTimeout(() => webviewRef.current?.reload(), 400);
        }
      } catch (error) {
        console.warn('[DeepLink] getInitialURL failed', error);
      }
    }

    prepareApp();
    checkNetwork();
    handleInitialUrl();
    const interval = setInterval(checkNetwork, 15000);
    const linkingSubscription = Linking.addEventListener('url', handleDeepLink);

    return () => {
      mounted = false;
      clearInterval(interval);
      linkingSubscription?.remove();
    };
  }, []);

  // Hide splash when offline
  useEffect(() => {
    if (!isConnected && !appIsReady) {
      SplashScreen.hideAsync().catch(() => null);
      setAppIsReady(true);
    }
  }, [isConnected, appIsReady]);

  // Android hardware back button
  useEffect(() => {
    const onBackPress = () => {
      if (canGoBack && webviewRef.current) {
        webviewRef.current.goBack();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack]);

  // ── WebView handlers ───────────────────────────────────────────────────────

  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);
  };

  /**
   * Block Google/Firebase auth URLs from loading inside the WebView.
   * Any auth URL that slips through (e.g. from a JS redirect) is intercepted here.
   */
  const handleShouldStartLoad = (request) => {
    const url = request.url;

    // Block known auth provider URLs from inside WebView
    if (AUTH_URL_PATTERNS.some((p) => url.includes(p))) {
      console.log('[WebView] Blocked auth URL from loading inside WebView:', url);
      return false;
    }

    // If somehow the callback URL fires inside WebView, block and reload instead
    if (url.startsWith(APP_SCHEME + '://')) {
      console.log('[WebView] Blocked custom scheme URL:', url);
      return false;
    }

    return true;
  };

  const handleWebViewLoadEnd = async () => {
    setIsLoading(false);
    if (!appIsReady) {
      await SplashScreen.hideAsync().catch(() => null);
      setAppIsReady(true);
    }
  };

  /**
   * Messages from window.ReactNativeWebView.postMessage(...) in Next.js.
   * Your Next.js GoogleAuthButton should post:
   *   { type: 'INITIATE_GOOGLE_LOGIN' }
   * instead of calling Firebase signInWithRedirect/signInWithPopup.
   */
  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[WebView] Message:', data.type);

      switch (data.type) {
        case 'INITIATE_GOOGLE_LOGIN':
          await initiateGoogleLogin();
          break;

        case 'WEBVIEW_READY':
          // WebView signals it has loaded — nothing to do here
          break;

        default:
          console.log('[WebView] Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('[WebView] Message parse error:', error);
    }
  };

  /**
   * Opens Google OAuth in an in-app browser (ASWebAuthenticationSession on iOS,
   * Chrome Custom Tab on Android). The browser is dismissed automatically when
   * it sees the `ajosave://` scheme in the redirect URL.
   *
   * FLOW:
   *   App → openAuthSessionAsync(googleUrl, 'ajosave://') →
   *   Google consent screen →
   *   Google redirects to OAUTH_CALLBACK_URL (your Next.js route) →
   *   Next.js sets session cookie → redirects to `ajosave://auth-complete` →
   *   Browser closes → openAuthSessionAsync resolves with { type: 'success' } →
   *   App reloads WebView → user is now logged in
   */
  const initiateGoogleLogin = async () => {
    if (authInProgress) return;
    setAuthInProgress(true);

    try {
      const googleUrl = buildGoogleOAuthUrl();
      console.log('[Auth] Opening Google OAuth URL in in-app browser');

      // Use the exact redirect scheme so Expo knows which return URL to watch for.
      const result = await WebBrowser.openAuthSessionAsync(
        googleUrl,
        AUTH_SUCCESS_SCHEME
      );

      console.log('[Auth] Browser result:', result.type, result.url ?? '');

      if (result.type === 'success' && result.url?.startsWith(AUTH_SUCCESS_SCHEME)) {
        // The in-app browser was dismissed because it saw the auth callback URL.
        // Your Next.js callback has already set the session cookie at this point.
        setTimeout(() => {
          webviewRef.current?.reload();
        }, 400);
      } else if (result.type === 'success') {
        // On some platforms the return URL may be returned differently.
        setTimeout(() => {
          webviewRef.current?.reload();
        }, 400);
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // User closed the browser without completing auth — re-enable buttons
        webviewRef.current?.injectJavaScript(`
          (function() {
            document.querySelectorAll('button[disabled]').forEach(function(btn) {
              btn.disabled = false;
            });
            true;
          })();
        `);
      }
    } catch (error) {
      console.error('[Auth] Google login error:', error);
      webviewRef.current?.injectJavaScript(`
        (function() {
          document.querySelectorAll('button[disabled]').forEach(function(btn) {
            btn.disabled = false;
          });
          true;
        })();
      `);
    } finally {
      setAuthInProgress(false);
    }
  };

  // JavaScript injected into every page — signals the app is in a WebView
  const injectedJavaScript = `
    (function() {
      // Flag for Next.js components to detect they're inside the native wrapper
      window.__NATIVE_APP__ = true;
      window.ReactNativeWebView?.postMessage(
        JSON.stringify({ type: 'WEBVIEW_READY' })
      );
      true;
    })();
  `;

  // ── Offline screen ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.offlineContainer}>
          <Text style={styles.offlineTitle}>No internet connection</Text>
          <Text style={styles.offlineMessage}>
            Please connect to a network and try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <WebView
        ref={webviewRef}
        source={{ uri: `${APP_URL}/login` }}
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#047857" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={handleWebViewLoadEnd}
        onError={handleWebViewLoadEnd}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleWebViewMessage}
        injectedJavaScript={injectedJavaScript}
        allowsInlineMediaPlayback
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        style={styles.webview}
      />
      {isLoading && (
        <View style={styles.spinnerOverlay}>
          <ActivityIndicator size="large" color="#047857" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  webview: { flex: 1, backgroundColor: '#ffffff' },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    padding: 24,
  },
  loadingText: { marginTop: 12, color: '#047857', fontSize: 16, fontWeight: '500' },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  offlineTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12, color: '#111827' },
  offlineMessage: { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24 },
});