import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Network from 'expo-network';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { WebView } from 'react-native-webview';

// ─── Config ───────────────────────────────────────────────────────────────────
const APP_URL = 'https://ajo-app-ebo2.vercel.app';
const APP_SCHEME = 'mobileapp';
const AUTH_SUCCESS_SCHEME = `${APP_SCHEME}://auth-complete`;
const OAUTH_CALLBACK_URL = `${APP_URL}/api/auth/google-callback`;

// How long to wait before showing the "taking too long" nudge (ms)
const SLOW_LOAD_THRESHOLD = 8000;

// Auth URL patterns that must never load inside the WebView
const AUTH_URL_PATTERNS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  '__/auth/handler',
  'securetoken.googleapis.com',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildGoogleOAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '',
    redirect_uri: OAUTH_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: AUTH_SUCCESS_SCHEME,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ─── Offline Screen ───────────────────────────────────────────────────────────
function OfflineScreen({ onRetry }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleRetry = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRetry();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <Animated.View
        style={[
          styles.centeredContent,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.offlineIconWrap}>
          <Text style={styles.offlineIcon}>📡</Text>
        </View>
        <Text style={styles.offlineTitle}>No Connection</Text>
        <Text style={styles.offlineMessage}>
          Please check your internet connection and try again.
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={handleRetry}
          activeOpacity={0.75}
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Loading Overlay ──────────────────────────────────────────────────────────
function LoadingOverlay({ visible, slowLoad }) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.loadingOverlay, { opacity }]}
    >
      <ActivityIndicator size="large" color="#047857" />
      <Text style={styles.loadingText}>
        {slowLoad ? 'Still loading…' : 'Loading…'}
      </Text>
      {slowLoad && (
        <Text style={styles.slowLoadHint}>
          This is taking longer than usual.{'\n'}Check your connection.
        </Text>
      )}
    </Animated.View>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const webviewRef = useRef(null);

  // Network
  const [isConnected, setIsConnected] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);

  // App readiness
  const [appIsReady, setAppIsReady] = useState(false);

  // WebView loading state
  const [isLoading, setIsLoading] = useState(true);
  const [slowLoad, setSlowLoad] = useState(false);
  const slowLoadTimer = useRef(null);

  // Navigation
  const [canGoBack, setCanGoBack] = useState(false);

  // Auth
  const [authInProgress, setAuthInProgress] = useState(false);

  // ── Browser warm-up ──────────────────────────────────────────────────────
  useEffect(() => {
    WebBrowser.warmUpAsync();
    return () => { WebBrowser.coolDownAsync(); };
  }, []);

  // ── Network polling ───────────────────────────────────────────────────────
  const checkNetwork = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      setIsConnected(prev => {
        if (!prev && connected) {
          // Coming back online — reload WebView automatically
          setWasOffline(true);
        }
        return connected;
      });
    } catch {
      setIsConnected(true);
    }
  }, []);

  // Auto-reload when coming back online
  useEffect(() => {
    if (wasOffline && isConnected) {
      setWasOffline(false);
      setTimeout(() => webviewRef.current?.reload(), 300);
    }
  }, [wasOffline, isConnected]);

  // ── App lifecycle ─────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function prepare() {
      try { await SplashScreen.preventAutoHideAsync(); } catch {}
      await checkNetwork();
      if (mounted) setAppIsReady(true);
    }

    const handleDeepLink = ({ url }) => {
      if (!mounted) return;
      if (url.startsWith(AUTH_SUCCESS_SCHEME)) {
        setTimeout(() => webviewRef.current?.reload(), 400);
      }
    };

    async function handleInitialUrl() {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl?.startsWith(AUTH_SUCCESS_SCHEME)) {
          setTimeout(() => webviewRef.current?.reload(), 400);
        }
      } catch {}
    }

    prepare();
    handleInitialUrl();

    const networkInterval = setInterval(checkNetwork, 10000);
    const linkingSub = Linking.addEventListener('url', handleDeepLink);

    return () => {
      mounted = false;
      clearInterval(networkInterval);
      linkingSub?.remove();
    };
  }, [checkNetwork]);

  // Hide splash once ready
  useEffect(() => {
    if (appIsReady) {
      SplashScreen.hideAsync().catch(() => null);
    }
  }, [appIsReady]);

  // ── Android back button ───────────────────────────────────────────────────
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

  // ── Slow-load detection ───────────────────────────────────────────────────
  const startSlowLoadTimer = () => {
    clearTimeout(slowLoadTimer.current);
    setSlowLoad(false);
    slowLoadTimer.current = setTimeout(() => setSlowLoad(true), SLOW_LOAD_THRESHOLD);
  };

  const clearSlowLoadTimer = () => {
    clearTimeout(slowLoadTimer.current);
    setSlowLoad(false);
  };

  // ── WebView handlers ──────────────────────────────────────────────────────
  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);
  };

  const handleShouldStartLoad = (request) => {
    const { url } = request;
    if (AUTH_URL_PATTERNS.some(p => url.includes(p))) return false;
    if (url.startsWith(`${APP_SCHEME}://`)) return false;
    return true;
  };

  const handleLoadStart = () => {
    setIsLoading(true);
    startSlowLoadTimer();
  };

  const handleLoadEnd = async () => {
    clearSlowLoadTimer();
    setIsLoading(false);
  };

  const handleError = (syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    console.warn('[WebView] Error:', nativeEvent.description);
    clearSlowLoadTimer();
    setIsLoading(false);
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'INITIATE_GOOGLE_LOGIN':
          await initiateGoogleLogin();
          break;
        case 'WEBVIEW_READY':
          break;
        default:
          console.log('[WebView] Unknown message:', data.type);
      }
    } catch (error) {
      console.error('[WebView] Message parse error:', error);
    }
  };

  const reenableButtons = () => {
    webviewRef.current?.injectJavaScript(`
      (function() {
        document.querySelectorAll('button[disabled]').forEach(function(btn) {
          btn.disabled = false;
        });
        true;
      })();
    `);
  };

  const initiateGoogleLogin = async () => {
    if (authInProgress) return;
    setAuthInProgress(true);

    // Haptic feedback when auth starts
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const googleUrl = buildGoogleOAuthUrl();
      const result = await WebBrowser.openAuthSessionAsync(
        googleUrl,
        AUTH_SUCCESS_SCHEME,
        {
          // iOS: show Done button so user can always dismiss
          showInRecents: false,
          preferEphemeralSession: false,
        }
      );

      if (result.type === 'success') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => webviewRef.current?.reload(), 400);
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        reenableButtons();
      }
    } catch (error) {
      console.error('[Auth] Google login error:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      reenableButtons();
    } finally {
      setAuthInProgress(false);
    }
  };

  // ── Injected JS ───────────────────────────────────────────────────────────
  const injectedJavaScript = `
    (function() {
      // Viewport
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

      // Native app flag
      window.__NATIVE_APP__ = true;
      window.__PLATFORM__ = '${Platform.OS}';

      // Disable pull-to-refresh on Android (prevents accidental reloads)
      document.body.style.overscrollBehavior = 'none';

      window.ReactNativeWebView?.postMessage(
        JSON.stringify({ type: 'WEBVIEW_READY' })
      );
      true;
    })();
  `;

  // ── Render ────────────────────────────────────────────────────────────────
  if (!appIsReady) return null;

  if (!isConnected) {
    return <OfflineScreen onRetry={checkNetwork} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      <WebView
        ref={webviewRef}
        source={{ uri: `${APP_URL}/login` }}
        originWhitelist={['*']}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleWebViewMessage}
        injectedJavaScript={injectedJavaScript}
        // Performance
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        setSupportMultipleWindows={false}
        // UX
        scalesPageToFit={false}
        allowsInlineMediaPlayback
        allowsBackForwardNavigationGestures
        // Cookies / auth
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        // Render
        style={styles.webview}
        // Avoid white flash on navigation
        renderLoading={() => <View style={styles.webviewPlaceholder} />}
        startInLoadingState
      />

      {/* <LoadingOverlay visible={isLoading} slowLoad={slowLoad} /> */}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webviewPlaceholder: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  // Loading overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#047857',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },
  slowLoadHint: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
    paddingHorizontal: 32,
  },

  // Offline screen
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  offlineIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  offlineIcon: {
    fontSize: 32,
  },
  offlineTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.3,
  },
  offlineMessage: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#047857',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    shadowColor: '#047857',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});