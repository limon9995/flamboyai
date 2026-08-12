import React, { useCallback, useEffect, useState } from 'react';
import { LanguageSwitch, Spinner } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

type ConnectedPage = {
  id: number; pageId: string; pageName: string; isActive: boolean;
  masterPageId?: number | null; hasCustomApp?: boolean; fbAppId?: string | null;
  waEnabled?: boolean; waPhoneNumberId?: string | null; waConfigured?: boolean;
  igEnabled?: boolean; igBusinessAccountId?: string | null; igConfigured?: boolean;
};
type PageRequest = { id: number; pageUrl: string; fbProfile?: string; note?: string; status: string; adminNote?: string; connectedPageId?: number; createdAt: string };
type ModeratorAccessInfo = { fbProfileLink?: string; email?: string };

function extractYouTubeId(url: string): string | null {
  const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

function ChannelCard({ icon, title, connected, configuredLabel, notConfiguredMsg, permissions, onSetup, dark, text, muted, border, copy }: {
  icon: string; title: string; connected: boolean; configuredLabel: string;
  notConfiguredMsg: string; permissions: string[];
  onSetup: () => void; dark: boolean; text: string; muted: string; border: string;
  copy: (bn: string, en: string) => string;
}) {
  const [showPerms, setShowPerms] = React.useState(false);
  const cardBg = connected
    ? (dark ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.04)')
    : (dark ? 'rgba(251,191,36,0.06)' : 'rgba(251,191,36,0.04)');
  const cardBorder = connected ? 'rgba(34,197,94,0.25)' : 'rgba(251,191,36,0.3)';

  return (
    <div style={{ flex: 1, minWidth: 140, borderRadius: 12, border: `1px solid ${cardBorder}`, background: cardBg, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontWeight: 800, fontSize: 13, color: text }}>{title}</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: connected ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)', color: connected ? '#16a34a' : '#b45309' }}>
          {connected ? copy('✅ সংযুক্ত', '✅ Connected') : copy('⚠️ সংযুক্ত নেই', '⚠️ Not set up')}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.6 }}>
        {connected ? configuredLabel : notConfiguredMsg}
      </div>
      {!connected && (
        <>
          <button
            onClick={() => setShowPerms(v => !v)}
            style={{ background: 'transparent', border: `1px solid ${border}`, borderRadius: 7, padding: '4px 10px', color: muted, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          >
            {showPerms ? copy('▲ যা যা লাগবে', '▲ Requirements') : copy('▼ যা যা লাগবে', '▼ Requirements')}
          </button>
          {showPerms && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {permissions.map((p, i) => (
                <div key={i} style={{ fontSize: 11, color: muted, display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                  <span style={{ color: '#f59e0b', flexShrink: 0 }}>•</span>
                  <code style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: 4, fontSize: 10.5, fontFamily: 'monospace' }}>{p}</code>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={onSetup}
            style={{ border: 'none', borderRadius: 8, padding: '7px 10px', background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' }}
          >
            {copy('⚙️ Setup করুন →', '⚙️ Setup →')}
          </button>
        </>
      )}
    </div>
  );
}

function ChannelStatusCards({ page, dark, text, muted, border, copy, onSetup }: {
  page: ConnectedPage; dark: boolean; text: string; muted: string; border: string;
  copy: (bn: string, en: string) => string; onSetup: () => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        {copy(`${page.pageName} — Channel Status`, `${page.pageName} — Channel Status`)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <ChannelCard
          icon="📘" title="Facebook"
          connected={true}
          configuredLabel={copy('Facebook Messenger ও comment automation চালু আছে।', 'Facebook Messenger & comment automation active.')}
          notConfiguredMsg="" permissions={[]}
          onSetup={onSetup} dark={dark} text={text} muted={muted} border={border} copy={copy}
        />
        <ChannelCard
          icon="📱" title="WhatsApp"
          connected={!!(page.waConfigured && page.waEnabled)}
          configuredLabel={copy(
            `WhatsApp automation চালু।${page.waPhoneNumberId ? ` Phone: ${page.waPhoneNumberId}` : ''}`,
            `WhatsApp automation active.${page.waPhoneNumberId ? ` Phone: ${page.waPhoneNumberId}` : ''}`,
          )}
          notConfiguredMsg={copy(
            'এই page-এ WhatsApp Business automation সংযুক্ত নেই। Settings > WhatsApp থেকে setup করুন।',
            'WhatsApp Business automation is not set up for this page. Set it up from Settings > WhatsApp.',
          )}
          permissions={[
            'WhatsApp Business Account (Meta Business Suite)',
            'whatsapp_business_messaging',
            'whatsapp_business_management',
            'Phone Number ID + System User Token',
          ]}
          onSetup={onSetup} dark={dark} text={text} muted={muted} border={border} copy={copy}
        />
        <ChannelCard
          icon="📸" title="Instagram"
          connected={!!(page.igConfigured && page.igEnabled)}
          configuredLabel={copy(
            `Instagram DM ও comment automation চালু।${page.igBusinessAccountId ? ` Account: ${page.igBusinessAccountId}` : ''}`,
            `Instagram DM & comment automation active.${page.igBusinessAccountId ? ` Account: ${page.igBusinessAccountId}` : ''}`,
          )}
          notConfiguredMsg={copy(
            'এই page-এ Instagram automation সংযুক্ত নেই। Settings > Instagram থেকে setup করুন।',
            'Instagram automation is not set up for this page. Set it up from Settings > Instagram.',
          )}
          permissions={[
            'Instagram Business / Creator Account (FB Page-এর সাথে linked)',
            'instagram_basic',
            'instagram_manage_messages',
            'instagram_manage_comments',
            'pages_show_list',
          ]}
          onSetup={onSetup} dark={dark} text={text} muted={muted} border={border} copy={copy}
        />
      </div>
    </div>
  );
}

interface Props {
  dark: boolean; userId: string;
  onConnected: () => void; onLogout: () => void;
}

export function ConnectPageScreen({ dark, userId: _userId, onConnected, onLogout }: Props) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const [alreadyConnected, setAlreadyConnected] = useState<ConnectedPage[]>([]);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [error, setError]         = useState('');

  // Manual (Advanced / BYOA) form state
  const [manualPageName, setManualPageName] = useState('');
  const [manualToken, setManualToken]       = useState('');
  const [manualBusy, setManualBusy]         = useState(false);
  const [manualSuccess, setManualSuccess]   = useState(false);
  const [connectResult, setConnectResult]   = useState<{ verifyToken?: string; webhookUrl?: string; hasCustomApp?: boolean } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Linked page: optional master page to share settings from
  const [selectedMasterId, setSelectedMasterId] = useState<number | ''>('');

  // Custom Facebook App (BYOA)
  const [showCustomApp, setShowCustomApp] = useState(false);
  const [customFbAppId, setCustomFbAppId] = useState('');
  const [customFbAppSecret, setCustomFbAppSecret] = useState('');

  // Request Access (moderator-access) state
  const [reqPageUrl, setReqPageUrl] = useState('');
  const [reqFbProfile, setReqFbProfile] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqSubmitted, setReqSubmitted] = useState(false);
  const [myRequests, setMyRequests] = useState<PageRequest[]>([]);
  // Inline edit of a PENDING request (fix a typo so auto-match works)
  const [editingReqId, setEditingReqId] = useState<number | null>(null);
  const [editReqUrl, setEditReqUrl] = useState('');
  const [editReqBusy, setEditReqBusy] = useState(false);
  const [moderatorAccess, setModeratorAccess] = useState<ModeratorAccessInfo>({});
  const [copiedField, setCopiedField] = useState<'profile' | 'email' | ''>('');
  // Customers who already have an active page shouldn't see the "connect a
  // page" flow by default — only when they explicitly want to add another one.
  const [showAddPageForm, setShowAddPageForm] = useState(false);

  // Tutorial sidebar
  const [pageConnectTutorialUrl, setPageConnectTutorialUrl] = useState('');

  const bg     = dark ? '#080e1c' : '#f1f3fa';
  const panel  = dark ? '#0d1526' : '#fff';
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text   = dark ? '#e2e8ff' : '#1a1f36';
  const muted  = dark ? 'rgba(226,232,255,0.45)' : 'rgba(26,31,54,0.45)';
  const activePages = alreadyConnected.filter((page) => page.isActive);
  const savedPages = alreadyConnected.filter((page) => !page.isActive);
  const hasActivePage = activePages.length > 0;
  const hasPendingRequest = myRequests.some((r) => r.status === 'pending');

  useEffect(() => {
    request<any>(`${API_BASE}/client-dashboard/tutorials`)
      .then(t => { if (t?.pageConnect) setPageConnectTutorialUrl(t.pageConnect); })
      .catch(() => {});
  }, [request]);

  useEffect(() => {
    request<ModeratorAccessInfo>(`${API_BASE}/facebook/moderator-access-info`)
      .then(info => setModeratorAccess(info || {}))
      .catch(() => {});
  }, [request]);

  const refreshRequestsAndPages = useCallback(() => {
    request<PageRequest[]>(`${API_BASE}/facebook/page-request/my`)
      .then(r => setMyRequests(r || []))
      .catch(() => {});
    request<ConnectedPage[]>(`${API_BASE}/facebook/my-pages`)
      .then(pages => setAlreadyConnected(pages || []))
      .catch(() => {});
  }, [request]);

  useEffect(() => {
    refreshRequestsAndPages();
  }, [refreshRequestsAndPages]);

  // While any request is still pending, poll so an admin approval (from
  // Telegram or the dashboard) shows up here automatically — no re-login,
  // no extra click needed on the client's end.
  useEffect(() => {
    if (!myRequests.some(r => r.status === 'pending')) return;
    const id = setInterval(refreshRequestsAndPages, 15_000);
    return () => clearInterval(id);
  }, [myRequests, refreshRequestsAndPages]);

  const submitPageRequest = async () => {
    if (!reqPageUrl.trim()) { setError(copy('Facebook Page link দিন', 'Enter your Facebook Page link')); return; }
    setReqBusy(true); setError('');
    try {
      await request(`${API_BASE}/facebook/page-request`, {
        method: 'POST',
        body: JSON.stringify({
          pageUrl: reqPageUrl.trim(),
          fbProfile: reqFbProfile.trim() || undefined,
          note: reqNote.trim() || undefined,
        }),
      });
      setReqSubmitted(true);
      const updated = await request<PageRequest[]>(`${API_BASE}/facebook/page-request/my`);
      setMyRequests(updated || []);
    } catch (e: any) {
      setError(e?.message || copy('Submit করা যায়নি', 'Submit failed'));
    } finally {
      setReqBusy(false);
    }
  };

  const copyToClipboard = (field: 'profile' | 'email', value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    });
  };

  const connectManual = async () => {
    const pname = manualPageName.trim();
    const tok   = manualToken.trim();
    if (!pname || !tok) { setError(copy('Page Name এবং Access Token দিন।', 'Enter the Page Name and Access Token.')); return; }
    setManualBusy(true); setError('');
    try {
      const res: any = await request(`${API_BASE}/facebook/connect`, {
        method: 'POST',
        body: JSON.stringify({
          pageId: '', pageName: pname, pageToken: tok,
          ...(selectedMasterId ? { masterPageId: selectedMasterId } : {}),
          ...(customFbAppId.trim() ? { fbAppId: customFbAppId.trim() } : {}),
          ...(customFbAppSecret.trim() ? { fbAppSecret: customFbAppSecret.trim() } : {}),
        }),
      });
      setConnectResult({
        verifyToken: res?.page?.verifyToken,
        webhookUrl: res?.webhookUrl,
        hasCustomApp: !!(customFbAppId.trim() || res?.page?.hasCustomApp),
      });
      setManualSuccess(true);
    } catch (e: any) {
      if (String(e?.message).toLowerCase().includes('already')) {
        setManualSuccess(true);
      } else {
        setError(e?.message || copy('Connect করা যায়নি', 'Connect failed'));
        setManualBusy(false);
      }
    }
  };

  const disconnectPage = async (page: ConnectedPage) => {
    const confirmed = window.confirm(
      copy(
        `"${page.pageName}" page টি disconnect করতে চান?`,
        `Do you want to disconnect "${page.pageName}"?`,
      ),
    );
    if (!confirmed) return;

    setDisconnecting(page.id);
    setError('');
    try {
      await request(`${API_BASE}/facebook/disconnect/${page.id}`, { method: 'DELETE' });
      const nextPages = alreadyConnected.map((p) =>
        p.id === page.id ? { ...p, isActive: false } : p,
      );
      setAlreadyConnected(nextPages);
      setManualSuccess(false);
      if (!nextPages.some((p) => p.isActive)) {
        onConnected();
      }
    } catch (e: any) {
      setError(e?.message || copy('Disconnect করা যায়নি', 'Disconnect failed'));
    } finally {
      setDisconnecting(null);
    }
  };

  const goToDashboardForPage = (page: ConnectedPage) => {
    localStorage.setItem('dfbot_active_page', String(page.id));
    // Hard navigation: boots the app straight into the dashboard for this
    // page and clears the stale ?mode=connect-page from the URL. The old
    // soft path (onConnected → loadMyPages) re-evaluated screen logic that
    // could bounce right back to this screen.
    window.location.href = `/?mode=dashboard&page=${page.id}`;
  };

  const inp: React.CSSProperties = {
    padding: '11px 14px', borderRadius: 10, border: `1px solid ${border}`,
    background: dark ? 'rgba(255,255,255,0.04)' : '#fff',
    color: text, fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const tutorialYtId = extractYouTubeId(pageConnectTutorialUrl);

  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 24, padding: 'clamp(14px, 4vw, 40px) clamp(10px, 3vw, 20px)', fontFamily: "'Inter', system-ui, sans-serif", flexWrap: 'wrap' }}>
      <div style={{ width: 'min(500px, 100%)', boxSizing: 'border-box', background: panel, border: `1px solid ${border}`, borderRadius: 22, padding: 'clamp(16px, 4.5vw, 38px)', boxShadow: dark ? '0 8px 48px rgba(0,0,0,0.5)' : '0 8px 40px rgba(99,102,241,0.1)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🤖</div>
              <span style={{ fontSize: 18, fontWeight: 900, color: text }}>{copy('পেজ কানেক্ট', 'Connect Page')}</span>
            </div>
            <div style={{ fontSize: 13, color: muted }}>{copy('আপনার Facebook Page bot-এর সাথে যুক্ত করুন', 'Connect your Facebook Page to the bot')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LanguageSwitch dark={dark} compact />
            <button onClick={onLogout} style={{ background: 'transparent', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 14px', color: muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {copy('লগআউট', 'Logout')}
            </button>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)', color: '#ef4444', borderRadius: 11, padding: '11px 15px', fontSize: 13, marginBottom: 16 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Active pages */}
        {activePages.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              {copy('Active Pages', 'Active Pages')}
            </div>
            {activePages.map(p => (
              <div key={p.pageId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px', borderRadius: 10, border: `1px solid rgba(34,197,94,0.25)`, background: dark ? 'rgba(34,197,94,0.05)' : 'rgba(34,197,94,0.04)', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{p.isActive ? '✅' : '⏸️'}</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: text }}>{p.pageName}</span>
                      {p.hasCustomApp && (
                        <span style={{ fontSize: 9, background: 'rgba(99,102,241,0.15)', color: '#6366f1', borderRadius: 5, padding: '1px 6px', fontWeight: 800 }}>Custom App</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: muted }}>
                      {p.pageId} {p.isActive ? copy('• Active', '• Active') : copy('• Inactive', '• Inactive')}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => disconnectPage(p)}
                  disabled={disconnecting === p.id || !p.isActive}
                  style={{
                    border: 'none', borderRadius: 8, padding: '7px 12px',
                    background: !p.isActive ? (dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') : 'rgba(239,68,68,0.14)',
                    color: !p.isActive ? muted : '#ef4444',
                    cursor: disconnecting === p.id || !p.isActive ? 'default' : 'pointer',
                    fontSize: 12, fontWeight: 700, fontFamily: 'inherit', minWidth: 104,
                  }}
                >
                  {disconnecting === p.id
                    ? copy('Disconnecting...', 'Disconnecting...')
                    : p.isActive
                      ? copy('Disconnect', 'Disconnect')
                      : copy('Disconnected', 'Disconnected')}
                </button>
              </div>
            ))}
            <div style={{ height: 1, background: border, margin: '14px 0' }} />

            {/* Channel status cards for each active page */}
            {activePages.map(p => (
              <ChannelStatusCards key={`ch-${p.id}`} page={p} dark={dark} text={text} muted={muted} border={border} copy={copy}
                onSetup={() => goToDashboardForPage(p)} />
            ))}
          </div>
        )}

        {/* Saved / disconnected pages */}
        {savedPages.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              {copy('Saved Pages', 'Saved Pages')}
            </div>
            {savedPages.map(p => (
              <div key={p.pageId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px', borderRadius: 10, border: `1px solid ${border}`, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>⏸️</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: text }}>{p.pageName}</div>
                    <div style={{ fontSize: 11, color: muted }}>
                      {p.pageId} {copy('• Saved কিন্তু active না', '• Saved but not active')}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: muted, fontWeight: 700 }}>
                  {copy('Reconnect লাগবে', 'Reconnect needed')}
                </div>
              </div>
            ))}
            <div style={{ height: 1, background: border, margin: '14px 0' }} />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {hasActivePage && !showAddPageForm && !hasPendingRequest ? (
            <button
              onClick={() => {
                // Fresh request for the next page — clear any previous
                // submission state so the form actually appears.
                setReqSubmitted(false);
                setReqPageUrl('');
                setReqFbProfile('');
                setReqNote('');
                setShowAddPageForm(true);
              }}
              style={{ width: '100%', padding: '12px', borderRadius: 12, border: `1px dashed rgba(99,102,241,0.4)`, background: 'transparent', color: '#6366f1', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              ➕ {copy('আরেকটি Facebook Page যোগ করুন', 'Add Another Facebook Page')}
            </button>
          ) : (
          <>
          {/* Moderator Access info — admin's FB profile/Gmail to add as moderator */}
          <div style={{ background: dark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#6366f1' }}>
              🛡️ {copy('Admin-কে Page Moderator হিসেবে Add করুন', 'Add Admin as a Page Moderator')}
            </div>
            <div style={{ fontSize: 12, color: muted, lineHeight: 1.7 }}>
              {copy(
                'কোনো Developer Account লাগবে না। শুধু নিচের profile/Gmail-কে আপনার Facebook Page-এ moderator হিসেবে add করুন — এটাই সবচেয়ে সহজ ও নিরাপদ পদ্ধতি।',
                'No Developer Account needed. Just add the profile/Gmail below as a moderator on your Facebook Page — this is the simplest and safest method.',
              )}
            </div>
            {moderatorAccess.fbProfileLink || moderatorAccess.email ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {moderatorAccess.fbProfileLink && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, minWidth: 0, background: dark ? 'rgba(0,0,0,0.2)' : '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: text, wordBreak: 'break-all', fontFamily: 'monospace', border: `1px solid ${border}` }}>
                      {moderatorAccess.fbProfileLink}
                    </code>
                    <button onClick={() => copyToClipboard('profile', moderatorAccess.fbProfileLink || '')}
                      style={{ border: `1px solid rgba(99,102,241,0.4)`, borderRadius: 7, padding: '6px 12px', background: 'rgba(99,102,241,0.1)', color: '#6366f1', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      {copiedField === 'profile' ? copy('✓ Copied', '✓ Copied') : copy('Copy', 'Copy')}
                    </button>
                  </div>
                )}
                {moderatorAccess.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, minWidth: 0, background: dark ? 'rgba(0,0,0,0.2)' : '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: text, wordBreak: 'break-all', fontFamily: 'monospace', border: `1px solid ${border}` }}>
                      {moderatorAccess.email}
                    </code>
                    <button onClick={() => copyToClipboard('email', moderatorAccess.email || '')}
                      style={{ border: `1px solid rgba(99,102,241,0.4)`, borderRadius: 7, padding: '6px 12px', background: 'rgba(99,102,241,0.1)', color: '#6366f1', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      {copiedField === 'email' ? copy('✓ Copied', '✓ Copied') : copy('Copy', 'Copy')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#b45309', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '9px 12px', lineHeight: 1.6 }}>
                ⚠️ {copy(
                  'Admin এখনো moderator profile/Gmail সেট করেনি। আপনি নিচের form-এ page link দিয়ে request পাঠান — admin approve করলেই connect হয়ে যাবে। (Admin: Admin Panel → Settings → Moderator Access-এ profile link ও Gmail সেট করুন)',
                  'The admin has not set the moderator profile/Gmail yet. Submit your page link in the form below — it connects once the admin approves. (Admin: set these in Admin Panel → Settings → Moderator Access)',
                )}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.7 }}>
              → {copy(
                'আপনার Page → Settings → Page access/Page roles → Add People → উপরের profile link বা Gmail দিয়ে moderator হিসেবে add করুন।',
                'Your Page → Settings → Page access/Page roles → Add People → add the profile link or Gmail above as a moderator.',
              )}
            </div>
          </div>

          {myRequests.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {copy('আপনার Requests', 'Your Requests')}
              </div>
              {myRequests.map(r => {
                const statusColor = r.status === 'approved' ? '#16a34a' : r.status === 'rejected' ? '#ef4444' : '#f59e0b';
                const statusLabel = r.status === 'approved' ? copy('✅ Approved', '✅ Approved') : r.status === 'rejected' ? copy('❌ Rejected', '❌ Rejected') : copy('⏳ Pending — Admin review করছে', '⏳ Pending — awaiting admin review');
                return (
                  <div key={r.id} style={{ border: `1px solid ${border}`, borderRadius: 10, padding: '10px 13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: text, wordBreak: 'break-all' }}>{r.pageUrl}</div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: statusColor, whiteSpace: 'nowrap' }}>{statusLabel}</span>
                    </div>
                    {r.adminNote && (
                      <div style={{ fontSize: 11.5, color: muted, marginTop: 3 }}>💬 {r.adminNote}</div>
                    )}
                    {r.status === 'approved' && (
                      <div style={{ marginTop: 6, padding: '8px 10px', background: 'rgba(34,197,94,0.08)', borderRadius: 8, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                        🎉 {copy('আপনার page connect হয়ে গেছে! উপরের "Active Pages" এ দেখুন।', 'Your page is connected! Check "Active Pages" above.')}
                      </div>
                    )}
                    {r.status === 'pending' && editingReqId !== r.id && (
                      <button
                        onClick={() => { setEditingReqId(r.id); setEditReqUrl(r.pageUrl); }}
                        style={{ marginTop: 6, border: `1px solid rgba(99,102,241,0.35)`, borderRadius: 7, padding: '5px 12px', background: 'rgba(99,102,241,0.08)', color: '#6366f1', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit' }}
                      >
                        ✏️ {copy('Page link/নাম ঠিক করুন', 'Edit page link/name')}
                      </button>
                    )}
                    {r.status === 'pending' && editingReqId === r.id && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <input
                          style={inp}
                          value={editReqUrl}
                          onChange={e => setEditReqUrl(e.target.value)}
                          placeholder={copy('Page-এর exact নাম বা link (যেমন: Mis Happy)', 'Exact page name or link (e.g. Mis Happy)')}
                        />
                        <div style={{ fontSize: 11, color: muted, lineHeight: 1.6 }}>
                          💡 {copy('Facebook-এ page-এর নাম যেভাবে লেখা, ঠিক সেভাবে দিন — তাহলে approve-এর সময় auto-match হবে।', 'Type the page name exactly as it appears on Facebook — then approval auto-matches.')}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            disabled={editReqBusy}
                            onClick={async () => {
                              if (!editReqUrl.trim()) { setError(copy('Page link/নাম দিন', 'Enter the page link/name')); return; }
                              setEditReqBusy(true); setError('');
                              try {
                                await request(`${API_BASE}/facebook/page-request/${r.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ pageUrl: editReqUrl.trim() }),
                                });
                                setEditingReqId(null);
                                refreshRequestsAndPages();
                              } catch (e: any) {
                                setError(e?.message || copy('Update করা যায়নি', 'Update failed'));
                              } finally {
                                setEditReqBusy(false);
                              }
                            }}
                            style={{ border: 'none', borderRadius: 8, padding: '8px 16px', background: editReqBusy ? 'rgba(99,102,241,0.5)' : '#6366f1', color: '#fff', cursor: editReqBusy ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, fontFamily: 'inherit' }}
                          >
                            {editReqBusy ? copy('Saving...', 'Saving...') : copy('✓ Save', '✓ Save')}
                          </button>
                          <button
                            onClick={() => setEditingReqId(null)}
                            style={{ border: `1px solid ${border}`, borderRadius: 8, padding: '8px 14px', background: 'transparent', color: muted, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}
                          >
                            {copy('Cancel', 'Cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ height: 1, background: border }} />
            </div>
          )}

          {/* Only an in-flight (pending / just-submitted) request hides the
              form — an APPROVED history must not block requesting the NEXT
              page (e.g. adding a second restaurant page). */}
          {!reqSubmitted && !hasPendingRequest ? (
            <>
              <div>
                <label style={{ fontSize: 12, color: muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                  {copy('Facebook Page Link *', 'Facebook Page Link *')}
                </label>
                <input style={inp} value={reqPageUrl} onChange={e => setReqPageUrl(e.target.value)}
                  placeholder="https://facebook.com/yourpage বা yourpage" />
                <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>
                  {copy('আপনার Facebook Page এর link বা username', 'Your Facebook Page link or username')}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                  {copy('আপনার Facebook Profile Link (optional)', 'Your Facebook Profile Link (optional)')}
                </label>
                <input style={inp} value={reqFbProfile} onChange={e => setReqFbProfile(e.target.value)}
                  placeholder="https://facebook.com/yourprofile" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                  {copy('Note (optional)', 'Note (optional)')}
                </label>
                <textarea style={{ ...inp, resize: 'vertical', minHeight: 60, lineHeight: 1.5 }}
                  value={reqNote} onChange={e => setReqNote(e.target.value)}
                  placeholder={copy('অতিরিক্ত কিছু জানাতে চাইলে লিখুন...', 'Any additional info for the admin...')} />
              </div>
              <button onClick={submitPageRequest} disabled={reqBusy}
                style={{ width: '100%', padding: '13px', borderRadius: 13, border: 'none', background: reqBusy ? 'rgba(99,102,241,0.5)' : '#6366f1', color: '#fff', fontWeight: 800, fontSize: 15, cursor: reqBusy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'inherit' }}>
                {reqBusy ? <><Spinner size={15} /> {copy('Submitting...', 'Submitting...')}</> : copy('📤 Request Submit করুন', 'Submit Request')}
              </button>
            </>
          ) : (
            <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12, padding: '14px 16px', fontSize: 13, color: '#16a34a', fontWeight: 700, textAlign: 'center' }}>
              ✅ {copy('Request submit হয়েছে! Admin moderator access দেখে approve করলে page automatically connect হয়ে যাবে — আপনাকে আর কিছু করতে হবে না।', 'Request submitted! Once the admin verifies moderator access and approves, your page connects automatically — no further action needed from you.')}
            </div>
          )}
          </>
          )}

          {/* ── Advanced: bring-your-own Facebook Developer App ── */}
          <div style={{ borderTop: `1px solid ${border}`, marginTop: 6, paddingTop: 14 }}>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 2px', background: 'transparent', border: 'none', cursor: 'pointer', color: text, fontFamily: 'inherit', fontWeight: 800, fontSize: 13 }}
            >
              <span>⚙️ {copy('Advanced: নিজের Facebook Developer App দিয়ে Connect করুন', 'Advanced: Connect with your own Facebook Developer App')}</span>
              <span style={{ color: muted, fontSize: 11 }}>{showAdvanced ? '▲' : '▼'}</span>
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* ── Personal App full guide (collapsible) ── */}
              <div style={{ borderRadius: 12, border: `1px solid rgba(99,102,241,0.3)`, overflow: 'hidden', background: dark ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.03)' }}>
                <button
                  onClick={() => setShowCustomApp(v => !v)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 15px', background: 'transparent', border: 'none', cursor: 'pointer', color: text, fontFamily: 'inherit', fontWeight: 800, fontSize: 13 }}
                >
                  <span>🏗️ {copy('নিজের Facebook App কিভাবে বানাবেন? — সম্পূর্ণ গাইড', 'How to create your own Facebook App? — Full Guide')}</span>
                  <span style={{ color: muted, fontSize: 11 }}>{showCustomApp ? '▲' : '▼'}</span>
                </button>
                {showCustomApp && (
                  <div style={{ padding: '0 15px 15px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: `1px solid rgba(99,102,241,0.2)` }}>

                    {/* Why own app */}
                    <div style={{ paddingTop: 12, fontSize: 12, color: muted, lineHeight: 1.8, background: dark ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 9, padding: '10px 12px', marginTop: 10 }}>
                      ✅ <strong style={{ color: text }}>{copy('কেন customer-এর নিজের App?', 'Why use the customer\'s own App?')}</strong><br />
                      {copy('Customer-এর Facebook account থেকে একটা Meta App বানিয়ে দিলে তাদের Facebook Messenger + WhatsApp + Instagram — তিনটাই সেই একটা App দিয়ে চলবে। App ID ও App Secret দিলে webhook HMAC verification তাদের নিজের secret দিয়ে হবে — সম্পূর্ণ আলাদা ও secure।', 'Creating a Meta App from the customer\'s Facebook account lets Facebook Messenger + WhatsApp + Instagram all run through that single App. With their own App ID and App Secret, webhook HMAC verification uses their own secret — completely isolated and secure.')}
                    </div>

                    <div style={{ fontSize: 12.5, fontWeight: 800, color: text, marginTop: 4 }}>
                      {copy('ধাপগুলো অনুসরণ করুন:', 'Follow these steps:')}
                    </div>

                    {([
                      {
                        step: '১',
                        emoji: '🌐',
                        title: copy('Meta Developer Account খুলুন', 'Create a Meta Developer Account'),
                        desc: (
                          <span>
                            {copy('আপনার Facebook account দিয়ে ', 'Use your Facebook account to visit ')}<a href="https://developers.facebook.com/" target="_blank" rel="noreferrer" style={{ color: '#6366f1', fontWeight: 700 }}>developers.facebook.com</a>
                            {copy(' — এ যান → "Get Started" click করুন → Developer হিসেবে register করুন।', ' → click "Get Started" → register as a Developer.')}
                          </span>
                        ),
                      },
                      {
                        step: '২',
                        emoji: '📱',
                        title: copy('নতুন App তৈরি করুন', 'Create a new App'),
                        desc: copy('"My Apps" → "Create App" click করুন → App type: "Business" select করুন (WhatsApp ও Instagram সব একই app-এ চলবে) → App-এর নাম দিন (যেমন: ShopBot) → "Create App" button চাপুন।', 'Click "My Apps" → "Create App" → select App type "Business" (WhatsApp and Instagram all run in the same app) → give your App a name (e.g. ShopBot) → click "Create App".'),
                      },
                      {
                        step: '৩',
                        emoji: '💬',
                        title: copy('Messenger Product যোগ করুন', 'Add Messenger Product'),
                        desc: copy('App Dashboard → বাম sidebar: "Add Product" → "Messenger" → "Set Up" click করুন। এরপর WhatsApp-এর জন্য আবার "Add Product" → "WhatsApp" → "Set Up"। Instagram-এর জন্য "Add Product" → "Instagram" → "Set Up"।', 'App Dashboard → left sidebar: "Add Product" → "Messenger" → click "Set Up". Then for WhatsApp: "Add Product" → "WhatsApp" → "Set Up". For Instagram: "Add Product" → "Instagram" → "Set Up".'),
                      },
                      {
                        step: '৪',
                        emoji: '🔑',
                        title: copy('App ID ও App Secret সংগ্রহ করুন', 'Collect App ID and App Secret'),
                        desc: copy('App Settings → Basic এ যান → App ID উপরে দেখাবে — copy করুন → App Secret-এর পাশে "Show" click করুন → password দিন → copy করুন। দুটো নোট করুন — নিচের "App ID" ও "App Secret" field-এ দিতে হবে।', 'Go to App Settings → Basic → copy the App ID shown at the top → click "Show" next to App Secret → enter your password → copy it. Note both — you will enter them in the "App ID" and "App Secret" fields below.'),
                      },
                      {
                        step: '৫',
                        emoji: '🔴',
                        title: copy('App Mode: Live করুন', 'Switch App Mode to Live'),
                        desc: copy('App Settings → Basic → উপরে "App Mode" toggle দেখাবে — "Development" থেকে "Live" করুন। Live না করলে শুধু Tester হিসেবে add করা accounts কাজ করবে। Live করার পর সব users-এর page connect হবে।', 'App Settings → Basic → you will see the "App Mode" toggle at the top → switch from "Development" to "Live". Without this, only accounts added as Testers will work. After switching to Live, all user pages can connect.'),
                      },
                      {
                        step: '৬',
                        emoji: '🎟️',
                        title: copy('Graph API Explorer থেকে Page Access Token নিন', 'Get Page Access Token from Graph API Explorer'),
                        desc: (
                          <span>
                            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ color: '#6366f1', fontWeight: 700 }}>developers.facebook.com/tools/explorer</a>
                            {copy(' → "Meta App" dropdown থেকে customer-এর App select করুন → "User or Page" থেকে customer-এর Facebook Page select করুন → নিচের সব permission যোগ করুন → "Generate Access Token" click করুন → সব permission Allow করুন → Token copy করুন (EAAxxxxx...)। এই token নিচের "Page Access Token" field-এ দিন।', ' → Select the customer\'s App from "Meta App" dropdown → select the customer\'s Facebook Page from "User or Page" → add all permissions below → click "Generate Access Token" → Allow all permissions → copy the token (EAAxxxxx...). Enter this token in the "Page Access Token" field below.')}
                          </span>
                        ),
                      },
                    ] as Array<{ step: string; emoji: string; title: string | React.ReactNode; desc: string | React.ReactNode }>).map(({ step, emoji, title, desc }) => (
                      <div key={step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderRadius: 9, padding: '10px 12px' }}>
                        <div style={{ minWidth: 24, height: 24, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', color: '#6366f1', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 }}>{step}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12.5, color: text, marginBottom: 3 }}>{emoji} {title}</div>
                          <div style={{ color: muted, fontSize: 12, lineHeight: 1.75, whiteSpace: 'pre-line' }}>{desc}</div>
                        </div>
                      </div>
                    ))}

                    <div style={{ background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)', border: `1px solid rgba(99,102,241,0.25)`, borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: text }}>
                      💡 {copy('App তৈরি হলে নিচে "App ID", "App Secret" এবং "Page Access Token" — তিনটোই একসাথে দিয়ে Page Connect করুন।', 'Once App is created, enter App ID, App Secret, and Page Access Token all together below and connect your page.')}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Token guide ── */}
              <div style={{ background: dark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 12, padding: '14px 16px', fontSize: 12.5, color: text, lineHeight: 1.9, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: '#6366f1' }}>
                  📌 {copy('কিভাবে Page Access Token পাবেন?', 'How to get a Page Access Token?')}
                </div>
                {[
                  {
                    step: '১',
                    title: copy('Graph API Explorer খুলুন', 'Open Graph API Explorer'),
                    desc: (<span><a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ color: '#6366f1', fontWeight: 700 }}>developers.facebook.com/tools/explorer</a>{copy(' — এই লিংকে যান', ' — go to this link')}</span>),
                  },
                  {
                    step: '২',
                    title: copy('App ও Page select করুন', 'Select App and Page'),
                    desc: copy(
                      '"Meta App" dropdown থেকে আপনার App বেছে নিন। তারপর "User or Page" dropdown থেকে আপনার Facebook Page select করুন — "User" নয়, "Page" বেছে নিন।',
                      'From the "Meta App" dropdown, select your App. Then from the "User or Page" dropdown, select your Facebook Page — choose "Page", not "User".',
                    ),
                  },
                  {
                    step: '৩',
                    title: copy('সব প্রয়োজনীয় Permissions যোগ করুন', 'Add all required permissions'),
                    desc: (
                      <span>
                        {copy('"Add a Permission" বাটনে click করে নিচের সব permission একটি একটি করে যোগ করুন:', 'Click "Add a Permission" and add each permission one by one:')}
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {[
                            { perm: 'pages_messaging', use: copy('Messenger-এ bot reply দেওয়ার জন্য', 'For bot to reply in Messenger') },
                            { perm: 'pages_read_engagement', use: copy('Post-এর comment detect করতে (comment reply)', 'To detect post comments (for comment reply)') },
                            { perm: 'pages_manage_engagement', use: copy('Post comment-এ reply দেওয়ার জন্য এবং post-এ link comment করতে', 'For replying to post comments and posting link as comment') },
                            { perm: 'pages_manage_metadata', use: copy('Webhook subscription-এর জন্য', 'For webhook subscription') },
                            { perm: 'pages_show_list', use: copy('Page list দেখার জন্য', 'For listing pages') },
                            { perm: 'pages_manage_posts', use: copy('Facebook Page-এ post publish করার জন্য (Auto Post feature)', 'For publishing posts to Facebook Page (Auto Post feature)') },
                          ].map(({ perm, use }) => (
                            <div key={perm} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 7, padding: '5px 8px' }}>
                              <code style={{ background: dark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '2px 6px', borderRadius: 5, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{perm}</code>
                              <span style={{ fontSize: 11, color: muted, marginTop: 1 }}>{use}</span>
                            </div>
                          ))}
                        </div>
                      </span>
                    ),
                  },
                  {
                    step: '৪',
                    title: copy('Token Generate করুন', 'Generate the Token'),
                    desc: copy(
                      '"Generate Access Token" বাটনে click করুন। Facebook login করতে বলবে — করুন এবং সব permission allow করুন। একটি লম্বা token দেখাবে (EAAxxxxx...)।',
                      'Click "Generate Access Token". Facebook will ask you to log in — do so and allow all permissions. A long token starting with EAAxxxxx... will appear.',
                    ),
                  },
                  {
                    step: '৫',
                    title: copy('Token copy করে নিচে paste করুন', 'Copy the token and paste below'),
                    desc: copy(
                      'Token টি copy করুন এবং নিচের "Page Access Token" field-এ paste করুন। Page Name-ও দিন। Page ID bot নিজেই বের করবে।',
                      'Copy the token and paste it in the "Page Access Token" field below. Also enter the Page Name. The bot will detect the Page ID automatically.',
                    ),
                  },
                ].map(({ step, title, desc }) => (
                  <div key={step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 22, height: 22, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', color: '#6366f1', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 }}>{step}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: text, marginBottom: 2 }}>{title}</div>
                      <div style={{ color: muted, fontSize: 12, lineHeight: 1.7 }}>{desc}</div>
                    </div>
                  </div>
                ))}
                <div style={{ background: dark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: text, marginTop: 2 }}>
                  ✅ {copy(
                    'Graph API Explorer-এ দেখানো token short-lived হলেও আমাদের system স্বয়ংক্রিয়ভাবে এটিকে long-lived (never-expiring) token-এ convert করে — আপনাকে কিছু করতে হবে না।',
                    'Even though the token shown in Graph API Explorer is short-lived, our system automatically converts it to a long-lived (never-expiring) token — you don\'t need to do anything extra.',
                  )}
                </div>
              </div>

              {/* ── Comment Reply info ── */}
              <div style={{ background: dark ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.04)', border: `1px solid rgba(99,102,241,0.2)`, borderRadius: 11, padding: '11px 14px', fontSize: 12, color: muted, lineHeight: 1.8 }}>
                💬 <strong style={{ color: text }}>{copy('Comment Reply কিভাবে কাজ করে?', 'How does Comment Reply work?')}</strong><br />
                {copy(
                  'আপনার Facebook Page-এর Post-এ কেউ comment করলে bot সেটি detect করে এবং product, price বা order সংক্রান্ত হলে স্বয়ংক্রিয়ভাবে reply দেয়। চালু করতে: Settings → Bot Modes → Comment Reply toggle করুন।',
                  'When someone comments on your Facebook Page Post, the bot detects it and automatically replies if it is about a product, price, or order. To enable: Settings → Bot Modes → Comment Reply.',
                )}<br />
                <span style={{ fontSize: 11 }}>⚠️ {copy('Comment reply কাজ করতে অবশ্যই pages_read_engagement ও pages_manage_engagement permission দিয়ে token নিতে হবে।', 'For comment reply to work, you must generate the token with pages_read_engagement and pages_manage_engagement permissions.')}</span>
              </div>



              <div>
                <label style={{ fontSize: 12, color: muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>{copy('Page Name *', 'Page Name *')}</label>
                <input style={inp} placeholder={copy('আপনার Page এর নাম', 'Your page name')}
                  value={manualPageName} onChange={e => setManualPageName(e.target.value)} />
              </div>

              <div>
                <label style={{ fontSize: 12, color: muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>{copy('Page Access Token *', 'Page Access Token *')}</label>
                <textarea style={{ ...inp, resize: 'vertical', minHeight: 80, lineHeight: 1.5 }}
                  placeholder={copy('EAAxxxxxx... (Graph API Explorer থেকে copy করুন)', 'EAAxxxxxx... (copy from Graph API Explorer)')}
                  value={manualToken} onChange={e => setManualToken(e.target.value)} />
              </div>

              {activePages.length > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${border}`, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 12, color: muted, fontWeight: 600, marginBottom: 6 }}>
                    🔗 {copy('এই page কি কোনো existing profile share করবে? (optional)', 'Link to an existing page profile? (optional)')}
                  </div>
                  <select
                    value={selectedMasterId}
                    onChange={e => setSelectedMasterId(e.target.value ? Number(e.target.value) : '')}
                    style={{ ...inp, fontSize: 13, height: 36, padding: '0 10px' }}
                  >
                    <option value="">{copy('না — নতুন standalone page হবে', 'No — create as standalone page')}</option>
                    {activePages.map(p => (
                      <option key={p.id} value={p.id}>{p.pageName} — {copy('এর settings/products share করবে', 'share settings & products')}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* ── Custom App Credentials ── */}
              <div style={{ borderRadius: 11, border: `1px solid ${border}`, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', color: text, fontWeight: 700, fontSize: 12.5, borderBottom: `1px solid ${border}` }}>
                  ⚙️ {copy('নিজের Facebook App Credentials (Optional)', 'Your Facebook App Credentials (Optional)')}
                </div>
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.7 }}>
                    {copy(
                      'Customer-এর নিজের Meta App থাকলে App ID ও App Secret এখানে দিন। এই App দিয়েই Facebook Messenger, WhatsApp ও Instagram — তিনটাই চলবে।',
                      'If the customer has their own Meta App, enter the App ID and App Secret here. This same App will handle Facebook Messenger, WhatsApp, and Instagram.',
                    )}
                    <div style={{ background: dark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)', padding: '7px 10px', borderRadius: 8, marginTop: 6, border: `1px solid rgba(99,102,241,0.2)` }}>
                      <strong style={{ color: '#6366f1' }}>{copy('কোথায় পাবেন?', 'Where to find?')}</strong>{' '}
                      <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer" style={{ color: text, fontWeight: 600 }}>developers.facebook.com</a>
                      {copy(' → customer-এর App → App Settings → Basic → App ID (উপরে) + App Secret ("Show" click করুন)', ' → customer\'s App → App Settings → Basic → App ID (at top) + App Secret (click "Show")')}
                    </div>
                    <div style={{ marginTop: 5 }}><strong>{copy('App Secret একবার save হলে আর দেখানো হবে না — encrypted রাখা হয়।', 'App Secret is stored encrypted and never shown again after saving.')}</strong></div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11.5, color: muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>App ID</label>
                    <input style={inp} value={customFbAppId} onChange={e => setCustomFbAppId(e.target.value)} placeholder="1234567890123456" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11.5, color: muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>App Secret</label>
                    <input style={inp} type="password" value={customFbAppSecret} onChange={e => setCustomFbAppSecret(e.target.value)} placeholder="••••••••••••••••••••••••••••••••" autoComplete="new-password" />
                  </div>
                </div>
              </div>

              {!manualSuccess ? (
                <button onClick={connectManual} disabled={manualBusy}
                  style={{
                    width: '100%', padding: '13px', borderRadius: 13, border: 'none',
                    background: manualBusy ? 'rgba(99,102,241,0.5)' : '#6366f1',
                    color: '#fff', fontWeight: 800, fontSize: 15,
                    cursor: manualBusy ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    fontFamily: 'inherit', transition: 'background .15s',
                  }}>
                  {manualBusy ? <><Spinner size={15} /> {copy('Connecting...', 'Connecting...')}</> : copy('🔗 Page Connect করুন', 'Connect Page')}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12, padding: '12px 15px', fontSize: 13, color: '#16a34a', fontWeight: 700 }}>
                    {copy('✅ Page সফলভাবে Connected হয়েছে!', '✅ Page connected successfully!')}
                  </div>

                  {/* Webhook subscription reminder — shown for all users */}
                  <div style={{ background: dark ? 'rgba(34,197,94,0.07)' : 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12, padding: '12px 15px', fontSize: 12.5, color: text, lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#16a34a', marginBottom: 6 }}>
                      ✅ {copy('Webhook Subscription স্বয়ংক্রিয়ভাবে হয়ে গেছে', 'Webhook subscription done automatically')}
                    </div>
                    <div style={{ color: muted }}>
                      {copy(
                        'আমাদের সিস্টেম আপনার page-এ নিচের events subscribe করে দিয়েছে:',
                        'Our system has subscribed the following events to your page:',
                      )}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {['messages', 'messaging_postbacks', 'messaging_optins', 'message_deliveries', 'message_reads', 'messaging_referrals', 'feed'].map(f => (
                        <code key={f} style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: '2px 7px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{f}</code>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11.5, color: muted }}>
                      ⚠️ {copy(
                        'যদি Facebook Developer Console-এ "No fields subscribed" দেখায়, তাহলে manually "Add Subscriptions" থেকে উপরের fields গুলো add করুন।',
                        'If Facebook Developer Console shows "No fields subscribed", manually add the above fields from "Add Subscriptions".',
                      )}
                    </div>
                  </div>

                  {/* Webhook setup instructions — shown only for custom app users */}
                  {connectResult?.hasCustomApp && connectResult.verifyToken && (
                    <div style={{ background: dark ? 'rgba(251,191,36,0.07)' : 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>⚠️</span> 
                        {copy('এখন আপনার Facebook App-এ Webhook Setup করুন', 'Now set up the Webhook in your Facebook App')}
                      </div>
                      
                      <div style={{ fontSize: 12.5, color: text, lineHeight: 1.7, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', padding: '12px', borderRadius: 8, border: `1px solid ${border}` }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, color: '#6366f1' }}>{copy('ধাপ ১: Webhooks এ যান', 'Step 1: Go to Webhooks')}</div>
                        {copy(
                          'developers.facebook.com → আপনার App Dashboard → বাম দিকের মেন্যু থেকে Messenger → Webhooks এ যান।',
                          'Go to developers.facebook.com → your App Dashboard → Messenger → Webhooks from the left menu.'
                        )}
                      </div>

                      <div style={{ fontSize: 12.5, color: text, lineHeight: 1.7, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', padding: '12px', borderRadius: 8, border: `1px solid ${border}` }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, color: '#6366f1' }}>{copy('ধাপ ২: Callback URL যোগ করুন', 'Step 2: Add Callback URL')}</div>
                        {copy(
                          '"Add Callback URL" বাটনে ক্লিক করে নিচের তথ্যগুলো হুবহু কপি করে বসান এবং Verify & Save এ ক্লিক করুন:',
                          'Click "Add Callback URL", copy exactly the info below, and click Verify & Save:'
                        )}
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 11.5, color: muted, fontWeight: 600 }}>{copy('Callback URL', 'Callback URL')}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <code style={{ flex: 1, background: dark ? 'rgba(0,0,0,0.2)' : '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: text, wordBreak: 'break-all', fontFamily: 'monospace', border: `1px solid ${border}` }}>
                                {connectResult.webhookUrl || 'https://flamboyai.com/webhook'}
                              </code>
                              <button onClick={() => navigator.clipboard.writeText(connectResult.webhookUrl || 'https://flamboyai.com/webhook')}
                                style={{ border: `1px solid rgba(99,102,241,0.4)`, borderRadius: 7, padding: '6px 12px', background: 'rgba(99,102,241,0.1)', color: '#6366f1', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                                {copy('Copy', 'Copy')}
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 11.5, color: muted, fontWeight: 600 }}>{copy('Verify Token', 'Verify Token')}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <code style={{ flex: 1, background: dark ? 'rgba(0,0,0,0.2)' : '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: text, wordBreak: 'break-all', fontFamily: 'monospace', border: `1px solid ${border}` }}>
                                {connectResult.verifyToken}
                              </code>
                              <button onClick={() => navigator.clipboard.writeText(connectResult.verifyToken!)}
                                style={{ border: `1px solid rgba(99,102,241,0.4)`, borderRadius: 7, padding: '6px 12px', background: 'rgba(99,102,241,0.1)', color: '#6366f1', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                                {copy('Copy', 'Copy')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ fontSize: 12.5, color: text, lineHeight: 1.7, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', padding: '12px', borderRadius: 8, border: `1px solid ${border}` }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, color: '#6366f1' }}>{copy('ধাপ ৩: Webhook Subscriptions', 'Step 3: Webhook Subscriptions')}</div>
                        {copy('এরপর Edit/Manage এ ক্লিক করে নিচের ৩টি ইভেন্ট অবশ্যই সাবস্ক্রাইব করুন:', 'Then click Edit/Manage and subscribe to these 3 events:')}
                        <div style={{ marginTop: 6 }}>
                          {['messages', 'messaging_postbacks', 'feed'].map(s => (
                            <code key={s} style={{ background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', padding: '3px 7px', borderRadius: 6, fontSize: 11.5, marginRight: 6, display: 'inline-block', marginBottom: 4, fontWeight: 600 }}>{s}</code>
                          ))}
                        </div>
                      </div>

                      <div style={{ fontSize: 12.5, color: text, lineHeight: 1.7, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', padding: '12px', borderRadius: 8, border: `1px solid ${border}` }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, color: '#6366f1' }}>{copy('ধাপ ৪: Page Subscribe করুন', 'Step 4: Subscribe the Page')}</div>
                        {copy('সবশেষে, অ্যাপ ড্যাশবোর্ড থেকেই আপনার নির্দিষ্ট Page-টিকে এই অ্যাপের সাথে সাবস্ক্রাইব (Subscribe) করে দিন।', 'Finally, subscribe your specific Page to this App directly from the App Dashboard.')}
                        <div style={{ marginTop: 6, color: muted, fontSize: 11.5 }}>
                          <strong>{copy('প্রয়োজনীয় Page Permissions:', 'Required Page Permissions:')}</strong><br/>
                          {['pages_messaging', 'pages_read_engagement', 'pages_manage_engagement'].map(p => (
                            <code key={p} style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', padding: '2px 5px', borderRadius: 4, fontSize: 10.5, marginRight: 5, marginTop: 4, display: 'inline-block' }}>{p}</code>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}

                  <button onClick={onConnected}
                    style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {copy('→ Dashboard-এ যান', 'Go to Dashboard')}
                  </button>
                </div>
              )}
              </div>
            )}
          </div>
        </div>

        {/* Goto dashboard for active pages */}
        {activePages.length > 0 && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {copy('Dashboard Access', 'Dashboard Access')}
            </div>
            {activePages.map((page) => (
              <button key={page.id} onClick={() => goToDashboardForPage(page)}
                style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1px solid rgba(99,102,241,0.3)`, background: 'transparent', color: '#6366f1', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                {copy(`→ ${page.pageName} dashboard`, `Go to ${page.pageName} dashboard`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tutorial Sidebar ── */}
      <div style={{ width: 'min(300px, 100%)', boxSizing: 'border-box', flexShrink: 0, background: panel, border: `1px solid ${border}`, borderRadius: 22, padding: 'clamp(16px, 4vw, 24px)', boxShadow: dark ? '0 8px 48px rgba(0,0,0,0.5)' : '0 8px 40px rgba(99,102,241,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🎬</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: text }}>{copy('Tutorial', 'Tutorial')}</div>
            <div style={{ fontSize: 11, color: muted }}>{copy('ধাপে ধাপে গাইড', 'Step-by-step guide')}</div>
          </div>
        </div>

        {tutorialYtId ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ borderRadius: 12, overflow: 'hidden', aspectRatio: '16/9', background: '#000' }}>
              <iframe
                src={`https://www.youtube.com/embed/${tutorialYtId}`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen title="Page connect tutorial"
              />
            </div>
            <div style={{ fontSize: 12, color: muted, lineHeight: 1.7 }}>
              {copy('এই video দেখে সহজেই page connect করতে পারবেন।', 'Watch this video to easily connect your page.')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', paddingTop: '56.25%' }}>
              <iframe
                src="https://www.youtube.com/embed/pYQvc16iP4M"
                title="Tutorial"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', borderRadius: 12 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: text, marginBottom: 2 }}>
                {copy('দ্রুত শুরুর ধাপ:', 'Quick start steps:')}
              </div>
              {[
                copy('১. Admin-কে আপনার Page-এ moderator হিসেবে add করুন', '1. Add the admin as a moderator on your Page'),
                copy('২. Request form submit করুন', '2. Submit the request form'),
                copy('৩. Admin Facebook দিয়ে login করে approve করবে', '3. Admin logs in with Facebook and approves'),
                copy('৪. আপনার page automatically connect হয়ে যাবে', '4. Your page connects automatically'),
              ].map((step, i) => (
                <div key={i} style={{ fontSize: 12, color: muted, padding: '7px 10px', borderRadius: 8, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', border: `1px solid ${border}` }}>
                  {step}
                </div>
              ))}
            </div>
            <a
              href="https://developers.facebook.com/"
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', padding: '9px', borderRadius: 10, border: `1px solid rgba(99,102,241,0.35)`, color: '#6366f1', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', background: dark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)' }}
            >
              🔗 {copy('Meta Developer Portal', 'Meta Developer Portal')}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
