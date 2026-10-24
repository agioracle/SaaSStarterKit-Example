/** Framework-free client for an extension background context. Tokens remain in memory only. */
export interface ExtensionUser { id: string; email: string; name?: string }
export function createExtensionSession(appOrigin: string, transport: typeof fetch = fetch) {
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || origin.username || origin.password ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))))
    throw Error('Use an exact HTTPS application origin (HTTP loopback is allowed for local development).');
  let token: string | null = null;
  let revision = 0;
  const request = (path: string, options: RequestInit) => transport(`${appOrigin}${path}`, {
    ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  return {
    async signIn(googleAccessToken: string): Promise<ExtensionUser> {
      if (!googleAccessToken || googleAccessToken.length > 8192) throw Error('Google access token is required.');
      const ownRevision = ++revision;
      token = null;
      const response = await request('/api/extension/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: googleAccessToken }),
      });
      if (!response.ok) throw Error(`Extension sign-in failed (${response.status}).`);
      const signedToken = response.headers.get('set-auth-token');
      if (!signedToken) throw Error('Server did not return a signed session token.');
      if (ownRevision !== revision) throw Error('Sign-in was superseded.');
      token = signedToken;
      try { return await this.getMe(); }
      catch (error) { if (ownRevision === revision) token = null; throw error; }
    },
    async getMe(): Promise<ExtensionUser> {
      if (!token) throw Error('Sign in first.');
      const current = token;
      const ownRevision = revision;
      const response = await request('/api/me', { method: 'GET', headers: { Authorization: `Bearer ${current}` } });
      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && token === current) token = null;
        throw Error(`Session check failed (${response.status}).`);
      }
      const result = await response.json() as { user?: ExtensionUser };
      if (ownRevision !== revision) throw Error('Session changed.');
      if (!result.user?.id || !result.user.email) throw Error('Invalid session response.');
      return result.user;
    },
    async signOut(): Promise<void> {
      const current = token;
      token = null;
      ++revision;
      if (!current) return;
      const response = await request('/api/auth/sign-out', { method: 'POST', headers: { Authorization: `Bearer ${current}`, 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw Error(`Local session cleared; server revocation failed (${response.status}). Revoke the session from account settings.`);
    },
    clearLocalSession() { token = null; ++revision; },
    hasSession() { return token !== null; },
  };
}
