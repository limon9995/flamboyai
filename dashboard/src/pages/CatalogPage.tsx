import { useCallback, useEffect, useState } from 'react';
import { CardHeader, EmptyState, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE } from '../hooks/useApi';
import { useLanguage } from '../i18n';

export function CatalogPage({ th, pageId, onToast }: {
  th: Theme; pageId: number; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const [catalogData, setCatalogData]     = useState<any>(null);
  const [loading, setLoading]             = useState(false);
  const [copied, setCopied]               = useState(false);
  const [copiedCode, setCopiedCode]       = useState<string | null>(null);
  const [customDomain, setCustomDomain]   = useState('');
  const [savingDomain, setSavingDomain]   = useState(false);
  const [domainSaved, setDomainSaved]     = useState(false);
  const [slugInput, setSlugInput]         = useState('');
  const [savingSlug, setSavingSlug]       = useState(false);
  const [slugError, setSlugError]         = useState('');
  const [editingSlug, setEditingSlug]     = useState(false);

  // External website mode
  const [ownUrlInput, setOwnUrlInput]     = useState('');
  const [savingOwnUrl, setSavingOwnUrl]   = useState(false);
  const [editingOwnUrl, setEditingOwnUrl] = useState(false);

  // Reviews
  const [reviews, setReviews]             = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  const backendBase = API_BASE.startsWith('http') ? API_BASE : `${window.location.protocol}//${window.location.hostname}:3000`;
  const slug        = catalogData?.page?.catalogSlug;
  const catalogKey  = slug || pageId;
  const CATALOG_URL = `${backendBase}/catalog/${catalogKey}`;
  const productUrl  = (code: string) => `${backendBase}/catalog/${catalogKey}/product/${code}`;

  const websiteUrl: string | null = catalogData?.page?.websiteUrl || null;
  // mode: 'own' if websiteUrl is set, 'FlamboyAI' otherwise
  const mode = websiteUrl ? 'own' : 'FlamboyAI';

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/catalog/${pageId}/data`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCatalogData(data);
      setCustomDomain(data?.page?.customDomain || '');
      setSlugInput(data?.page?.catalogSlug || '');
      setOwnUrlInput(data?.page?.websiteUrl || '');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [pageId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/client-dashboard/${pageId}/reviews`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('dfbot_token')}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviews(await res.json());
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setReviewsLoading(false); }
  }, [pageId]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  const deleteReview = async (id: number) => {
    if (!window.confirm(copy('এই review মুছে ফেলবেন?', 'Delete this review?'))) return;
    try {
      const res = await fetch(`${API_BASE}/client-dashboard/${pageId}/reviews/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('dfbot_token')}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviews(rs => rs.filter(r => r.id !== id));
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(CATALOG_URL);
    setCopied(true);
    onToast(copy('✅ URL copied!', '✅ URL copied!'));
    setTimeout(() => setCopied(false), 2000);
  };

  const openCatalog = () => window.open(CATALOG_URL, '_blank');

  const patchSettings = async (fields: Record<string, any>) => {
    const res = await fetch(`${API_BASE}/client-dashboard/${pageId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('dfbot_token')}` },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.message || `HTTP ${res.status}`);
    }
  };

  const saveCustomDomain = async () => {
    setSavingDomain(true);
    try {
      await patchSettings({ customDomain: customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '') || null });
      setDomainSaved(true);
      onToast('✅ Custom domain saved!', 'success');
      setTimeout(() => setDomainSaved(false), 3000);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSavingDomain(false); }
  };

  const handleSlugInput = (val: string) => {
    const clean = val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setSlugInput(clean);
    setSlugError('');
  };

  const saveSlug = async () => {
    const clean = slugInput.trim();
    if (!clean) { setSlugError('খালি রাখা যাবে না'); return; }
    if (clean.length < 3) { setSlugError('কমপক্ষে ৩ টি character দিন'); return; }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(clean)) {
      setSlugError('শুধু a-z, 0-9 এবং hyphen (-)। শুরু ও শেষ letter/number হতে হবে।');
      return;
    }
    setSavingSlug(true);
    try {
      await patchSettings({ catalogSlug: clean });
      onToast('✅ URL পরিবর্তন হয়েছে!', 'success');
      setEditingSlug(false);
      setSlugError('');
      await loadPreview();
    } catch (e: any) {
      setSlugError(String(e.message || 'সমস্যা হয়েছে, আবার চেষ্টা করুন।'));
    } finally { setSavingSlug(false); }
  };

  const startEditSlug = () => {
    setSlugInput(catalogData?.page?.catalogSlug || '');
    setSlugError('');
    setEditingSlug(true);
  };

  const saveOwnUrl = async () => {
    let url = ownUrlInput.trim();
    if (url && !/^https?:\/\/.+/.test(url)) url = 'https://' + url;
    if (url) setOwnUrlInput(url);
    setSavingOwnUrl(true);
    try {
      await patchSettings({ websiteUrl: url || null });
      onToast(url ? '✅ ' + copy('নিজের Website সেট হয়েছে', 'Your website has been set') : '✅ ' + copy('FlamboyAI Catalog এ ফিরে গেছে', 'Switched back to FlamboyAI Catalog'), 'success');
      setEditingOwnUrl(false);
      await loadPreview();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSavingOwnUrl(false); }
  };

  const switchToFlamboyAI = async () => {
    if (!confirm(copy('নিজের website সরিয়ে FlamboyAI Catalog এ ফিরবেন?', 'Remove your website and switch back to FlamboyAI Catalog?'))) return;
    setSavingOwnUrl(true);
    try {
      await patchSettings({ websiteUrl: null });
      onToast('✅ ' + copy('FlamboyAI Catalog এ ফিরে গেছে', 'Switched back to FlamboyAI Catalog'), 'success');
      await loadPreview();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSavingOwnUrl(false); }
  };

  if (loading) return (
    <div style={{ ...th.card, display: 'flex', alignItems: 'center', gap: 12, color: th.muted }}>
      <Spinner size={20}/> {copy('Loading...', 'Loading...')}
    </div>
  );

  const page     = catalogData?.page;
  const products = catalogData?.products || [];
  const activeCustomDomain = page?.customDomain;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: `linear-gradient(135deg, ${th.accent}, ${th.accent}88)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, flexShrink: 0, boxShadow: `0 4px 14px ${th.accent}33`,
        }}>🌐</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>
            {page?.businessName || copy('আপনার Website', 'Your Website')}
          </div>
          <div style={{ fontSize: 12.5, color: th.muted, marginTop: 2 }}>
            {copy('Customer রা এই website থেকে product দেখে order করতে পারবে', 'Customers can browse and order from this website')}
          </div>
        </div>
      </div>

      {/* ── Mode Switcher ── */}
      <div style={{ ...th.card, border: `2px solid ${th.accent}22`, padding: 0, overflow: 'hidden' }}>
        {/* Toggle tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${th.border}` }}>
          {(['own', 'FlamboyAI'] as const).map(m => {
            const isActive = mode === m || (m === 'own' && editingOwnUrl);
            return (
              <button
                key={m}
                onClick={() => {
                  if (m === 'own' && mode !== 'own') {
                    setEditingOwnUrl(true);
                  } else if (m === 'FlamboyAI') {
                    if (editingOwnUrl) { setEditingOwnUrl(false); setOwnUrlInput(''); }
                    else if (mode !== 'FlamboyAI') switchToFlamboyAI();
                  }
                }}
                style={{
                  padding: '13px 8px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
                  background: isActive ? `${th.accent}15` : 'transparent',
                  color: isActive ? th.accent : th.muted,
                  borderBottom: isActive ? `2px solid ${th.accent}` : '2px solid transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {m === 'own'
                  ? <>{copy('🔗 নিজের Website আছে', '🔗 I have my own website')}</>
                  : <>{copy('🛒 FlamboyAI Website বানাব', '🛒 Build with FlamboyAI')}</>
                }
                {isActive && <span style={{ fontSize: 10, background: th.accent, color: '#fff', borderRadius: 20, padding: '1px 7px', fontWeight: 800 }}>{copy('চালু', 'Active')}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: 18 }}>
          {/* ── OWN WEBSITE MODE ── */}
          {mode === 'own' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#16a34a12', border: '1px solid #16a34a33' }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>✅</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', marginBottom: 3 }}>
                    {copy('নিজের Website সংযুক্ত আছে', 'Your own website is connected')}
                  </div>
                  <div style={{ fontSize: 12, color: th.muted, lineHeight: 1.6 }}>
                    {copy('Bot customer কে এই link পাঠাবে। FlamboyAI-এর under-এ কোনো website তৈরি হবে না।', 'The bot will send this link to customers. No website will be created under FlamboyAI.')}
                  </div>
                </div>
              </div>

              {editingOwnUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    autoFocus
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '11px 14px', borderRadius: 10,
                      border: `1.5px solid ${th.accent}`, background: th.surface,
                      color: th.text, fontSize: 13, fontFamily: 'monospace', outline: 'none',
                    }}
                    value={ownUrlInput}
                    onChange={e => {
                      let v = e.target.value;
                      if (v && !v.startsWith('http') && !v.startsWith('/')) v = 'https://' + v;
                      setOwnUrlInput(v);
                    }}
                    onBlur={e => {
                      let v = e.target.value.trim();
                      if (v && !/^https?:\/\//.test(v)) setOwnUrlInput('https://' + v);
                    }}
                    placeholder="https://yourshop.com"
                    onKeyDown={e => { if (e.key === 'Enter') saveOwnUrl(); if (e.key === 'Escape') setEditingOwnUrl(false); }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveOwnUrl} disabled={savingOwnUrl} style={{ ...th.btnPrimary, flex: 1, justifyContent: 'center', opacity: savingOwnUrl ? 0.7 : 1 }}>
                      {savingOwnUrl ? <Spinner size={13} /> : '💾 ' + copy('Save করুন', 'Save')}
                    </button>
                    <button onClick={() => { setEditingOwnUrl(false); setOwnUrlInput(websiteUrl || ''); }} style={{ ...th.btnGhost, padding: '10px 16px' }}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{
                    flex: 1, padding: '10px 14px', borderRadius: 10,
                    border: `1.5px solid ${th.accent}44`, background: th.surface,
                    fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all',
                    color: th.accent, minWidth: 0,
                  }}>
                    {websiteUrl}
                  </div>
                  <button style={{ ...th.btnGhost, whiteSpace: 'nowrap' }} onClick={() => { setOwnUrlInput(websiteUrl || ''); setEditingOwnUrl(true); }}>
                    ✏️ {copy('বদলান', 'Edit')}
                  </button>
                  <button style={{ ...th.btnPrimary, whiteSpace: 'nowrap' }} onClick={() => { navigator.clipboard.writeText(websiteUrl!); onToast('✅ Copied!'); }}>
                    📋 Copy
                  </button>
                  <button style={{ ...th.btnGhost, whiteSpace: 'nowrap' }} onClick={() => window.open(websiteUrl!, '_blank')}>
                    🔗 Open
                  </button>
                </div>
              )}

              {/* QR Code for own website */}
              {!editingOwnUrl && websiteUrl && (
                <div style={{ borderTop: `1px solid ${th.border}`, paddingTop: 14, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    📱 QR Code
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <img
                        key={websiteUrl}
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(websiteUrl)}&color=000000&bgcolor=ffffff&margin=10`}
                        alt="Website QR Code"
                        style={{ width: 180, height: 180, borderRadius: 12, border: `1.5px solid ${th.border}`, display: 'block' }}
                      />
                      <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, textAlign: 'center' }}>Website QR</div>
                      <a
                        href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(websiteUrl)}&color=000000&bgcolor=ffffff&margin=20`}
                        download="website-qr.png"
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...th.btnGhost, fontSize: 11, padding: '5px 12px', textDecoration: 'none' }}
                      >
                        ⬇️ Download
                      </a>
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                        {copy('QR Code ব্যবহারের উপায়:', 'How to use QR Code:')}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {[
                          ['📦', copy('প্রতিটা প্যাকেজে print করে দিন', 'Print and stick on packages')],
                          ['🖨️', copy('ভিজিটিং কার্ড বা ফ্লায়ারে লাগান', 'Add to visiting cards or flyers')],
                          ['📱', copy('Facebook/WhatsApp story তে share করুন', 'Share on Facebook/WhatsApp story')],
                          ['🏷️', copy('Product এর গায়ে sticker হিসেবে লাগান', 'Stick on products as label')],
                        ].map(([icon, text]) => (
                          <div key={text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: th.muted }}>
                            <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
                            <span>{text}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: `${th.accent}0d`, border: `1px dashed ${th.accent}33`, fontSize: 12, color: th.muted, lineHeight: 1.6 }}>
                        ℹ️ {copy('Product views ও auto-sync শুধু FlamboyAI website এ পাওয়া যায়।', 'Product views & auto-sync are only available with FlamboyAI website.')}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── FlamboyAI MODE — add own website prompt ── */}
          {mode === 'FlamboyAI' && !editingOwnUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: `${th.accent}0d`, border: `1px solid ${th.accent}22` }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
                <div style={{ fontSize: 12.5, color: th.muted, lineHeight: 1.7 }}>
                  {copy(
                    'নিজের website থাকলে "নিজের Website আছে" tab এ click করে সেটা add করুন — FlamboyAI এর under এ website তৈরি হবে না।',
                    'If you already have your own website, click the "I have my own website" tab to add it — no website will be created under FlamboyAI.'
                  )}
                </div>
              </div>

              {/* Website URL card */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {copy('✅ আপনার FlamboyAI Website Link', '✅ Your FlamboyAI Website Link')}
                </div>

                {editingSlug ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                      <div style={{
                        padding: '10px 11px', borderRadius: '10px 0 0 10px',
                        border: `1.5px solid ${th.border}`, borderRight: 'none',
                        background: th.bg, color: th.muted,
                        fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center',
                      }}>
                        {`${backendBase}/catalog/`}
                      </div>
                      <input
                        autoFocus
                        style={{
                          flex: 1, padding: '10px 11px', minWidth: 100,
                          border: `1.5px solid ${slugError ? '#ef4444' : th.accent}`,
                          borderLeft: 'none', borderRight: 'none',
                          background: th.surface, color: th.accent,
                          fontSize: 13, fontFamily: 'monospace', fontWeight: 700,
                          outline: 'none',
                        }}
                        value={slugInput}
                        onChange={e => handleSlugInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveSlug(); if (e.key === 'Escape') setEditingSlug(false); }}
                        placeholder="your-shop-name"
                        spellCheck={false}
                      />
                      <button
                        style={{ ...th.btnPrimary, borderRadius: 0, padding: '10px 16px', whiteSpace: 'nowrap', opacity: savingSlug ? 0.7 : 1 }}
                        onClick={saveSlug} disabled={savingSlug}
                      >
                        {savingSlug ? <Spinner size={13} /> : copy('💾 Save', 'Save')}
                      </button>
                      <button
                        style={{ ...th.btnGhost, borderRadius: '0 10px 10px 0', padding: '10px 14px', whiteSpace: 'nowrap' }}
                        onClick={() => { setEditingSlug(false); setSlugError(''); }}
                      >✕</button>
                    </div>
                    {slugError
                      ? <div style={{ marginTop: 5, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>⚠️ {slugError}</div>
                      : <div style={{ marginTop: 5, fontSize: 11.5, color: th.muted }}>
                          {copy('⚠️ Save করলে পুরনো link কাজ করবে না। • Esc = বাতিল', '⚠️ Old link stops working after save. • Esc = cancel')}
                        </div>
                    }
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{
                      flex: 1, padding: '10px 14px', ...th.card2,
                      borderRadius: 10, border: `1.5px solid ${th.accent}44`,
                      fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all',
                      color: th.accent, minWidth: 0,
                    }}>
                      {activeCustomDomain ? `https://${activeCustomDomain}` : CATALOG_URL}
                    </div>
                    <button
                      title={copy('URL-এর শেষ অংশ বদলান', 'Edit URL slug')}
                      style={{ ...th.btnGhost, whiteSpace: 'nowrap', padding: '10px 13px' }}
                      onClick={startEditSlug}
                    >✏️</button>
                    <button style={{ ...th.btnPrimary, whiteSpace: 'nowrap' }} onClick={copyUrl}>
                      {copied ? '✅' : '📋 Copy'}
                    </button>
                    <button style={{ ...th.btnGhost, whiteSpace: 'nowrap' }} onClick={openCatalog}>
                      🔗 Open
                    </button>
                  </div>
                )}

                <div style={{ fontSize: 11.5, color: th.muted, marginTop: 8 }}>
                  {copy('💡 Products page এ ছবি ও YouTube video যোগ করলে এখানে নিজে থেকেই দেখাবে।', '💡 Add product photos and YouTube videos from the Products page — they appear automatically here.')}
                </div>
              </div>

              {/* Custom domain */}
              <div style={{ borderTop: `1px solid ${th.border}`, paddingTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {copy('🌐 Personal Domain (যদি থাকে)', '🌐 Personal Domain (optional)')}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    style={{
                      flex: 1, padding: '10px 14px',
                      borderRadius: 10, border: `1.5px solid ${th.border}`,
                      background: th.surface, color: th.text, fontSize: 13,
                      outline: 'none', fontFamily: 'monospace', minWidth: 180,
                    }}
                    value={customDomain}
                    onChange={e => setCustomDomain(e.target.value)}
                    placeholder="shop.yourbrand.com"
                  />
                  <button
                    style={{ ...th.btnPrimary, whiteSpace: 'nowrap', opacity: (savingDomain || !customDomain.trim()) ? 0.5 : 1 }}
                    onClick={saveCustomDomain}
                    disabled={savingDomain || !customDomain.trim()}
                  >
                    {savingDomain ? '...' : domainSaved ? '✅ Saved' : copy('💾 Save', 'Save')}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: th.muted, marginTop: 8, lineHeight: 1.6 }}>
                  {copy('নিজের domain ব্যবহার করতে চাইলে domain টি এখানে enter করুন। তারপর DNS-এ CNAME করুন:', 'To use your own domain, enter it here, then set a DNS CNAME record:')}
                </div>
                {(customDomain || activeCustomDomain) && (
                  <div style={{
                    marginTop: 8, padding: '10px 14px', borderRadius: 10,
                    background: `${th.accent}0d`, border: `1px dashed ${th.accent}44`,
                    fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8,
                  }}>
                    <div style={{ color: th.muted }}>DNS Record (CNAME):</div>
                    <div style={{ color: th.accent }}>
                      {customDomain || activeCustomDomain} <span style={{ color: th.muted }}>→</span> api.flamboyai.com
                    </div>
                  </div>
                )}
                {activeCustomDomain && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#16a34a', fontWeight: 700 }}>
                    <span>✅</span>
                    <span>{copy(`${activeCustomDomain} — active আছে`, `${activeCustomDomain} — active`)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inline editing for switching to own website */}
          {mode === 'FlamboyAI' && editingOwnUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{copy('আপনার Website এর link দিন:', 'Enter your website link:')}</div>
              <input
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '11px 14px', borderRadius: 10,
                  border: `1.5px solid ${th.accent}`, background: th.surface,
                  color: th.text, fontSize: 13, fontFamily: 'monospace', outline: 'none',
                }}
                value={ownUrlInput}
                onChange={e => setOwnUrlInput(e.target.value)}
                placeholder="https://yourshop.com"
                onKeyDown={e => { if (e.key === 'Enter') saveOwnUrl(); if (e.key === 'Escape') setEditingOwnUrl(false); }}
              />
              <div style={{ fontSize: 12, color: th.muted, lineHeight: 1.6 }}>
                {copy('এই link save করলে bot customer কে এই link পাঠাবে এবং FlamboyAI website তৈরি বন্ধ হবে।', 'After saving, the bot will send this link to customers and the FlamboyAI catalog will be disabled.')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveOwnUrl} disabled={savingOwnUrl} style={{ ...th.btnPrimary, flex: 1, justifyContent: 'center', opacity: savingOwnUrl ? 0.7 : 1 }}>
                  {savingOwnUrl ? <Spinner size={13} /> : '💾 ' + copy('Save করুন', 'Save')}
                </button>
                <button onClick={() => { setEditingOwnUrl(false); setOwnUrlInput(''); }} style={{ ...th.btnGhost, padding: '10px 16px' }}>✕ {copy('বাতিল', 'Cancel')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats & QR — only in FlamboyAI mode */}
      {mode === 'FlamboyAI' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
            {[
              { value: products.length, label: 'Products', color: th.accent },
              { value: products.filter((p: any) => p.imageUrl).length, label: 'With Photo', color: '#16a34a' },
              { value: products.filter((p: any) => p.videoUrl).length, label: 'With Video', color: '#8b5cf6' },
              { value: (catalogData?.page?.catalogViews ?? 0).toLocaleString(), label: 'Website Views', color: '#f59e0b' },
              { value: products.reduce((s: number, p: any) => s + (p.productViews ?? 0), 0).toLocaleString(), label: 'Product Views', color: '#06b6d4' },
            ].map(({ value, label, color }) => (
              <div key={label} style={{ ...th.card, padding: '16px 20px' }}>
                <div style={{ fontSize: 26, fontWeight: 900, color }}>{value}</div>
                <div style={{ fontSize: 11, color: th.muted, marginTop: 4, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ ...th.card }}>
            <CardHeader th={th} title="📱 QR Code" sub={copy('Print করুন, প্যাকেজে দিন — scan করলেই website খুলবে', 'Print and stick on packages — scan opens your website')} />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <img
                  key={CATALOG_URL}
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(CATALOG_URL)}&color=000000&bgcolor=ffffff&margin=10`}
                  alt="Website QR Code"
                  style={{ width: 180, height: 180, borderRadius: 12, border: `1.5px solid ${th.border}`, display: 'block' }}
                />
                <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, textAlign: 'center' }}>Website QR</div>
                <a
                  href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(CATALOG_URL)}&color=000000&bgcolor=ffffff&margin=20`}
                  download="website-qr.png"
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...th.btnGhost, fontSize: 11, padding: '5px 12px', textDecoration: 'none' }}
                >
                  ⬇️ Download
                </a>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Website QR ব্যবহারের উপায়:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['📦', 'প্রতিটা প্যাকেজে print করে দিন — customer next order সহজে করতে পারবে'],
                    ['🖨️', 'ভিজিটিং কার্ড বা ফ্লায়ারে লাগান — offline promotion'],
                    ['📱', 'Facebook/WhatsApp story তে share করুন'],
                    ['🏷️', 'Product এর গায়ে sticker হিসেবে লাগান'],
                  ].map(([icon, text]) => (
                    <div key={text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: th.muted }}>
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {products.length > 0 && page && (
            <div style={th.card}>
              <CardHeader th={th}
                title={copy('Preview', 'Preview')}
                sub={`${products.length} ${copy('products', 'products')}`}
                action={<button style={th.btnGhost} onClick={loadPreview}>🔄</button>}
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(175px,1fr))', gap: 12 }}>
                {products.slice(0, 12).map((p: any) => {
                  const pUrl = productUrl(p.code);
                  const isCopied = copiedCode === p.code;
                  const copyProductLink = (e: React.MouseEvent) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(pUrl);
                    setCopiedCode(p.code);
                    onToast(copy(`✅ ${p.code} link copied!`, `✅ ${p.code} link copied!`));
                    setTimeout(() => setCopiedCode(null), 2000);
                  };
                  return (
                    <div key={p.id} style={{ ...th.card2, borderRadius: 14, overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
                      {p.imageUrl
                        ? <img src={p.imageUrl} alt={p.name || p.code} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        : <div style={{ aspectRatio: '1', background: `${th.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🛍️</div>
                      }
                      <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 10, color: th.muted, fontWeight: 700, letterSpacing: '0.07em' }}>{p.code}</div>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.code}</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: th.accent }}>{page.currency}{Number(p.price).toLocaleString()}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                          {p.videoUrl && <span style={{ fontSize: 9, ...th.pill, background: '#8b5cf622', color: '#8b5cf6', padding: '1px 5px' }}>🎬</span>}
                          {p.stockQty > 0
                            ? <span style={{ fontSize: 9, ...th.pill, ...th.pillGreen, padding: '1px 5px' }}>In Stock</span>
                            : <span style={{ fontSize: 9, ...th.pill, ...th.pillRed, padding: '1px 5px' }}>Stock Out</span>
                          }
                          {(p.productViews ?? 0) > 0 && (
                            <span style={{ fontSize: 9, ...th.pill, background: '#f59e0b22', color: '#d97706', padding: '1px 5px' }}>
                              👁 {p.productViews}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                          <a href={pUrl} target="_blank" rel="noreferrer"
                            style={{ flex: 1, textAlign: 'center', fontSize: 11, padding: '6px 4px', borderRadius: 7, background: `${th.accent}15`, color: th.accent, textDecoration: 'none', fontWeight: 700, border: `1px solid ${th.accent}25` }}>
                            🔗 Open
                          </a>
                          <button onClick={copyProductLink}
                            style={{ flex: 1, fontSize: 11, padding: '6px 4px', borderRadius: 7, background: isCopied ? '#dcfce7' : th.surface, color: isCopied ? '#16a34a' : th.muted, border: `1px solid ${th.border}`, fontWeight: 700, cursor: 'pointer' }}>
                            {isCopied ? '✅' : '📋'} {isCopied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {products.length > 12 && (
                <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 12.5, color: th.muted }}>
                  {copy(`আরো ${products.length - 12} টি product আছে — `, `${products.length - 12} more products — `)}<button style={{ ...th.btnGhost, fontSize: 12.5, padding: '4px 10px' }} onClick={openCatalog}>{copy('Website খুলুন', 'Open Website')}</button>
                </div>
              )}
            </div>
          )}

          <div style={th.card}>
            <CardHeader th={th}
              title={copy('⭐ Reviews', '⭐ Reviews')}
              sub={copy('শুধু যারা order করেছে তারাই review দিতে পারে — delivery হওয়ার পর link পাঠানো হয় (Follow-up settings থেকে বন্ধ/চালু করা যায়)।', 'Only customers who ordered can review — a link is sent after delivery (toggle in Follow-up settings).')}
              action={<button style={th.btnGhost} onClick={loadReviews}>🔄</button>}
            />
            {reviewsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner size={18} color={th.accent} /></div>
            ) : reviews.length === 0 ? (
              <EmptyState icon="⭐" title={copy('এখনো কোনো review নেই', 'No reviews yet')} sub={copy('Order delivered হলে customer-কে review link পাঠানো হবে', "Customers get a review link once their order is delivered")} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {reviews.map((r: any) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 9, border: `1px solid ${th.border}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{r.product?.name || r.product?.code}</span>
                        <span style={{ color: '#f59e0b', fontSize: 12 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                        <span style={{ fontSize: 11, color: th.muted }}>{r.customerName || copy('Customer', 'Customer')}</span>
                      </div>
                      {r.comment && <div style={{ fontSize: 12.5, color: th.muted, marginTop: 3 }}>{r.comment}</div>}
                    </div>
                    <button style={{ ...th.btnSmDanger, fontSize: 11.5, flexShrink: 0 }} onClick={() => deleteReview(r.id)}>🗑 {copy('মুছুন', 'Delete')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
