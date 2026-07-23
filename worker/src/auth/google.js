/**
 * Google OAuth (§11). Server-side authorization-code flow with a client secret.
 */
export const google = {
  id: 'google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  scope: 'openid profile',

  clientId: (env) => env.GOOGLE_CLIENT_ID,
  clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,

  /** Google's token endpoint takes form encoding, not JSON. */
  tokenHeaders: () => ({ accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }),
  tokenBody: (params) => new URLSearchParams(params).toString(),

  userHeaders: (token) => ({ authorization: `Bearer ${token}`, accept: 'application/json' }),

  identity: (profile) => ({
    providerId: profile.sub,
    displayName: profile.name || profile.given_name || null,
  }),
};

export default google;
