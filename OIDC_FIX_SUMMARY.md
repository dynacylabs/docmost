# OIDC Authentication Session Conflict Fix

## Problem Description

When using Docmost with an OIDC provider (like Authelia), there was a critical session management issue:

1. User A logs in through Authelia → Successfully logged into Docmost as User A
2. User A logs out of Authelia (via auth.austinconn.org/logout) → Authelia session cleared, BUT Docmost session remains
3. User B logs in through Authelia → Authenticates as User B in Authelia, BUT remains logged in as User A in Docmost

### Root Cause

The issue occurred because:
- Docmost kept the authentication cookie (`authToken`) active even after the OIDC provider session was cleared
- When auto-redirecting to OIDC login, Docmost didn't clear existing sessions
- The OIDC callback didn't validate or clear the existing session before setting a new one
- The authorization URL didn't force re-authentication at the provider level

## Solution Implemented

Three key changes were made to fix this issue:

### 1. Clear Auth Cookie Before OIDC Login
**File:** `apps/server/src/core/auth/oidc.controller.ts`

Added `res.clearCookie('authToken')` at the start of the OIDC login flow to ensure any existing Docmost session is cleared before redirecting to the OIDC provider.

```typescript
@Get('login')
async login(
  @AuthWorkspace() workspace: Workspace,
  @Res() res: FastifyReply,
) {
  // Clear any existing auth cookie to ensure fresh authentication
  // This prevents session conflicts when switching between OIDC users
  res.clearCookie('authToken');
  
  // ... rest of login logic
}
```

### 2. Force Re-authentication at OIDC Provider
**File:** `apps/server/src/core/auth/services/oidc.service.ts`

Added `prompt: 'login'` to the authorization URL parameters. This forces the OIDC provider to re-authenticate the user even if they have an active session, ensuring the correct user is authenticated.

```typescript
async getAuthorizationUrl(state: string): Promise<string> {
  const authUrl = client.authorizationUrl({
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state: state,
    // Force fresh authentication at the OIDC provider
    // This prevents using cached OIDC sessions when switching users
    prompt: 'login',
  });
  
  return authUrl;
}
```

### 3. Clear Cookie Before Setting New Session in Callback
**File:** `apps/server/src/core/auth/oidc.controller.ts`

Added `res.clearCookie('authToken')` in the callback handler before setting the new authentication cookie. This provides an additional safeguard against session conflicts.

```typescript
@Get('callback')
async callback(...) {
  const { authToken } = await this.oidcService.handleCallback(...);

  // Clear any existing auth cookie before setting the new one
  // This ensures we don't have conflicting sessions
  res.clearCookie('authToken');

  // Set auth cookie
  this.setAuthCookie(res, authToken);
  
  // ... redirect to home
}
```

## How It Works Now

With these fixes, the authentication flow works correctly:

1. **User A logs in through Authelia:**
   - Old session (if any) is cleared
   - Authelia authenticates User A (forced re-auth with `prompt=login`)
   - Docmost creates a fresh session for User A

2. **User A logs out of Authelia:**
   - Authelia session is cleared

3. **User B logs in through Authelia:**
   - Auto-redirect clears any existing Docmost session
   - Authelia is forced to re-authenticate (no cached session used)
   - User B is authenticated by Authelia
   - Docmost clears any lingering cookie and creates a fresh session for User B
   - **User B is now correctly logged in as User B** ✓

## Testing Recommendations

To verify the fix works correctly:

1. Log in as User A through Authelia
2. Verify you're logged in as User A in Docmost
3. Log out of Authelia (NOT Docmost) via the Authelia logout endpoint
4. Log in as User B through Authelia
5. Verify you're now logged in as User B (not User A) in Docmost

## Additional Notes

- The `prompt=login` parameter is part of the OpenID Connect specification and is supported by most OIDC providers including Authelia, Keycloak, Auth0, Okta, etc.
- These changes ensure session security and prevent unauthorized access through session carryover
- The fix is backward compatible and doesn't affect normal OIDC authentication flows
- If using `OIDC_LOGOUT_URL`, users clicking "Logout" in Docmost will still be properly logged out of both systems

## Affected Files

- `apps/server/src/core/auth/oidc.controller.ts`
- `apps/server/src/core/auth/services/oidc.service.ts`

## References

- OpenID Connect Core 1.0 - Authentication Request: https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest
- The `prompt` parameter values: `none`, `login`, `consent`, `select_account`
