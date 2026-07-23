/**
 * The account section of Settings (§12): sign in, sync, sign out, delete.
 *
 * polyglot works fully without any of this (§1.3). An account buys one thing — the same
 * log on two devices — and this screen says so rather than selling it.
 */
import { config } from '../../../config/app.config.js';
import { forgetAccount, noteSync, store, syncPort, wipeLocal } from '../store.js';
import { button, div, el, p, panel, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { httpApi, syncNow } from './client.js';
import { loadTurnstile, renderWidget } from './turnstile.js';

const s = strings.account;
const api = httpApi();

/** "just now", "3 minutes ago", a date — without a date library. */
export function relativeTime(then, now = Date.now()) {
  if (!then) return s.never;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return s.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return s.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return s.hoursAgo(hours);
  return new Date(then).toLocaleDateString();
}

/**
 * Render the panel, refreshing itself as the session and sync state change.
 * @param {{ navigate: (hash: string) => void }} ctx
 */
export function accountPanel(ctx) {
  const body = div({ class: 'account' });
  const host = panel(s.title, [body]);

  const paint = (state) => replace(body, ...state);
  paint([p(s.checking, 'muted')]);

  api
    .me()
    .then((session) => {
      store.account = session.user;
      paint(signedIn(session.user, paint, ctx));
    })
    .catch(() => {
      store.account = null;
      paint([p(s.guestBody, 'muted'), ...signInControls(paint, ctx)]);
    });

  return host;
}

/** Signed out: what an account is for, and the provider buttons. */
function signInControls(paint, ctx) {
  const status = p('', 'muted');
  const widgetHost = div({ class: 'turnstile-host' });
  const buttons = div({ class: 'row' });

  const begin = async (provider) => {
    status.textContent = s.redirecting;
    try {
      // Turnstile runs on this page only, and only when an operator configured it.
      const token = await tokenFor(widgetHost, status);
      const { redirectUrl } = await api.startLogin(provider, token);
      location.href = redirectUrl;
    } catch (err) {
      status.textContent = err?.message === 'turnstile_unavailable' ? s.turnstileFailed : s.signInFailed;
    }
  };

  api
    .providers()
    .then(({ providers }) => {
      if (providers.length === 0) {
        replace(buttons, p(s.noProviders, 'muted'));
        return;
      }
      replace(
        buttons,
        ...providers.map((provider) =>
          button(s.signInWith(providerLabel(provider)), () => begin(provider), {
            variant: 'btn-quiet',
          }),
        ),
      );
    })
    .catch(() => replace(buttons, p(s.noProviders, 'muted')));

  return [buttons, widgetHost, status];
}

/** Signed in: who, when it last synced, and the two dangerous buttons. */
function signedIn(user, paint, ctx) {
  const status = p(s.lastSync(relativeTime(store.lastSyncAt)), 'muted');

  const sync = button(s.syncNow, async () => {
    status.textContent = s.syncing;
    sync.disabled = true;
    try {
      const result = await syncNow(syncPort(), api);
      if (!result.ok) throw new Error(result.reason);
      await noteSync(result.at, user);
      status.textContent = s.syncedCounts(result.pushed, result.pulled);
    } catch {
      status.textContent = s.syncFailed;
    } finally {
      sync.disabled = false;
    }
  }, { variant: 'btn-primary' });

  const signOut = button(s.signOut, async () => {
    await api.logout().catch(() => {});
    await forgetAccount();
    paint([p(s.signedOutBody, 'muted'), ...signInControls(paint, ctx)]);
  }, { variant: 'btn-quiet' });

  return [
    p(s.signedInAs(user.displayName || user.id), ''),
    div({ class: 'row' }, [sync, signOut]),
    status,
    deleteAccount(paint, ctx),
  ];
}

/** Deleting the account removes the server copy and this device's data (§11, §1.5). */
function deleteAccount(paint, ctx) {
  const input = el('input', {
    class: 'answer',
    attrs: { type: 'text', placeholder: s.deleteConfirm(s.deleteWord), 'aria-label': s.deleteConfirm(s.deleteWord) },
  });

  const confirm = button(s.deleteAccount, async () => {
    if (input.value.trim() !== s.deleteWord) return;
    confirm.disabled = true;
    await api.deleteAccount().catch(() => {});
    await forgetAccount();
    await wipeLocal();
    ctx.navigate('#home');
  }, { variant: 'btn-danger' });

  confirm.disabled = true;
  input.addEventListener('input', () => {
    confirm.disabled = input.value.trim() !== s.deleteWord;
  });

  return div({ class: 'danger-inline' }, [p(s.deleteBody, 'muted'), input, confirm]);
}

/**
 * A Turnstile token, or undefined when the operator has not configured a widget.
 *
 * The server decides whether a token is required; the client only supplies one when it
 * can. That keeps a self-hosted deploy without Turnstile working (§12).
 */
async function tokenFor(host, status) {
  const siteKey = config.auth.turnstile.siteKey;
  if (!config.auth.turnstile.enabled || !siteKey) return undefined;

  status.textContent = s.verifying;
  const loaded = await loadTurnstile();
  if (!loaded) throw new Error('turnstile_unavailable');
  return renderWidget(host, siteKey);
}

const providerLabel = (name) => name.charAt(0).toUpperCase() + name.slice(1);
