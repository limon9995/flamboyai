import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

export interface MetaAppStatus {
  configured: boolean;
  verified: boolean;
  verifiedAt: string | null;
  appName: string | null;
  appId: string | null;
  computedRedirectUri: string;
  computedWebhookUrls: { messenger: string; whatsapp: string; instagram: string };
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function CopyField({ th, value, label }: { th: Theme; value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          style={{ ...th.input, fontFamily: 'monospace', fontSize: 12.5 }}
        />
        <button
          style={th.btnSm}
          onClick={() => {
            navigator.clipboard.writeText(value).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? '✅' : '📋'}
        </button>
      </div>
    </div>
  );
}

function GuideStep({ th, step, emoji, title, children }: {
  th: Theme; step: string; emoji: string; title: string; children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', ...th.card2, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{
        minWidth: 22, height: 22, borderRadius: '50%', background: th.accentSoft, color: th.accentText,
        fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 1, flexShrink: 0,
      }}>
        {step}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: th.text }}>{emoji} {title}</div>
        <div style={{ color: th.muted, fontSize: 12, lineHeight: 1.75 }}>{children}</div>
      </div>
    </div>
  );
}

export function MetaAppSetupScreen({ th, variant, status, onStatusChange, onToast, onLogout }: {
  th: Theme;
  variant: 'gate' | 'tab';
  status: MetaAppStatus | null;
  onStatusChange: (s: MetaAppStatus) => void;
  onToast: (m: string, t?: any) => void;
  onLogout?: () => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const BASE = `${API_BASE}/admin`;

  const [fbAppId, setFbAppId] = useState('');
  const [fbAppSecret, setFbAppSecret] = useState('');
  const [fbRedirectUri, setFbRedirectUri] = useState('');
  const [fbOauthStateSecret, setFbOauthStateSecret] = useState('');
  const [fbWebhookSecret, setFbWebhookSecret] = useState('');

  const [loaded, setLoaded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [savingOther, setSavingOther] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const keys = await request<Record<string, string>>(`${BASE}/api-keys`);
        setFbAppId(status?.appId || keys.fbAppId || '');
        setFbAppSecret(keys.fbAppSecret === '***SAVED***' ? '***SAVED***' : '');
        setFbRedirectUri(keys.fbRedirectUri || status?.computedRedirectUri || '');
        setFbOauthStateSecret(keys.fbOauthStateSecret === '***SAVED***' ? '***SAVED***' : '');
        setFbWebhookSecret(keys.fbWebhookSecret === '***SAVED***' ? '***SAVED***' : '');
      } catch { /* ignore — fields just start blank */ }
      finally { setLoaded(true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testConnection = async () => {
    setVerifying(true);
    setVerifyError('');
    try {
      const res = await request<{ success: boolean; appName: string }>(`${BASE}/meta-app/verify`, {
        method: 'POST',
        body: JSON.stringify({ fbAppId, fbAppSecret }),
      });
      onToast(copy(`✅ সংযুক্ত হয়েছে — ${res.appName}`, `✅ Connected — ${res.appName}`), 'success');
      const fresh = await request<MetaAppStatus>(`${BASE}/meta-app/status`);
      onStatusChange(fresh);
    } catch (e: any) {
      setVerifyError(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const saveOther = async () => {
    setSavingOther(true);
    try {
      await request(`${BASE}/api-keys`, {
        method: 'PATCH',
        body: JSON.stringify({ fbRedirectUri, fbOauthStateSecret, fbWebhookSecret }),
      });
      onToast(copy('✅ Saved', '✅ Saved'), 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSavingOther(false); }
  };

  if (!loaded) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner size={22} />
      </div>
    );
  }

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {variant === 'gate' && (
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>
            🔌 {copy('Meta App সংযুক্ত করুন', 'Connect your Meta App')}
          </div>
          <div style={{ fontSize: 13, color: th.muted, marginTop: 6, lineHeight: 1.7 }}>
            {copy(
              'স্বাগতম! এই platform ব্যবহার শুরু করার আগে আপনার Meta (Facebook) Developer App সংযুক্ত ও verify করতে হবে। এটা একবারই করতে হবে — এখান থেকে সব client-এর Facebook Messenger, WhatsApp এবং Instagram automation চলবে।',
              'Welcome! Before using this platform, you need to connect and verify your Meta (Facebook) Developer App. This is a one-time setup — every client\'s Facebook Messenger, WhatsApp, and Instagram automation runs through it.',
            )}
          </div>
        </div>
      )}

      {status?.verified ? (
        <div style={{ ...th.alert, ...th.alertOk }}>
          ✅ {copy('সংযুক্ত আছে', 'Connected')} — <b>{status.appName}</b>
          {status.verifiedAt && (
            <span style={{ color: th.muted }}> ({new Date(status.verifiedAt).toLocaleString()})</span>
          )}
        </div>
      ) : (
        <div style={{ ...th.alert, ...th.alertInfo }}>
          ⚠️ {copy('এখনো verify করা হয়নি — নিচের ধাপগুলো অনুসরণ করুন।', 'Not verified yet — follow the steps below.')}
        </div>
      )}

      <GuideStep th={th} step="১" emoji="🆔" title={copy('App ID ও App Secret কোথায় পাবেন', 'Where to find your App ID and App Secret')}>
        <span>
          {copy('', 'Go to ')}<a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{ color: th.accentText, fontWeight: 700 }}>developers.facebook.com/apps</a>
          {copy(' এ যান → My Apps → আপনার App বেছে নিন (না থাকলে "Create App" → type: "Business") → Settings → Basic — এখানে App ID এবং App Secret ("Show" বাটনে click করে) পাবেন।', ' → My Apps → select your App (or "Create App" → type: "Business" if you don\'t have one) → Settings → Basic — App ID and App Secret (click "Show") are there.')}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>App ID</div>
            <input
              value={fbAppId}
              onChange={(e) => setFbAppId(e.target.value)}
              placeholder="123456789012345"
              style={{ ...th.input, fontFamily: 'monospace' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>App Secret</div>
            <input
              type={fbAppSecret === '***SAVED***' ? 'password' : 'text'}
              value={fbAppSecret}
              onChange={(e) => setFbAppSecret(e.target.value)}
              onFocus={(e) => { if (e.target.value === '***SAVED***') setFbAppSecret(''); }}
              placeholder="••••••••••••••••••••••••••••••••"
              style={{ ...th.input, fontFamily: 'monospace' }}
            />
          </div>
        </div>
      </GuideStep>

      <GuideStep th={th} step="২" emoji="🔗" title={copy('Redirect URI — এখান থেকে কপি করুন', 'Redirect URI — copy it from here')}>
        <span>
          ⚠️ {copy('এই URL Facebook থেকে আসবে না — এটা আপনি এখান থেকে কপি করে Facebook Developer Console-এ পেস্ট করবেন: App → Facebook Login → Settings → "Valid OAuth Redirect URIs"-তে যোগ করুন।', 'This URL does not come from Facebook — copy it from here and paste it into Facebook\'s console: App → Facebook Login → Settings → add it under "Valid OAuth Redirect URIs".')}
        </span>
        <div style={{ marginTop: 8 }}>
          <CopyField th={th} label={copy('আপনার Redirect URI', 'Your Redirect URI')} value={fbRedirectUri || status?.computedRedirectUri || ''} />
        </div>
      </GuideStep>

      <GuideStep th={th} step="৩" emoji="🎲" title={copy('OAuth State Secret — নিজে generate করুন', 'OAuth State Secret — generate it yourself')}>
        <span>
          {copy('এটা Facebook থেকে আসে না — এটা শুধু এই platform-এর নিজের security-এর জন্য ব্যবহার হয় (CSRF protection)। "Generate" বাটনে click করুন অথবা নিজে একটা random string বসান।', 'This is not from Facebook — it\'s used internally for CSRF protection. Click "Generate" or type your own random string.')}
        </span>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            type={fbOauthStateSecret === '***SAVED***' ? 'password' : 'text'}
            value={fbOauthStateSecret}
            onChange={(e) => setFbOauthStateSecret(e.target.value)}
            onFocus={(e) => { if (e.target.value === '***SAVED***') setFbOauthStateSecret(''); }}
            placeholder={copy('••••••• (সংরক্ষিত)', '••••••• (saved)')}
            style={{ ...th.input, fontFamily: 'monospace' }}
          />
          <button style={th.btnSm} onClick={() => setFbOauthStateSecret(randomHex(24))}>
            🎲 {copy('Generate', 'Generate')}
          </button>
        </div>
      </GuideStep>

      <GuideStep th={th} step="৪" emoji="🪝" title={copy('Webhook Secret ও URL — একবারই manual setup', 'Webhook Secret and URLs — one-time manual setup')}>
        <span>
          {copy('সাধারণত এটা App Secret-এর same value ব্যবহার করা হয়। এই secret দিয়ে Facebook → App → Webhooks product-এ গিয়ে নিচের callback URL(গুলো) + verify token বসিয়ে "Verify and Save" করুন — এটা Facebook-এর dashboard-এ একবারই করতে হয়, এখানে নয়।', 'This is usually the same value as your App Secret. Go to Facebook → App → Webhooks product, paste the callback URL(s) below + a verify token, and click "Verify and Save" — this is a one-time step done on Facebook\'s side, not here.')}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>Webhook Secret</div>
            <input
              type={fbWebhookSecret === '***SAVED***' ? 'password' : 'text'}
              value={fbWebhookSecret}
              onChange={(e) => setFbWebhookSecret(e.target.value)}
              onFocus={(e) => { if (e.target.value === '***SAVED***') setFbWebhookSecret(''); }}
              placeholder={copy('••••••• (সংরক্ষিত)', '••••••• (saved)')}
              style={{ ...th.input, fontFamily: 'monospace' }}
            />
          </div>
          <button
            style={th.btnSmGhost}
            disabled={!fbAppSecret || fbAppSecret === '***SAVED***'}
            onClick={() => setFbWebhookSecret(fbAppSecret)}
            title={copy('App Secret-এর same value বসান', 'Use the same value as App Secret')}
          >
            = {copy('App Secret', 'App Secret')}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <CopyField th={th} label="Messenger Webhook URL" value={status?.computedWebhookUrls.messenger || ''} />
          <CopyField th={th} label="WhatsApp Webhook URL" value={status?.computedWebhookUrls.whatsapp || ''} />
          <CopyField th={th} label="Instagram Webhook URL" value={status?.computedWebhookUrls.instagram || ''} />
        </div>
      </GuideStep>

      <GuideStep th={th} step="৫" emoji="🧪" title={copy('Development vs Live mode', 'Development vs Live mode')}>
        {copy(
          'আপনার App প্রথমে "Development" mode-এ থাকবে — এই অবস্থায় শুধু আপনি এবং App Roles-এ manually যোগ করা Admin/Developer/Tester রা login করতে পারবে। সব client-এর কাছে open করতে হলে Meta App Review-তে গিয়ে requested permissions (pages_show_list, pages_read_engagement, pages_messaging, pages_manage_metadata, pages_manage_engagement, pages_manage_posts) approve করাতে হবে এবং App-কে "Live" mode-এ switch করতে হবে।',
          'Your App starts in "Development" mode — only you and anyone manually added as Admin/Developer/Tester in App Roles can log in. To open it to all clients, submit the requested permissions (pages_show_list, pages_read_engagement, pages_messaging, pages_manage_metadata, pages_manage_engagement, pages_manage_posts) for Meta App Review and switch the App to "Live" mode.',
        )}
      </GuideStep>

      {verifyError && (
        <div style={{ ...th.alert, ...th.alertErr }}>❌ {verifyError}</div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button style={th.btnPrimary} onClick={testConnection} disabled={verifying}>
          {verifying ? <Spinner size={14} /> : '🔌'} {copy('Test Connection', 'Test Connection')}
        </button>
        <button style={th.btnGhost} onClick={saveOther} disabled={savingOther}>
          {savingOther ? <Spinner size={14} /> : '💾'} {copy('Redirect URI / State / Webhook Secret সেভ করুন', 'Save Redirect URI / State / Webhook Secret')}
        </button>
      </div>
    </div>
  );

  if (variant === 'gate') {
    return (
      <div style={{ ...th.app, minHeight: '100vh' }}>
        <header style={{ ...th.topbar, background: `linear-gradient(135deg, #1e1b4b, #312e81)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#ef4444,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛡️</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: '-0.3px', color: '#fff' }}>YourApp Admin</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em' }}>META APP SETUP</div>
            </div>
          </div>
          {onLogout && <button onClick={onLogout} style={{ ...th.btnGhost, fontSize: 12.5 }}>Logout</button>}
        </header>
        <div style={{ padding: '26px 22px', maxWidth: 720, margin: '0 auto' }}>
          {content}
        </div>
      </div>
    );
  }

  return <div style={{ maxWidth: 720, margin: '0 auto' }}>{content}</div>;
}
