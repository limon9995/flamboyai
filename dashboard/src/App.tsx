import { Suspense, useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { API_BASE, useApi } from './hooks/useApi';
import { getTheme, useToast, safeLazy } from './components/ui';
import { useLanguage } from './i18n';
import { mountImpersonationBar } from './utils/impersonation';
import { LoginPage } from './pages/LoginPage';
import { SignupPageComponent } from './pages/SignupPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ConnectPageScreen } from './pages/ConnectPageScreen';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { OnboardingFlow } from './pages/OnboardingFlow';
const DashboardLayout = safeLazy(async () => {
  const mod = await import('./pages/DashboardLayout');
  return { default: mod.DashboardLayout };
});
const AdminPanel = safeLazy(async () => {
  const mod = await import('./pages/AdminPanel');
  return { default: mod.AdminPanel };
});

type MyPage = { id: number; pageId: string; pageName: string; isActive: boolean; automationOn: boolean; masterPageId?: number | null; isConnected?: boolean; };
type Screen = 'landing' | 'login' | 'signup' | 'forgot-password' | 'change-password' | 'connect-page' | 'onboarding' | 'dashboard' | 'admin';

function normalizePathname(pathname: string) {
  const cleaned = String(pathname || '/')
    .replace(/\/+(null|undefined)(?=\/|$)/gi, '')
    .replace(/\/{2,}/g, '/')
    .trim();
  if (!cleaned || cleaned === '') return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function replaceUrl(params: URLSearchParams) {
  const query = params.toString();
  const nextPath = normalizePathname(window.location.pathname);
  const safePath = nextPath; // Fixed: use current path for deep link support
  const next = query ? `${safePath}?${query}` : safePath;
  if (next !== window.location.pathname + window.location.search) {
    window.history.replaceState({}, '', next);
  }
}

function ScreenFallback({ dark }: { dark: boolean }) {
  const { copy } = useLanguage();
  return (
    <div
      style={{
        minHeight: '100vh',
        background: dark ? '#06060a' : '#f7f7f8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui',
        color: dark ? '#ededf0' : '#0d0d10',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⬡</div>
        <div style={{ fontSize: 12, opacity: 0.35 }}>{copy('লোড হচ্ছে...', 'Loading...')}</div>
      </div>
    </div>
  );
}

// Global Error Boundary to prevent white screen
import { Component, type ReactNode, type ErrorInfo } from 'react';
class ErrorBoundary extends Component<{ children: ReactNode; dark: boolean }, { hasError: boolean; errorText?: string }> {
  constructor(props: any) { super(props); this.state = { hasError: false, errorText: '' }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorText: error.message || String(error) });
    console.error('App Crash:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: this.props.dark ? '#06060a' : '#f7f7f8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: this.props.dark ? '#fff' : '#000', padding: 20, textAlign: 'center' }}>
          <div>
            <h2 style={{ marginBottom: 10 }}>Oops! Something went wrong.</h2>
            <p style={{ color: '#ef4444', marginBottom: 20, fontSize: 13, fontFamily: 'monospace' }}>
              Error: {this.state.errorText || 'Unknown Initialization Error'}
            </p>
            <p>Please try refreshing the page.</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '10px 24px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Reload FlamboyAI</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppContent() {
  const { copy } = useLanguage();
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('dfbot_dark') !== '0'; }
    catch { return true; }
  });
  const th = getTheme(dark);
  const { user, ready, login, logout, changePassword, loginWithGoogle, completeGoogleLogin } = useAuth();
  const { request } = useApi();
  const { show: showToast, ToastNode } = useToast();

  const [screen, setScreen] = useState<Screen>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'login') return 'login';
    if (params.get('mode') === 'signup') return 'signup';
    if (params.get('mode') === 'forgot-password') return 'forgot-password';
    if (params.get('mode') === 'change-password') return 'change-password';
    if (params.get('mode') === 'connect-page') return 'connect-page';
    if (params.get('mode') === 'admin') return 'admin';
    if (params.get('mode') === 'dashboard') return 'dashboard';
    return 'landing';
  });
  const [activePage, setActivePage] = useState<MyPage | null>(null);
  const [myPages, setMyPages] = useState<MyPage[]>([]);

  useEffect(() => {
    try { localStorage.setItem('dfbot_dark', dark ? '1' : '0'); } catch {}
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.style.background = dark ? '#0a0a0f' : '#f7f7f8';
    document.body.style.color = dark ? '#ededf0' : '#0d0d10';
  }, [dark]);

  useEffect(() => {
    if (normalizePathname(window.location.pathname) !== '/') {
      const params = new URLSearchParams(window.location.search);
      replaceUrl(params);
    }
  }, []);

  // Show the floating "Impersonate mode" pill whenever an admin is logged in
  // as a client. Re-checked on every screen change so it survives navigation.
  useEffect(() => {
    mountImpersonationBar();
  }, [screen, user]);

  useEffect(() => {
    if (screen === 'dashboard') return;
    const params = new URLSearchParams();
    if (screen !== 'landing') params.set('mode', screen);
    // preserve oauthResult/googleAuth so ConnectPageScreen / the Google-login
    // effect below can still consume them after this effect rewrites the URL
    const existing = new URLSearchParams(window.location.search);
    const oauthResult = existing.get('oauthResult');
    if (oauthResult) params.set('oauthResult', oauthResult);
    const googleAuth = existing.get('googleAuth');
    if (googleAuth) params.set('googleAuth', googleAuth);
    replaceUrl(params);
  }, [screen]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setScreen((s) => {
        if (s === 'signup') return 'signup';
        if (s === 'login' || s === 'forgot-password') return s;
        return 'landing';
      });
      return;
    }
    if (screen === 'landing') {
      void loadMyPages();
      return;
    }
    if (user.forcePasswordChange) {
      setScreen('change-password');
      return;
    }
    if (user.role === 'admin' || user.role === 'agent') {
      setScreen('admin');
      return;
    }
    void loadMyPages();
  }, [ready, user]);

  const loadMyPages = async () => {
    try {
      const pages: MyPage[] = await request(`${API_BASE}/facebook/my-pages`);
      setMyPages(pages);
      const activePages = pages.filter((page) => page.isActive);
      if (activePages.length === 0) {
        localStorage.removeItem('dfbot_active_page');
        setActivePage(null);
        setScreen('connect-page');
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const pageFromUrl = Number(params.get('page') || '');
      const savedId = localStorage.getItem('dfbot_active_page');
      const foundFromUrl = Number.isFinite(pageFromUrl)
        ? activePages.find((page) => page.id === pageFromUrl)
        : null;
      const found = foundFromUrl || (savedId ? activePages.find((page) => page.id === Number(savedId)) : null);
      const nextPage = found || activePages[0];
      setActivePage(nextPage);
      localStorage.setItem('dfbot_active_page', String(nextPage.id));
      const onboardingDone = localStorage.getItem(`FlamboyAI_onboarding_${nextPage.id}`);
      if (onboardingDone) {
        setScreen('dashboard');
      } else {
        // Check server-side if page already has a mode configured
        try {
          const settings = await fetch(`${API_BASE}/client-dashboard/${nextPage.id}/settings`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('dfbot_token')}` },
          }).then((r) => r.json());
          // NOTE: infoModeOn/orderModeOn default to `true` in the DB for every
          // brand-new page (unrelated feature toggles, not an onboarding
          // signal), so they must NOT be used here — including them made this
          // check true for every fresh signup, skipping onboarding entirely.
          const alreadyConfigured = settings?.universityModeOn === true || settings?.automationOn === true;
          if (alreadyConfigured) {
            localStorage.setItem(`FlamboyAI_onboarding_${nextPage.id}`, 'done');
            setScreen('dashboard');
          } else {
            setScreen('onboarding');
          }
        } catch {
          setScreen('onboarding');
        }
      }
    } catch {
      // Transient failure (network hiccup, brief 5xx) must not kick a
      // working session out to the connect screen.
      if (activePage) return;
      setMyPages([]);
      setActivePage(null);
      setScreen('connect-page');
    }
  };

  useEffect(() => {
    if (!activePage?.id) return;
    localStorage.setItem('dfbot_active_page', String(activePage.id));
  }, [activePage?.id]);

  const handleLogin = async (username: string, password: string) => {
    const result = await login(username, password);
    if (result.mustChangePassword) {
      setScreen('change-password');
      return;
    }
    if (result.user?.role === 'admin' || result.user?.role === 'agent') {
      setScreen('admin');
      return;
    }
    await loadMyPages();
  };

  // Consume ?googleAuth=<id> left by the backend's OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleAuth = params.get('googleAuth');
    if (!googleAuth) return;
    params.delete('googleAuth');
    replaceUrl(params);
    (async () => {
      try {
        const result = await completeGoogleLogin(googleAuth);
        if (result.user?.role === 'admin' || result.user?.role === 'agent') {
          setScreen('admin');
        } else {
          await loadMyPages();
        }
      } catch (e: any) {
        showToast(e?.message || copy('Google login করা যায়নি', 'Google login failed'), 'error');
        setScreen('login');
      }
    })();
  }, []);

  const handleSignup = async (data: { identifier: string; password: string; name: string }) => {
    const raw = data.identifier.trim();
    const cleaned = raw.replace(/[\s-]/g, '');
    const isPhone = /^(\+88)?01[3-9]\d{8}$/.test(cleaned);
    const isEmail = raw.includes('@');
    const body: Record<string, string> = {
      password: data.password,
      name: data.name,
    };

    if (isPhone) {
      body.phone = cleaned;
      body.username = cleaned;
    } else if (isEmail) {
      body.email = raw.toLowerCase();
      body.username = raw.toLowerCase();
    } else {
      body.username = raw;
    }

    const referralCode = new URLSearchParams(window.location.search).get('ref');
    if (referralCode) body.referralCode = referralCode;

    await request(`${API_BASE}/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    showToast(copy('অ্যাকাউন্ট তৈরি হয়েছে। এখন সাইন ইন করুন।', 'Account created successfully. Please sign in.'), 'success');
    setScreen('login');
  };

  const handleLogout = async () => {
    await logout();
    setMyPages([]);
    setActivePage(null);
    setScreen('landing');
  };



  if (!ready) {
    return <ScreenFallback dark={dark} />;
  }

  if (screen === 'landing') {
    if (ready && !user) {
      window.location.href = 'https://flamboyai.com';
    }
    return <ScreenFallback dark={dark} />;
  }

  if (screen === 'login') {
    return <LoginPage dark={dark} setDark={setDark} onLogin={handleLogin} onSignup={() => setScreen('signup')} onForgotPassword={() => setScreen('forgot-password')} onGoogleLogin={loginWithGoogle} />;
  }

  if (screen === 'forgot-password') {
    return (
      <Suspense fallback={<ScreenFallback dark={dark} />}>
        <ForgotPasswordPage dark={dark} onBack={() => setScreen('login')} />
      </Suspense>
    );
  }

  if (screen === 'signup') {
    return (
      <Suspense fallback={<ScreenFallback dark={dark} />}>
        <SignupPageComponent dark={dark} setDark={setDark} onSignup={handleSignup} onBack={() => setScreen('login')} />
      </Suspense>
    );
  }

  if (screen === 'change-password') {
    return (
      <Suspense fallback={<ScreenFallback dark={dark} />}>
        <ChangePasswordPage dark={dark} onSubmit={async (current, next) => {
          await changePassword(current, next);
          await loadMyPages();
        }} />
      </Suspense>
    );
  }

  if (screen === 'onboarding' && activePage && user) {
    return (
      <OnboardingFlow
        dark={dark}
        user={user}
        activePage={activePage}
        onComplete={() => { localStorage.setItem(`FlamboyAI_onboarding_${activePage.id}`, 'done'); void loadMyPages(); }}
        onSkip={() => { localStorage.setItem(`FlamboyAI_onboarding_${activePage.id}`, 'done'); void loadMyPages(); }}
      />
    );
  }

  if (screen === 'connect-page') {
    if (!user) {
      return <ScreenFallback dark={dark} />;
    }
    return (
      <Suspense fallback={<ScreenFallback dark={dark} />}>
        <ConnectPageScreen dark={dark} userId={user?.id || ''} onConnected={loadMyPages} onLogout={handleLogout} />
      </Suspense>
    );
  }

  if (screen === 'admin' && (user?.role === 'admin' || user?.role === 'agent')) {
    return (
      <Suspense fallback={<ScreenFallback dark={dark} />}>
        <>
          <AdminPanel th={th} onToast={showToast} onLogout={handleLogout} role={user.role} />
          {ToastNode}
        </>
      </Suspense>
    );
  }

  if (screen === 'dashboard' && activePage && user) {
    return (
      <Suspense fallback={<ScreenFallback dark={dark} />}>
        <DashboardLayout
          dark={dark}
          setDark={setDark}
          user={user}
          myPages={myPages}
          activePage={activePage}
          onSelectPage={(page) => setActivePage(page as MyPage)}
          onManagePages={() => {
            // Deliberate user action ("নতুন Page যোগ" / topbar Facebook Page
            // button) — always open the connect screen so a second page (e.g.
            // a restaurant) can be added. The old guard that skipped this when
            // an active page existed left users stuck on "Redirecting…".
            // Reload-loop safety lives in DashboardLayout: CONNECT_FB_PAGE is
            // never persisted as the last nav.
            setScreen('connect-page');
          }}
          onLogout={handleLogout}
        />
      </Suspense>
    );
  }

  if (screen === 'dashboard') {
    return <ScreenFallback dark={dark} />;
  }

  return <ScreenFallback dark={dark} />;
}

export default function App() {
  const [dark] = useState(() => {
    try { return localStorage.getItem('dfbot_dark') !== '0'; }
    catch { return true; }
  });
  return (
    <ErrorBoundary dark={dark}>
      <AppContent />
    </ErrorBoundary>
  );
}
