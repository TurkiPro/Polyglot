/**
 * GitHub OAuth (§11). Server-side authorization-code flow with a client secret.
 */
export const github = {
  id: 'github',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userUrl: 'https://api.github.com/user',
  scope: 'read:user',

  clientId: (env) => env.GITHUB_CLIENT_ID,
  clientSecret: (env) => env.GITHUB_CLIENT_SECRET,

  /** GitHub wants a JSON Accept header, or it answers form-encoded. */
  tokenHeaders: () => ({ accept: 'application/json', 'content-type': 'application/json' }),

  /** GitHub rejects requests without a User-Agent. */
  userHeaders: (token) => ({
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'polyglot',
  }),

  identity: (profile) => ({
    providerId: profile.id,
    displayName: profile.name || profile.login || null,
  }),
};

export default github;
