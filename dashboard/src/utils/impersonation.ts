// ── Impersonation ("Login as user") helper ────────────────────────────────
// When an admin impersonates a client, we swap the active session token for a
// freshly-minted session belonging to that client and hard-reload the app, so
// the whole dashboard loads as that user — inbox, orders, analytics, etc.
// The admin's own token is stashed so a floating "Impersonate mode" pill can
// restore it and return to the admin panel at any time.

const TOKEN_KEY = 'dfbot_token';
const ADMIN_TOKEN_KEY = 'impersonator_token';
const LABEL_KEY = 'impersonating_as';

export function isImpersonating(): boolean {
  try {
    return !!localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return false;
  }
}

export function getImpersonationLabel(): string {
  try {
    return localStorage.getItem(LABEL_KEY) || '';
  } catch {
    return '';
  }
}

// Enter a user's account. `label` is what shows on the floating pill
// (e.g. their email). Hard-reloads so every part of the app re-auths as them.
export function startImpersonation(token: string, label: string) {
  try {
    const current = localStorage.getItem(TOKEN_KEY) || '';
    // Don't overwrite the stashed admin token if we're already impersonating.
    if (!localStorage.getItem(ADMIN_TOKEN_KEY)) {
      localStorage.setItem(ADMIN_TOKEN_KEY, current);
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LABEL_KEY, label || 'user');
    // Clear per-account UI state so we don't carry admin/page selections over.
    localStorage.removeItem('dfbot_active_page');
    localStorage.removeItem('admin_tab');
  } catch {}
  window.location.href = '/';
}

// Leave the impersonated account and return to the admin session.
export function stopImpersonation() {
  try {
    const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
    if (adminToken) localStorage.setItem(TOKEN_KEY, adminToken);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(LABEL_KEY);
    localStorage.removeItem('dfbot_active_page');
  } catch {}
  window.location.href = '/';
}

// Injects a fixed, draggable "Impersonate mode" pill into <body> whenever an
// impersonation session is active. Pure DOM so it renders above every screen
// without touching React's render tree. Safe to call on every app boot.
export function mountImpersonationBar() {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('impersonation-bar');
  if (!isImpersonating()) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const label = getImpersonationLabel();
  const bar = document.createElement('div');
  bar.id = 'impersonation-bar';
  bar.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:8px 10px 8px 14px',
    'border-radius:14px',
    'background:#ffffff',
    'color:#0d0d10',
    'box-shadow:0 8px 28px rgba(0,0,0,0.22)',
    'border:1px solid rgba(0,0,0,0.08)',
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
    'font-size:13px',
    'max-width:calc(100vw - 32px)',
  ].join(';');

  const info = document.createElement('div');
  info.style.cssText = 'display:flex;flex-direction:column;min-width:0;';
  const title = document.createElement('span');
  title.textContent = 'Impersonate mode';
  title.style.cssText = 'font-weight:800;font-size:11px;color:#a855f7;letter-spacing:.02em;';
  const who = document.createElement('span');
  who.textContent = label;
  who.style.cssText = 'font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;';
  info.appendChild(title);
  info.appendChild(who);

  const exit = document.createElement('button');
  exit.title = 'Return to admin';
  exit.setAttribute('aria-label', 'Return to admin');
  exit.textContent = '⤶ Exit';
  exit.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:6px',
    'padding:7px 14px',
    'border:none',
    'border-radius:10px',
    'cursor:pointer',
    'font-weight:800',
    'font-size:12px',
    'font-family:inherit',
    'background:#ef4444',
    'color:#fff',
  ].join(';');
  exit.onclick = () => stopImpersonation();

  bar.appendChild(info);
  bar.appendChild(exit);
  document.body.appendChild(bar);
}
