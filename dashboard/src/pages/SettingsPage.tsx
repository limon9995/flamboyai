import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner, Toggle } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';
import { DHAKA_ZONES } from '../data/dhaka-areas';

// ── Types ─────────────────────────────────────────────────────────────────────
// V29: one row in the product-card button list — 'order'/'details' reuse the
// bot's built-in actions with a custom label, 'custom' opens a link or sends
// a fixed reply text when clicked.
interface CardButton {
  id: string;
  type: 'order' | 'details' | 'custom';
  label: string;
  url?: string;
  replyText?: string;
}

interface Settings {
  businessName: string; businessPhone: string; businessAddress: string;
  websiteUrl: string;
  catalogMessengerUrl: string;
  catalogSlug: string;
  currencySymbol: string; codLabel: string; productCodePrefix: string;
  deliveryFeeInsideDhaka: number; deliveryFeeOutsideDhaka: number;
  deliveryTimeText: string; deliveryTimeInsideDhaka: string; deliveryTimeOutsideDhaka: string;
  paymentMode: string; advanceAmount: number; advanceBkash: string; advanceNagad: string; advanceRocket: string; advancePaymentMessage: string; webOrderEnabled: boolean;
  codEnabled: boolean; advanceThresholdAmount: number;
  // V24: Restaurant mode
  restaurantModeEnabled: boolean;
  restaurantLat: number | null;
  restaurantLng: number | null;
  deliverySlabs: { maxKm: number; fee: number }[];
  // V29: Messenger product-card buttons — [] means "use the built-in default"
  cardButtons: CardButton[];
  smsGatewayEnabled: boolean;
  automationOn: boolean; ocrOn: boolean;
  waEnabled: boolean; waPhoneNumberId: string; waVerifyToken: string; waTokenSet: boolean; waFallbackTemplateName: string;
  igEnabled: boolean; igBusinessAccountId: string; igVerifyToken: string; igTokenSet: boolean; igCommentToDmEnabled: boolean;
  infoModeOn: boolean; orderModeOn: boolean; printModeOn: boolean;
  callConfirmModeOn: boolean; memoSaveModeOn: boolean; memoTemplateModeOn: boolean;
  smartBotOn: boolean;
  businessBotOn: boolean;
  businessInfo: string;
  commentReplyOn: boolean;
  recurringNotifMode: boolean;
  telegramNotifEnabled: boolean; telegramChatId: string; telegramTokenSet: boolean;
  // V18: Image recognition
  imageRecognitionOn: boolean; imageHighConfidence: number;
  imageMediumConfidence: number; imageFallbackAiOn: boolean;
  textFallbackAiOn: boolean;
  pricingPolicy: {
    priceMode: string; allowCustomerOffer: boolean; agentApprovalRequired: boolean;
    fixedPriceReplyText: string; negotiationReplyText: string;
    minNegotiationType: string; minNegotiationValue: number;
  };
  callSettings: {
    callConfirmModeOn: boolean; callMode: string; callConfirmationScope: string;
    initialCallDelayMinutes: number; retryIntervalMinutes: number; maxCallRetries: number; callProvider: string;
  };
  voiceSettings: {
    callLanguage: string; voiceType: string; voiceStyle: string; ttsProvider: string;
    banglaVoiceId: string; englishVoiceId: string;
    banglaCallScript: string; englishCallScript: string;
    banglaVoiceFileUrl: string; englishVoiceFileUrl: string;
    voiceGeneratedAt: string | null;
  };
  modeAccess?: Record<string, boolean>;
  knowledgeText: string;
  customPersonaPrompt: string;
  behaviorInstructions: string;
  promptMode: 'guided' | 'custom';
  customSystemPrompt: string;
  // Agent handoff — pause the bot for a conversation on a manual agent reply
  autoPauseOnHumanTakeover: boolean;
  autoPauseTimeoutMinutes: number;
  stopAiCommand: string;
  startAiCommand: string;
}

const S0: Settings = {
  businessName: '', businessPhone: '', businessAddress: '',
  websiteUrl: '',
  catalogMessengerUrl: '',
  catalogSlug: '',
  currencySymbol: '৳', codLabel: 'COD', productCodePrefix: 'DF',
  deliveryFeeInsideDhaka: 80, deliveryFeeOutsideDhaka: 120, deliveryTimeText: '', deliveryTimeInsideDhaka: '', deliveryTimeOutsideDhaka: '',
  paymentMode: 'cod', advanceAmount: 0, advanceBkash: '', advanceNagad: '', advanceRocket: '', advancePaymentMessage: '', webOrderEnabled: false, smsGatewayEnabled: false,
  codEnabled: true, advanceThresholdAmount: 0,
  restaurantModeEnabled: false, restaurantLat: null, restaurantLng: null, deliverySlabs: [],
  cardButtons: [],
  knowledgeText: '',
  customPersonaPrompt: '',
  behaviorInstructions: '',
  promptMode: 'guided',
  customSystemPrompt: '',
  autoPauseOnHumanTakeover: false,
  autoPauseTimeoutMinutes: 120,
  stopAiCommand: '',
  startAiCommand: '',
  automationOn: false, ocrOn: false,
  waEnabled: false, waPhoneNumberId: '', waVerifyToken: '', waTokenSet: false, waFallbackTemplateName: '',
  igEnabled: false, igBusinessAccountId: '', igVerifyToken: '', igTokenSet: false, igCommentToDmEnabled: true,
  infoModeOn: true, orderModeOn: true, printModeOn: false,
  callConfirmModeOn: false, memoSaveModeOn: false, memoTemplateModeOn: false,
  smartBotOn: false,
  businessBotOn: false,
  businessInfo: '',
  commentReplyOn: false,
  recurringNotifMode: false,
  telegramNotifEnabled: false, telegramChatId: '', telegramTokenSet: false,
  imageRecognitionOn: false, imageHighConfidence: 0.75, imageMediumConfidence: 0.45, imageFallbackAiOn: false, textFallbackAiOn: false,
  pricingPolicy: {
    priceMode: 'FIXED', allowCustomerOffer: false, agentApprovalRequired: true,
    fixedPriceReplyText: 'দুঃখিত, আমাদের price fixed 💖',
    negotiationReplyText: 'আমরা আপনার offer বিবেচনা করব।',
    minNegotiationType: 'PERCENT', minNegotiationValue: 0,
  },
  callSettings: {
    callConfirmModeOn: false, callMode: 'MANUAL', callConfirmationScope: 'ALL',
    initialCallDelayMinutes: 30, retryIntervalMinutes: 30, maxCallRetries: 3, callProvider: '',
  },
  voiceSettings: {
    callLanguage: 'BN', voiceType: 'FEMALE', voiceStyle: 'NATURAL', ttsProvider: 'MANUAL_UPLOAD',
    banglaVoiceId: '', englishVoiceId: '', banglaCallScript: '', englishCallScript: '',
    banglaVoiceFileUrl: '', englishVoiceFileUrl: '', voiceGeneratedAt: null,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 28, marginBottom: 28 }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.02em' }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, opacity: 0.5, marginTop: 3 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
      {children}
    </div>
  );
}

function Label({ text, hint }: { text: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.45 }}>{text}</span>
      {hint && (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
            style={{ background: 'rgba(79,70,229,0.1)', border: 'none', cursor: 'pointer', width: 15, height: 15, borderRadius: '50%', fontSize: 9, color: '#4f46e5', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            i
          </button>
          {show && (
            <div style={{
              position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
              background: 'var(--panel)', border: '1px solid var(--border-md)',
              boxShadow: '0 8px 32px rgba(0,0,0,.12)', borderRadius: 9,
              padding: '9px 12px', width: 200, zIndex: 999,
              fontSize: 11.5, lineHeight: 1.6, pointerEvents: 'none',
            }}>{hint}</div>
          )}
        </span>
      )}
    </div>
  );
}

function SaveRow({ onClick, saving, label = 'Save Changes' }: { onClick: () => void; saving: boolean; label?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
      <button onClick={onClick} disabled={saving} style={{
        padding: '9px 22px', borderRadius: 8, border: 'none',
        background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13.5,
        cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-0.01em',
        display: 'inline-flex', alignItems: 'center', gap: 7,
        boxShadow: '0 1px 4px rgba(79,70,229,.4)',
        opacity: saving ? 0.7 : 1, transition: 'opacity .15s',
      }}>
        {saving && <Spinner size={13} color="#fff"/>} {label}
      </button>
    </div>
  );
}

// ── V29: Product card buttons editor ─────────────────────────────────────────
const CARD_BTN_TYPES = [
  { v: 'order', label: 'Order' },
  { v: 'details', label: 'Details' },
  { v: 'custom', label: 'Custom' },
] as const;
const MAX_CARD_BUTTONS = 3;

function CardButtonsEditor({ th, buttons, onChange }: {
  th: Theme; buttons: CardButton[]; onChange: (b: CardButton[]) => void;
}) {
  const { copy } = useLanguage();
  const update = (i: number, patch: Partial<CardButton>) =>
    onChange(buttons.map((b, j) => j === i ? { ...b, ...patch } : b));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {buttons.map((b, i) => (
        <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 10, border: `1px solid ${th.border}`, background: th.surface }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={{ ...th.input, width: 120, padding: '7px 10px' }} value={b.type}
              onChange={e => update(i, { type: e.target.value as CardButton['type'], url: undefined, replyText: undefined })}>
              {CARD_BTN_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <input style={{ ...th.input, flex: 1, padding: '7px 10px' }} maxLength={30}
              placeholder={copy('Button-এর লেখা (যেমন: Order করব)', 'Button label (e.g. Order now)')}
              value={b.label} onChange={e => update(i, { label: e.target.value })} />
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 18, padding: '0 4px' }}
              onClick={() => onChange(buttons.filter((_, j) => j !== i))}>×</button>
          </div>
          {b.type === 'order' && (
            <div style={{ fontSize: 11.5, color: th.muted }}>{copy('ক্লিক করলে order শুরু হবে (draft flow)', 'Clicking this starts the order draft flow')}</div>
          )}
          {b.type === 'details' && (
            <div style={{ fontSize: 11.5, color: th.muted }}>{copy('ক্লিক করলে product details দেখাবে (catalog link অথবা in-chat)', 'Clicking this shows product details (catalog link or in-chat)')}</div>
          )}
          {b.type === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...th.btnGhost, fontSize: 11.5, padding: '5px 10px', ...(b.url !== undefined ? { borderColor: th.accent, color: th.accent } : {}) }}
                  onClick={() => update(i, { url: '', replyText: undefined })}>🔗 {copy('Link', 'Link')}</button>
                <button style={{ ...th.btnGhost, fontSize: 11.5, padding: '5px 10px', ...(b.replyText !== undefined ? { borderColor: th.accent, color: th.accent } : {}) }}
                  onClick={() => update(i, { replyText: '', url: undefined })}>💬 {copy('Reply text', 'Reply text')}</button>
              </div>
              {b.url !== undefined && (
                <input style={{ ...th.input, padding: '7px 10px' }} placeholder="https://..."
                  value={b.url} onChange={e => update(i, { url: e.target.value })} />
              )}
              {b.replyText !== undefined && (
                <textarea style={{ ...th.input, minHeight: 60, padding: '7px 10px', fontFamily: 'inherit', resize: 'vertical' }} maxLength={500}
                  placeholder={copy('Customer বাটন চাপলে এই text reply পাবে', 'Customer receives this text when they tap the button')}
                  value={b.replyText} onChange={e => update(i, { replyText: e.target.value })} />
              )}
            </div>
          )}
        </div>
      ))}
      {buttons.length < MAX_CARD_BUTTONS && (
        <button style={{ ...th.btnGhost, fontSize: 12, alignSelf: 'flex-start' }} onClick={() => {
          onChange([...buttons, { id: `btn_${Date.now().toString(36)}`, type: 'custom', label: '', replyText: '' }]);
        }}>+ {copy('Button যোগ করুন', 'Add button')}</button>
      )}
      <div style={{ fontSize: 11.5, color: th.muted }}>
        {buttons.length === 0
          ? copy('কিছু set করা না থাকলে default button (Order + Details) দেখানো হবে।', 'When nothing is set, the default buttons (Order + Details) are shown.')
          : copy(`Messenger card-এ সর্বোচ্চ ${MAX_CARD_BUTTONS}টা button দেখানো যায়।`, `Messenger cards can show at most ${MAX_CARD_BUTTONS} buttons.`)}
      </div>
    </div>
  );
}

// ── Voice ID hints per provider ───────────────────────────────────────────────
const VOICE_ID_HINTS: Record<string, { bn: string; en: string; bnPlaceholder: string; enPlaceholder: string }> = {
  GOOGLE: {
    bn: 'Google voice names যেমন: bn-BD-Standard-A (female), bn-BD-Standard-B (male)',
    en: 'Google voice names যেমন: en-US-Standard-C (female), en-US-Standard-D (male)',
    bnPlaceholder: 'bn-BD-Standard-A',
    enPlaceholder: 'en-US-Standard-C',
  },
  ELEVENLABS: {
    bn: 'ElevenLabs voice ID (UUID format) — multilingual_v2 model ব্যবহার করে',
    en: 'ElevenLabs voice ID (UUID format) যেমন: 21m00Tcm4TlvDq8ikWAM (Rachel)',
    bnPlaceholder: '21m00Tcm4TlvDq8ikWAM',
    enPlaceholder: '21m00Tcm4TlvDq8ikWAM',
  },
  AWS_POLLY: {
    bn: 'AWS Polly voice name যেমন: Kajal (Bengali female, neural engine)',
    en: 'AWS Polly voice name যেমন: Joanna (female), Matthew (male), Ruth (neural)',
    bnPlaceholder: 'Kajal',
    enPlaceholder: 'Joanna',
  },
};

const CALL_PROVIDERS = [
  { v: 'MANUAL',      icon: '👤', label: 'Manual Call', desc: 'Agent নিজে call করবে dashboard থেকে' },
  { v: 'SSLWIRELESS', icon: '🇧🇩', label: 'Server 2',    desc: 'Automatic calling server - option 2' },
  { v: 'BDCALLING',   icon: '📲', label: 'Server 3',    desc: 'Automatic calling server - option 3' },
  { v: 'TWILIO',      icon: '📡', label: 'Server 1',    desc: 'Only for international clients' },
] as const;

const TTS_PROVIDERS = [
  { v: 'MANUAL_UPLOAD', icon: '📤', label: 'নিজের Voice Upload', desc: 'সবচেয়ে সহজ - নিজের recorded audio upload করুন', featured: true },
  { v: 'GOOGLE',     icon: '🔵', label: 'Google TTS',  desc: 'High quality, multilingual' },
  { v: 'ELEVENLABS', icon: '🟣', label: 'ElevenLabs',  desc: 'Ultra-realistic AI voice' },
  { v: 'AWS_POLLY',  icon: '🟠', label: 'AWS Polly',   desc: 'Reliable, cost-effective' },
] as const;

const DTMF_KEYS = [
  { key: '1', action: 'Order Confirm ✅', color: '#16a34a', bg: '#f0fdf4' },
  { key: '2', action: 'Order Cancel ❌',  color: '#dc2626', bg: '#fef2f2' },
  { key: '3', action: 'Agent দরকার 👋',  color: '#d97706', bg: '#fffbeb' },
  { key: '?', action: 'Retry call হবে',  color: '#6b7280', bg: '#f9fafb' },
] as const;

function extractYouTubeId(url: string): string | null {
  const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

// ── Main Component ────────────────────────────────────────────────────────────
export function SettingsPage({ th, pageId, tab, onToast, autoOpenReconnect, userRole }: {
  th: Theme; pageId: number; tab: string; onToast: (m: string, t?: any) => void; autoOpenReconnect?: boolean; userRole?: string;
}) {
  const isAdmin = userRole === 'admin';
  const { copy } = useLanguage();
  const { request } = useApi();
  const [s, setS]       = useState<Settings>(S0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [voiceBusy, setVoiceBusy] = useState<Record<string, boolean>>({});
  const [fbTutorialUrl, setFbTutorialUrl] = useState<string>('');
  // Facebook connection / linked pages state
  const [linkedPages, setLinkedPages] = useState<{ id: number; pageId: string; pageName: string; isActive: boolean }[]>([]);
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [reconnectTab, setReconnectTab] = useState<'request' | 'manual'>('request');
  const [reconnectToken, setReconnectToken] = useState('');
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [reconnectReqPageUrl, setReconnectReqPageUrl] = useState('');
  const [reconnectReqFbProfile, setReconnectReqFbProfile] = useState('');
  const [reconnectReqNote, setReconnectReqNote] = useState('');
  const [reconnectReqBusy, setReconnectReqBusy] = useState(false);
  const [reconnectReqSubmitted, setReconnectReqSubmitted] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapePreview, setScrapePreview] = useState<string | null>(null);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  // Payment credentials state
  const [payCreds, setPayCreds] = useState<{ method: string; type: string; isActive: boolean }[]>([]);
  const [paySelected, setPaySelected] = useState<string | null>(null);
  const [payFields, setPayFields] = useState<Record<string, string>>({});
  const [paySandbox, setPaySandbox] = useState(true);
  const [paySaving, setPaySaving] = useState(false);
  const [payTesting, setPayTesting] = useState(false);
  const [payTestResult, setPayTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [payDeleting, setPayDeleting] = useState<string | null>(null);
  // SMS Gateway state
  const [smsToken, setSmsToken] = useState<string | null>(null);
  const [smsCopied, setSmsCopied] = useState(false);
  const [smsToggling, setSmsToggling] = useState(false);
  const [smsDevices, setSmsDevices] = useState<any[]>([]);
  const [selectedPayModeKey, setSelectedPayModeKey] = useState<string>('sms');
  // WhatsApp settings state
  const [waToken, setWaToken] = useState('');
  const [waSaving, setWaSaving] = useState(false);
  const [waManualSetup, setWaManualSetup] = useState(false);
  const [waRequests, setWaRequests] = useState<{ id: number; phoneNumber: string; status: string; note?: string; adminNote?: string; createdAt: string }[]>([]);
  const [waReqPhone, setWaReqPhone] = useState('');
  const [waReqNote, setWaReqNote] = useState('');
  const [waReqBusy, setWaReqBusy] = useState(false);
  // Instagram settings state
  const [igToken, setIgToken] = useState('');
  const [igSaving, setIgSaving] = useState(false);
  // Telegram bot settings state
  const [tgToken, setTgToken] = useState('');
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  // Dhaka zone custom areas
  const [customAreas, setCustomAreas] = useState<string[]>([]);
  const [newArea, setNewArea] = useState('');
  const [areaSaving, setAreaSaving] = useState(false);
  const banglaVoiceUploadRef = useRef<HTMLInputElement>(null);
  const englishVoiceUploadRef = useRef<HTMLInputElement>(null);
  const BASE = `${API_BASE}/client-dashboard/${pageId}`;

  // ── CSS vars for inner components ─────────────────────────────────────────
  const cssVars = {
    '--panel':     th.panel,
    '--border':    th.border,
    '--border-md': th.borderMd,
    '--text':      th.text,
    '--muted':     th.muted,
    '--accent':    th.accent,
  } as React.CSSProperties;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [biz, modes, tut, linked, payCr, smsTok, smsDevList, bkCfg] = await Promise.all([
        request<any>(`${BASE}/settings`),
        request<any>(`${BASE}/modes`),
        request<any>(`${BASE}/tutorials`).catch(() => null),
        request<any>(`${API_BASE}/page/${pageId}/linked-pages`).catch(() => []),
        request<any>(`${API_BASE}/pages/${pageId}/payment-credentials`).catch(() => []),
        request<any>(`${API_BASE}/sms-gateway/token?pageId=${pageId}`).catch(() => null),
        request<any[]>(`${API_BASE}/sms-gateway/devices?pageId=${pageId}`).catch(() => []),
        request<any>(`${BASE}/bot-knowledge/config`).catch(() => null),
      ]);
      setS(prev => ({
        ...prev, ...biz, ...modes,
        pricingPolicy: biz?.pricingPolicy || prev.pricingPolicy,
        callSettings:  biz?.callSettings  || prev.callSettings,
        voiceSettings: biz?.voiceSettings || prev.voiceSettings,
      }));
      if (tut?.facebookAccessToken) setFbTutorialUrl(tut.facebookAccessToken);
      setLinkedPages(Array.isArray(linked) ? linked : []);
      setPayCreds(Array.isArray(payCr) ? payCr : []);
      if (bkCfg?.areaRules?.clientCustomAreas) {
        setCustomAreas((bkCfg.areaRules.clientCustomAreas as any[]).map((a: any) => a.areaName || a));
      }
      if (smsTok?.token) setSmsToken(smsTok.token);
      if (Array.isArray(smsDevList)) {
        setSmsDevices(smsDevList);
        // Auto-disable SMS gateway on load if no active device
        const hasActive = smsDevList.some((d: any) => d.isActive);
        if (!hasActive) {
          setS(p => {
            if (p.smsGatewayEnabled) {
              request(`${API_BASE}/sms-gateway/enabled`, { method: 'PATCH', body: JSON.stringify({ pageId, enabled: false }) }).catch(() => {});
              return { ...p, smsGatewayEnabled: false };
            }
            return p;
          });
        }
      }
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  // Poll device status every 30s — auto-reflect disconnect/uninstall
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const devList = await request<any[]>(`${API_BASE}/sms-gateway/devices?pageId=${pageId}`).catch(() => null);
        if (!Array.isArray(devList)) return;
        setSmsDevices(devList);
        // If all devices are inactive and gateway is on → disable immediately
        const hasActive = devList.some((d: any) => d.isActive);
        if (!hasActive) {
          setS(p => {
            if (p.smsGatewayEnabled) {
              request(`${API_BASE}/sms-gateway/enabled`, { method: 'PATCH', body: JSON.stringify({ pageId, enabled: false }) }).catch(() => {});
              return { ...p, smsGatewayEnabled: false };
            }
            return p;
          });
        }
      } catch { /* silent */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [pageId]);

  useEffect(() => {
    if (autoOpenReconnect && !loading) {
      setReconnectTab('request');
      setReconnectToken('');
      setReconnectReqSubmitted(false);
      setReconnectReqPageUrl('');
      setReconnectReqFbProfile('');
      setReconnectReqNote('');
      setShowReconnectModal(true);
    }
  }, [autoOpenReconnect, loading]);

  const save = async (body: any) => {
    setSaving(true);
    try {
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
      onToast('✓ Saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const scrapeWebsite = async () => {
    if (!s.websiteUrl) { onToast('Website URL দিন আগে', 'error'); return; }
    setScraping(true);
    try {
      const res = await request<{ text: string }>(`${API_BASE}/page/${pageId}/knowledge/scrape`, {
        method: 'POST',
        body: JSON.stringify({ url: s.websiteUrl }),
      });
      if (res.text) setScrapePreview(res.text);
      else onToast('কোনো text পাওয়া যায়নি', 'error');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setScraping(false); }
  };

  const saveKnowledge = async () => {
    setKnowledgeSaving(true);
    try {
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify({ knowledgeText: s.knowledgeText }) });
      onToast('✓ AI Knowledge saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setKnowledgeSaving(false); }
  };

  const savePersona = async () => {
    setPersonaSaving(true);
    try {
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify({ customPersonaPrompt: s.customPersonaPrompt }) });
      onToast('✓ Bot Personality saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPersonaSaving(false); }
  };

  const saveBehavior = async () => {
    setBehaviorSaving(true);
    try {
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify({ behaviorInstructions: s.behaviorInstructions }) });
      onToast('✓ Behavior Instructions saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setBehaviorSaving(false); }
  };

  const savePrompt = async () => {
    setPromptSaving(true);
    try {
      await request(`${BASE}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ promptMode: s.promptMode, customSystemPrompt: s.customSystemPrompt }),
      });
      onToast('✓ Custom Prompt saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPromptSaving(false); }
  };

  const reconnectPage = async () => {
    if (!reconnectToken.trim()) { onToast(copy('নতুন Page Access Token দিন', 'Enter the new Page Access Token'), 'error'); return; }
    setReconnectBusy(true);
    try {
      const res = await request<any>(`${API_BASE}/page/${pageId}/reconnect`, {
        method: 'PATCH',
        body: JSON.stringify({ newPageToken: reconnectToken.trim() }),
      });
      onToast(`✅ ${copy('Page পরিবর্তন হয়েছে', 'Page reconnected')}: ${res?.page?.pageName || ''}`);
      setShowReconnectModal(false);
      setReconnectToken('');
      load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setReconnectBusy(false); }
  };

  const submitReconnectRequest = async () => {
    if (!reconnectReqPageUrl.trim()) { onToast(copy('Facebook Page link দিন', 'Enter your Facebook Page link'), 'error'); return; }
    if (!reconnectReqFbProfile.trim()) { onToast(copy('আপনার Facebook profile link দিন', 'Enter your Facebook profile link'), 'error'); return; }
    setReconnectReqBusy(true);
    try {
      await request(`${API_BASE}/facebook/page-request`, {
        method: 'POST',
        body: JSON.stringify({ pageUrl: reconnectReqPageUrl.trim(), fbProfile: reconnectReqFbProfile.trim(), note: reconnectReqNote.trim() || undefined }),
      });
      setReconnectReqSubmitted(true);
      onToast(copy('✅ Request submit হয়েছে!', '✅ Request submitted!'));
    } catch (e: any) {
      onToast(e.message || copy('Submit করা যায়নি', 'Submit failed'), 'error');
    } finally {
      setReconnectReqBusy(false);
    }
  };

  const saveWhatsApp = async () => {
    setWaSaving(true);
    try {
      const body: any = {
        waEnabled: s.waEnabled,
        waPhoneNumberId: s.waPhoneNumberId.trim(),
        waVerifyToken: s.waVerifyToken.trim(),
        waFallbackTemplateName: s.waFallbackTemplateName.trim(),
      };
      if (waToken.trim()) body.waToken = waToken.trim();
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
      onToast('✅ WhatsApp settings saved');
      setWaToken('');
      load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setWaSaving(false); }
  };

  const loadWaRequests = useCallback(async () => {
    try {
      const all = await request<any[]>(`${API_BASE}/whatsapp/connect-request/my`);
      setWaRequests((all || []).filter(r => r.pageId === pageId));
    } catch { /* ignore */ }
  }, [pageId]);

  useEffect(() => { loadWaRequests(); }, [loadWaRequests]);

  const submitWaConnectRequest = async () => {
    if (!waReqPhone.trim()) { onToast(copy('WhatsApp নম্বর দিন', 'Enter a WhatsApp number'), 'error'); return; }
    setWaReqBusy(true);
    try {
      await request(`${API_BASE}/whatsapp/connect-request`, {
        method: 'POST',
        body: JSON.stringify({ pageId, phoneNumber: waReqPhone.trim(), note: waReqNote.trim() || undefined }),
      });
      onToast(copy('✅ Request পাঠানো হয়েছে — শীঘ্রই connect করে দেওয়া হবে', '✅ Request sent — we\'ll connect it shortly'));
      setWaReqPhone(''); setWaReqNote('');
      loadWaRequests();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setWaReqBusy(false); }
  };

  const saveTelegram = async () => {
    setTgSaving(true);
    try {
      const body: any = {
        telegramNotifEnabled: s.telegramNotifEnabled,
        telegramChatId: s.telegramChatId.trim(),
      };
      if (tgToken.trim()) body.telegramBotToken = tgToken.trim();
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
      onToast(copy('✅ Telegram settings সেভ হয়েছে', '✅ Telegram settings saved'));
      setTgToken('');
      load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setTgSaving(false); }
  };

  const testTelegram = async () => {
    const token = tgToken.trim();
    const chatId = s.telegramChatId.trim();
    if (!token || !chatId) {
      onToast(copy('Token এবং Chat ID দিন', 'Enter token and Chat ID first'), 'error');
      return;
    }
    setTgTesting(true);
    try {
      const res = await request<{ ok: boolean; error?: string }>(`${API_BASE}/telegram/test`, {
        method: 'POST',
        body: JSON.stringify({ token, chatId }),
      });
      if (res.ok) onToast(copy('✅ Test message পাঠানো হয়েছে! Telegram চেক করুন', '✅ Test message sent! Check Telegram'));
      else onToast(res.error || copy('Test failed', 'Test failed'), 'error');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setTgTesting(false); }
  };

  const [tgFetching, setTgFetching] = useState(false);
  const fetchTelegramChatId = async () => {
    const token = tgToken.trim();
    if (!token) {
      onToast(copy('আগে Bot Token দিন', 'Enter Bot Token first'), 'error');
      return;
    }
    setTgFetching(true);
    try {
      const res = await request<{ ok: boolean; chatId?: string; error?: string }>(`${API_BASE}/telegram/fetch-chat-id`, {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (res.ok && res.chatId) {
        setS(prev => ({ ...prev, telegramChatId: res.chatId! }));
        onToast(copy(`✅ Chat ID পাওয়া গেছে: ${res.chatId}`, `✅ Chat ID found: ${res.chatId}`));
      } else {
        onToast(res.error || copy('Chat ID পাওয়া যায়নি। আপনার bot-কে একটি message পাঠান, তারপর আবার চেষ্টা করুন।', 'Chat ID not found. Send a message to your bot first, then try again.'), 'error');
      }
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setTgFetching(false); }
  };

  const saveCustomAreas = async (areas: string[]) => {
    setAreaSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/area-rules`, {
        method: 'PATCH',
        body: JSON.stringify({ clientCustomAreas: areas.map(a => ({ areaName: a, aliases: [] })) }),
      });
      onToast(copy('✅ এলাকার তালিকা সেভ হয়েছে', '✅ Area list saved'));
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setAreaSaving(false); }
  };

  const saveInstagram = async () => {
    setIgSaving(true);
    try {
      const body: any = {
        igEnabled: s.igEnabled,
        igBusinessAccountId: s.igBusinessAccountId.trim(),
        igVerifyToken: s.igVerifyToken.trim(),
        igCommentToDmEnabled: s.igCommentToDmEnabled,
      };
      if (igToken.trim()) body.igToken = igToken.trim();
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
      onToast('✅ Instagram settings saved');
      setIgToken('');
      load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setIgSaving(false); }
  };

  const unlinkPage = async (linkedPageId: number) => {
    if (!window.confirm(copy('এই page টি unlink করলে এটি নিজের settings/products পাবে না — standalone হয়ে যাবে। Continue?', 'This page will become standalone and lose access to shared settings/products. Continue?'))) return;
    setUnlinkingId(linkedPageId);
    try {
      await request(`${API_BASE}/page/${linkedPageId}/unlink`, { method: 'PATCH' });
      setLinkedPages(prev => prev.filter(p => p.id !== linkedPageId));
      onToast(copy('✓ Page unlink হয়েছে', '✓ Page unlinked'));
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setUnlinkingId(null); }
  };

  const saveMode = async (key: string, val: boolean) => {
    if (val && s.modeAccess?.[key] === false) {
      const msg = copy(
        'এই mode টি আপনার current plan-এ available না। এটি চালু করতে Admin-এর সাথে যোগাযোগ করে plan update করুন।',
        'This mode is not available on your current plan. Please contact the admin to upgrade your plan.',
      );
      window.alert(msg);
      onToast(msg, 'error');
      return;
    }
    setS(p => ({ ...p, [key]: val }));
    try {
      await request(`${BASE}/modes`, { method: 'PATCH', body: JSON.stringify({ [key]: val }) });
    } catch (e: any) { onToast(e.message, 'error'); setS(p => ({ ...p, [key]: !val })); }
  };

  const savePricing = async () => {
    setSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/pricing-policy`, { method: 'PATCH', body: JSON.stringify(s.pricingPolicy) });
      onToast('✓ Pricing policy saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveCall = async () => {
    setSaving(true);
    try {
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify({ callSettings: s.callSettings }) });
      onToast('✅ Call settings saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveVoice = async (showToast = true) => {
    if (showToast) setSaving(true);
    try {
      await request(`${BASE}/settings`, { method: 'PATCH', body: JSON.stringify({ voiceSettings: s.voiceSettings }) });
      if (showToast) onToast('✅ Voice settings saved');
    } catch (e: any) { if (showToast) onToast(e.message, 'error'); }
    finally { if (showToast) setSaving(false); }
  };

  const generateVoice = async (lang: 'BN' | 'EN') => {
    // Save latest script to DB first so generate uses updated text
    await saveVoice(false);
    setVoiceBusy(b => ({ ...b, [lang]: true }));
    try {
      const result = await request<any>(`${BASE}/voice/generate`, { method: 'POST', body: JSON.stringify({ language: lang }) });
      if (result?.success === false) {
        onToast(result.message || 'Voice generation failed', 'error');
      } else {
        onToast(copy(`✅ ${lang === 'BN' ? 'বাংলা' : 'English'} voice তৈরি হয়েছে!`, `✅ ${lang === 'BN' ? 'Bangla' : 'English'} voice generated!`), 'success');
        void load();
      }
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setVoiceBusy(b => ({ ...b, [lang]: false })); }
  };

  const uploadVoice = async (lang: 'BN' | 'EN', file?: File | null) => {
    if (!file) return;
    setVoiceBusy(b => ({ ...b, [lang]: true }));
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const form = new FormData();
      form.append('language', lang);
      form.append('file', file);
      const res = await fetch(`${BASE}/voice/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try { message = JSON.parse(text)?.message || text; } catch {}
        throw new Error(message || `HTTP ${res.status}`);
      }
      const result = await res.json();
      if (result?.success === false) {
        onToast(result.message || 'Voice upload failed', 'error');
      } else {
        onToast(copy(`✅ ${lang === 'BN' ? 'বাংলা' : 'English'} voice upload হয়েছে!`, `✅ ${lang === 'BN' ? 'Bangla' : 'English'} voice uploaded!`), 'success');
        void load();
      }
    } catch (e: any) {
      onToast(e.message, 'error');
    } finally {
      setVoiceBusy(b => ({ ...b, [lang]: false }));
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Spinner size={22} color={th.accent}/>
    </div>
  );

  const inp = { ...th.input };
  const showPlanUpgradePopup = () => {
    const msg = copy(
      'এই mode টি আপনার current plan-এ locked আছে। এটি চালু করতে Admin-এর সাথে যোগাযোগ করে plan update করুন।',
      'This mode is locked on your current plan. Please contact the admin to upgrade your plan.',
    );
    window.alert(msg);
    onToast(msg, 'error');
  };

  // ── SETTINGS_BUSINESS ────────────────────────────────────────────────────
  if (tab === 'SETTINGS_BUSINESS') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, ...cssVars }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>🏪 Business</h1>
        <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('ব্যবসার তথ্য, ক্যাটালগ ও Facebook সংযোগ', 'Business info, catalog and Facebook connection')}</p>
      </div>

      {/* Facebook Access Token Tutorial — shown only when admin has set a URL */}
      {(() => {
        const ytId = extractYouTubeId(fbTutorialUrl);
        if (!ytId) return null;
        return (
          <div style={{ ...th.card, marginBottom: 24 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              📺 How to get your Facebook Access Token
            </div>
            <div style={{ borderRadius: 12, overflow: 'hidden', aspectRatio: '16/9', maxWidth: 480, background: '#000', marginBottom: 10 }}>
              <iframe
                src={`https://www.youtube.com/embed/${ytId}`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen title="Facebook Access Token tutorial"
              />
            </div>
            <div style={{ fontSize: 12, color: th.muted }}>
              {copy('👆 Facebook Page connect করার আগে এই video দেখুন — Access Token কোথায় পাবেন বুঝতে পারবেন।', '👆 Watch this video before connecting your Facebook Page to learn where to find the Access Token.')}
            </div>
          </div>
        );
      })()}

      <div style={{ ...th.card }}>
        {/* Business Info */}
        <Section title="Business Information" desc="Your business details shown on invoices and memos">
          <Grid>
            <div>
              <Label text="Business Name" hint={copy('Memo এবং invoice এ দেখাবে', 'Shown on memos and invoices')}/>
              <input style={inp} value={s.businessName} onChange={e => setS(p => ({ ...p, businessName: e.target.value }))} placeholder="My Shop"/>
            </div>
            <div>
              <Label text="Phone" hint="Contact number"/>
              <input style={inp} value={s.businessPhone} onChange={e => setS(p => ({ ...p, businessPhone: e.target.value }))} placeholder="01700000000"/>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Label text="Address"/>
              <input style={inp} value={s.businessAddress} onChange={e => setS(p => ({ ...p, businessAddress: e.target.value }))} placeholder="Dhaka, Bangladesh"/>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Label text="Website / Store Link" hint={copy('আপনার নিজের website/store link থাকলে bot catalog এর বদলে এই link পাঠাবে', 'If you already have your own website/store, the bot will send this instead of the hosted catalog link')}/>
              <input
                style={inp}
                value={s.websiteUrl}
                onChange={e => setS(p => ({ ...p, websiteUrl: e.target.value }))}
                placeholder="https://yourstore.com"
              />
              <div style={{ fontSize: 11.5, color: th.muted, marginTop: 5 }}>
                {copy('খালি রাখলে bot আপনার FlamboyAI catalog link পাঠাবে।', 'Leave empty to use your FlamboyAI hosted catalog link.')}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Label text="🌐 Website URL Slug" hint={copy('আপনার website-এর সুন্দর URL — যেমন: limon-tech-diary → /catalog/limon-tech-diary', 'Your website friendly URL, for example: limon-tech-diary -> /catalog/limon-tech-diary')}/>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: th.muted, pointerEvents: 'none' }}>
                    /catalog/
                  </span>
                  <input style={{ ...inp, paddingLeft: 72 }}
                    value={s.catalogSlug}
                    onChange={e => setS(p => ({ ...p, catalogSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') }))}
                    placeholder="your-shop-name"
                  />
                </div>
                <button style={{ ...th.btnGhost, whiteSpace: 'nowrap', fontSize: 12 }}
                  onClick={() => {
                    const raw = (s.businessName || '').toLowerCase().replace(/[^\w\s-]/g,'').replace(/[\s_]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
                    setS(p => ({ ...p, catalogSlug: raw }));
                  }}>
                  {copy('✨ Auto', '✨ Auto')}
                </button>
              </div>
              {s.catalogSlug && (
                <div style={{ fontSize: 11.5, color: th.accent, marginTop: 5, fontFamily: 'monospace' }}>
                  {API_BASE}/catalog/{s.catalogSlug}
                </div>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Label text="🔗 Catalog Page Link" hint={copy(`Catalog এ 'Order করুন' button এ এই link যাবে — Facebook page, Messenger বা WhatsApp link দিন`, `This link will open when customers click the 'Order Now' button in the catalog - use a Facebook page, Messenger, or WhatsApp link`)}/>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inp, flex: 1 }} value={s.catalogMessengerUrl}
                  onChange={e => setS(p => ({ ...p, catalogMessengerUrl: e.target.value }))}
                  placeholder={copy('https://m.me/your-page  বা  https://wa.me/8801700000000', 'https://m.me/your-page or https://wa.me/8801700000000')}/>
                {(s as any).fbPageId && (
                  <button style={{ ...th.btnGhost, whiteSpace: 'nowrap', fontSize: 12 }}
                    onClick={() => setS(p => ({ ...p, catalogMessengerUrl: `https://m.me/${(s as any).fbPageId}` }))}>
                    {copy('✨ Auto', '✨ Auto')}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: th.muted, marginTop: 5 }}>
                {(s as any).fbPageId
                  ? copy(`Auto বাটনে click করলে https://m.me/${(s as any).fbPageId} set হবে`, `Click Auto to set https://m.me/${(s as any).fbPageId}`)
                  : copy('খালি রাখলে Facebook Messenger auto-detect হবে', 'Leave this empty to auto-detect Facebook Messenger')}
              </div>
            </div>
          </Grid>
        </Section>

        {/* Branding */}
        <Section title="Branding" desc="Currency, labels, and product code format">
          <Grid cols={3}>
            <div>
              <Label text="Currency Symbol" hint={copy('যেমন: ৳, $, £', 'For example: ৳, $, £')}/>
              <input style={inp} value={s.currencySymbol} maxLength={4}
                onChange={e => setS(p => ({ ...p, currencySymbol: e.target.value }))}/>
            </div>
            <div>
              <Label text="COD Label" hint="Cash on delivery label"/>
              <input style={inp} value={s.codLabel}
                onChange={e => setS(p => ({ ...p, codLabel: e.target.value }))}/>
            </div>
            <div>
              <Label text="Product Code Prefix" hint={copy('যেমন: DF → DF-0001, SK → SK-0001', 'For example: DF -> DF-0001, SK -> SK-0001')}/>
              <input style={{ ...inp, textTransform: 'uppercase' }} value={s.productCodePrefix} maxLength={10} placeholder="DF"
                onChange={e => setS(p => ({ ...p, productCodePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'') }))}/>
              <div style={{ fontSize: 11.5, color: th.muted, marginTop: 5 }}>
                Preview: <code style={{ background: th.accentSoft, color: th.accentText, padding: '1px 7px', borderRadius: 5, fontSize: 11 }}>
                  {(s.productCodePrefix||'DF')}-0001
                </code>
              </div>
            </div>
          </Grid>
        </Section>

        {/* ── Facebook Connection ── */}
        <Section title={copy('Facebook Connection', 'Facebook Connection')} desc={copy('Connected page পরিবর্তন করুন — settings ও products অক্ষুণ্ণ থাকবে', 'Change the connected Facebook page while keeping all settings & products intact')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {(s as any).pageName || copy('(নাম জানা নেই)', '(unknown)')}
              </div>
              <div style={{ fontSize: 11.5, color: th.muted }}>
                FB Page ID: {(s as any).fbPageId || '—'}
              </div>
            </div>
            <button
              onClick={() => { setReconnectToken(''); setReconnectTab('request'); setReconnectReqSubmitted(false); setReconnectReqPageUrl(''); setReconnectReqFbProfile(''); setReconnectReqNote(''); setShowReconnectModal(true); }}
              style={{ ...th.btnGhost, whiteSpace: 'nowrap', fontSize: 12 }}
            >
              🔄 {copy('Change FB Page', 'Change FB Page')}
            </button>
          </div>
          {showReconnectModal && (
            <div style={{ marginTop: 14, borderRadius: 14, border: `1px solid ${th.borderMd}`, background: th.surface, overflow: 'hidden' }}>
              {/* Tab bar — 2 tabs: Request first (Recommended), Access Token second */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${th.border}` }}>
                {(['request', 'manual'] as const).map(t => {
                  const labels: Record<string, string> = {
                    request: copy('📋 Request Access', '📋 Request Access'),
                    manual: copy('🔑 Access Token', '🔑 Access Token'),
                  };
                  return (
                    <div key={t} style={{ position: 'relative' }}>
                      <button onClick={() => setReconnectTab(t)} style={{
                        width: '100%', padding: '10px 6px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', borderBottom: `2px solid ${reconnectTab === t ? th.accent : 'transparent'}`,
                        background: reconnectTab === t ? th.accentSoft : 'transparent',
                        color: reconnectTab === t ? th.accentText : th.muted,
                        transition: 'all .15s',
                      }}>{labels[t]}</button>
                      {t === 'request' && (
                        <span style={{ position: 'absolute', top: 4, right: 8, background: '#22c55e', color: '#fff', fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 20, letterSpacing: '0.04em', pointerEvents: 'none' }}>
                          {copy('প্রস্তাবিত', 'Recommended')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: th.muted }}>
                  {copy('সব settings, products ও bot training অক্ষুণ্ণ থাকবে।', 'All settings, products, and bot training will be preserved.')}
                </div>

                {/* ── Request tab ── */}
                {reconnectTab === 'request' && (
                  <>
                    <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.28)', borderRadius: 10, padding: '11px 14px', fontSize: 12.5, color: th.text, lineHeight: 1.9 }}>
                      📋 <strong>{copy('কীভাবে কাজ করে?', 'How does this work?')}</strong><br />
                      <span style={{ color: th.muted }}>
                        {copy('১. নিচের form পূরণ করুন — আপনার Facebook page link ও profile link দিন', '1. Fill the form below with your Facebook page & profile links')}<br />
                        {copy('২. Admin আপনাকে Facebook App-এ Tester হিসেবে add করবে', '2. Admin will add you as a Tester in the Facebook App')}<br />
                        {copy('৩. Facebook থেকে invite notification আসবে — Accept করুন', '3. You will get an invite notification on Facebook — Accept it')}<br />
                        {copy('৪. Accepted হলে "Access Token" tab থেকে page connect করুন', '4. After accepting, use the "Access Token" tab to connect your page')}
                      </span>
                    </div>
                    {reconnectReqSubmitted ? (
                      <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#16a34a', fontWeight: 700, textAlign: 'center' }}>
                        ✅ {copy('Request submit হয়েছে! Admin review করে approve করবে।', 'Request submitted! Admin will review and approve.')}
                      </div>
                    ) : (
                      <>
                        <div>
                          <label style={{ fontSize: 12, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            {copy('Facebook Page Link *', 'Facebook Page Link *')}
                          </label>
                          <input style={{ ...inp }} value={reconnectReqPageUrl} onChange={e => setReconnectReqPageUrl(e.target.value)}
                            placeholder="https://facebook.com/yourpage" />
                        </div>
                        <div>
                          <label style={{ fontSize: 12, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            {copy('আপনার Facebook Profile Link *', 'Your Facebook Profile Link *')}
                          </label>
                          <input style={{ ...inp }} value={reconnectReqFbProfile} onChange={e => setReconnectReqFbProfile(e.target.value)}
                            placeholder="https://facebook.com/yourprofile" />
                        </div>
                        <div>
                          <label style={{ fontSize: 12, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            {copy('Note (optional)', 'Note (optional)')}
                          </label>
                          <textarea style={{ ...inp, resize: 'vertical', minHeight: 56, lineHeight: 1.5 }}
                            value={reconnectReqNote} onChange={e => setReconnectReqNote(e.target.value)}
                            placeholder={copy('অতিরিক্ত কিছু জানাতে চাইলে লিখুন...', 'Any additional info for the admin...')} />
                        </div>
                        <button onClick={submitReconnectRequest} disabled={reconnectReqBusy}
                          style={{ ...th.btnPrimary, width: '100%', justifyContent: 'center', opacity: reconnectReqBusy ? 0.6 : 1 }}>
                          {reconnectReqBusy ? <><Spinner size={13} /> {copy('Submitting...', 'Submitting...')}</> : copy('📤 Request Submit করুন', 'Submit Request')}
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* ── Access Token (manual) tab ── */}
                {reconnectTab === 'manual' && (
                  <>
                    <div style={{ background: th.accentSoft, border: `1px solid rgba(99,102,241,0.2)`, borderRadius: 10, padding: '12px 14px', fontSize: 12, color: th.text, lineHeight: 1.85, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontWeight: 800, color: th.accent }}>📌 {copy('কিভাবে Page Access Token পাবেন?', 'How to get a Page Access Token?')}</div>
                      <div style={{ color: th.muted }}>
                        {copy('১. ', '1. ')} <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ color: th.accent }}>Graph API Explorer</a> {copy('খুলুন', '— open it')}<br />
                        {copy('২. "Meta App" dropdown থেকে আপনার App বেছে নিন। "User or Page" dropdown থেকে আপনার Page select করুন (User নয়, Page)।', '2. Select your App from "Meta App" dropdown. Select your Page (not User) from "User or Page" dropdown.')}<br />
                        {copy('৩. নিচের permissions একটি একটি করে add করুন:', '3. Add the following permissions one by one:')}
                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {['pages_messaging', 'pages_read_engagement', 'pages_manage_engagement', 'pages_manage_metadata', 'pages_show_list'].map(p => (
                            <code key={p} style={{ background: th.accentSoft, color: th.accent, padding: '2px 6px', borderRadius: 5, fontSize: 10.5, fontWeight: 700 }}>{p}</code>
                          ))}
                        </div>
                        {copy('৪. "Generate Access Token" click করুন → Facebook login করুন → সব permission allow করুন → token copy করুন।', '4. Click "Generate Access Token" → log in to Facebook → allow all permissions → copy the token.')}
                      </div>
                      <div style={{ fontSize: 11, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 7, padding: '6px 9px', color: th.text }}>
                        ✅ {copy('Token আমাদের system automatically long-lived (never-expiring)-এ convert করে নেবে।', 'Our system automatically converts the token to long-lived (never-expiring).')}
                      </div>
                    </div>

                    <textarea
                      style={{ ...inp, minHeight: 72, resize: 'vertical', lineHeight: 1.5 }}
                      placeholder="EAAxxxxxx..."
                      value={reconnectToken}
                      onChange={e => setReconnectToken(e.target.value)}
                    />
                    <button onClick={reconnectPage} disabled={reconnectBusy}
                      style={{ ...th.btnPrimary, width: '100%', justifyContent: 'center', opacity: reconnectBusy ? 0.6 : 1 }}>
                      {reconnectBusy ? <><Spinner size={13} /> {copy('Verifying...', 'Verifying...')}</> : copy('✓ Change Page', '✓ Change Page')}
                    </button>
                  </>
                )}

                <button onClick={() => setShowReconnectModal(false)} style={{ ...th.btnGhost, alignSelf: 'flex-start', fontSize: 12 }}>
                  {copy('বাতিল', 'Cancel')}
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* ── WhatsApp Connection ── */}
        <Section title="📱 WhatsApp Connection" desc="WhatsApp Business API দিয়ে automation চালু করুন — bot একইভাবে কাজ করবে">
          {!s.waTokenSet && (() => {
            const pending = waRequests.find(r => r.status === 'pending');
            const latest = waRequests[0];
            return (
              <div style={{ padding: 14, borderRadius: 12, background: th.surface, border: `1px solid ${th.border}`, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  {copy('✨ WhatsApp Automation চালু করতে চান?', '✨ Want WhatsApp automation?')}
                </div>
                <div style={{ fontSize: 12, color: th.muted, marginBottom: 12, lineHeight: 1.6 }}>
                  {copy('শুধু আপনার WhatsApp Business নম্বরটা দিন — বাকি সব (Meta setup, token) আমরা করে দিচ্ছি। আপনাকে কিছু করা লাগবে না, শুধু নম্বর verify করার সময় একটা OTP call/SMS আসবে।', 'Just give us your WhatsApp Business number — we handle all the Meta setup and tokens. You only need to confirm an OTP call/SMS when the number is verified.')}
                </div>

                {pending ? (
                  <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, background: th.bg, border: `1px solid ${th.border}` }}>
                    ⏳ {copy(`Request pending: ${pending.phoneNumber} — admin শীঘ্রই connect করে দেবে।`, `Request pending: ${pending.phoneNumber} — admin will connect it shortly.`)}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {latest?.status === 'rejected' && (
                      <div style={{ fontSize: 12, color: '#ef4444' }}>
                        ❌ {copy('আগের request reject হয়েছে', 'Previous request was rejected')}{latest.adminNote ? `: ${latest.adminNote}` : ''}
                      </div>
                    )}
                    <input
                      style={{ ...inp }}
                      placeholder={copy('WhatsApp নম্বর (যেমন 01712345678)', 'WhatsApp number (e.g. 01712345678)')}
                      value={waReqPhone}
                      onChange={e => setWaReqPhone(e.target.value)}
                    />
                    <input
                      style={{ ...inp }}
                      placeholder={copy('নোট (optional)', 'Note (optional)')}
                      value={waReqNote}
                      onChange={e => setWaReqNote(e.target.value)}
                    />
                    <button
                      onClick={submitWaConnectRequest}
                      disabled={waReqBusy}
                      style={{ ...th.btnPrimary, opacity: waReqBusy ? 0.6 : 1, alignSelf: 'flex-start' }}
                    >
                      {waReqBusy ? <><Spinner size={13} /> {copy('পাঠানো হচ্ছে...', 'Sending...')}</> : copy('📲 Request পাঠান', '📲 Send request')}
                    </button>
                  </div>
                )}

                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 11.5, color: th.muted, cursor: 'pointer', userSelect: 'none' }}>
                    {copy('নিজে setup করতে চান? (Advanced)', 'Want to set it up yourself? (Advanced)')}
                  </summary>
                  <button
                    onClick={() => setWaManualSetup(true)}
                    style={{ ...th.btnGhost, fontSize: 11.5, marginTop: 8 }}
                  >
                    {copy('Manual token entry দেখান', 'Show manual token entry')}
                  </button>
                </details>
              </div>
            );
          })()}
          {(s.waTokenSet || waManualSetup) && <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>WhatsApp Automation</div>
              <div style={{ fontSize: 11.5, color: th.muted }}>
                {s.waTokenSet
                  ? (s.waPhoneNumberId ? `Phone Number ID: ${s.waPhoneNumberId}` : 'Token saved — Phone Number ID নেই')
                  : 'এখনো connect করা হয়নি'}
              </div>
            </div>
            <Toggle
              th={th}
              checked={s.waEnabled}
              onChange={v => setS(prev => ({ ...prev, waEnabled: v }))}
              label=""
            />
          </div>

          {s.waEnabled && <><details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', color: th.accent, userSelect: 'none', marginBottom: 6 }}>
              📋 {copy('কিভাবে WhatsApp token পাবেন? (ধাপে ধাপে)', 'How to get WhatsApp token? (Step by step)')}
            </summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                copy('১. developers.facebook.com → আপনার App-এ যান → বাম sidebar: "Add Product" → "WhatsApp" → "Set Up" click করুন', '1. Go to developers.facebook.com → your App → left sidebar: "Add Product" → "WhatsApp" → click "Set Up"'),
                copy('২. App → WhatsApp → "Getting Started" → "From" section-এ Phone Number ID দেখাবে → Copy করুন → নিচের "Phone Number ID" field-এ paste করুন', '2. App → WhatsApp → "Getting Started" → find Phone Number ID in the "From" section → Copy it → paste in the "Phone Number ID" field below'),
                copy('৩. business.facebook.com → Settings (গিয়ার আইকন) → Users → System Users → "Add" click করুন → নাম দিন, Role: "Admin" → তৈরি করুন', '3. Go to business.facebook.com → Settings (gear icon) → Users → System Users → click "Add" → enter a name, Role: "Admin" → create'),
                copy('৪. তৈরি System User-এ click করুন → "Add Assets" → "Pages" → customer-এর Page select করুন → "Manage Page" toggle ON করুন → Save করুন', '4. Click the created System User → "Add Assets" → "Pages" → select the customer\'s Page → turn ON "Manage Page" → Save'),
                copy('৫. System User-এ "Generate New Token" click করুন → আপনার App select করুন → নিচের permission যোগ করুন: whatsapp_business_messaging, whatsapp_business_management, pages_messaging', '5. Click "Generate New Token" on the System User → select your App → add these permissions: whatsapp_business_messaging, whatsapp_business_management, pages_messaging'),
                copy('৬. "Generate Token" click করুন → Token copy করুন (EAAxxxxx... দিয়ে শুরু) → নিচের "Access Token" field-এ paste করুন', '6. Click "Generate Token" → Copy the token (starts with EAAxxxxx...) → paste in the "Access Token" field below'),
                copy('৭. নিচে "🔀 Generate" click করে Webhook Verify Token তৈরি করুন → copy করে রাখুন', '7. Click "🔀 Generate" below to create a Webhook Verify Token → keep a copy of it'),
                copy('৮. developers.facebook.com → App → বাম sidebar: "Webhooks" click করুন → "Select product" dropdown থেকে "WhatsApp Business Account" select করুন → Callback URL দিন (নিচে দেখুন) + Verify Token দিন → "Verify and save" → নিচে "messages" field-এ "Subscribe" করুন', '8. developers.facebook.com → App → left sidebar: click "Webhooks" → from "Select product" dropdown choose "WhatsApp Business Account" → enter Callback URL (see below) + Verify Token → "Verify and save" → click "Subscribe" next to the "messages" field below'),
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}` }}>
                  <span style={{ color: th.accent, flexShrink: 0 }}>→</span>
                  <span style={{ color: th.text, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </div>
          </details>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Phone Number ID
              </label>
              <input
                style={{ ...inp }}
                placeholder="123456789012345"
                value={s.waPhoneNumberId}
                onChange={e => setS(prev => ({ ...prev, waPhoneNumberId: e.target.value }))}
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 3 }}>
                Meta Developer Console → WhatsApp → Phone Numbers
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Access Token {s.waTokenSet && <span style={{ color: '#22c55e', fontWeight: 400 }}>✓ saved</span>}
              </label>
              <input
                type="password"
                style={{ ...inp }}
                placeholder={s.waTokenSet ? '••••••• (পরিবর্তন করতে নতুন token দিন)' : 'EAAxxxxxx...'}
                value={waToken}
                onChange={e => setWaToken(e.target.value)}
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 3 }}>
                Meta Business Manager → System User Token (whatsapp_business_messaging permission)
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Webhook Verify Token
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...inp, flex: 1 }}
                  placeholder="my-secret-verify-token"
                  value={s.waVerifyToken}
                  onChange={e => setS(prev => ({ ...prev, waVerifyToken: e.target.value }))}
                />
                <button
                  onClick={() => {
                    const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
                    setS(prev => ({ ...prev, waVerifyToken: rand }));
                  }}
                  style={{ ...th.btnGhost, fontSize: 11, whiteSpace: 'nowrap' }}
                >
                  🔀 Generate
                </button>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Fallback Template Name <span style={{ color: th.muted, fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                style={{ ...inp }}
                placeholder="e.g. hello_world"
                value={s.waFallbackTemplateName}
                onChange={e => setS(prev => ({ ...prev, waFallbackTemplateName: e.target.value }))}
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                {copy('24h window expire হলে এই approved template দিয়ে message পাঠাবে। Meta Business Manager-এ আগে approve করাতে হবে।', 'Used when the 24h messaging window expires. Must be pre-approved in Meta Business Manager.')}
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 10, background: th.surface, border: `1px solid ${th.border}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>📋 Webhook URL (Meta Console-এ দিন)</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: th.accent, wordBreak: 'break-all' }}>
                {`${(typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':3000').replace('app.flamboyai.com', 'api.flamboyai.com') : 'https://api.flamboyai.com')}/wa-webhook`}
              </div>
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                Meta App → Webhook → Edit → এই URL দিন, Verify Token-ও দিন
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              onClick={saveWhatsApp}
              disabled={waSaving}
              style={{ ...th.btnPrimary, opacity: waSaving ? 0.6 : 1 }}
            >
              {waSaving ? <><Spinner size={13} /> Saving...</> : '💾 WhatsApp Save করুন'}
            </button>
          </div></>}
          </>}
        </Section>


        {/* ── Instagram Connection ── */}
        <Section title="📸 Instagram Connection" desc="Instagram Business API দিয়ে DM ও post comment automation চালু করুন">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Instagram Automation</div>
              <div style={{ fontSize: 11.5, color: th.muted }}>
                {s.igTokenSet
                  ? (s.igBusinessAccountId ? `IG Account ID: ${s.igBusinessAccountId}` : 'Token saved — IG Account ID নেই')
                  : 'এখনো connect করা হয়নি'}
              </div>
            </div>
            <Toggle
              th={th}
              checked={s.igEnabled}
              onChange={v => setS(prev => ({ ...prev, igEnabled: v }))}
              label=""
            />
          </div>

          {s.igEnabled && <>{/* Step-by-step guide */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', color: th.accent, userSelect: 'none', marginBottom: 6 }}>
              📋 {copy('কিভাবে Instagram token পাবেন? (ধাপে ধাপে)', 'How to get Instagram token? (Step by step)')}
            </summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Step 1: Link Instagram to Facebook Page */}
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: `1px solid rgba(99,102,241,0.25)` }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: th.accent }}>
                  🔗 {copy('ধাপ ১ — Instagram-কে Facebook Page-এর সাথে link করুন (আগে থেকে না থাকলে)', 'Step 1 — Link Instagram to your Facebook Page (if not already linked)')}
                </div>
                {[
                  copy('ক. Instagram app → Profile → ☰ → Settings and privacy → "Account type and tools" → "Switch to Professional Account" → Business বা Creator select করুন', 'a. Instagram app → Profile → ☰ → Settings and privacy → "Account type and tools" → "Switch to Professional Account" → select Business or Creator'),
                  copy('খ. Settings → Account → "Linked accounts" → Facebook → আপনার Facebook account দিয়ে login করুন → customer-এর Facebook Page select করুন (যেটি FlamboyAI-এ connected)', 'b. Settings → Account → "Linked accounts" → Facebook → log in with the Facebook account → select the customer\'s Facebook Page (the one connected in FlamboyAI)'),
                  copy('গ. Instagram Profile → Edit Profile → "Page" section-এ Page-এর নাম দেখাবে — link confirm', 'c. Instagram Profile → Edit Profile → the Page name will appear in the "Page" section — link confirmed'),
                ].map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '5px 0', borderBottom: i < 2 ? `1px solid rgba(99,102,241,0.1)` : 'none' }}>
                    <span style={{ color: th.accent, flexShrink: 0 }}>•</span>
                    <span style={{ color: th.text, lineHeight: 1.5 }}>{step}</span>
                  </div>
                ))}
              </div>

              {[
                copy('১. developers.facebook.com → আপনার App → বাম sidebar: "Add Product" → "Instagram" → "Set Up" click করুন ("Instagram Basic Display" নয়, "Instagram" Graph API বেছে নিন)', '1. developers.facebook.com → your App → left sidebar: "Add Product" → "Instagram" → click "Set Up" (choose "Instagram" Graph API, NOT "Instagram Basic Display")'),
                copy('২. Instagram Business Account ID পেতে: developers.facebook.com/tools/explorer → আপনার App ও IG-linked Page select → query field-এ লিখুন: /me?fields=instagram_business_account → Submit করুন → result-এ "id" value copy করুন → নিচের "Business Account ID" field-এ paste করুন', '2. To get Instagram Business Account ID: developers.facebook.com/tools/explorer → select your App & IG-linked Page → type: /me?fields=instagram_business_account → Submit → copy the "id" from the result → paste in the "Business Account ID" field below'),
                copy('৩. Access Token-এর জন্য: business.facebook.com → Settings → Users → System Users → WhatsApp-এ তৈরি একই System User-এ click করুন (বা নতুন তৈরি করুন)', '3. For Access Token: business.facebook.com → Settings → Users → System Users → click the same System User you created for WhatsApp (or create a new one)'),
                copy('৪. System User → "Add Assets" → Pages → customer-এর Page select → "Manage Page" ON → Save করুন', '4. System User → "Add Assets" → Pages → select customer\'s Page → turn ON "Manage Page" → Save'),
                copy('৫. "Generate New Token" → আপনার App select → নিচের permissions যোগ করুন: instagram_basic, instagram_manage_messages, instagram_manage_comments, pages_messaging, pages_read_engagement → "Generate Token"', '5. "Generate New Token" → select your App → add permissions: instagram_basic, instagram_manage_messages, instagram_manage_comments, pages_messaging, pages_read_engagement → "Generate Token"'),
                copy('৬. Token copy করুন (EAAxxxxx...) → নিচের "Access Token" field-এ paste করুন', '6. Copy the token (EAAxxxxx...) → paste in the "Access Token" field below'),
                copy('৭. নিচে "Generate" click করে Webhook Verify Token তৈরি করুন', '7. Click "Generate" below to create a Webhook Verify Token'),
                copy('৮. developers.facebook.com → App → বাম sidebar: "Webhooks" click করুন → "Select product" dropdown থেকে "Instagram" select করুন → Callback URL দিন + Verify Token দিন → "Verify and save" → "messages" ও "comments" field-এ "Subscribe" করুন', '8. developers.facebook.com → App → left sidebar: click "Webhooks" → from "Select product" dropdown choose "Instagram" → enter Callback URL + Verify Token → "Verify and save" → Subscribe to "messages" and "comments" fields'),
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}` }}>
                  <span style={{ color: th.accent, flexShrink: 0 }}>→</span>
                  <span style={{ color: th.text, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </div>
          </details>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                Instagram Business Account ID
              </label>
              <input
                style={th.input}
                value={s.igBusinessAccountId}
                onChange={e => setS(prev => ({ ...prev, igBusinessAccountId: e.target.value }))}
                placeholder="e.g. 17841400455057828"
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                Graph API Explorer → /me?fields=instagram_business_account → result-এ "id" value
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                Access Token {s.igTokenSet && <span style={{ color: '#22c55e', fontWeight: 400 }}>✓ saved</span>}
              </label>
              <input
                style={th.input}
                type="password"
                autoComplete="new-password"
                placeholder={s.igTokenSet ? '••••••• (পরিবর্তন করতে নতুন token দিন)' : 'EAAxxxxxx... (System User Token)'}
                value={igToken}
                onChange={e => setIgToken(e.target.value)}
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                business.facebook.com → System Users → Generate Token → instagram_basic + instagram_manage_messages + instagram_manage_comments
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                Webhook Verify Token
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...th.input, flex: 1 }}
                  value={s.igVerifyToken}
                  onChange={e => setS(prev => ({ ...prev, igVerifyToken: e.target.value }))}
                  placeholder="যেকোনো random string"
                />
                <button
                  onClick={() => {
                    const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
                    setS(prev => ({ ...prev, igVerifyToken: rand }));
                  }}
                  style={{ ...th.btnPrimary, whiteSpace: 'nowrap', fontSize: 12 }}
                >
                  Generate
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: th.surface, border: `1px solid ${th.border}` }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>💬 Comment-to-DM Automation</div>
                <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>
                  {copy('Post comment-এ product code বা order intent দেখলে automatically DM পাঠাবে।', 'Auto-sends DM when a product code or order intent is detected in post comments.')}
                </div>
              </div>
              <Toggle th={th} label="" checked={s.igCommentToDmEnabled} onChange={v => setS(prev => ({ ...prev, igCommentToDmEnabled: v }))} />
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 10, background: th.surface, border: `1px solid ${th.border}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>📋 Webhook URL (Meta Console-এ দিন)</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: th.accent, wordBreak: 'break-all' }}>
                {`${(typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':3000').replace('app.flamboyai.com', 'api.flamboyai.com') : 'https://api.flamboyai.com')}/ig-webhook`}
              </div>
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                Meta App → Instagram → Webhooks → এই URL দিন। Subscribe করুন: messages, comments
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              onClick={saveInstagram}
              disabled={igSaving}
              style={{ ...th.btnPrimary, opacity: igSaving ? 0.6 : 1 }}
            >
              {igSaving ? <><Spinner size={13} /> Saving...</> : '💾 Instagram Save করুন'}
            </button>
          </div></>}
        </Section>

        {/* ── Linked Pages ── */}
        <Section title={copy('Linked Pages', 'Linked Pages')} desc={copy('এই page এর settings ও products share করছে এমন pages', 'Pages that share this profile\'s settings and products')}>
          {linkedPages.length === 0 ? (
            <div style={{ fontSize: 12.5, color: th.muted, padding: '10px 0' }}>
              {copy('কোনো linked page নেই।', 'No linked pages yet.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {linkedPages.map(lp => (
                <div key={lp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px', borderRadius: 10, border: `1px solid ${th.border}`, background: th.surface }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15 }}>{lp.isActive ? '🔗' : '⏸️'}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{lp.pageName}</div>
                      <div style={{ fontSize: 11.5, color: th.muted }}>FB ID: {lp.pageId}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => unlinkPage(lp.id)}
                    disabled={unlinkingId === lp.id}
                    style={{ ...th.btnGhost, fontSize: 12, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', opacity: unlinkingId === lp.id ? 0.5 : 1 }}
                  >
                    {unlinkingId === lp.id ? copy('Unlinking...', 'Unlinking...') : copy('Unlink', 'Unlink')}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 12, color: th.muted }}>
            {copy('নতুন page link করতে "পেজ কানেক্ট" থেকে নতুন page add করুন এবং "Link to existing profile" option select করুন।', 'To add a linked page, go to "Connect Page", add a new page, and select "Link to existing profile".')}
          </div>
        </Section>

        <SaveRow onClick={() => save({
          businessName: s.businessName, businessPhone: s.businessPhone,
          businessAddress: s.businessAddress, websiteUrl: s.websiteUrl,
          catalogSlug: s.catalogSlug || null, catalogMessengerUrl: s.catalogMessengerUrl,
          currencySymbol: s.currencySymbol, codLabel: s.codLabel,
          productCodePrefix: s.productCodePrefix,
        })} saving={saving}/>
      </div>
    </div>
  );

  // ── SETTINGS_DELIVERY ──────────────────────────────────────────────────────
  if (tab === 'SETTINGS_DELIVERY') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, ...cssVars }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>🚀 Fulfillment</h1>
        <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('ডেলিভারি ফি, সময় ও পেমেন্ট পদ্ধতি', 'Delivery fees, time and payment method')}</p>
      </div>
      <div style={{ ...th.card }}>
        {/* Delivery */}
        <Section title="Delivery Settings" desc={copy('Bot এই settings থেকে পড়ে customer-কে delivery fee ও সময় বলে', 'Bot reads these to tell customers about delivery fees and time')}>
          {s.restaurantModeEnabled && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(5,150,105,.08)', border: '1px solid rgba(5,150,105,.35)', color: '#059669', fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
              🍕 {copy('Restaurant mode চালু — ঢাকার ভেতরে/বাইরে fee এই page-এ apply হচ্ছে না। Delivery charge আসছে Website tab-এর distance slab rate থেকে।', 'Restaurant mode is ON — inside/outside Dhaka fees do not apply to this page. Delivery charge comes from the distance slabs in the Website tab.')}
            </div>
          )}
          <div style={{ opacity: s.restaurantModeEnabled ? 0.45 : 1, pointerEvents: s.restaurantModeEnabled ? 'none' : 'auto' }}>
          <Grid cols={3}>
            <div>
              <Label text="Inside Dhaka (৳)" hint={copy('ঢাকার ভেতরে delivery fee', 'Delivery fee inside Dhaka')}/>
              <input style={inp} type="number" min={0} value={s.deliveryFeeInsideDhaka}
                onChange={e => setS(p => ({ ...p, deliveryFeeInsideDhaka: Number(e.target.value) }))}/>
            </div>
            <div>
              <Label text="Outside Dhaka (৳)" hint={copy('ঢাকার বাইরে delivery fee', 'Delivery fee outside Dhaka')}/>
              <input style={inp} type="number" min={0} value={s.deliveryFeeOutsideDhaka}
                onChange={e => setS(p => ({ ...p, deliveryFeeOutsideDhaka: Number(e.target.value) }))}/>
            </div>
            <div>
              <Label text={copy('Delivery Time — ঢাকার ভেতরে', 'Delivery Time — Inside Dhaka')} hint={copy('ঢাকার ভেতরে কতদিনে পৌঁছাবে — bot এটা বলবে। যেমন: ১-২ দিন', 'e.g. 1-2 days')}/>
              <input style={inp} value={s.deliveryTimeInsideDhaka} placeholder="যেমন: ১-২ কার্যদিবস"
                onChange={e => setS(p => ({ ...p, deliveryTimeInsideDhaka: e.target.value }))}/>
            </div>
            <div>
              <Label text={copy('Delivery Time — ঢাকার বাইরে', 'Delivery Time — Outside Dhaka')} hint={copy('ঢাকার বাইরে কতদিনে পৌঁছাবে — bot এটা বলবে। যেমন: ৩-৫ দিন', 'e.g. 3-5 days')}/>
              <input style={inp} value={s.deliveryTimeOutsideDhaka} placeholder="যেমন: ৩-৫ কার্যদিবস"
                onChange={e => setS(p => ({ ...p, deliveryTimeOutsideDhaka: e.target.value }))}/>
            </div>
          </Grid>
          </div>
        </Section>

        {/* Dhaka Zone Management */}
        <Section title={copy('ঢাকার ভেতরের এলাকা', 'Inside Dhaka Areas')} desc={copy('এই তালিকায় থাকা address গুলো "ঢাকার ভেতরে" ধরা হবে। বাকি সব outside Dhaka।', 'Addresses matching this list = inside Dhaka. Everything else = outside.')}>
          {/* Custom areas added by client */}
          {customAreas.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: th.accent, marginBottom: 6 }}>{copy('আপনার যোগ করা এলাকা', 'Your custom areas')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {customAreas.map((area, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: th.accentSoft, border: `1px solid ${th.accent}`, borderRadius: 20, padding: '3px 10px 3px 12px', fontSize: 12.5, color: th.accent }}>
                    {area}
                    <button onClick={() => { const u = customAreas.filter((_, j) => j !== i); setCustomAreas(u); saveCustomAreas(u); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.accent, fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add new area */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input style={{ ...inp, flex: 1 }} placeholder={copy('নতুন এলাকার নাম লিখুন (বাংলা বা English)', 'Type area name (Bengali or English)')}
              value={newArea} onChange={e => setNewArea(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newArea.trim()) { const u = [...customAreas, newArea.trim()]; setCustomAreas(u); setNewArea(''); saveCustomAreas(u); } }}
            />
            <button style={{ ...th.btnPrimary, padding: '8px 16px', whiteSpace: 'nowrap', opacity: areaSaving ? 0.6 : 1 }}
              onClick={() => { if (!newArea.trim()) return; const u = [...customAreas, newArea.trim()]; setCustomAreas(u); setNewArea(''); saveCustomAreas(u); }}>
              {areaSaving ? <Spinner size={13} /> : copy('+ যোগ করুন', '+ Add')}
            </button>
          </div>

          {/* Default whitelist — collapsible by zone */}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: th.muted, userSelect: 'none', marginBottom: 8 }}>
              {copy('▶ Default Dhaka এলাকার তালিকা দেখুন (এখানে না থাকলে উপরে add করুন)', '▶ View default Dhaka area list (add missing ones above)')}
            </summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {DHAKA_ZONES.map(zone => (
                <div key={zone.zone}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{zone.zone}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {zone.areas.map(area => {
                        return (
                        <span key={area} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: th.surface, border: `1px solid ${th.border}`, borderRadius: 16, padding: '2px 10px', fontSize: 12, color: th.text, opacity: 0.85 }}>
                          {area}
                          {!customAreas.some(c => c.toLowerCase() === area.toLowerCase()) && (
                            <button title={copy('Custom list-এ যোগ করুন', 'Add to custom list')}
                              onClick={() => { const u = [...customAreas, area]; setCustomAreas(u); saveCustomAreas(u); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.accent, fontSize: 13, lineHeight: 1, padding: 0 }}>+</button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </Section>

        {/* Payment Mode */}
        <Section title="Payment Mode" desc={copy('Bot কীভাবে payment নেবে order confirm করার আগে', 'How the bot will collect payment before confirming the order')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([
              { value: 'cod',             label: '💵 Full COD (Cash on Delivery)',        sub: copy('কোনো advance নেই — delivery-র সময় সম্পূর্ণ payment', 'No advance needed - full payment on delivery') },
              { value: 'advance_outside', label: '🔄 Advance + COD (Outside Dhaka)',       sub: copy('ঢাকার বাইরে হলে আগে advance নেবে, ভেতরে normal COD', 'Collect advance outside Dhaka, use normal COD inside Dhaka') },
              { value: 'full_advance',    label: '💳 Full Advance (সম্পূর্ণ অগ্রিম)',     sub: copy('সব order-এই আগে full payment — তারপর order confirm', 'Require full payment before confirming any order') },
            ] as const).map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${s.paymentMode === opt.value ? th.accent : th.border}`,
                background: s.paymentMode === opt.value ? th.accentSoft : th.surface }}>
                <input type="radio" name="paymentMode" value={opt.value} checked={s.paymentMode === opt.value}
                  onChange={() => setS(p => ({ ...p, paymentMode: opt.value }))}
                  style={{ accentColor: th.accent, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>{opt.sub}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <Toggle th={th}
              label={copy('COD চালু আছে', 'COD enabled')}
              sub={copy('বন্ধ করলে সব order-এই advance payment বাধ্যতামূলক হবে', 'If off, advance payment becomes mandatory for every order regardless of mode')}
              checked={s.codEnabled !== false}
              onChange={v => setS(p => ({ ...p, codEnabled: v }))} />
          </div>

          {/* Extra config for advance modes */}
          {s.paymentMode !== 'cod' && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Full Advance info note — no fixed amount needed */}
              {s.paymentMode === 'full_advance' ? (
                <div style={{ padding: '10px 14px', borderRadius: 9, background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <span style={{ fontSize: 12.5, color: '#166534', fontWeight: 600 }}>
                    ✅ {copy('Full Advance mode-এ bot প্রতিটা order-এর মোট দাম (product + delivery fee) automatically নেবে। আলাদা করে amount দেওয়ার দরকার নেই।', 'In Full Advance mode, the bot automatically collects the full order total (product price + delivery fee). No fixed amount needed.')}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
                  <div>
                    <Label text="Advance Amount (৳)" hint={copy('0 রাখলে delivery fee-ই advance হিসেবে নেবে। নির্দিষ্ট পরিমাণ দিলে সেটা নেবে। Customer advance দিতে অস্বীকার করলে order automatically cancel হবে।', 'Leave 0 to collect the delivery fee as advance. Enter a fixed amount to always collect that. If customer refuses to pay, order is automatically cancelled.')}/>
                    <input style={inp} type="number" min={0} value={s.advanceAmount || ''}
                      onChange={e => setS(p => ({ ...p, advanceAmount: Number(e.target.value) }))} placeholder="0 = delivery fee"/>
                    <div style={{ fontSize: 11, color: th.muted, marginTop: 3 }}>
                      {copy(`0 = Delivery fee (${s.paymentMode === 'advance_outside' ? 'Outside Dhaka fee' : 'full delivery fee'}) নেবে`, `0 = collects the delivery fee as advance`)}
                    </div>
                  </div>
                  <div>
                    <Label text="Advance Threshold (৳)" hint={copy('এই amount-এর বেশি order হলেই advance লাগবে। 0 রাখলে সবসময় advance rule apply হবে।', 'Only require advance when the order total exceeds this amount. Leave 0 to always apply the advance rule.')}/>
                    <input style={inp} type="number" min={0} value={s.advanceThresholdAmount || ''}
                      onChange={e => setS(p => ({ ...p, advanceThresholdAmount: Number(e.target.value) }))} placeholder="0 = always"/>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
              <div>
                <Label text="Bkash Number" hint={copy('Customer কে দেখানো হবে', 'Shown to customers')}/>
                <input style={inp} value={s.advanceBkash} placeholder="01XXXXXXXXX"
                  onChange={e => setS(p => ({ ...p, advanceBkash: e.target.value }))} />
              </div>
              <div>
                <Label text="Nagad Number" hint={copy('Customer কে দেখানো হবে', 'Shown to customers')}/>
                <input style={inp} value={s.advanceNagad} placeholder="01XXXXXXXXX"
                  onChange={e => setS(p => ({ ...p, advanceNagad: e.target.value }))} />
              </div>
              <div>
                <Label text="Rocket Number" hint={copy('Customer কে দেখানো হবে', 'Shown to customers')}/>
                <input style={inp} value={s.advanceRocket ?? ''} placeholder="01XXXXXXXXX"
                  onChange={e => setS(p => ({ ...p, advanceRocket: e.target.value }))} />
              </div>
            </div>
            </div>
          )}
          {s.paymentMode !== 'cod' && (
            <div style={{ marginTop: 14 }}>
              <Label text={copy('Advance Payment Message', 'Advance Payment Message')} hint={copy('Customer কে যে message যাবে। খালি রাখলে default message যাবে।', 'Message sent to customer when advance is needed. Leave empty for default.')}/>
              <textarea
                style={{ ...inp, minHeight: 100, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                value={s.advancePaymentMessage}
                placeholder={copy(
                  '💳 Advance Payment প্রয়োজন\nপরিমাণ: {{amount}}\nBkash: {{bkash}}\nNagad: {{nagad}}\n\nPayment করার পর Transaction ID পাঠান 💖',
                  '💳 Advance payment required\nAmount: {{amount}}\nBkash: {{bkash}}\nNagad: {{nagad}}\n\nSend Transaction ID after payment 💖'
                )}
                onChange={e => setS(p => ({ ...p, advancePaymentMessage: e.target.value }))}
              />
              <div style={{ fontSize: 11.5, color: th.muted, marginTop: 6, lineHeight: 1.7 }}>
                {copy('Available variables:', 'Available variables:')}{' '}
                {['{{amount}}', '{{bkash}}', '{{nagad}}', '{{currency}}'].map(v => (
                  <code key={v} style={{ background: th.accentSoft, color: th.accentText, padding: '1px 6px', borderRadius: 4, fontSize: 11, marginRight: 5 }}>{v}</code>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Payment Verification — 4 numbered modes */}
        <Section
          title={copy('💳 Payment Verification', '💳 Payment Verification')}
          desc={copy('কোন পদ্ধতিতে customer-এর payment verify হবে তা বেছে নিন। একটাই active থাকবে — বাকিগুলো fallback।', 'Choose how customer payments are verified. Only one is active at a time.')}
        >
          {(() => {
            // ── Color palette per mode ───────────────────────────────────────
            const MC = {
              sms:     { c: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.35)', light: 'rgba(139,92,246,0.06)' },
              direct:  { c: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', light: 'rgba(16,185,129,0.06)' },
              gateway: { c: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', light: 'rgba(59,130,246,0.06)' },
              manual:  { c: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  light: 'rgba(245,158,11,0.06)'  },
            } as Record<string, { c: string; bg: string; border: string; light: string }>;

            // ── Mode definitions ────────────────────────────────────────────
            const MODES = [
              {
                num: 1, key: 'sms', mck: 'sms', icon: '📲',
                title: copy('SMS Gateway', 'SMS Gateway'),
                subtitle: copy('Phone Verify', 'Phone Verify'),
                badge: copy('সবচেয়ে সহজ', 'Easiest'),
                feeLabel: '১%', feeDesc: copy('wallet থেকে প্রতি verify-এ', 'per verify from wallet'),
                works: copy('Personal + Merchant — bKash / Nagad / Rocket', 'Personal + Merchant — bKash / Nagad / Rocket'),
                flow: copy('Customer TxID দেয় → Bot আপনার phone SMS-এ match করে → Auto confirm ✅', 'Customer gives TxID → Bot matches phone SMS → Auto confirm ✅'),
                note: copy('কোনো merchant API লাগবে না। Android-এ SMS Forwarder app ইন্সটল করুন।', 'No merchant API needed. Install SMS Forwarder app on Android.'),
                accountingNote: copy('প্রতি verify-এ ১% fee wallet থেকে কাটবে → Accounting-এ "SMS Verify Fee" হিসেবে দেখাবে।', '1% fee per verify deducted from wallet → appears in Accounting as "SMS Verify Fee".'),
                fields: [],
              },
              {
                num: 2, key: 'direct_api', icon: '🔗',
                title: copy('Direct API (bKash/Nagad Merchant)', 'Direct API (bKash/Nagad Merchant)'),
                badge: copy('Merchant Account লাগবে', 'Requires Merchant Account'), badgeColor: '#059669',
                fee: copy('bKash: ~1.5% | Nagad: ~1.5% (gateway নিজে কাটে)', 'bKash: ~1.5% | Nagad: ~1.5% (charged by gateway)'),
                mck: 'direct',
                works: copy('শুধু bKash/Nagad Merchant Account', 'bKash/Nagad Merchant Account only'),
                flow: copy('Customer TxID দেয় → Bot API-তে verify করে → Auto confirm ✅', 'Customer gives TxID → Bot verifies via API → Auto confirm ✅'),
                note: copy('bKash বা Nagad merchant portal থেকে API credentials নিতে হবে।', 'Get API credentials from bKash or Nagad merchant portal.'),
                feeLabel: '~১.৫%', feeDesc: copy('gateway নিজে কাটে', 'charged by gateway'),
                accountingNote: copy('Payment fee bKash/Nagad নিজেই কাটে — আপনার wallet থেকে কিছু কাটে না।', 'Gateway fee is deducted by bKash/Nagad — nothing from your wallet.'),
                subModes: [
                  { key: 'bkash', icon: '📱', title: 'bKash Merchant', fee: '~১.৫%', fields: [
                    { key: 'app_key', label: 'App Key', ph: 'bKash App Key' },
                    { key: 'app_secret', label: 'App Secret', ph: 'bKash App Secret' },
                    { key: 'username', label: 'Username', ph: 'Merchant Portal Username' },
                    { key: 'password', label: 'Password', ph: 'Merchant Portal Password', secret: true },
                  ]},
                  { key: 'nagad', icon: '💰', title: 'Nagad Merchant', fee: '~১.৫%', fields: [
                    { key: 'merchant_id', label: 'Merchant ID', ph: 'Nagad Merchant ID' },
                    { key: 'api_key', label: 'API Key', ph: 'Nagad API Key', secret: true },
                  ]},
                ],
                fields: [],
              },
              {
                num: 3, key: 'gateway', mck: 'gateway', icon: '🌐',
                title: copy('Payment Gateway', 'Payment Gateway'),
                subtitle: copy('Link পাঠায়', 'Sends Payment Link'),
                badge: copy('সব method', 'All Methods'),
                feeLabel: '~২-২.৫%', feeDesc: copy('gateway নিজে কাটে', 'charged by gateway'),
                works: copy('bKash / Nagad / Rocket / Card / Bank', 'bKash / Nagad / Rocket / Card / Bank'),
                flow: copy('Bot link পাঠায় → Customer pay করে → Auto confirm ✅', 'Bot sends link → Customer pays → Auto confirm ✅'),
                note: copy('Gateway checkout page-এ নেয়। Customer TxID দিতে হয় না।', 'Goes to gateway checkout. Customer doesn\'t need to share TxID.'),
                accountingNote: copy('Payment fee gateway নিজে কাটে — আপনার wallet থেকে কিছু কাটে না।', 'Gateway fee is deducted by the gateway — nothing from your wallet.'),
                subModes: [
                  { key: 'sslcommerz', icon: '🔵', title: 'SSLCommerz', fee: '~২.৫%', fields: [
                    { key: 'store_id', label: 'Store ID', ph: 'SSLCommerz Store ID' },
                    { key: 'store_passwd', label: 'Store Password', ph: 'SSLCommerz Store Password', secret: true },
                  ]},
                  { key: 'shurjopay', icon: '🟠', title: 'ShurjoPay', fee: '~২%', fields: [
                    { key: 'username', label: 'Username', ph: 'ShurjoPay Username' },
                    { key: 'password', label: 'Password', ph: 'ShurjoPay Password', secret: true },
                    { key: 'prefix', label: 'Prefix', ph: 'e.g. SP' },
                  ]},
                  { key: 'zinipay', icon: '⚡', title: 'ZiniPay', fee: '~২%', fields: [
                    { key: 'store_id', label: 'Store ID', ph: 'ZiniPay Store ID' },
                    { key: 'api_key', label: 'API Key', ph: 'ZiniPay API Key', secret: true },
                  ]},
                ],
                fields: [],
              },
              {
                num: 4, key: 'manual', mck: 'manual', icon: '📋',
                title: copy('Manual TxID', 'Manual TxID'),
                subtitle: copy('সবসময় Fallback', 'Always Fallback'),
                badge: copy('সবসময় চালু', 'Always On'),
                feeLabel: '০%', feeDesc: copy('কোনো fee নেই', 'No fee'),
                works: copy('সব method — bKash / Nagad / Rocket / যেকোনো', 'All — bKash / Nagad / Rocket / anything'),
                flow: copy('Customer TxID দেয় → Dashboard-এ জমা → আপনি amount মিলিয়ে confirm করেন', 'Customer gives TxID → Stored in dashboard → You manually verify'),
                note: copy('Mode 1/2/3 fail বা configure না থাকলে এই mode চলে।', 'Runs when Mode 1/2/3 fails or is not configured.'),
                accountingNote: copy('Manual verify → Orders-এ "Payment Proof" tab-এ দেখুন। Accounting-এ manual confirm করা orders দেখা যাবে।', 'Manual verify → check Orders "Payment Proof" tab. Confirmed orders appear in Accounting.'),
                fields: [],
              },
            ];

            // ── Derived state ────────────────────────────────────────────────
            const activeCred = payCreds.find(c => c.isActive);
            const activeDirectKey = activeCred && ['bkash','nagad'].includes(activeCred.method) ? activeCred.method : null;
            const activeGatewayKey = activeCred && ['sslcommerz','shurjopay','zinipay'].includes(activeCred.method) ? activeCred.method : null;
            const smsActive = s.smsGatewayEnabled;
            const activeModeNum = smsActive ? 1 : activeDirectKey ? 2 : activeGatewayKey ? 3 : 4;
            const selectedModeKey = selectedPayModeKey;
            const setSelectedModeKey = setSelectedPayModeKey;
            const selectedMode = MODES.find(m => m.key === selectedModeKey) ?? MODES[0];
            const col = MC[selectedMode.mck];

            const opt = (selectedMode.subModes ?? []).find((sub: any) => sub.key === paySelected) as any;

            const handlePaySave = async () => {
              if (!opt) return;
              const emptyFields = opt.fields.filter((f: any) => !payFields[f.key]?.trim());
              if (emptyFields.length > 0) {
                onToast(copy(`❌ ${emptyFields.map((f: any) => f.label).join(', ')} দিন`, `❌ Please fill: ${emptyFields.map((f: any) => f.label).join(', ')}`), 'error');
                return;
              }
              setPaySaving(true); setPayTestResult(null);
              try {
                await request(`${API_BASE}/pages/${pageId}/payment-credentials`, {
                  method: 'POST',
                  body: JSON.stringify({ method: opt.key, credentials: { ...payFields, sandbox: paySandbox ? 'true' : 'false' }, isActive: true }),
                });
                setPayCreds(prev => {
                  const filtered = prev.filter(c => c.method !== opt.key);
                  return [...filtered, { method: opt.key, type: ['bkash','nagad'].includes(opt.key) ? 'direct' : 'gateway', isActive: true }];
                });
                onToast(copy('✅ Credentials সেভ হয়েছে', '✅ Credentials saved'));
                setPaySelected(null); setPayFields({});
              } catch (e: any) { onToast(e.message, 'error'); }
              finally { setPaySaving(false); }
            };

            const handlePayTest = async () => {
              if (!opt) return;
              const emptyFields = opt.fields.filter((f: any) => !payFields[f.key]?.trim());
              if (emptyFields.length > 0) {
                onToast(copy(`❌ ${emptyFields.map((f: any) => f.label).join(', ')} দিন`, `❌ Please fill: ${emptyFields.map((f: any) => f.label).join(', ')}`), 'error');
                return;
              }
              setPayTesting(true); setPayTestResult(null);
              try {
                await request(`${API_BASE}/pages/${pageId}/payment-credentials`, {
                  method: 'POST',
                  body: JSON.stringify({ method: opt.key, credentials: { ...payFields, sandbox: paySandbox ? 'true' : 'false' }, isActive: true }),
                });
                const r = await request<any>(`${API_BASE}/pages/${pageId}/payment-credentials/${opt.key}/test`, { method: 'POST' });
                setPayTestResult({ ok: r.ok, message: r.message });
              } catch (e: any) { setPayTestResult({ ok: false, message: e.message }); }
              finally { setPayTesting(false); }
            };

            const handlePayDelete = async (method: string) => {
              setPayDeleting(method);
              try {
                await request(`${API_BASE}/pages/${pageId}/payment-credentials/${method}`, { method: 'DELETE' });
                setPayCreds(prev => prev.filter(c => c.method !== method));
                onToast(copy('Credentials মুছে ফেলা হয়েছে', 'Credentials removed'));
                if (paySelected === method) { setPaySelected(null); setPayFields({}); }
              } catch (e: any) { onToast(e.message, 'error'); }
              finally { setPayDeleting(null); }
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 14, overflow: 'hidden', border: `2px solid ${col.border}`, background: th.panel }}>

                {/* ── Tab strip ──────────────────────────────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: `2px solid ${col.border}` }}>
                  {MODES.map(mode => {
                    const mc = MC[mode.mck];
                    const isSel = mode.key === selectedModeKey;
                    const modeHasActive = mode.num === activeModeNum;
                    return (
                      <button key={mode.key}
                        onClick={() => { setSelectedModeKey(mode.key); setPaySelected(null); setPayFields({}); setPayTestResult(null); }}
                        style={{
                          padding: '12px 6px 10px', border: 'none', cursor: 'pointer',
                          borderRight: mode.num < 4 ? `1px solid ${isSel ? mc.border : 'rgba(148,163,184,0.12)'}` : 'none',
                          background: isSel ? mc.bg : 'transparent',
                          transition: 'background 150ms',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                          borderBottom: isSel ? `3px solid ${mc.c}` : '3px solid transparent',
                          position: 'relative',
                        }}
                      >
                        {modeHasActive && (
                          <div style={{ position: 'absolute', top: 6, right: 8, width: 7, height: 7, borderRadius: '50%', background: mc.c, boxShadow: `0 0 6px ${mc.c}` }} />
                        )}
                        <span style={{ fontSize: 20 }}>{mode.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: isSel ? mc.c : th.muted, lineHeight: 1.2, textAlign: 'center' }}>
                          {mode.num}. {mode.title}
                        </span>
                        {mode.subtitle && <span style={{ fontSize: 10, color: isSel ? mc.c : th.muted, opacity: 0.8 }}>{mode.subtitle}</span>}
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                          background: isSel ? mc.c + '25' : 'rgba(148,163,184,0.08)',
                          color: isSel ? mc.c : th.muted }}>
                          fee {mode.feeLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* ── Detail panel ───────────────────────────────────────── */}
                <div style={{ padding: '18px 20px', background: col.light }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: col.bg, border: `2px solid ${col.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                      {selectedMode.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 900, fontSize: 16, color: col.c }}>{selectedMode.title}</span>
                        {selectedMode.subtitle && <span style={{ fontSize: 13, color: th.textSub, fontWeight: 500 }}>— {selectedMode.subtitle}</span>}
                        <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: col.bg, color: col.c, border: `1px solid ${col.border}` }}>{selectedMode.badge}</span>
                        {selectedMode.num === activeModeNum && (
                          <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#16a34a22', color: '#16a34a', border: '1px solid #16a34a44' }}>✅ {copy('এখন চালু', 'Active Now')}</span>
                        )}
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {/* Fee badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, background: col.bg, border: `1px solid ${col.border}` }}>
                          <span style={{ fontSize: 13 }}>💰</span>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: col.c }}>{selectedMode.feeLabel}</span>
                          <span style={{ fontSize: 11.5, color: th.muted }}>{selectedMode.feeDesc}</span>
                        </div>
                        {/* Works with */}
                        <div style={{ fontSize: 12, color: th.textSub }}><strong style={{ color: th.text }}>Works:</strong> {selectedMode.works}</div>
                      </div>
                    </div>
                  </div>

                  {/* Flow diagram */}
                  <div style={{ padding: '10px 14px', borderRadius: 10, background: col.bg, border: `1px solid ${col.border}`, marginBottom: 12, fontSize: 12.5, color: col.c, fontWeight: 600 }}>
                    🔄 {selectedMode.flow}
                  </div>

                  {/* Note */}
                  <div style={{ fontSize: 12, color: th.muted, marginBottom: 14, fontStyle: 'italic' }}>
                    ℹ️ {selectedMode.note}
                  </div>

                  {/* Accounting integration note */}
                  <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 12, color: '#92400e', marginBottom: 16, display: 'flex', gap: 8 }}>
                    <span>📊</span>
                    <span><strong>{copy('Accounting:', 'Accounting:')}</strong> {selectedMode.accountingNote}</span>
                  </div>

                  {/* SMS mode — pointer */}
                  {selectedMode.key === 'sms' && (
                    <div style={{ padding: '12px 16px', borderRadius: 10, background: col.bg, border: `1.5px solid ${col.border}`, fontSize: 13, color: col.c, fontWeight: 600 }}>
                      👇 {copy('নিচে "SMS Gateway" section-এ আপনার phone setup করুন এবং চালু করুন।', 'Set up your phone in the "SMS Gateway" section below and enable it.')}
                    </div>
                  )}

                  {/* Manual mode — pointer */}
                  {selectedMode.key === 'manual' && (
                    <div style={{ padding: '12px 16px', borderRadius: 10, background: col.bg, border: `1.5px solid ${col.border}`, fontSize: 13, color: col.c, fontWeight: 600 }}>
                      👉 {copy('Orders → "Payment Proof" tab-এ pending TxID গুলো দেখুন ও verify করুন।', 'Go to Orders → "Payment Proof" tab to review and verify pending TxIDs.')}
                    </div>
                  )}

                  {/* Sub-modes for Direct API and Gateway */}
                  {selectedMode.subModes && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: th.textSub, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                        {copy('Provider বেছে নিন:', 'Select Provider:')}
                      </div>
                      {selectedMode.subModes.map((sub: any) => {
                        const existingCred = payCreds.find(c => c.method === sub.key);
                        const isSubSelected = paySelected === sub.key;
                        return (
                          <div key={sub.key}>
                            <div
                              onClick={() => { setPaySelected(isSubSelected ? null : sub.key); setPayFields({}); setPayTestResult(null); setPaySandbox(true); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                                borderRadius: 10, cursor: 'pointer',
                                border: `2px solid ${isSubSelected ? col.c : existingCred?.isActive ? '#16a34a' : col.border}`,
                                background: isSubSelected ? col.bg : existingCred?.isActive ? 'rgba(22,163,74,0.08)' : th.panel,
                                transition: 'all 130ms',
                              }}
                            >
                              <span style={{ fontSize: 20 }}>{sub.icon}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: th.text }}>{sub.title}</div>
                                <div style={{ fontSize: 11, color: th.muted }}>Gateway fee: <strong style={{ color: col.c }}>{sub.fee}</strong></div>
                              </div>
                              {existingCred?.isActive && (
                                <>
                                  <span style={{ fontSize: 11, background: '#d1fae5', color: '#065f46', borderRadius: 6, padding: '3px 10px', fontWeight: 800 }}>✅ Active</span>
                                  <button onClick={e => { e.stopPropagation(); handlePayDelete(sub.key); }} disabled={payDeleting === sub.key}
                                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '3px 9px' }}>
                                    {payDeleting === sub.key ? '…' : '🗑'}
                                  </button>
                                </>
                              )}
                              <span style={{ fontSize: 14, color: isSubSelected ? col.c : th.muted, fontWeight: 700 }}>{isSubSelected ? '▲' : '▼'}</span>
                            </div>

                            {/* Credential form */}
                            {isSubSelected && (
                              <div style={{ marginTop: 6, padding: '16px 18px', borderRadius: 10, background: th.surface, border: `2px solid ${col.border}` }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 13 }}>
                                  <input type="checkbox" checked={paySandbox} onChange={e => setPaySandbox(e.target.checked)} style={{ accentColor: col.c }} />
                                  <span style={{ color: th.muted }}>{copy('Sandbox/Test mode (live করতে uncheck করুন)', 'Sandbox/Test mode (uncheck for live)')}</span>
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(175px,1fr))', gap: 10, marginBottom: 12 }}>
                                  {sub.fields.map((f: any) => (
                                    <div key={f.key}>
                                      <div style={{ fontSize: 11.5, fontWeight: 700, color: th.muted, marginBottom: 4 }}>{f.label}</div>
                                      <input type={f.secret ? 'password' : 'text'} placeholder={f.ph}
                                        value={payFields[f.key] || ''}
                                        onChange={e => setPayFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                                        style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
                                    </div>
                                  ))}
                                </div>
                                {payTestResult && (
                                  <div style={{ marginBottom: 10, padding: '9px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700,
                                    background: payTestResult.ok ? '#d1fae5' : '#fee2e2', color: payTestResult.ok ? '#065f46' : '#991b1b' }}>
                                    {payTestResult.ok ? '✅' : '❌'} {payTestResult.message}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button onClick={handlePayTest} disabled={payTesting || paySaving}
                                    style={{ ...th.btnGhost, fontSize: 13, padding: '8px 16px' }}>
                                    {payTesting ? <Spinner size={13} color={th.accent} /> : copy('🔍 Test Connection', 'Test Connection')}
                                  </button>
                                  <button onClick={handlePaySave} disabled={paySaving || payTesting}
                                    style={{ ...th.btnPrimary, fontSize: 13, padding: '8px 20px', background: col.c, borderColor: col.c }}>
                                    {paySaving ? <Spinner size={13} color="#fff" /> : copy('💾 Save & Activate', 'Save & Activate')}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </Section>

        {/* Web Order Toggle */}
        <Section title="🌐 Website Order" desc={copy('Catalog website থেকে সরাসরি order নেওয়া চালু/বন্ধ করুন। চালু থাকলে product page এ "Website থেকে Order করুন" বাটন দেখাবে।', 'Enable or disable direct web ordering from the catalog website.')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{copy('Website থেকে Order', 'Order from Website')}</div>
              <div style={{ fontSize: 12.5, color: th.muted, marginTop: 2 }}>{copy('Customer সরাসরি catalog website থেকে order দিতে পারবে', 'Customers can place orders directly from the catalog website')}</div>
            </div>
            <button
              onClick={() => setS(p => ({ ...p, webOrderEnabled: !p.webOrderEnabled }))}
              style={{
                padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontWeight: 800, fontSize: 13, fontFamily: 'inherit',
                background: s.webOrderEnabled ? '#059669' : th.border,
                color: s.webOrderEnabled ? '#fff' : th.muted,
                transition: 'all .15s',
              }}
            >
              {s.webOrderEnabled ? '✅ চালু' : '⏸ বন্ধ'}
            </button>
          </div>
        </Section>

        {/* V25: Restaurant settings moved to the dedicated 🍕 Restaurant panel */}
        <Section
          title={copy('🍕 Restaurant Mode', '🍕 Restaurant Mode')}
          desc={copy(
            'Restaurant/food business-এর সব setting এখন আলাদা "🍕 Restaurant" panel-এ — menu, ingredient inventory, delivery fee, order নেওয়া সব ওখানে।',
            'All restaurant settings now live in the dedicated "🍕 Restaurant" panel — menu, ingredient inventory, delivery fees, take-order.',
          )}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: s.restaurantModeEnabled ? '#059669' : th.muted }}>
              {s.restaurantModeEnabled ? copy('✅ চালু আছে', '✅ Enabled') : copy('⏸ বন্ধ আছে', '⏸ Off')}
            </span>
            <span style={{ fontSize: 12.5, color: th.muted }}>
              → {copy('বাম পাশের menu থেকে "🍕 রেস্টুরেন্ট" খুলুন', 'Open "🍕 Restaurant" from the left menu')}
            </span>
          </div>
        </Section>

        {/* SMS Gateway Setup */}
        <Section
          title={copy('📲 SMS Gateway — Phone দিয়ে Payment Verify', '📲 SMS Gateway — Verify Payments via Phone')}
          desc={copy(
            'আপনার ফোনে bKash/Nagad/Rocket-এ টাকা আসলে সেই SMS bot স্বয়ংক্রিয়ভাবে পড়বে এবং customer-এর দেওয়া তথ্যের সাথে মিলিয়ে payment verify করবে। কোনো merchant API লাগবে না।',
            'When your phone receives a bKash/Nagad/Rocket payment SMS, the bot reads it automatically and matches it with the customer\'s info to verify payment — no merchant API needed.',
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* How it works banner */}
            <div style={{ background: 'linear-gradient(135deg,#ede9fe,#dbeafe)', borderRadius: 12, padding: '14px 16px', border: '1px solid #c4b5fd' }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#4c1d95', marginBottom: 10 }}>⚡ কীভাবে কাজ করে?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { icon: '1️⃣', text: copy('Customer আপনার bKash/Nagad/Rocket নম্বরে টাকা পাঠায়', 'Customer sends money to your bKash/Nagad/Rocket number') },
                  { icon: '2️⃣', text: copy('আপনার ফোনে payment received SMS আসে', 'Your phone receives a payment received SMS') },
                  { icon: '3️⃣', text: copy('SMS Forwarder app সেই SMS টা FlamboyAI-এ পাঠায়', 'SMS Forwarder app sends that SMS to FlamboyAI') },
                  { icon: '4️⃣', text: copy('Customer Messenger-এ TxID বা phone number দেয়', 'Customer gives TxID or phone number in Messenger') },
                  { icon: '5️⃣', text: copy('Bot SMS-এর সাথে match করে → ✅ Auto confirm!', 'Bot matches with SMS → ✅ Auto confirm!') },
                ].map(({ icon, text }) => (
                  <div key={icon} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 15, lineHeight: 1.4 }}>{icon}</span>
                    <span style={{ fontSize: 12.5, color: '#3730a3', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Enable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: th.surface, border: `1px solid ${th.border}` }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: th.text }}>{copy('SMS Gateway চালু করুন', 'Enable SMS Gateway')}</div>
                <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>{copy('চালু থাকলে phone SMS-এ match করে payment verify হবে।', 'When enabled, payment is verified by matching with phone SMS.')}</div>
              </div>
              <button onClick={async () => {
                const hasActiveDevice = smsDevices.some((d: any) => d.isActive);
                if (!s.smsGatewayEnabled && !hasActiveDevice) {
                  onToast(copy('কোনো active device নেই — app install করে connect করুন', 'No active device — install the app and connect first'), 'error');
                  return;
                }
                setSmsToggling(true);
                try {
                  await request(`${API_BASE}/sms-gateway/enabled`, { method: 'PATCH', body: JSON.stringify({ pageId, enabled: !s.smsGatewayEnabled }) });
                  setS(p => ({ ...p, smsGatewayEnabled: !p.smsGatewayEnabled }));
                  onToast(copy('সেভ হয়েছে', 'Saved'));
                } catch (e: any) { onToast(e.message, 'error'); }
                finally { setSmsToggling(false); }
              }} disabled={smsToggling} title={!s.smsGatewayEnabled && !smsDevices.some((d:any)=>d.isActive) ? copy('আগে device connect করুন', 'Connect a device first') : ''} style={{
                border: 'none', borderRadius: 20, padding: '7px 20px', cursor: (!s.smsGatewayEnabled && !smsDevices.some((d:any)=>d.isActive)) ? 'not-allowed' : 'pointer',
                fontWeight: 800, fontSize: 13, fontFamily: 'inherit', flexShrink: 0,
                background: s.smsGatewayEnabled ? '#059669' : (!s.smsGatewayEnabled && !smsDevices.some((d:any)=>d.isActive)) ? '#e5e7eb' : th.border,
                color: s.smsGatewayEnabled ? '#fff' : (!s.smsGatewayEnabled && !smsDevices.some((d:any)=>d.isActive)) ? '#9ca3af' : th.muted,
                transition: 'all .15s',
                opacity: (!s.smsGatewayEnabled && !smsDevices.some((d:any)=>d.isActive)) ? 0.6 : 1,
              }}>
                {s.smsGatewayEnabled ? '✅ চালু' : '⏸ বন্ধ'}
              </button>
            </div>

            {/* Step by step setup guide */}
            {smsToken && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Step 1 — Download app */}
                <div style={{ borderRadius: 12, padding: '14px 16px', background: th.surface, border: `1px solid ${th.border}` }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 10 }}>
                    📱 {copy('ধাপ ১ — App ডাউনলোড করুন', 'Step 1 — Download the App')}
                  </div>
                  <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 12, lineHeight: 1.6 }}>
                    {copy(
                      'নিচের যেকোনো একটি app আপনার Android ফোনে install করুন। যে ফোনে bKash/Nagad/Rocket-এর payment SMS আসে সেই ফোনে দিতে হবে।',
                      'Install any one of the apps below on the Android phone that receives your bKash/Nagad/Rocket payment SMSes.',
                    )}
                  </div>
                  <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 11.5, color: '#92400e', marginBottom: 12, lineHeight: 1.6 }}>
                    ⚠️ {copy(
                      'বেশিরভাগ SMS forwarder app Google Play Store-এ নেই (Google-এর SMS permission নীতির কারণে)। নিচের app গুলো GitHub থেকে সরাসরি APK download করে install করতে হবে। Install-এর সময় "Unknown Sources" allow করুন।',
                      'Most SMS forwarder apps are not on the Play Store (due to Google\'s SMS permission policy). Download the APK directly from GitHub. Allow "Unknown Sources" during install.',
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      {
                        name: 'FlamboyAI PaySync',
                        badge: copy('⭐ অফিসিয়াল (প্রস্তাবিত)', '⭐ Official (Recommended)'),
                        badgeColor: '#10b981',
                        desc: copy('চ্যাটক্যাট-এর নিজস্ব পেমেন্ট সিঙ্ক অ্যাপ। সবচেয়ে সহজ ও সবচেয়ে বিশ্বস্ত।', 'FlamboyAI\'s own payment sync app. Simplest and most reliable.'),
                        url: `${API_BASE}/storage/downloads/FlamboyAI-paysync.apk`,
                        btnText: copy('⬇ APK Download', '⬇ APK Download'),
                        btnColor: '#10b981',
                      },
                    ].map(app => (
                      <div key={app.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 9, background: th.bg, border: `1px solid ${th.border}` }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 12.5, color: th.text }}>{app.name}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: app.badgeColor + '20', color: app.badgeColor }}>{app.badge}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: th.muted, lineHeight: 1.5 }}>{app.desc}</div>
                        </div>
                        <a href={app.url} target="_blank" rel="noreferrer" style={{
                          flexShrink: 0, padding: '7px 14px', borderRadius: 8, background: app.btnColor, color: '#fff',
                          fontWeight: 700, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap',
                        }}>
                          {app.btnText}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 2 — Copy Secret Token */}
                <div style={{ borderRadius: 12, padding: '14px 16px', background: th.surface, border: `1px solid ${th.border}` }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 10 }}>
                    🔑 {copy('ধাপ ২ — Secret Token copy করুন', 'Step 2 — Copy Secret Token')}
                  </div>
                  <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 10, lineHeight: 1.5 }}>
                    {copy('নিচের Secret Token টা copy করে FlamboyAI PaySync app-এ paste করুন।', 'Copy the Secret Token below and paste it into the FlamboyAI PaySync app.')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input readOnly value={smsToken} style={{ ...inp, flex: 1, fontSize: 11, color: th.muted, userSelect: 'all' as any, fontFamily: 'monospace' }} onFocus={e => e.target.select()} />
                    <button onClick={() => { navigator.clipboard.writeText(smsToken); setSmsCopied(true); setTimeout(() => setSmsCopied(false), 2500); }} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: smsCopied ? '#10b981' : th.accent, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {smsCopied ? '✅ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                  <button onClick={async () => {
                    const res = await request<any>(`${API_BASE}/sms-gateway/token?pageId=${pageId}`, { method: 'DELETE' });
                    if (res?.token) { setSmsToken(res.token); onToast(copy('নতুন token তৈরি হয়েছে', 'New token generated')); }
                  }} style={{ marginTop: 10, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11.5, padding: 0, fontWeight: 700 }}>
                    🔄 {copy('নতুন token তৈরি করুন', 'Regenerate token')} <span style={{ fontWeight: 400, color: th.muted }}>{copy('(পুরানোটা কাজ করবে না)', '(old one will stop working)')}</span>
                  </button>
                </div>

                {/* Step 3 — App connect */}
                <div style={{ borderRadius: 12, padding: '14px 16px', background: th.surface, border: `1px solid ${th.border}` }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 10 }}>
                    ⚙️ {copy('ধাপ ৩ — App-এ connect করুন', 'Step 3 — Connect in App')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      copy('App install করে open করুন → সব SMS permission allow করুন', 'Install and open the app → Allow all SMS permissions'),
                      copy('App-এ Secret Token paste করুন (উপরের ধাপ ২ এর token)', 'Paste the Secret Token into the app (from Step 2 above)'),
                      copy('App-এ Token ADD করুন — connected হলে নিচে device দেখাবে', 'ADD the token in the app — connected devices will appear below'),
                      copy('⚠️ Battery Optimization OFF করুন (Settings → Battery → এই app → Unrestricted)', '⚠️ Disable Battery Optimization (Settings → Battery → This app → Unrestricted)'),
                      copy('Phone সবসময় internet-এ connected ও চার্জে রাখুন', 'Keep the phone always connected to internet and plugged in'),
                    ].map((step, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: th.accent + '20', color: th.accent, fontWeight: 800, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                        <span style={{ fontSize: 12.5, color: th.muted, lineHeight: 1.5 }}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 4 — Test webhook */}
                <div style={{ borderRadius: 12, padding: '14px 16px', background: th.surface, border: `1px solid ${th.border}` }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 10 }}>
                    🧪 {copy('ধাপ ৪ — টেস্ট করুন', 'Step 4 — Test It')}
                  </div>
                  <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 12, lineHeight: 1.6 }}>
                    {copy(
                      'সব setup হয়ে গেলে নিচের "Test" button-এ click করুন, অথবা নিজের bKash/Nagad থেকে ৳10 send করুন। নিচে "Last SMS" দেখালে setup সঠিক আছে।',
                      'After setup, click "Test" below, or send ৳10 from your own bKash/Nagad. If "Last SMS" appears below, setup is correct.',
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={async () => {
                        try {
                          const res = await request<any>(`${API_BASE}/sms-gateway/status?pageId=${pageId}`);
                          if (res.lastReceived) {
                            onToast(copy(
                              `✅ SMS আসছে! শেষ SMS: ${res.lastReceived.method?.toUpperCase()} ৳${res.lastReceived.amount ?? '?'} — ${new Date(res.lastReceived.receivedAt).toLocaleString('bn-BD')}`,
                              `✅ SMS working! Last: ${res.lastReceived.method?.toUpperCase()} ৳${res.lastReceived.amount ?? '?'} — ${new Date(res.lastReceived.receivedAt).toLocaleString()}`
                            ));
                          } else {
                            onToast(copy(
                              '⚠️ এখনো কোনো SMS আসেনি। App setup ঠিক আছে কিনা চেক করুন, তারপর নিজে ৳10 send করে test করুন।',
                              '⚠️ No SMS received yet. Verify app setup, then test by sending ৳10 to yourself.'
                            ), 'error');
                          }
                        } catch (e: any) { onToast(e.message, 'error'); }
                      }}
                      style={{ ...th.btnPrimary, fontSize: 12.5, padding: '8px 18px', background: '#059669', borderColor: '#059669' }}
                    >
                      🧪 {copy('Connection Test করুন', 'Test Connection')}
                    </button>
                    <span style={{ fontSize: 11.5, color: th.muted }}>
                      {copy('(নিজের নম্বরে ৳10 send করে test করুন)', '(Send ৳10 to yourself to test)')}
                    </span>
                  </div>
                </div>

                {/* Connected Devices */}
                <div style={{ borderRadius: 12, padding: '14px 16px', background: th.surface, border: `1px solid ${th.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: th.text }}>
                      📱 {copy('Connected Devices', 'Connected Devices')}
                    </div>
                    <button onClick={async () => { const d = await request<any[]>(`${API_BASE}/sms-gateway/devices?pageId=${pageId}`).catch(() => []); setSmsDevices(d); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.muted, fontSize: 12 }}>🔄</button>
                  </div>
                  {smsDevices.length === 0 ? (
                    <div style={{ fontSize: 12, color: th.muted, textAlign: 'center', padding: '12px 0' }}>
                      {copy('কোনো device connect হয়নি। App-এ token দিয়ে connect করুন।', 'No devices connected yet. Connect via the app using the token.')}
                    </div>
                  ) : smsDevices.map((d: any) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: th.bg, border: `1px solid ${d.isActive ? '#10b98133' : th.border}`, marginBottom: 6 }}>
                      <span style={{ fontSize: 20 }}>📱</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5, color: th.text }}>{d.deviceName}</div>
                        {d.deviceModel && <div style={{ fontSize: 11.5, color: th.muted }}>{d.deviceModel}</div>}
                      </div>
                      <div style={{ fontSize: 11, color: th.muted, textAlign: 'right' }}>
                        <div style={{ color: d.isActive ? '#10b981' : '#ef4444', fontWeight: 700 }}>{d.isActive ? '● Connected' : '○ Disconnected'}</div>
                        <div>{copy('সর্বশেষ:', 'Last:')} {new Date(d.lastSeenAt).toLocaleDateString('bn-BD')}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* bKash/Nagad sender numbers info */}
                <div style={{ borderRadius: 10, padding: '12px 14px', background: '#fefce8', border: '1px solid #fde68a' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: '#92400e', marginBottom: 7 }}>
                    💡 {copy('bKash/Nagad/Rocket-এর SMS Sender ID (Filter-এ দিন)', 'bKash/Nagad/Rocket SMS Sender IDs (use in filter)')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[
                      { label: 'bKash', numbers: copy('16247 (শর্টকোড) অথবা sender name: "bKash"', '16247 (shortcode) or sender name: "bKash"') },
                      { label: 'Nagad', numbers: copy('16167 (শর্টকোড) অথবা sender name: "NAGAD"', '16167 (shortcode) or sender name: "NAGAD"') },
                      { label: 'Rocket', numbers: copy('16216 (শর্টকোড) অথবা sender name: "DBBL"', '16216 (shortcode) or sender name: "DBBL"') },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#78350f' }}>
                        <span style={{ fontWeight: 700, minWidth: 50 }}>{r.label}:</span>
                        <span style={{ fontFamily: 'monospace' }}>{r.numbers}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#92400e', marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
                    {copy(
                      '💡 FlamboyAI SMS content দিয়ে match করে (bKash/Nagad/Rocket keyword + TxID + Amount)। তাই filter না দিলেও কাজ করবে, তবে filter দিলে unnecessary SMS forwarding হবে না।',
                      '💡 FlamboyAI matches by SMS content (bKash/Nagad/Rocket keyword + TxID + Amount). It works without filters too, but filters prevent unnecessary SMS forwarding.',
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        </Section>

        <SaveRow onClick={() => save({
          deliveryFeeInsideDhaka: s.deliveryFeeInsideDhaka,
          deliveryFeeOutsideDhaka: s.deliveryFeeOutsideDhaka,
          deliveryTimeText: s.deliveryTimeText,
          deliveryTimeInsideDhaka: s.deliveryTimeInsideDhaka,
          deliveryTimeOutsideDhaka: s.deliveryTimeOutsideDhaka,
          paymentMode: s.paymentMode, advanceAmount: s.advanceAmount,
          advanceBkash: s.advanceBkash, advanceNagad: s.advanceNagad, advanceRocket: s.advanceRocket,
          advancePaymentMessage: s.advancePaymentMessage,
          codEnabled: s.codEnabled, advanceThresholdAmount: s.advanceThresholdAmount,
          webOrderEnabled: s.webOrderEnabled,
          // restaurant fields are managed by the 🍕 Restaurant panel — not sent
          // from here so a stale Settings tab can never clobber panel edits
        })} saving={saving}/>
      </div>
    </div>
  );

  // ── SETTINGS_BOT ───────────────────────────────────────────────────────────
  const isUniversityMode = (s as any).universityModeOn === true;

  if (tab === 'SETTINGS_BOT') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, ...cssVars }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>⚙ Bot Modes</h1>
        <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('Bot কী কী করতে পারবে তা এখানে চালু/বন্ধ করো', 'Control which features the bot can use')}</p>
      </div>
      <div style={{ ...th.card }}>
        {/* Business Info Bot — hidden in university mode */}
        {!isUniversityMode && <Section title="🏢 Business Info Bot" desc="Product বিক্রি না করে শুধু business সম্পর্কে তথ্য দিতে চাইলে এটি চালু করুন। Customer যেকোনো প্রশ্ন করলে AI আপনার দেওয়া business তথ্য থেকে উত্তর দেবে।">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Toggle th={th}
              label="Business Info Bot চালু করুন"
              sub="চালু থাকলে নিচের তথ্য দিয়ে সব message-এর AI reply দেবে। SmartBot ও Order mode-এর দরকার নেই।"
              checked={s.businessBotOn}
              onChange={v => saveMode('businessBotOn', v)} />
            {s.businessBotOn && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Label text="Business সম্পর্কে বিস্তারিত তথ্য" hint="আপনার business-এর নাম, কী সেবা দেন, যোগাযোগ, ঠিকানা, সময়সূচি, FAQ — সব লিখুন। এই তথ্য থেকে AI customer-দের reply করবে।" />

                {/* FlamboyAI service info smart-merge — admin only */}
                {isAdmin && <><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    style={{ ...th.btnPrimary, fontSize: 11.5, padding: '6px 12px' }}
                    onClick={() => {
                      // Each section has a unique marker so only changed parts get replaced
                      const sections: Record<string, string> = {
                        'FlamboyAI-intro': `আমরা Facebook Messenger automation সেবা দিই। আপনার page এর bot automatically order নেবে, reply করবে, courier booking করবে।`,
                        'platform-fee': `## Platform Fee\nআলোচনা সাপেক্ষ — আপনার পেজের size ও ব্যবহার অনুযায়ী admin এর সাথে কথা বলে deal হবে।`,
                        'ai-pricing': `## AI Usage Pricing (Pay-as-you-go, credit-based)\n- AI text/SmartBot reply: ১০+ credit/message (message length অনুযায়ী বাড়ে)\n- Customer image (Vision AI): ৮ credit/image\n- OCR scan: ১–২ credit\n- Voice note (STT): ৪০ credit/voice\n- Broadcast: ২ credit/message\n- Subscriber notification: ৪ credit/message\n- Memo print: ৪ credit\n- Recharge rate: ১ টাকা = ৪০ credit`,
                        'free-features': `## বিনামূল্যে\nCourier booking (Pathao, Steadfast, RedX, Paperfly), Accounting, CRM, Analytics, Order management`,
                        'subscriber-feature': `## Special Feature: Subscriber Notification\nOrder complete/cancel হলে bot customer কে subscribe করতে বলে।\nSubscribed customer দের যেকোনো সময় নতুন পণ্যের message পাঠানো যায়।\nFacebook Ad ছাড়া — মাত্র ৪ credit/message। ১০০০ জন = মাত্র ৪,০০০ credit (~৳১০০)।`,
                        'payment-trial': `## Payment ও Trial\n- Payment: bKash, Nagad, Rocket, Bank transfer\n- ৭ দিন সম্পূর্ণ free trial — কোনো credit card লাগে না\n- Contact: WhatsApp — wa.me/8801575897887`,
                      };

                      let text = s.businessInfo;
                      let changed = false;

                      for (const [key, newContent] of Object.entries(sections)) {
                        const start = `<!--CC:${key}-->`;
                        const end = `<!--/CC:${key}-->`;
                        const block = `${start}\n${newContent}\n${end}`;
                        const si = text.indexOf(start);
                        const ei = text.indexOf(end);
                        if (si !== -1 && ei !== -1) {
                          // Section exists — replace only if content changed
                          const existing = text.slice(si + start.length + 1, ei - 1);
                          if (existing.trim() !== newContent.trim()) {
                            text = text.slice(0, si) + block + text.slice(ei + end.length);
                            changed = true;
                          }
                        } else {
                          // Section missing — append it
                          text = text.trim() + (text.trim() ? '\n\n' : '') + block;
                          changed = true;
                        }
                      }

                      if (changed) setS(p => ({ ...p, businessInfo: text.slice(0, 5000) }));
                    }}
                  >
                    🔄 FlamboyAI Info Sync করুন
                  </button>
                  <button
                    style={{ ...th.btnGhost, fontSize: 11.5, padding: '6px 12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                    onClick={() => setS(p => ({ ...p, businessInfo: '' }))}
                  >
                    🗑️ Clear
                  </button>
                </div>
                <div style={{ fontSize: 11, color: th.muted, marginTop: -4 }}>
                  💡 "Sync" button — শুধু changed বা নতুন section update করে। আপনার custom লেখা অক্ষুণ্ণ থাকে।
                </div>
                </>}

                <textarea
                  style={{ ...th.input, minHeight: 200, resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7, borderColor: s.businessInfo.length > 4800 ? '#f87171' : undefined }}
                  placeholder={`উদাহরণ:\nআমাদের business-এর নাম: Limon Tech Diary\nআমরা যা করি: ওয়েব ডিজাইন, গ্রাফিক্স ডিজাইন, ডিজিটাল মার্কেটিং সেবা প্রদান করি\nযোগাযোগ: 01XXXXXXXXX\nইমেইল: info@example.com\nঅফিস সময়: শনি-বৃহস্পতি, সকাল ১০টা - রাত ৮টা\nঠিকানা: ঢাকা, বাংলাদেশ\n\nকাজের ধরন:\n- ওয়েবসাইট তৈরি: ৳৫,০০০ থেকে শুরু\n- লোগো ডিজাইন: ৳১,৫০০\n- ফেসবুক পেজ ম্যানেজমেন্ট: মাসে ৳৩,০০০`}
                  value={s.businessInfo}
                  maxLength={5000}
                  onChange={e => setS(p => ({ ...p, businessInfo: e.target.value.slice(0, 5000) }))}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <p style={{ fontSize: 11.5, color: th.muted, margin: 0 }}>
                    💡 যত বেশি তথ্য দেবেন, AI তত ভালো উত্তর দিতে পারবে।
                    <span style={{ color: s.businessInfo.length > 4800 ? '#f87171' : th.muted }}> {s.businessInfo.length}/5000</span>
                  </p>
                  <SaveRow onClick={() => save({ businessInfo: s.businessInfo })} saving={saving} />
                </div>
              </div>
            )}
          </div>
        </Section>}

        {/* SmartBot — hidden in university mode */}
        {!isUniversityMode && <Section title="🧠 SmartBot Mode" desc="AI — customer যেকোনো ভাষায় কথা বলবে, bot বুঝে order নেবে। Knowledge box-এর তথ্য দিয়ে reply দেবে।">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Toggle th={th}
              label="SmartBot চালু করুন (সুপারিশকৃত)"
              sub="AI সরাসরি customer-এর প্রতিটা message বুঝে natural reply দেবে এবং order নেবে — আগের কথা (chat history) মনে রাখবে, Bot Personality/tone পুরো conversation-এ consistent থাকবে। এটাই এখন default।"
              checked={s.smartBotOn}
              onChange={v => saveMode('smartBotOn', v)} />
            {!s.smartBotOn && (
              <div style={{ fontSize: 12, color: th.muted, padding: '10px 14px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}`, lineHeight: 1.7 }}>
                Common question (size/color/দাম/delivery) আগের মতোই দ্রুত ও কম খরচে fixed reply দেবে। Custom Bot Personality শুধু open/flexible কথাবার্তায় কাজ করবে।
              </div>
            )}
            {s.smartBotOn && (
              <div style={{ fontSize: 12, color: th.muted, padding: '10px 14px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}`, lineHeight: 1.7 }}>
                <strong style={{ color: th.text }}>SmartBot চালু আছে।</strong> উপরের "AI Business Knowledge" box-এ আপনার business-এর সব তথ্য লিখুন — size chart, return policy, payment info, FAQ — AI এই তথ্য দিয়ে customer-দের reply করবে।
              </div>
            )}
            {isAdmin && (
              <div style={{ fontSize: 11, color: th.muted, padding: '8px 12px', borderRadius: 8, background: 'rgba(79,110,247,0.07)', border: '1px solid rgba(79,110,247,0.2)' }}>
                Admin only — rates: AI text ৳0.05/msg · SmartBot ৳0.10/msg · Customer image ৳0.20
              </div>
            )}
          </div>
        </Section>}

        {/* Bot Modes — university mode shows only automation + university toggle */}
        <Section title="Bot Modes" desc="Toggle bot features on or off">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { key: 'automationOn', label: 'Bot Automation', sub: copy('⚠️ Master switch — এটা OFF থাকলে কোনো automation কাজ করবে না', '⚠️ Master switch — if OFF, all automation will stop') },
              ...(!isUniversityMode ? [
                { key: 'callConfirmModeOn', label: 'Call Confirm Mode', sub: copy('Phone call দিয়ে order confirm করবে', 'Confirm orders by phone call') },
                { key: 'commentReplyOn',    label: 'Comment Reply',     sub: copy('Post-এর comment-এ auto reply দেবে', 'Auto-reply to Facebook post comments') },
                { key: 'recurringNotifMode', label: '🔔 Subscriber Notification', sub: copy('Order complete/cancel হলে customer কে subscribe করতে বলবে', 'After order complete/cancel, bot asks customer to subscribe') },
              ] : []),
            ].map(m => (
              <Toggle key={m.key} th={th} label={m.label} sub={m.sub}
                checked={(s as any)[m.key] ?? false}
                onChange={v => saveMode(m.key, v)} />
            ))}
          </div>
            <div style={{ background: th.accentSoft, border: `1px solid rgba(99,102,241,0.2)`, borderRadius: 10, padding: '10px 14px', fontSize: 11.5, color: th.muted, lineHeight: 1.8, marginTop: 4 }}>
              💬 <strong style={{ color: th.text }}>{copy('Comment Reply কিভাবে কাজ করে?', 'How does Comment Reply work?')}</strong><br />
              {copy(
                'আপনার Page-এর কোনো Post-এ কেউ comment করলে bot সেটি detect করে। Comment-এ product, price বা order সংক্রান্ত কিছু থাকলে bot স্বয়ংক্রিয়ভাবে সেই comment-এ public reply দেয়।',
                'When someone comments on your Page Post, the bot detects it. If the comment mentions a product, price, or order, the bot automatically posts a public reply to that comment.',
              )}<br />
              <strong style={{ color: th.text }}>{copy('⚠️ প্রয়োজনীয় Permissions:', '⚠️ Required Permissions:')}</strong>{' '}
              {['pages_read_engagement', 'pages_manage_engagement'].map(p => (
                <code key={p} style={{ background: th.accentSoft, color: th.accent, padding: '1px 5px', borderRadius: 4, fontSize: 10.5, fontWeight: 700, marginRight: 4 }}>{p}</code>
              ))}<br />
              <span style={{ fontSize: 11 }}>{copy('এই দুটি permission ছাড়া comment reply কাজ করবে না। Settings → Facebook Page → Reconnect করে নতুন token নিন।', 'Without these two permissions, comment reply will not work. Go to Settings → Facebook Page → Reconnect to get a new token.')}</span>
            </div>

        </Section>

        {/* Agent Handoff — pause bot on human takeover */}
        <Section title={copy('🙋 Agent Handoff', '🙋 Agent Handoff')} desc={copy('Agent নিজে reply করলে bot কখন থামবে এবং কখন আবার চালু হবে সেটা এখানে ঠিক করুন।', 'Control when the bot pauses for an agent, and when it resumes.')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toggle th={th}
              label={copy('Auto Pause on Human Takeover', 'Auto Pause on Human Takeover')}
              sub={copy('চালু থাকলে agent Messenger/inbox থেকে যেকোনো message পাঠালেই bot ওই customer-এর জন্য থেমে যাবে।', 'When ON, the bot pauses for that customer the moment an agent sends any message from Messenger/inbox.')}
              checked={s.autoPauseOnHumanTakeover}
              onChange={v => setS(p => ({ ...p, autoPauseOnHumanTakeover: v }))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <Label text={copy('Stop AI Command', 'Stop AI Command')} hint={copy('Agent chat-এ ঠিক এই text/emoji পাঠালে bot থেমে যাবে (Auto Pause toggle না থাকলেও কাজ করবে)।', 'When an agent sends exactly this text/emoji in the chat, the bot pauses — works even if Auto Pause is OFF.')}/>
                <input style={inp} value={s.stopAiCommand} placeholder="👍"
                  onChange={e => setS(p => ({ ...p, stopAiCommand: e.target.value }))} maxLength={40} />
              </div>
              <div>
                <Label text={copy('Start AI Command', 'Start AI Command')} hint={copy('Agent chat-এ ঠিক এই text/emoji পাঠালে bot আবার চালু হয়ে যাবে।', 'When an agent sends exactly this text/emoji in the chat, the bot resumes right away.')}/>
                <input style={inp} value={s.startAiCommand} placeholder="👍👍"
                  onChange={e => setS(p => ({ ...p, startAiCommand: e.target.value }))} maxLength={40} />
              </div>
            </div>
            <div>
              <Label text={copy('Auto Pause Timeout', 'Auto Pause Timeout')} hint={copy('Bot থামার এই সময় পর নিজে থেকেই আবার চালু হয়ে যাবে (Start command না দিলেও)।', 'The bot automatically resumes on its own after this much time, even without a Start command.')}/>
              <select style={inp} value={s.autoPauseTimeoutMinutes}
                onChange={e => setS(p => ({ ...p, autoPauseTimeoutMinutes: Number(e.target.value) }))}>
                <option value={10}>{copy('১০ মিনিট', '10 minutes')}</option>
                <option value={30}>{copy('৩০ মিনিট', '30 minutes')}</option>
                <option value={60}>{copy('১ ঘণ্টা', '1 hour')}</option>
                <option value={120}>{copy('২ ঘণ্টা', '2 hours')}</option>
                <option value={240}>{copy('৪ ঘণ্টা', '4 hours')}</option>
                <option value={0}>{copy('কখনো না (Never)', 'Never')}</option>
              </select>
            </div>
            <SaveRow onClick={() => save({
              autoPauseOnHumanTakeover: s.autoPauseOnHumanTakeover,
              autoPauseTimeoutMinutes: s.autoPauseTimeoutMinutes,
              stopAiCommand: s.stopAiCommand.trim(),
              startAiCommand: s.startAiCommand.trim(),
            })} saving={saving}/>
          </div>
        </Section>

        {/* University Mode */}
        <Section title={copy('🎓 ইউনিভার্সিটি মোড', '🎓 University Mode')} desc={copy('সক্রিয় করলে কমার্স বট বন্ধ হয়ে ইউনিভার্সিটি বট চালু হবে — নোটিশ auto-post এবং student Q&A।', 'Activates university bot (notice auto-post & student Q&A), disables commerce pipeline.')}>
          <Toggle th={th}
            label={copy('ইউনিভার্সিটি মোড চালু করুন', 'Enable University Mode')}
            sub={copy('চালু থাকলে OCR, order, product সব বন্ধ — শুধু ইউনিভার্সিটি bot কাজ করবে', 'When ON: orders, OCR, products are bypassed — only university bot runs')}
            checked={(s as any).universityModeOn ?? false}
            onChange={v => saveMode('universityModeOn', v)} />
        </Section>

        {/* V18: Image Recognition */}
        <Section title={copy('Image Recognition (AI)', 'Image Recognition (AI)')} desc={copy('ছবি থেকে product চেনার feature। Customer product code না দিয়ে ছবি পাঠালে bot বুঝতে চেষ্টা করবে।', 'Let the bot recognize products from customer images — no product code needed.')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Toggle th={th}
              label={copy('Image Recognition চালু', 'Enable Image Recognition')}
              sub={copy('Customer ছবি পাঠালে AI দিয়ে product match করার চেষ্টা করবে', 'When a customer sends an image, the bot will try to match it with products using AI')}
              checked={s.imageRecognitionOn}
              onChange={v => setS(p => ({ ...p, imageRecognitionOn: v }))} />
            <Toggle th={th}
              label={copy('Image AI Fallback চালু', 'Enable Image AI Fallback')}
              sub={copy('ছবিতে low confidence হলে AI fallback reply দেবে।', 'Use AI to generate a reply when image confidence is too low.')}
              checked={s.imageFallbackAiOn}
              onChange={v => setS(p => ({ ...p, imageFallbackAiOn: v }))} />
            <Toggle th={th}
              label={copy('Text AI Fallback চালু', 'Enable Text AI Fallback')}
              sub={copy('Bot বুঝতে না পারলে AI context বুঝে জবাব দেবে।', 'When the bot cannot match a message, AI will understand the context and reply.')}
              checked={s.textFallbackAiOn}
              onChange={v => setS(p => ({ ...p, textFallbackAiOn: v }))} />
            {s.imageRecognitionOn && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
                <div>
                  <Label text={copy('High Confidence Threshold', 'High Confidence Threshold')} hint={copy('এই মানের উপরে হলে bot সরাসরি product দেখাবে (0–1)', 'Above this score the bot auto-proceeds with the top match (0.0–1.0)')}/>
                  <input style={th.input} type="number" min={0} max={1} step={0.05}
                    value={s.imageHighConfidence}
                    onChange={e => setS(p => ({ ...p, imageHighConfidence: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label text={copy('Medium Confidence Threshold', 'Medium Confidence Threshold')} hint={copy('এই মানের উপরে হলে bot কয়েকটি option দেখাবে (0–1)', 'Above this score the bot shows 2–4 product options (0.0–1.0)')}/>
                  <input style={th.input} type="number" min={0} max={1} step={0.05}
                    value={s.imageMediumConfidence}
                    onChange={e => setS(p => ({ ...p, imageMediumConfidence: Number(e.target.value) }))} />
                </div>
              </div>
            )}
            <div style={{ fontSize: 12, color: th.muted, padding: '8px 12px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}` }}>
              {copy('Note: Product এর Category, Color, Keywords field fill করুন — matching আরো ভালো হবে।', 'Note: Fill in Category, Color, and Keywords on each product for better matching accuracy.')}
            </div>

          </div>
        </Section>

        {/* V29: Product card buttons — client-configurable buttons on Messenger product cards */}
        <Section title={copy('🃏 Product Card Buttons', '🃏 Product Card Buttons')} desc={copy('Bot যে product card পাঠায় তাতে কোন কোন button থাকবে সেটা এখানে ঠিক করুন (সর্বোচ্চ ৩টা)।', 'Choose which buttons appear on the product cards the bot sends (up to 3).')}>
          <CardButtonsEditor th={th} buttons={s.cardButtons} onChange={b => setS(p => ({ ...p, cardButtons: b }))} />
        </Section>

        <SaveRow onClick={() => save({
          imageRecognitionOn: s.imageRecognitionOn,
          imageHighConfidence: s.imageHighConfidence,
          imageMediumConfidence: s.imageMediumConfidence,
          imageFallbackAiOn: s.imageFallbackAiOn,
          textFallbackAiOn: s.textFallbackAiOn,
          businessBotOn: s.businessBotOn,
          businessInfo: s.businessInfo,
          cardButtons: s.cardButtons.filter(b =>
            b.label.trim() && (b.type !== 'custom' || (b.url ?? '').trim() || (b.replyText ?? '').trim())
          ),
        })} saving={saving}/>
      </div>
    </div>
  );

  // ── SETTINGS_KNOWLEDGE ─────────────────────────────────────────────────────
  if (tab === 'SETTINGS_KNOWLEDGE') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, ...cssVars }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>🧠 Knowledge & Pricing</h1>
        <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('Bot যা জানবে এবং দাম নিয়ে কীভাবে কথা বলবে', 'What the bot knows and how it handles pricing')}</p>
      </div>

      <div style={{ ...th.card }}>
        <Section
          title="✍️ Custom Prompt"
          desc={copy(
            'Bot কে চালানোর জন্য নিজের ভাষায় একটাই পূর্ণ prompt লিখুন — role, greeting, product info, discount/delivery/return নিয়ম, order নেওয়ার flow, সব এখানেই। চালু করলে নিচের Knowledge/Behavior/Personality/Pricing আলাদা করে সেট করার দরকার নেই।',
            'Write one complete prompt in your own words to run the bot — role, greeting, product info, discount/delivery/return rules, order flow, all in one place. When on, you no longer need the separate Knowledge/Behavior/Personality/Pricing sections below.'
          )}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['guided', 'custom'] as const).map(m => (
              <button key={m} onClick={() => setS(p => ({ ...p, promptMode: m }))}
                style={{
                  ...th.btnSm, flex: 1, justifyContent: 'center',
                  background: s.promptMode === m ? th.accent : th.surface,
                  color: s.promptMode === m ? '#fff' : th.textSub,
                  border: `1px solid ${s.promptMode === m ? th.accent : th.border}`,
                }}>
                {m === 'guided' ? copy('🧩 Guided (Default)', '🧩 Guided (Default)') : copy('✍️ Custom Prompt', '✍️ Custom Prompt')}
              </button>
            ))}
          </div>

          {s.promptMode === 'custom' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Label
                  text={copy('System Prompt', 'System Prompt')}
                  hint={copy(
                    'উদাহরণ:\nROLE: Amader Mart-এর sales assistant। Wireless Ear Pick নিয়ে customer-দের সাহায্য করো।\nGreeting, product info, discount rule, delivery/return policy, order collection flow — সব লিখুন।\nProduct-এর দাম/stock bot নিজে থেকেই জানবে, আলাদা করে লেখার দরকার নেই।',
                    'Example:\nROLE: Amader Mart\'s sales assistant. Help customers with the Wireless Ear Pick.\nWrite the greeting, product info, discount rules, delivery/return policy, and order-collection flow.\nProduct price/stock is injected automatically — no need to hardcode it.'
                  )}
                />
                <span style={{ fontSize: 11, color: s.customSystemPrompt.length > 7500 ? '#f87171' : th.muted }}>
                  {s.customSystemPrompt.length}/8000
                </span>
              </div>
              <textarea
                style={{ ...inp, minHeight: 320, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
                value={s.customSystemPrompt}
                maxLength={8000}
                onChange={e => setS(p => ({ ...p, customSystemPrompt: e.target.value }))}
                placeholder={copy(
                  'ROLE: ...\n\nCONVERSATION FLOW:\n1. ...\n\nPRODUCT DETAILS:\n...\n\nDISCOUNT RULES:\n...\n\nDELIVERY:\n...\n\nORDER FLOW:\n...',
                  'ROLE: ...\n\nCONVERSATION FLOW:\n1. ...\n\nPRODUCT DETAILS:\n...\n\nDISCOUNT RULES:\n...\n\nDELIVERY:\n...\n\nORDER FLOW:\n...'
                )}
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                {copy(
                  '⚠️ Product-এর live দাম/stock ও order-collection JSON format bot নিজে থেকেই handle করবে — শুধু business behavior/tone/policy লিখুন।',
                  "⚠️ Live product price/stock and the order-collection JSON format are still handled automatically — just write your business behavior/tone/policy."
                )}
              </div>
            </div>
          )}
        </Section>
        <SaveRow onClick={savePrompt} saving={promptSaving} label="Save Custom Prompt"/>
      </div>

      {s.promptMode !== 'custom' && (<>
      <div style={{ ...th.card }}>
        {/* AI Knowledge */}
        <Section title="🤖 AI Business Knowledge" desc="এখানে লেখো — AI bot এই তথ্য দিয়ে customer-দের সঠিক reply দেবে">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Label text="FAQ / Product Info / Policies" hint="AI bot এই text পড়ে customer-এর প্রশ্নের উত্তর দেবে। Products, delivery, payment, return policy লেখো।"/>
              <span style={{ fontSize: 11, color: s.knowledgeText.length > 2800 ? '#f87171' : th.muted }}>
                {s.knowledgeText.length}/3000
              </span>
            </div>

            {/* FlamboyAI Pricing Info Panel — admin only */}
            {isAdmin && <div style={{ marginBottom: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(79,110,247,0.07)', border: `1px solid rgba(79,110,247,0.2)` }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: th.accent, marginBottom: 8 }}>📋 FlamboyAI Service Info — Bot কে শেখান</div>
              <div style={{ fontSize: 11.5, color: th.muted, marginBottom: 10, lineHeight: 1.6 }}>
                নিচের বাটনে click করলে FlamboyAI এর সব নতুন pricing ও service info automatically আপনার knowledge box এ add হবে। তারপর নিজের product info যোগ করুন।
              </div>
              <div style={{ background: th.surface, borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: th.muted, lineHeight: 1.8, border: `1px solid ${th.border}`, marginBottom: 10, maxHeight: 160, overflowY: 'auto' }}>
                <strong style={{ color: th.text }}>FlamboyAI — যা bot জানবে:</strong><br/>
                ✦ Platform fee: আলোচনা সাপেক্ষ (admin এর সাথে কথা বলে deal)<br/>
                ✦ AI reply: ৳০.০৫/msg | SmartBot: ৳০.০৮/msg<br/>
                ✦ Customer image (Vision AI): ৳০.২০ | OCR: ৳০.০২–০.০৫<br/>
                ✦ Voice note (STT): ৳১.০০ | Product analyze: ৳০.২০<br/>
                ✦ Broadcast: ৳০.০৫/msg | Subscriber notification: ৳০.১০/msg<br/>
                ✦ Memo print: ৳০.১০ | Comment reply: ৳০.০৫<br/>
                ✦ Courier, Accounting, CRM — বিনামূল্যে<br/>
                ✦ ১টি image + ৫ AI reply = মাত্র ৬০–৮০ পয়সা<br/>
                ✦ Subscriber notification: Facebook Ad ছাড়াই পুরনো customer reach — ৳০.১০/msg<br/>
                ✦ Payment: bKash/Nagad wallet recharge | ৭ দিন free trial
              </div>
              <button
                style={{ ...th.btnPrimary, fontSize: 12, padding: '7px 14px' }}
                onClick={() => {
                  const sections: Record<string, string> = {
                    'cc-pricing': `## FlamboyAI AI Pricing (Wallet)\n- AI text reply: ৳০.০৫/msg\n- AI SmartBot: ৳০.০৮/msg\n- Customer image (Vision AI): ৳০.২০/image\n- OCR: ৳০.০২–০.০৫/scan\n- Voice note (STT): ৳১.০০/voice\n- Product analyze: ৳০.২০\n- Broadcast: ৳০.০৫/msg\n- Subscriber notification: ৳০.১০/msg\n- Comment reply: ৳০.০৫\n- Memo print: ৳০.১০`,
                    'cc-free': `## বিনামূল্যে\nCourier (Pathao/Steadfast/RedX/Paperfly), Order management, Accounting, CRM, Analytics, Product catalog`,
                    'cc-example': `## Real Example\n১ image + ৫ AI reply = ৳০.২০ + (৫×৳০.০৮) = মাত্র ৳০.৬০`,
                    'cc-subscriber': `## Subscriber Notification\nOrder পরে subscribe করা customer দের যেকোনো সময় নতুন পণ্যের message — ৳০.১০/msg। Facebook Ad ছাড়া।`,
                    'cc-payment': `## Payment ও Trial\nbKash, Nagad, Rocket, Bank | ৭ দিন free trial | Balance শেষ হলে AI বন্ধ, courier চলবে`,
                  };
                  let text = s.knowledgeText;
                  let changed = false;
                  for (const [key, newContent] of Object.entries(sections)) {
                    const start = `<!--CC:${key}-->`;
                    const end = `<!--/CC:${key}-->`;
                    const block = `${start}\n${newContent}\n${end}`;
                    const si = text.indexOf(start);
                    const ei = text.indexOf(end);
                    if (si !== -1 && ei !== -1) {
                      const existing = text.slice(si + start.length + 1, ei - 1);
                      if (existing.trim() !== newContent.trim()) {
                        text = text.slice(0, si) + block + text.slice(ei + end.length);
                        changed = true;
                      }
                    } else {
                      text = text.trim() + (text.trim() ? '\n\n' : '') + block;
                      changed = true;
                    }
                  }
                  if (changed) setS(p => ({ ...p, knowledgeText: text.slice(0, 3000) }));
                }}
              >
                🔄 FlamboyAI Info Sync করুন
              </button>
            </div>}

            <textarea
              style={{ ...inp, minHeight: 140, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              value={s.knowledgeText}
              maxLength={3000}
              onChange={e => setS(p => ({ ...p, knowledgeText: e.target.value }))}
              placeholder={`উদাহরণ:\nআমাদের products: সব ধরনের মেয়েদের পোশাক — saree, kameez, kurti। দাম: ৳৩৫০-৳২৫০০।\nDelivery: ঢাকার ভিতরে ৳৮০, বাইরে ৳১৩০। ২-৩ দিনে পাবেন।\nPayment: Cash on Delivery। Outside Dhaka-তে ৳১০০ advance।\nReturn: ৭ দিনের মধ্যে exchange। Cash refund নেই।\nFAQ: রং বদলানো যাবে কি? — হ্যাঁ, order-এর সময় বলুন।`}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                style={{ ...th.btnGhost, fontSize: 12, opacity: scraping ? 0.6 : 1 }}
                onClick={scrapeWebsite}
                disabled={scraping || !s.websiteUrl}
                title={s.websiteUrl ? 'Website থেকে text extract করবে' : 'আগে Website URL দিন'}
              >
                {scraping ? '⏳ Scraping...' : '🌐 Website থেকে Auto-fill'}
              </button>
              <button
                style={{ ...th.btn, fontSize: 12, opacity: knowledgeSaving ? 0.6 : 1 }}
                onClick={saveKnowledge}
                disabled={knowledgeSaving}
              >
                {knowledgeSaving ? '...' : '💾 Save Knowledge'}
              </button>
            </div>
            {scrapePreview !== null && (
              <div style={{ marginTop: 10, padding: 10, background: th.surface, borderRadius: 6, border: `1px solid ${th.border}` }}>
                <div style={{ fontSize: 11, color: th.muted, marginBottom: 6 }}>Preview (click "Use This" to apply):</div>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', color: th.text, margin: 0 }}>{scrapePreview.slice(0, 500)}{scrapePreview.length > 500 ? '...' : ''}</pre>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button style={{ ...th.btn, fontSize: 11 }} onClick={() => {
                    setS(p => ({ ...p, knowledgeText: scrapePreview.slice(0, 3000) }));
                    setScrapePreview(null);
                  }}>✓ Use This</button>
                  <button style={{ ...th.btnGhost, fontSize: 11 }} onClick={() => setScrapePreview(null)}>✕ Cancel</button>
                </div>
              </div>
            )}
          </div>
        </Section>

        <SaveRow onClick={saveKnowledge} saving={knowledgeSaving} label="Save Knowledge"/>
      </div>

      <div style={{ ...th.card, marginTop: 16 }}>
        {/* Behavior Instructions — custom business rules, separate from tone and FAQ */}
        <Section
          title="📏 Behavior Instructions (নিয়ম-কানুন)"
          desc={copy(
            'Bot সবসময় কী করবে বা কখনো করবে না তা এখানে লিখুন — যেমন নিয়ম, শর্ত। এটা "কী জানবে" (Knowledge) বা "কীভাবে কথা বলবে" (Personality) থেকে আলাদা।',
            'Write rules the bot must always or never follow — different from Knowledge (facts) and Personality (tone).'
          )}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Label
                text={copy('Business Behavior Rules', 'Business Behavior Rules')}
                hint={copy(
                  'উদাহরণ:\n"কনফার্ম করার আগে সবসময় সাইজ জিজ্ঞেস করবে।"\n"কখনো ছাড় দেবে না, দাম নিয়ে দর কষাকষি করবে না।"\n"রাগান্বিত customer পেলে সাথে সাথে Agent/মানুষের কাছে পাঠাবে।"',
                  'Example:\n"Always ask about size before confirming an order."\n"Never offer a discount, don\'t negotiate on price."\n"If the customer sounds angry, escalate to a human agent immediately."'
                )}
              />
              <span style={{ fontSize: 11, color: s.behaviorInstructions.length > 2800 ? '#f87171' : th.muted }}>
                {s.behaviorInstructions.length}/3000
              </span>
            </div>
            <textarea
              style={{ ...inp, minHeight: 120, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              value={s.behaviorInstructions}
              maxLength={3000}
              onChange={e => setS(p => ({ ...p, behaviorInstructions: e.target.value }))}
              placeholder={copy(
                'উদাহরণ:\nকনফার্ম করার আগে সবসময় সাইজ জিজ্ঞেস করবে।\nকখনো নিজে থেকে ছাড় অফার করবে না।\nকাস্টমার রাগ দেখালে সাথে সাথে "Agent" action দিয়ে human agent-কে জানাবে।',
                'Example:\nAlways ask for size before confirming.\nNever offer a discount on your own.\nIf a customer sounds angry, escalate to a human agent immediately.'
              )}
            />
            <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
              {copy(
                '⚠️ এটা Bot-এর order/payment প্রসেস পরিবর্তন করতে পারবে না — শুধু বাড়তি নিয়ম/আচরণ যোগ করবে।',
                "⚠️ This can't change the bot's order/payment logic — it only adds extra behavior rules on top."
              )}
            </div>
          </div>
        </Section>
        <SaveRow onClick={saveBehavior} saving={behaviorSaving} label="Save Behavior Rules"/>
      </div>

      <div style={{ ...th.card, marginTop: 16 }}>
        {/* Bot Personality / System Prompt */}
        <Section title="🎭 Bot Personality" desc={copy('Bot কীভাবে কথা বলবে তার নিজস্ব style লিখুন — খালি রাখলে default tone ব্যবহার হবে', "Write your bot's own tone/personality — leave empty to use the default tone")}>
          <div>
            <Label text={copy('System Prompt / Tone Instructions', 'System Prompt / Tone Instructions')} hint={copy('উদাহরণ: "তুমি বন্ধুত্বপূর্ণ কিন্তু professional। সবসময় আপনি করে সম্বোধন করবে। বেশি ইমোজি ব্যবহার করবে না।"', 'Example: "Be friendly but professional. Always use polite pronouns. Do not overuse emojis."')}/>
            <textarea
              style={{ ...inp, minHeight: 120, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              value={s.customPersonaPrompt}
              maxLength={4000}
              onChange={e => setS(p => ({ ...p, customPersonaPrompt: e.target.value }))}
              placeholder={copy('খালি থাকলে bot এর default personality ব্যবহার হবে...', 'Leave empty to use the bot\'s default personality...')}
            />
            <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>{s.customPersonaPrompt.length}/4000</div>
          </div>
        </Section>
        <SaveRow onClick={savePersona} saving={personaSaving} label="Save Personality"/>
      </div>

      <div style={{ ...th.card, marginTop: 16 }}>
        <Section title="Pricing Policy" desc="How the bot handles customer price requests">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Label text="Price Mode"/>
              <div style={{ display: 'flex', gap: 8 }}>
                {['FIXED','NEGOTIABLE'].map(m => (
                  <button key={m} onClick={() => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, priceMode: m } }))}
                    style={{
                      ...th.btnSm, flex: 1, justifyContent: 'center',
                      background: s.pricingPolicy.priceMode === m ? th.accent : th.surface,
                      color: s.pricingPolicy.priceMode === m ? '#fff' : th.textSub,
                      border: `1px solid ${s.pricingPolicy.priceMode === m ? th.accent : th.border}`,
                    }}>
                    {m === 'FIXED' ? '🔒 Fixed Price' : '💬 Negotiable'}
                  </button>
                ))}
              </div>
            </div>

            {s.pricingPolicy.priceMode === 'NEGOTIABLE' && (
              <>
                <Toggle th={th} label="Allow Customer Offers" sub={copy('Customer কে নিজে দাম propose করতে দেবে', 'Allow customers to suggest their own price')}
                  checked={s.pricingPolicy.allowCustomerOffer}
                  onChange={v => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, allowCustomerOffer: v } }))}/>
                <Toggle th={th} label="Agent Approval Required" sub={copy('Offer agent approve করার পরেই confirm হবে', 'Offers will be confirmed only after agent approval')}
                  checked={s.pricingPolicy.agentApprovalRequired}
                  onChange={v => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, agentApprovalRequired: v } }))}/>
                <Grid>
                  <div>
                    <Label text="Min Discount Type"/>
                    <select style={inp} value={s.pricingPolicy.minNegotiationType}
                      onChange={e => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, minNegotiationType: e.target.value } }))}>
                      <option value="PERCENT">Percent (%)</option>
                      <option value="FIXED">Fixed Amount (৳)</option>
                    </select>
                  </div>
                  <div>
                    <Label text="Min Discount Value" hint={copy('০ দিলে কোনো minimum নেই', 'Use 0 for no minimum limit')}/>
                    <input style={inp} type="number" min={0} value={s.pricingPolicy.minNegotiationValue}
                      onChange={e => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, minNegotiationValue: Number(e.target.value) } }))}/>
                  </div>
                </Grid>
              </>
            )}

            <div>
              <Label text="Fixed Price Reply" hint="Negotiation reject করলে bot এই message পাঠাবে"/>
              <input style={inp} value={s.pricingPolicy.fixedPriceReplyText}
                onChange={e => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, fixedPriceReplyText: e.target.value } }))}/>
            </div>
            <div>
              <Label text="Negotiation Reply" hint="Offer accept করলে এই message"/>
              <input style={inp} value={s.pricingPolicy.negotiationReplyText}
                onChange={e => setS(p => ({ ...p, pricingPolicy: { ...p.pricingPolicy, negotiationReplyText: e.target.value } }))}/>
            </div>
          </div>
        </Section>

        <SaveRow onClick={savePricing} saving={saving} label="Save Pricing"/>
      </div>
      </>)}
    </div>
  );
  // ── CALL ──────────────────────────────────────────────────────────────────
  if (tab === 'SETTINGS_CALL') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', ...cssVars }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>📞 Call Confirm</h1>
        <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('Order আসলে customer কে call করে confirm নেওয়া', 'Call the customer to confirm each order')}</p>
      </div>

      {/* How it works */}
      <div style={{ background: th.accentSoft, border: `1px solid ${th.accent}44`, borderRadius: 14, padding: '14px 18px', marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: th.accentText, marginBottom: 10 }}>{copy('ℹ️ কীভাবে কাজ করে?', 'ℹ️ How it works')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: th.textSub, lineHeight: 1.7 }}>
          <div>{copy('① Order receive হলে bot customer কে automatically call করে।', '① When an order is received, the bot automatically calls the customer.')}</div>
          <div>{copy('② Customer একটি pre-recorded message শোনে (Voice tab-এ set করো)।', '② The customer hears a pre-recorded message set from the Voice tab.')}</div>
          <div>{copy('③ Customer DTMF key চাপে → order status automatically update হয়।', '③ The customer presses a DTMF key and the order status updates automatically.')}</div>
          <div>{copy('④ Call না ধরলে Retry Interval পরে আবার call করে, সর্বোচ্চ Max Retries বার।', '④ If the call is not answered, the system retries after the Retry Interval up to Max Retries times.')}</div>
        </div>
      </div>

      <div style={th.card}>
        {/* Call Provider */}
        <Section title="📡 Call Provider" desc={copy('কোন service দিয়ে call যাবে', 'Choose which service will place the calls')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
            {CALL_PROVIDERS.map(opt => {
              const sel = (s.callSettings.callProvider || 'MANUAL') === opt.v;
              return (
                <button key={opt.v} onClick={() => setS(p => ({ ...p, callSettings: { ...p.callSettings, callProvider: opt.v } }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', fontFamily: 'inherit',
                    border: `2px solid ${sel ? th.accent : th.border}`, borderRadius: 12,
                    background: sel ? th.accentSoft : th.panel, cursor: 'pointer', textAlign: 'left', transition: 'all .12s' }}>
                  <span style={{ fontSize: 20 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: sel ? th.accentText : th.text }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>{opt.desc}</div>
                  </div>
                  {sel && <span style={{ color: th.accent, fontWeight: 800 }}>✓</span>}
                </button>
              );
            })}
          </div>
          {s.callSettings.callProvider && s.callSettings.callProvider !== 'MANUAL' && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: 12, color: '#92400e', lineHeight: 1.7 }}>
              ⚠️ <b>{s.callSettings.callProvider}</b> ব্যবহার করতে server-এর <code>.env</code> file-এ API credentials add করতে হবে।
              {s.callSettings.callProvider === 'TWILIO' && <><br/>Keys: <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_FROM_NUMBER</code>, <code>TWILIO_TWIML_BASE</code></>}
              {s.callSettings.callProvider === 'SSLWIRELESS' && <><br/>Keys: <code>SSLWIRELESS_API_KEY</code>, <code>SSLWIRELESS_CALLER_ID</code>, <code>SSLWIRELESS_API_URL</code></>}
              {s.callSettings.callProvider === 'BDCALLING' && <><br/>BDCalling API credentials সেট করুন .env-এ।</>}
            </div>
          )}
        </Section>

        {/* Call Rules */}
          <Section title="⚙️ Call Rules" desc={copy('কখন এবং কতবার call করবে', 'Choose when and how often calls should be placed')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toggle th={th}
              label={s.callSettings.callConfirmModeOn
                ? copy('Call Confirm Mode চালু', 'Call Confirm Mode is on')
                : copy('Call Confirm Mode বন্ধ', 'Call Confirm Mode is off')}
              sub={s.callSettings.callConfirmModeOn
                ? copy('নতুন order আসলে automatically call দেবে', 'New orders will trigger calls automatically')
                : copy('এখন call automatically যাবে না', 'Calls will not be placed automatically right now')}
              checked={s.callSettings.callConfirmModeOn}
              onChange={v => {
                if (v && s.modeAccess?.callConfirmModeOn === false) {
                  showPlanUpgradePopup();
                  return;
                }
                setS(p => ({ ...p, callSettings: { ...p.callSettings, callConfirmModeOn: v } }));
              }}/>
            <Grid>
              <div>
                <Label text="Call Mode" hint={copy('কখন call যাবে', 'Choose when the call should be placed')}/>
                <select style={inp} value={s.callSettings.callMode}
                  onChange={e => setS(p => ({ ...p, callSettings: { ...p.callSettings, callMode: e.target.value } }))}>
                  <option value="MANUAL">{copy('👤 Manual — Agent dashboard থেকে trigger করবে', '👤 Manual - triggered by an agent from the dashboard')}</option>
                  <option value="AUTO">{copy('🤖 Auto — Order আসার সাথে সাথে', '🤖 Auto - immediately after order creation')}</option>
                  <option value="AUTO_AFTER_DELAY">{copy('⏳ Auto after delay — custom time পরে', '⏳ Auto after delay - after your custom time')}</option>
                </select>
                {s.callSettings.callMode === 'AUTO_AFTER_DELAY' && (
                  <div style={{ fontSize: 11.5, color: th.muted, marginTop: 6 }}>
                    {copy(
                      `এই mode-এ order আসার ${s.callSettings.initialCallDelayMinutes} মিনিট পরে first call যাবে।`,
                      `In this mode, the first call will be placed ${s.callSettings.initialCallDelayMinutes} minute(s) after the order arrives.`,
                    )}
                  </div>
                )}
              </div>
              <div>
                <Label text="Confirmation Scope" hint={copy('কোন order এ call যাবে', 'Choose which orders should receive calls')}/>
                <select style={inp} value={s.callSettings.callConfirmationScope}
                  onChange={e => setS(p => ({ ...p, callSettings: { ...p.callSettings, callConfirmationScope: e.target.value } }))}>
                  <option value="ALL">{copy('সব orders', 'All orders')}</option>
                  <option value="NEW_CUSTOMERS">{copy('শুধু নতুন customers', 'New customers only')}</option>
                  <option value="HIGH_VALUE">High value orders only</option>
                </select>
              </div>
              <div>
                <Label text={copy('First Call Delay (মিনিট)', 'First Call Delay (minutes)')} hint={copy('Auto after delay mode-এ order আসার কত মিনিট পরে প্রথম call যাবে', 'How many minutes after the order arrives the first call should be placed in Auto after delay mode')}/>
                <input style={inp} type="number" min={1} value={s.callSettings.initialCallDelayMinutes}
                  onChange={e => setS(p => ({ ...p, callSettings: { ...p.callSettings, initialCallDelayMinutes: Number(e.target.value) } }))}/>
              </div>
              <div>
                <Label text={copy('Retry Interval (মিনিট)', 'Retry Interval (minutes)')} hint={copy('Call fail বা not answered হলে next retry এর আগে কত মিনিট wait করবে', 'How many minutes to wait before the next retry after a failed or unanswered call')}/>
                <input style={inp} type="number" min={5} value={s.callSettings.retryIntervalMinutes}
                  onChange={e => setS(p => ({ ...p, callSettings: { ...p.callSettings, retryIntervalMinutes: Number(e.target.value) } }))}/>
              </div>
              <div>
                <Label text={copy('সর্বোচ্চ Retry সংখ্যা', 'Maximum Retries')} hint={copy('কতবার পর্যন্ত try করবে তারপর CALL_FAILED', 'Number of retry attempts before marking the call as failed')}/>
                <input style={inp} type="number" min={1} max={10} value={s.callSettings.maxCallRetries}
                  onChange={e => setS(p => ({ ...p, callSettings: { ...p.callSettings, maxCallRetries: Number(e.target.value) } }))}/>
              </div>
            </Grid>
          </div>
        </Section>

        {/* DTMF keys reference */}
        <div style={{ background: th.surface, borderRadius: 12, padding: '14px 16px', marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            {copy('📱 Customer এর DTMF Keys', '📱 Customer DTMF Keys')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {DTMF_KEYS.map(d => (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', background: d.bg, borderRadius: 10, border: `1px solid ${d.color}30` }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: d.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>{d.key}</div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: d.color }}>{d.action}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: th.muted }}>
            {copy('💡 Voice script-এ এই keys mention করুন: "order confirm করতে ১ চাপুন, cancel করতে ২ চাপুন, agent-এর সাহায্য নিতে ৩ চাপুন।"', '💡 Mention these keys in the voice script: "Press 1 to confirm, 2 to cancel, 3 to speak with an agent."')}
          </div>
        </div>

        <SaveRow onClick={saveCall} saving={saving} label="Save Call Settings"/>
      </div>

      {/* ── Coming Soon Overlay ── */}
      {!s.modeAccess?.callFeatureEnabled && <div style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
      }}>
        <div style={{ fontSize: 52 }}>🚀</div>
        <div style={{
          fontSize: 30, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff',
          textShadow: '0 2px 16px rgba(0,0,0,0.4)',
        }}>Coming Soon</div>
        <div style={{
          fontSize: 13.5, color: 'rgba(255,255,255,0.75)', textAlign: 'center',
          maxWidth: 280, lineHeight: 1.7,
        }}>
          Call Confirm feature টি শীঘ্রই চালু হবে।<br/>Stay tuned! 🎉
        </div>
      </div>}
    </div>
  );

  // ── VOICE ─────────────────────────────────────────────────────────────────
  if (tab === 'SETTINGS_VOICE') {
    const voiceHints = VOICE_ID_HINTS[s.voiceSettings.ttsProvider] ?? null;
    const codeStyle: React.CSSProperties = { background: th.accentSoft, color: th.accentText, padding: '1px 6px', borderRadius: 4, fontSize: 11 };
    const isManualUpload = s.voiceSettings.ttsProvider === 'MANUAL_UPLOAD';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', ...cssVars }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>🎙 Voice & TTS</h1>
          <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('Call confirmation-এ customer কোন voice শুনবে — script লেখো, audio তৈরি করো', 'Choose the voice customers hear during confirmation calls, write the script, and generate the audio')}</p>
        </div>

        <div style={th.card}>
          {/* TTS Provider */}
          <Section title="🤖 TTS Provider" desc={copy('কোন AI service দিয়ে voice তৈরি হবে', 'Choose which AI service will generate the voice')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
              {TTS_PROVIDERS.map(opt => {
                const sel = (s.voiceSettings.ttsProvider || '') === opt.v;
                return (
                  <button key={opt.v} onClick={() => setS(p => ({ ...p, voiceSettings: { ...p.voiceSettings, ttsProvider: opt.v } }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', fontFamily: 'inherit',
                      border: `2px solid ${sel ? th.accent : th.border}`, borderRadius: 12,
                      background: sel ? th.accentSoft : th.panel, cursor: 'pointer', textAlign: 'left', transition: 'all .12s' }}>
                    <span style={{ fontSize: 20 }}>{opt.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: sel ? th.accentText : th.text }}>{opt.label}</div>
                        {'featured' in opt && opt.featured && (
                          <span style={{
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 999,
                            background: '#dcfce7',
                            color: '#166534',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}>
                            {copy('Recommended', 'Recommended')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                    {sel && <span style={{ color: th.accent, fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })}
            </div>
            {s.voiceSettings.ttsProvider === 'MANUAL_UPLOAD' && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, fontSize: 12, color: '#166534', lineHeight: 1.7 }}>
                {copy(
                  '✅ এই option select করলে নিচে নিজের recorded voice upload করে calling-এ use করতে পারবেন। এটা সবচেয়ে সহজ setup।',
                  '✅ Select this option to upload your own recorded voice below and use it for calling. This is the easiest setup.',
                )}
              </div>
            )}
            {s.voiceSettings.ttsProvider && s.voiceSettings.ttsProvider !== 'MANUAL_UPLOAD' && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: 12, color: '#92400e', lineHeight: 1.7 }}>
                {copy(
                  `⚠️ ${s.voiceSettings.ttsProvider} ব্যবহার করতে চাইলে Admin এর সাথে যোগাযোগ করুন।`,
                  `⚠️ To use ${s.voiceSettings.ttsProvider}, please contact the Admin.`,
                )}
              </div>
            )}
          </Section>


          {!isManualUpload && (
            <Section title="🔑 Voice IDs" desc={copy('Provider-এর নিজস্ব voice identifier — খালি রাখলে default ব্যবহার হবে', 'Provider-specific voice IDs. Leave empty to use the default voice')}>
              <Grid>
                <div>
                  <Label text="Bangla Voice ID" hint={voiceHints?.bn}/>
                  <input style={inp} value={s.voiceSettings.banglaVoiceId}
                    placeholder={voiceHints?.bnPlaceholder || 'Default (empty)'}
                    onChange={e => setS(p => ({ ...p, voiceSettings: { ...p.voiceSettings, banglaVoiceId: e.target.value } }))}/>
                </div>
                <div>
                  <Label text="English Voice ID" hint={voiceHints?.en}/>
                  <input style={inp} value={s.voiceSettings.englishVoiceId}
                    placeholder={voiceHints?.enPlaceholder || 'Default (empty)'}
                    onChange={e => setS(p => ({ ...p, voiceSettings: { ...p.voiceSettings, englishVoiceId: e.target.value } }))}/>
                </div>
              </Grid>
            </Section>
          )}

          {/* Scripts + audio player */}
          <Section
            title={isManualUpload ? copy('📤 Voice Upload', '📤 Voice Upload') : '📜 Call Scripts'}
            desc={
              isManualUpload
                ? copy('নিজের recorded audio upload করুন - calling system এ এটিই play হবে', 'Upload your own recorded audio - this exact file will be played in the calling system')
                : copy('Customer call ধরলে এই message শুনবে', 'This message will play when the customer answers the call')
            }
          >
            <div style={{ fontSize: 12, color: th.muted, marginBottom: 12, padding: '8px 12px', background: th.surface, borderRadius: 8, lineHeight: 1.8 }}>
              {isManualUpload ? (
                <>
                  <b>{copy('কি বলা উচিত:', 'What should the voice say:')}</b>{' '}
                  {copy(
                    'ছোট, পরিষ্কার, ভদ্র message দিন। যেমন: "আসসালামু আলাইকুম। আপনার অর্ডার confirm করতে ১ চাপুন, cancel করতে ২ চাপুন, agent-এর সাথে কথা বলতে ৩ চাপুন।"',
                    'Keep it short, clear, and polite. Example: "Hello. To confirm your order press 1, to cancel press 2, and to speak with an agent press 3."',
                  )}
                </>
              ) : (
                <>
                  {copy('💡 Script-এ variables ব্যবহার করো:', '💡 You can use variables in the script:')}&nbsp;
                  <code style={codeStyle}>{'{{customerName}}'}</code>&nbsp;
                  <code style={codeStyle}>{'{{orderId}}'}</code>&nbsp;
                  <code style={codeStyle}>{'{{total}}'}</code>
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <input
                ref={banglaVoiceUploadRef}
                type="file"
                accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  void uploadVoice('BN', file);
                  e.currentTarget.value = '';
                }}
              />
              <input
                ref={englishVoiceUploadRef}
                type="file"
                accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  void uploadVoice('EN', file);
                  e.currentTarget.value = '';
                }}
              />
              {/* Bangla */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <Label text={isManualUpload ? copy('🇧🇩 বাংলা Audio', '🇧🇩 Bangla Audio') : copy('🇧🇩 বাংলা Script', '🇧🇩 Bangla Script')}/>
                  {s.voiceSettings.banglaVoiceFileUrl
                    ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, background: '#f0fdf4', border: '1px solid #86efac', padding: '2px 8px', borderRadius: 6 }}>✅ Audio ready</span>
                    : <span style={{ fontSize: 11, color: th.muted }}>No audio file</span>}
                </div>
                {!isManualUpload && (
                  <textarea style={{ ...inp, height: 80, resize: 'vertical' as const, fontFamily: 'inherit' }}
                    value={s.voiceSettings.banglaCallScript}
                    onChange={e => setS(p => ({ ...p, voiceSettings: { ...p.voiceSettings, banglaCallScript: e.target.value } }))}
                    placeholder={copy('আপনার order confirm করতে ১ চাপুন, cancel করতে ২ চাপুন, agent-এর সাথে কথা বলতে ৩ চাপুন।', 'Press 1 to confirm your order, 2 to cancel, and 3 to speak with an agent.')}/>
                )}
                {s.voiceSettings.banglaVoiceFileUrl && (
                  <div style={{ marginTop: 8, background: th.surface, borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: th.muted, marginBottom: 5 }}>{copy('🎵 বাংলা Voice Preview:', '🎵 Bangla Voice Preview:')}</div>
                    <audio controls src={s.voiceSettings.banglaVoiceFileUrl} style={{ width: '100%', height: 36 }}/>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {!isManualUpload && (
                    <button style={{ ...th.btnPrimary, fontSize: 12 }}
                      onClick={() => generateVoice('BN')}
                      disabled={voiceBusy['BN'] || !s.voiceSettings.banglaCallScript || !s.voiceSettings.ttsProvider || s.voiceSettings.ttsProvider === 'MANUAL_UPLOAD'}>
                      {voiceBusy['BN'] ? <><Spinner size={12}/> {copy('Generating...', 'Generating...')}</> : copy('🎙 বাংলা Voice তৈরি করো', 'Generate Bangla Voice')}
                    </button>
                  )}
                  <button
                    style={{ ...(isManualUpload ? th.btnPrimary : th.btnGhost), fontSize: 12 }}
                    onClick={() => banglaVoiceUploadRef.current?.click()}
                    disabled={voiceBusy['BN']}
                  >
                    {voiceBusy['BN'] ? <><Spinner size={12}/> {copy('Uploading...', 'Uploading...')}</> : copy('📤 নিজের Audio Upload', 'Upload your own audio')}
                  </button>
                  {!s.voiceSettings.ttsProvider && <span style={{ fontSize: 12, color: '#d97706', alignSelf: 'center' }}>{copy('উপরে একটি option select করুন', 'Select an option above')}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: th.muted, marginTop: 8 }}>
                  {copy('চাইলে mp3/wav/m4a নিজের voice upload করতে পারেন। Call-এর সময় এই audio-টাই use হবে।', 'You can also upload your own mp3, wav, or m4a file. This audio will be used during calls.')}
                </div>
              </div>

              {/* English */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <Label text={isManualUpload ? '🇺🇸 English Audio' : '🇺🇸 English Script'}/>
                  {s.voiceSettings.englishVoiceFileUrl
                    ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, background: '#f0fdf4', border: '1px solid #86efac', padding: '2px 8px', borderRadius: 6 }}>✅ Audio ready</span>
                    : <span style={{ fontSize: 11, color: th.muted }}>No audio file</span>}
                </div>
                {!isManualUpload && (
                  <textarea style={{ ...inp, height: 80, resize: 'vertical' as const, fontFamily: 'inherit' }}
                    value={s.voiceSettings.englishCallScript}
                    onChange={e => setS(p => ({ ...p, voiceSettings: { ...p.voiceSettings, englishCallScript: e.target.value } }))}
                    placeholder="Press 1 to confirm your order, press 2 to cancel, press 3 to speak with an agent."/>
                )}
                {s.voiceSettings.englishVoiceFileUrl && (
                  <div style={{ marginTop: 8, background: th.surface, borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: th.muted, marginBottom: 5 }}>🎵 English Voice Preview:</div>
                    <audio controls src={s.voiceSettings.englishVoiceFileUrl} style={{ width: '100%', height: 36 }}/>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {!isManualUpload && (
                    <button style={{ ...th.btnGhost, fontSize: 12 }}
                      onClick={() => generateVoice('EN')}
                      disabled={voiceBusy['EN'] || !s.voiceSettings.englishCallScript || !s.voiceSettings.ttsProvider || s.voiceSettings.ttsProvider === 'MANUAL_UPLOAD'}>
                      {voiceBusy['EN'] ? <><Spinner size={12}/> {copy('Generating...', 'Generating...')}</> : copy('🎙 English Voice তৈরি করো', 'Generate English Voice')}
                    </button>
                  )}
                  <button
                    style={{ ...(isManualUpload ? th.btnPrimary : th.btnGhost), fontSize: 12 }}
                    onClick={() => englishVoiceUploadRef.current?.click()}
                    disabled={voiceBusy['EN']}
                  >
                    {voiceBusy['EN'] ? <><Spinner size={12}/> {copy('Uploading...', 'Uploading...')}</> : copy('📤 নিজের Audio Upload', 'Upload your own audio')}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: th.muted, marginTop: 8 }}>
                  {copy('নিজের recorded English audio upload করলেও call system সেটা use করবে।', 'You can upload your own recorded English audio and the call system will use it.')}
                </div>
              </div>
            </div>
            {s.voiceSettings.voiceGeneratedAt && (
              <div style={{ marginTop: 12, fontSize: 12, color: th.muted }}>
                🕐 Last generated: {new Date(s.voiceSettings.voiceGeneratedAt).toLocaleString()}
              </div>
            )}
          </Section>

          <SaveRow onClick={() => saveVoice(true)} saving={saving} label="Save Voice Settings"/>
        </div>

        {/* ── Coming Soon Overlay ── */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(15,23,42,0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderRadius: 16,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 52 }}>🚀</div>
          <div style={{
            fontSize: 30, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff',
            textShadow: '0 2px 16px rgba(0,0,0,0.4)',
          }}>Coming Soon</div>
          <div style={{
            fontSize: 13.5, color: 'rgba(255,255,255,0.75)', textAlign: 'center',
            maxWidth: 280, lineHeight: 1.7,
          }}>
            Voice & TTS feature টি শীঘ্রই চালু হবে।<br/>Stay tuned! 🎉
          </div>
        </div>
      </div>
    );
  }

  // ── TELEGRAM NOTIFICATIONS ────────────────────────────────────────────────
  if (tab === 'SETTINGS_TELEGRAM') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', ...cssVars }}>
              {/* ── Telegram Bot Setup (merchant notifications) ── */}
        <Section title={copy('🤖 Telegram Bot সেটআপ', '🤖 Telegram Bot Setup')} desc={copy('নতুন order, cancel, কম balance ও subscription notification নিজের Telegram-এ পান', 'Get new order, cancel, low-balance and subscription alerts on your own Telegram')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{copy('Telegram নোটিফিকেশন', 'Telegram Notifications')}</div>
              <div style={{ fontSize: 11.5, color: th.muted }}>
                {s.telegramTokenSet
                  ? (s.telegramChatId ? `Chat ID: ${s.telegramChatId}` : copy('Token সেভ আছে — Chat ID নেই', 'Token saved — Chat ID missing'))
                  : copy('এখনো connect করা হয়নি', 'Not connected yet')}
              </div>
            </div>
            <Toggle
              th={th}
              checked={s.telegramNotifEnabled}
              onChange={v => setS(prev => ({ ...prev, telegramNotifEnabled: v }))}
              label=""
            />
          </div>

          {s.telegramNotifEnabled && <><details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', color: th.accent, userSelect: 'none', marginBottom: 6 }}>
              📋 {copy('কিভাবে নিজের Telegram Bot তৈরি করবেন? (ধাপে ধাপে)', 'How to create your own Telegram bot? (Step by step)')}
            </summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                copy('১. Telegram অ্যাপ খুলুন → সার্চ করুন "@BotFather" → চ্যাট শুরু করুন', '1. Open Telegram → search "@BotFather" → start a chat'),
                copy('২. /newbot লিখে পাঠান → আপনার bot-এর একটি নাম দিন → একটি username দিন (শেষে "bot" থাকতে হবে, যেমন MyShopAlertBot)', '2. Send /newbot → give your bot a name → give it a username (must end in "bot", e.g. MyShopAlertBot)'),
                copy('৩. BotFather একটি Token দেবে (যেমন 123456:ABC-xxxxx) → এটি কপি করে নিচের "Bot Token" field-এ দিন', '3. BotFather will give you a Token (e.g. 123456:ABC-xxxxx) → copy it into the "Bot Token" field below'),
                copy('৪. আপনার তৈরি bot-টি Telegram-এ সার্চ করে খুলুন → একটি মেসেজ পাঠান (যেমন "hi")', '4. Search for your new bot in Telegram → open it → send it a message (e.g. "hi")'),
                copy('৫. ব্রাউজারে যান: https://api.telegram.org/bot<TOKEN>/getUpdates (TOKEN এর জায়গায় আপনার token দিন) → "chat":{"id": ...} খুঁজুন → এই নাম্বারটাই আপনার Chat ID', '5. Visit https://api.telegram.org/bot<TOKEN>/getUpdates (replace TOKEN with your token) → find "chat":{"id": ...} → that number is your Chat ID'),
                copy('৬. Token ও Chat ID নিচে দিয়ে "Test Connection" চাপুন — Telegram-এ একটি test মেসেজ পাবেন', '6. Enter the Token and Chat ID below and click "Test Connection" — you should receive a test message on Telegram'),
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}` }}>
                  <span style={{ color: th.accent, flexShrink: 0 }}>→</span>
                  <span style={{ color: th.text, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </div>
          </details>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Bot Token {s.telegramTokenSet && <span style={{ color: '#22c55e', fontWeight: 400 }}>✓ saved</span>}
              </label>
              <input
                type="password"
                style={{ ...inp }}
                placeholder={s.telegramTokenSet ? '••••••• (পরিবর্তন করতে নতুন token দিন)' : '123456:ABC-xxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
              />
              <div style={{ fontSize: 11, color: th.muted, marginTop: 3 }}>
                @BotFather থেকে পাওয়া token
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Chat ID
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ ...inp, flex: 1 }}
                  placeholder="123456789"
                  value={s.telegramChatId}
                  onChange={e => setS(prev => ({ ...prev, telegramChatId: e.target.value }))}
                />
                <button
                  onClick={fetchTelegramChatId}
                  disabled={tgFetching}
                  style={{ ...th.btnPrimary, fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap', opacity: tgFetching ? 0.6 : 1 }}
                >
                  {tgFetching ? <Spinner size={13} /> : copy('Auto Fetch', 'Auto Fetch')}
                </button>
              </div>
              <div style={{ fontSize: 11, color: th.muted, marginTop: 3 }}>
                {copy('⚠️ আগে Telegram-এ আপনার bot-কে যেকোনো একটি message পাঠান, তারপর "Auto Fetch" চাপুন', '⚠️ First send any message to your bot on Telegram, then click "Auto Fetch"')}
              </div>
            </div>

            <div>
              <button
                onClick={testTelegram}
                disabled={tgTesting}
                style={{ ...th.btnGhost, fontSize: 12.5, opacity: tgTesting ? 0.6 : 1 }}
              >
                {tgTesting ? <><Spinner size={13} /> Testing...</> : `🧪 ${copy('Connection Test করুন', 'Test Connection')}`}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              onClick={saveTelegram}
              disabled={tgSaving}
              style={{ ...th.btnPrimary, opacity: tgSaving ? 0.6 : 1 }}
            >
              {tgSaving ? <><Spinner size={13} /> Saving...</> : `💾 ${copy('Telegram Save করুন', 'Save Telegram')}`}
            </button>
          </div></>}
        </Section>
    </div>
  );

  return null;
}
