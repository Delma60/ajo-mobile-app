# Firebase Gmail Auth Setup for Mobile WebView

This document explains how to configure Firebase auth to work properly in the native mobile app WebView.

## Problem

Firebase redirect-based OAuth doesn't work well inside WebView because:
- OAuth redirects break the WebView flow
- Pop-ups don't open in WebView
- Cookies may not sync between OAuth provider and WebView

## Solution

The app now opens Firebase OAuth flows in the **native browser** instead of in the WebView. This ensures proper OAuth completion, then syncs the auth session back when the user returns.

## Required Configuration

### 1. Firebase Console Setup

Add your mobile app domain to Firebase as an **authorized domain**:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to **Authentication** → **Settings** → **Authorized domains**
4. Add: `ajo-app-ebo2.vercel.app`
5. Also add the redirect domain if using a custom callback URL

### 2. Google OAuth Configuration

In **Google Cloud Console**:

1. Go to **APIs & Services** → **OAuth 2.0 Client IDs**
2. Edit your Web application credentials
3. Add these **Authorized redirect URIs**:
   - `https://ajo-app-ebo2.vercel.app/api/auth/callback/google` (if using custom backend)
   - `https://ajo-app-ebo2.vercel.app/` (fallback)

### 3. Next.js App Configuration

Your Next.js app needs to support the OAuth redirect properly:

```javascript
// pages/login.jsx or your auth page
import { signInWithRedirect, getAuth, GoogleAuthProvider } from 'firebase/auth';

export default function Login() {
  const handleGoogleSignIn = async () => {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    
    // Firebase will redirect to Google, then back to your callback URL
    signInWithRedirect(auth, provider);
  };

  return (
    <button onClick={handleGoogleSignIn}>
      Sign in with Google
    </button>
  );
}
```

### 4. Handle Auth Redirect in Next.js

After Google redirects back to your app, handle the result:

```javascript
// pages/api/auth/callback/google.js or in your page component
import { getRedirectResult, getAuth } from 'firebase/auth';

useEffect(() => {
  const auth = getAuth();
  
  getRedirectResult(auth)
    .then(result => {
      if (result && result.user) {
        // User signed in successfully
        console.log('Signed in as:', result.user.email);
        // Redirect to app dashboard
        router.push('/dashboard');
      }
    })
    .catch(error => {
      console.error('Auth error:', error);
    });
}, []);
```

## How It Works

1. **User taps "Sign in with Gmail"** in the WebView
2. **Native browser opens** with Google OAuth page
3. **User authenticates** with their Google account
4. **Redirected back** to `https://ajo-app-ebo2.vercel.app/`
5. **Firebase sets session cookie** (shared across browser)
6. **Mobile app reloads** and syncs the authenticated session
7. **User is now logged in** in the WebView

## Cookie Sharing (Critical)

The WebView has `sharedCookiesEnabled={true}` and `thirdPartyCookiesEnabled={true}` to ensure:
- Cookies set by the native browser are visible in the WebView
- Session cookies from Firebase are shared across both contexts

## Testing

### On Android Emulator

1. Make sure your development server is accessible from the emulator:
   - Run Next.js app: `npm run dev`
   - Note your machine's IP address (e.g., `192.168.x.y`)
   - Update `App.js` to use: `http://192.168.x.y:3000`

2. Run the mobile app:
   ```bash
   npm start
   # Select Android emulator
   ```

3. Test Gmail sign-in flow

### On iOS Simulator

1. Run Next.js app on `http://localhost:3000`
2. Run mobile app:
   ```bash
   npm start
   # Select iOS simulator
   ```

3. Test Gmail sign-in flow

## Troubleshooting

### Issue: "Sign in page loads but doesn't redirect back"

**Cause**: OAuth redirect URL not registered in Firebase/Google Console

**Solution**:
- Add the exact redirect URL to Firebase authorized domains
- Add OAuth client redirect URIs in Google Cloud Console
- Restart the app after config changes

### Issue: "Session not persisting after OAuth"

**Cause**: Cookies not shared between browser and WebView

**Solution**:
- Verify `sharedCookiesEnabled={true}` in `App.js`
- Check that Firebase session cookie is being set (use Safari DevTools on iOS to inspect)
- Clear app cache: uninstall and reinstall the mobile app

### Issue: "Gmail sign-in opens in WebView instead of native browser"

**Cause**: Redirect URL is same-origin, so `handleShouldStartLoad` doesn't intercept it

**Solution**:
- The app checks for `accounts.google.com` URLs to force native browser
- Ensure your Next.js Firebase config uses `signInWithRedirect()` (not a custom endpoint)

## Security Notes

- Session cookies are httpOnly (set by Firebase), so they can't be accessed via JavaScript
- The native browser handles the OAuth flow securely, not exposed to WebView code
- Tokens are never passed through the WebView bridge
- For extra security, consider using Firebase Admin SDK on your backend to validate user sessions

## Production URLs

Update the domain references in:
1. **app.json**: Change `ajo-app-ebo2.vercel.app` to your production domain
2. **App.js**: Update hardcoded domain in `handleShouldStartLoad` check
3. **Firebase Console**: Add your production domain as authorized domain
4. **Google Cloud Console**: Update OAuth redirect URIs for production

