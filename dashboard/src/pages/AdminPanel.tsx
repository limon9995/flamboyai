import { useCallback, useEffect, useRef, useState } from 'react';
import { CardHeader, EmptyState, FieldWithInfo, InfoButton, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { startImpersonation } from '../utils/impersonation';

type AdminTab = 'overview' | 'users' | 'clients' | 'global-questions' | 'global-replies' | 'learning-log' | 'courier-tutorials' | 'billing' | 'call-servers' | 'wallet' | 'pricing' | 'subscriptions' | 'page-requests' | 'wa-requests' | 'customers' | 'domain-setup' | 'api-keys' | 'reports' | 'agents' | 'my-clients' | 'earnings';

interface TutorialsConfig {
  courier?: { pathao?: string; steadfast?: string; redx?: string; paperfly?: string };
  facebookAccessToken?: string;
  generalOnboarding?: string;
  pageConnect?: string;
}

interface BillingSupportConfig {
  label?: string;
  phone?: string;
  whatsappUrl?: string;
  messengerUrl?: string;
  email?: string;
  note?: string;
  bkash?: string;
  nagad?: string;
  rocket?: string;
  bankAccount?: string;
  bankName?: string;
  bankBranch?: string;
  bankHolder?: string;
}

interface ModeratorAccessConfig {
  fbProfileLink?: string;
  email?: string;
}

const BILLING_FEATURES = [
  { key: 'automationAllowed', label: 'Automation' },
  { key: 'ocrAllowed', label: 'OCR' },
  { key: 'infoModeAllowed', label: 'Info Mode' },
  { key: 'orderModeAllowed', label: 'Order Mode' },
  { key: 'printModeAllowed', label: 'Print' },
  { key: 'callConfirmModeAllowed', label: 'Call Confirm' },
  { key: 'memoSaveModeAllowed', label: 'Memo Save' },
  { key: 'memoTemplateModeAllowed', label: 'Memo Template' },
  { key: 'autoMemoDesignModeAllowed', label: 'Auto Memo Design' },
] as const;

const DEFAULT_FEATURE_ACCESS = Object.fromEntries(
  BILLING_FEATURES.map((item) => [item.key, true]),
) as Record<(typeof BILLING_FEATURES)[number]['key'], boolean>;

interface ClientPage {
  id: number; pageId: string; pageName: string;
  isActive: boolean; automationOn: boolean; webOrderEnabled?: boolean; websiteEnabled?: boolean;
  masterPageId?: number | null;
  lastReconnectedAt?: string | null;
  previousPageId?: string | null;
  createdAt?: string;
  owner?: { id: string; username: string; name: string; isActive?: boolean };
  fbAppId?: string | null;
  hasCustomApp?: boolean;
}

interface AdminUser {
  id: string; username: string; name: string; email?: string | null;
  isActive: boolean; createdAt?: string;
  pageCount: number; credits: number; creditUsed: number;
  pages?: ClientPage[];
}

// Sidebar groups — the admin tabs are organised into labelled sections so the
// panel reads top-to-bottom instead of a flat wall of pills.
type AdminTabDef = { key: AdminTab; label: string; icon: string; help: string; group: string };

const ADMIN_TABS: AdminTabDef[] = [
  // ── Overview ──
  { key: 'overview',          label: 'Overview',          icon: '📊', group: 'Overview',      help: 'System এর সার্বিক অবস্থা দেখুন' },

  // ── Clients & Access ──
  { key: 'users',             label: 'Users',             icon: '👤', group: 'Clients & Access', help: 'সব user এর list — credits, businesses, status এবং impersonate।' },
  { key: 'clients',           label: 'Business Profiles', icon: '🏢', group: 'Clients & Access', help: 'সব page/business এর list এবং তাদের bot knowledge পরিচালনা করুন' },
  { key: 'page-requests',     label: 'Page Requests',     icon: '📋', group: 'Clients & Access', help: 'Client দের page access request গুলো দেখুন এবং approve/reject করুন।' },
  { key: 'wa-requests',       label: 'WhatsApp Requests', icon: '📲', group: 'Clients & Access', help: 'Client দের WhatsApp automation request গুলো দেখুন এবং connect করুন।' },
  { key: 'subscriptions',     label: 'Subscriptions',     icon: '📅', group: 'Clients & Access', help: 'প্রতিটি page এর server subscription expiry set করুন। Expired হলে bot বন্ধ হয়ে যায়।' },
  { key: 'domain-setup',      label: 'Custom Domains',    icon: '🌐', group: 'Clients & Access', help: 'Customer-দের নিজের domain set করুন — Nginx config + SSL সব automatic হবে।' },

  // ── Bot Knowledge ──
  { key: 'global-questions',  label: 'Global Questions',  icon: '❓', group: 'Bot Knowledge',   help: 'সব client এর জন্য default question bank।' },
  { key: 'global-replies',    label: 'System Replies',    icon: '💬', group: 'Bot Knowledge',   help: 'সব page এর জন্য default bot reply template।' },
  { key: 'learning-log',      label: 'Learning Log',      icon: '🧠', group: 'Bot Knowledge',   help: 'Bot যে messages বোঝেনি সেগুলো।' },
  { key: 'courier-tutorials', label: 'Courier Tutorials', icon: '🚚', group: 'Bot Knowledge',   help: 'Client দের courier API setup এর জন্য tutorial video link রাখুন।' },

  // ── Finance ──
  { key: 'billing',           label: 'Billing',           icon: '💳', group: 'Finance',         help: 'Subscriptions, payments, plan management।' },
  { key: 'wallet',            label: 'Wallet',            icon: '💰', group: 'Finance',         help: 'সব client এর wallet balance দেখুন, recharge approve করুন।' },
  { key: 'pricing',           label: 'Pricing',           icon: '🏷️', group: 'Finance',         help: 'Global usage cost rates edit করুন এবং সব client এ একসাথে apply করুন।' },
  { key: 'reports',           label: 'Reports',           icon: '📈', group: 'Finance',         help: 'Revenue, API cost, profit — সব কিছুর full financial report।' },

  // ── System ──
  { key: 'call-servers',      label: 'Call Servers',      icon: '📞', group: 'System',          help: 'Calling feature চালু/বন্ধ করুন এবং call servers manage করুন।' },
  { key: 'api-keys',          label: 'API Keys',          icon: '🔑', group: 'System',          help: 'সব third-party API key গুলো এখান থেকে manage করুন। .env ফাইল edit না করেও চলবে।' },
  { key: 'agents',            label: 'Agents',            icon: '🤝', group: 'System',          help: 'Reseller/Agent account তৈরি করুন, commission rate set করুন, payout record করুন।' },
];

const SECRET_TAB: AdminTabDef =
  { key: 'customers', label: 'Sys Log', icon: '🔒', group: 'System', help: '' };

// Agent (reseller) role sees only these two tabs — never the full admin surface.
const AGENT_TABS: AdminTabDef[] = [
  { key: 'my-clients', label: 'My Clients',  icon: '👥', group: 'Agent', help: 'আপনার referral link দিয়ে signup করা client এবং তাদের page গুলো।' },
  { key: 'earnings',   label: 'Earnings',    icon: '💰', group: 'Agent', help: 'আপনার referral link, commission rate, owed balance এবং payout history।' },
];

const REPLY_KEY_HELP: Record<string, string> = {
  ocr_processing:    'Customer ছবি পাঠালে প্রথম message। "Processing হচ্ছে" জানান।',
  ocr_fail:          'ছবি থেকে code বোঝা না গেলে এই reply।',
  order_received:    'Order নেওয়া হলে confirmation reply।',
  order_confirmed:   'Order confirm হলে reply।',
  order_cancelled:   'Order cancel হলে reply।',
  product_not_found: 'Product code ভুল হলে reply। {{productCode}} ব্যবহার করুন।',
  stock_out:         'Stock নেই হলে reply। {{productCode}} ব্যবহার করুন।',
  product_info:      'Product info reply। {{productCode}}, {{productPrice}}, {{productStock}} ব্যবহার করুন।',
  order_prompt:      'Customer order করতে চাইলে guide reply।',
  generic_fallback:  'Bot কিছু না বুঝলে default reply।',
};

const REPLY_KEYS = Object.keys(REPLY_KEY_HELP);

export function AdminPanel({ th, onToast, onLogout, role }: {
  th: Theme; onToast: (m: string, t?: any) => void; onLogout: () => void; role?: 'admin' | 'agent';
}) {
  const { request } = useApi();
  const isAgent = role === 'agent';
  const [tab, setTab] = useState<AdminTab>(() => {
    const saved = localStorage.getItem('admin_tab') as AdminTab | null;
    const valid: AdminTab[] = isAgent
      ? ['my-clients', 'earnings']
      : ['overview','users','clients','customers','global-questions','global-replies','learning-log','courier-tutorials','billing','call-servers','wallet','pricing','subscriptions','page-requests','wa-requests','domain-setup','api-keys','reports','agents'];
    return saved && valid.includes(saved) ? saved : (isAgent ? 'my-clients' : 'overview');
  });
  const [pageRequests, setPageRequests] = useState<any[]>([]);
  const [pageReqFilter, setPageReqFilter] = useState<'all' | 'pending'>('pending');
  const [pageReqBusy, setPageReqBusy] = useState<number | null>(null);
  const [moderatorAccess, setModeratorAccess] = useState<ModeratorAccessConfig>({});
  const [moderatorAccessSaving, setModeratorAccessSaving] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [pages, setPages]       = useState<ClientPage[]>([]);
  const [clients, setClients]   = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [globalCfg, setGlobalCfg]       = useState<any>(null);
  const [learningLog, setLearningLog]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [selectedPage, setSelectedPage] = useState<ClientPage | null>(null);
  const [clientCfg, setClientCfg]       = useState<any>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [editReplies, setEditReplies]   = useState<Record<string, string>>({});
  const [tutorials, setTutorials]       = useState<TutorialsConfig>({});
  const [clientPageTab, setClientPageTab] = useState<'bot' | 'settings' | 'wallet'>('bot');
  const [pageSettings, setPageSettings]   = useState<any>(null);
  const [pageSettingsSaving, setPageSettingsSaving]   = useState(false);
  const [adminFbAppId, setAdminFbAppId]   = useState('');
  const [adminFbAppSecret, setAdminFbAppSecret] = useState('');
  const [pageWallet, setPageWallet]       = useState<any>(null);
  const [pageWalletLoading, setPageWalletLoading] = useState(false);
  const [pwRecharge, setPwRecharge]       = useState({ creditAmount: '', transactionId: '', note: '' });
  const [pwRechargeSaving, setPwRechargeSaving] = useState(false);
  const [pwAdjust, setPwAdjust]           = useState({ creditAmount: '', note: '' });
  const [pwAdjustSaving, setPwAdjustSaving] = useState(false);
  const [pwPricing, setPwPricing]         = useState<any>(null);
  const [pwPricingSaving, setPwPricingSaving] = useState(false);
  const [appCredSaving, setAppCredSaving] = useState(false);

  // Call Servers state
  const [globalCfgCall, setGlobalCfgCall] = useState<{ callFeatureEnabled: boolean; callServers: any[] } | null>(null);
  const [callCfgSaving, setCallCfgSaving] = useState(false);

  // Billing state — defined after loadBilling callback below
  const [billingData, setBillingData] = useState<{ subscriptions: any[]; pending: any[] }>({ subscriptions: [], pending: [] });
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingSubFilter, setBillingSubFilter] = useState('');
  const [billingSupport, setBillingSupport] = useState<BillingSupportConfig>({});

  // Admin payment config state
  const [adminPayCfg, setAdminPayCfg] = useState<any>({});
  const [adminPaySaving, setAdminPaySaving] = useState(false);
  const [adminPayTab, setAdminPayTab] = useState<'sms' | 'bkash' | 'nagad' | 'manual'>('sms');
  const [adminSmsLog, setAdminSmsLog] = useState<any[]>([]);
  const [adminSmsDevices, setAdminSmsDevices] = useState<any[]>([]);

  // Wallet admin state
  const [walletPages, setWalletPages]       = useState<any[]>([]);
  const [walletRequests, setWalletRequests] = useState<any[]>([]);
  const [walletLoading, setWalletLoading]   = useState(false);
  const [walletReqFilter, setWalletReqFilter] = useState<'all' | 'pending'>('pending');
  const [walletDirectForm, setWalletDirectForm] = useState({ pageId: '', creditAmount: '', transactionId: '', note: '' });
  const [walletDirectSaving, setWalletDirectSaving] = useState(false);
  const [walletAdjustForm, setWalletAdjustForm] = useState({ pageId: '', creditAmount: '', note: '' });
  const [walletAdjustSaving, setWalletAdjustSaving] = useState(false);

  // Credit packages tab state
  const [creditPackages, setCreditPackages] = useState<any[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [newPackageForm, setNewPackageForm] = useState({ name: '', priceBdt: '', credits: '' });

  // Pricing tab state
  const DEFAULT_PRICING = {
    costPerKeywordReplyCredit: 1,
    costPerImageCredit: 8,
    costPerImageLocalCredit: 4,
    costPerOcrLocalCredit: 1,
    costPerOcrAiCredit: 2,
    costPerVoiceMsgCredit: 40,
    costPerAnalyzeCredit: 8,
    costPerAiGenerateCredit: 4,
    costPerBroadcastMsgCredit: 2,
    costPerRecurringNotifCredit: 4,
    costPerCommentReplyCredit: 2,
    costPerMemoPrintCredit: 4,
    creditsPerBdt: 40,
  };
  const [pricingForm, setPricingForm] = useState(DEFAULT_PRICING);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [globalPricingInfo, setGlobalPricingInfo] = useState('');
  const [pricingInfoSaving, setPricingInfoSaving] = useState(false);

  // Subscriptions tab state
  const [subPages, setSubPages] = useState<any[]>([]);
  const [subLoading, setSubLoading] = useState(false);

  // Agents tab state (admin: manage agents; agent: self-service)
  const [agents, setAgents] = useState<any[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [newAgentForm, setNewAgentForm] = useState({ username: '', password: '', name: '', commissionPercentRecharge: '', commissionPercentSubscription: '' });
  const [myClients, setMyClients] = useState<any[]>([]);
  const [myClientsLoading, setMyClientsLoading] = useState(false);
  const [myProfile, setMyProfile] = useState<any>(null);
  const [myEarnings, setMyEarnings] = useState<any[]>([]);
  const [myPayouts, setMyPayouts] = useState<any[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Laptop AI mode state
  const [localAiMode, setLocalAiMode] = useState<'all' | 'generate_only' | 'none'>('none');
  const [laptopAiSaving, setLaptopAiSaving] = useState(false);

  // Image provider order state
  type ImageProvider = 'gemini' | 'openai' | 'fal' | 'ideogram';
  const [imageProviderOrder, setImageProviderOrder] = useState<ImageProvider[]>(['gemini', 'openai', 'fal', 'ideogram']);
  const [imgProviderSaving, setImgProviderSaving] = useState(false);

  // Secret reveal state
  const [secretUnlocked, setSecretUnlocked] = useState(false);
  const secretRef = useRef({ n: 0, t: null as ReturnType<typeof setTimeout> | null });
  const handleSecretClick = () => {
    const s = secretRef.current;
    s.n++;
    if (s.t) clearTimeout(s.t);
    s.t = setTimeout(() => { s.n = 0; }, 2500);
    if (s.n >= 5) {
      s.n = 0;
      if (s.t) { clearTimeout(s.t); s.t = null; }
      setSecretUnlocked(prev => {
        if (!prev) setTab('customers');
        return !prev;
      });
    }
  };

  // Customers tab state
  const [customers, setCustomers] = useState<{ total: number; items: any[] }>({ total: 0, items: [] });
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOffset, setCustomerOffset] = useState(0);
  const CUSTOMER_LIMIT = 50;

  // Reports tab state
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMonth, setReportMonth] = useState('');

  // API Keys tab state
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [apiKeysDraft, setApiKeysDraft] = useState<Record<string, string>>({});
  const [apiKeysSaving, setApiKeysSaving] = useState(false);
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  const [geminiKeys, setGeminiKeys] = useState<string[]>(['']);
  const [geminiStatus, setGeminiStatus] = useState<{
    total: number;
    available: number;
    keys: {
      masked: string;
      available: boolean;
      status: 'active' | 'cooldown' | 'disabled';
      exhaustedUntil: number | null;
      successCount: number;
      failureCount: number;
      healthScore: number;
      lastLatencyMs: number | null;
      avgLatencyMs: number | null;
      errorMessage?: string;
    }[];
  } | null>(null);

  // Domain Setup tab state
  const [domainPages, setDomainPages]         = useState<any[]>([]);
  const [domainSelectedPage, setDomainSelectedPage] = useState<any>(null);
  const [domainInput, setDomainInput]         = useState('');
  const [domainSkipSsl, setDomainSkipSsl]     = useState(false);
  const [domainBusy, setDomainBusy]           = useState(false);
  const [domainResult, setDomainResult]       = useState<any>(null);
  const [domainList, setDomainList]           = useState<any[]>([]);
  const [domainRemoveBusy, setDomainRemoveBusy] = useState<number | null>(null);

  // Create client form state
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newClient, setNewClient] = useState({ identifier: '', name: '', password: '', pageIds: '' });
  const [creating, setCreating]   = useState(false);

  const BASE = `${API_BASE}/admin`;

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, ai] = await Promise.all([
        request(`${BASE}/overview`),
        request(`${BASE}/laptop-ai`),
      ]);
      setOverview(ov);
      const mode = ai?.localAiMode;
      setLocalAiMode(mode === 'all' || mode === 'generate_only' ? mode : 'none');
      if (Array.isArray(ai?.imageProviderOrder)) setImageProviderOrder(ai.imageProviderOrder);
    }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  const setAiMode = async (mode: 'all' | 'generate_only' | 'none') => {
    setLaptopAiSaving(true);
    try {
      await request(`${BASE}/laptop-ai`, { method: 'PATCH', body: JSON.stringify({ localAiMode: mode }) });
      setLocalAiMode(mode);
      const msg = mode === 'all'
        ? 'Laptop ON — Ollama সব জায়গায় ব্যবহার হবে'
        : mode === 'generate_only'
          ? 'Laptop OFF (Bot) — Bot OpenAI, AI Generate Ollama'
          : 'Laptop OFF (সব) — সব কিছু সরাসরি OpenAI';
      onToast(msg, 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setLaptopAiSaving(false); }
  };

  const moveImageProvider = (index: number, dir: -1 | 1) => {
    const next = [...imageProviderOrder];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setImageProviderOrder(next);
  };

  const saveImageProviderOrder = async () => {
    setImgProviderSaving(true);
    try {
      await request(`${BASE}/laptop-ai`, { method: 'PATCH', body: JSON.stringify({ imageProviderOrder }) });
      onToast('Image provider order সেভ হয়েছে ✅', 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setImgProviderSaving(false); }
  };

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const [cl, pg] = await Promise.all([
        request<AdminUser[]>(`${BASE}/clients`),
        request<ClientPage[]>(`${BASE}/pages`),
      ]);
      setClients(Array.isArray(cl) ? cl : []);
      setPages(pg);
    }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  const loadGlobal = useCallback(async () => {
    setLoading(true);
    try {
      const g = await request<any>(`${BASE}/bot-knowledge/global`);
      setGlobalCfg(g);
      const r: Record<string, string> = {};
      for (const k of REPLY_KEYS) r[k] = g?.systemReplies?.[k]?.template || '';
      setEditReplies(r);
    }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  const loadLog = useCallback(async () => {
    setLoading(true);
    try { setLearningLog(await request<any[]>(`${BASE}/bot-knowledge/learning-log`)); }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  const loadTutorials = useCallback(async () => {
    try { setTutorials(await request<TutorialsConfig>(`${BASE}/tutorials`)); }
    catch {}
  }, []);

  const loadGlobalCfgCall = useCallback(async () => {
    try { setGlobalCfgCall(await request<any>(`${BASE}/global-config`)); }
    catch (e: any) { onToast(e.message, 'error'); }
  }, []);

  const saveGlobalCfgCall = async () => {
    if (!globalCfgCall) return;
    setCallCfgSaving(true);
    try {
      const updated = await request<any>(`${BASE}/global-config`, { method: 'PATCH', body: JSON.stringify(globalCfgCall) });
      setGlobalCfgCall(updated);
      onToast('✅ Call settings saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setCallCfgSaving(false); }
  };

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      const [subs, pending, globalCfg, payCfg] = await Promise.all([
        request<any[]>(`${API_BASE}/billing/admin/subscriptions${billingSubFilter ? `?status=${billingSubFilter}` : ''}`),
        request<any[]>(`${API_BASE}/billing/admin/pending-payments`),
        request<any>(`${BASE}/global-config`),
        request<any>(`${BASE}/payment-config`).catch(() => ({})),
      ]);
      setBillingData({ subscriptions: subs || [], pending: pending || [] });
      setBillingSupport(globalCfg?.billingSupport || {});
      setAdminPayCfg(payCfg || {});
      setAdminSmsLog(payCfg?.recentSms || []);
      request<any[]>(`${API_BASE}/sms-gateway/devices`).then(d => { if (Array.isArray(d)) setAdminSmsDevices(d); }).catch(() => {});
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setBillingLoading(false); }
  }, [BASE, billingSubFilter]);

  const loadSubscriptions = useCallback(async () => {
    setSubLoading(true);
    try { setSubPages(await request<any[]>(`${BASE}/subscriptions`) || []); }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setSubLoading(false); }
  }, [BASE]);

  // ── Agents (admin: manage; agent: self-service) ──────────────────────────
  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try { setAgents(await request<any[]>(`${BASE}/agents`) || []); }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setAgentsLoading(false); }
  }, [BASE]);

  const createAgent = async () => {
    if (!newAgentForm.username.trim() || !newAgentForm.password.trim()) {
      onToast('Username ও password দিন', 'error'); return;
    }
    try {
      await request(`${BASE}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          username: newAgentForm.username.trim(),
          password: newAgentForm.password,
          name: newAgentForm.name.trim() || undefined,
          commissionPercentRecharge: newAgentForm.commissionPercentRecharge ? Number(newAgentForm.commissionPercentRecharge) : undefined,
          commissionPercentSubscription: newAgentForm.commissionPercentSubscription ? Number(newAgentForm.commissionPercentSubscription) : undefined,
        }),
      });
      onToast('✅ Agent তৈরি হয়েছে', 'success');
      setNewAgentForm({ username: '', password: '', name: '', commissionPercentRecharge: '', commissionPercentSubscription: '' });
      loadAgents();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const updateAgentRates = async (id: string, data: { commissionPercentRecharge?: number; commissionPercentSubscription?: number }) => {
    try {
      await request(`${BASE}/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
      onToast('✅ Update হয়েছে', 'success');
      loadAgents();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const toggleAgentActive = async (id: string, isActive: boolean) => {
    try {
      await request(`${BASE}/users/${id}/account-status`, { method: 'PATCH', body: JSON.stringify({ isActive: !isActive }) });
      loadAgents();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const recordAgentPayout = async (id: string, amountBdt: number, note?: string) => {
    if (!amountBdt || amountBdt <= 0) { onToast('সঠিক amount দিন', 'error'); return; }
    try {
      await request(`${BASE}/agents/${id}/payout`, { method: 'POST', body: JSON.stringify({ amountBdt, note }) });
      onToast('✅ Payout record হয়েছে', 'success');
      loadAgents();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const loadMyClients = useCallback(async () => {
    setMyClientsLoading(true);
    try { setMyClients(await request<any[]>(`${API_BASE}/partner/clients`) || []); }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setMyClientsLoading(false); }
  }, []);

  const loadMyEarnings = useCallback(async () => {
    setEarningsLoading(true);
    try {
      const [profile, earnings, payouts] = await Promise.all([
        request<any>(`${API_BASE}/partner/me`),
        request<any>(`${API_BASE}/partner/earnings`),
        request<any>(`${API_BASE}/partner/payouts`),
      ]);
      setMyProfile(profile);
      setMyEarnings(earnings?.rows || []);
      setMyPayouts(payouts?.rows || []);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setEarningsLoading(false); }
  }, []);

  const loadCustomers = useCallback(async (search = customerSearch, offset = customerOffset) => {
    setCustomersLoading(true);
    try {
      const params = new URLSearchParams({ n: String(CUSTOMER_LIMIT), s: String(offset) });
      if (search) params.set('q', search);
      const data = await request<{ total: number; items: any[] }>(`${BASE}/syslog?${params}`);
      setCustomers(data || { total: 0, items: [] });
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setCustomersLoading(false); }
  }, [BASE, customerSearch, customerOffset]);

  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const [pages, reqs] = await Promise.all([
        request<any[]>(`${BASE}/wallet`),
        request<any[]>(`${BASE}/wallet/requests${walletReqFilter === 'pending' ? '?status=pending' : ''}`),
      ]);
      setWalletPages(pages || []);
      setWalletRequests(reqs || []);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setWalletLoading(false); }
  }, [BASE, walletReqFilter]);

  const approveRequest = async (id: number) => {
    try {
      await request(`${BASE}/wallet/requests/${id}/approve`, { method: 'POST' });
      onToast('✅ Approved — balance যোগ হয়েছে', 'success');
      loadWallet();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const rejectRequest = async (id: number) => {
    const reason = window.prompt('Rejection কারণ (optional):');
    if (reason === null) return;
    try {
      await request(`${BASE}/wallet/requests/${id}/reject`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      onToast('Request rejected');
      loadWallet();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const directRecharge = async () => {
    const pid = Number(walletDirectForm.pageId);
    const amt = Number(walletDirectForm.creditAmount);
    if (!pid || !amt || amt <= 0 || !walletDirectForm.transactionId.trim()) {
      onToast('Page, amount ও Transaction ID দিন', 'error'); return;
    }
    setWalletDirectSaving(true);
    try {
      await request(`${BASE}/wallet/${pid}/recharge`, {
        method: 'POST',
        body: JSON.stringify({
          creditAmount: amt,
          transactionId: walletDirectForm.transactionId.trim(),
          note: walletDirectForm.note.trim() || undefined,
        }),
      });
      onToast(`✅ ${amt} credit balance যোগ হয়েছে`, 'success');
      setWalletDirectForm({ pageId: '', creditAmount: '', transactionId: '', note: '' });
      loadWallet();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setWalletDirectSaving(false); }
  };

  const adjustWallet = async () => {
    const pid = Number(walletAdjustForm.pageId);
    const amt = Number(walletAdjustForm.creditAmount);
    if (!pid || !amt) {
      onToast('Page ও amount দিন (কমাতে negative number দিন, যেমন: -100)', 'error'); return;
    }
    setWalletAdjustSaving(true);
    try {
      await request(`${BASE}/wallet/${pid}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          creditAmount: amt,
          note: walletAdjustForm.note.trim() || undefined,
        }),
      });
      onToast(`✅ Balance ${amt > 0 ? '+' : ''}${amt} credit adjust হয়েছে`, 'success');
      setWalletAdjustForm({ pageId: '', creditAmount: '', note: '' });
      loadWallet();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setWalletAdjustSaving(false); }
  };

  const loadPricing = useCallback(async () => {
    try {
      const data = await request<any>(`${BASE}/wallet/pricing/global`);
      if (data) setPricingForm({
        costPerKeywordReplyCredit:  data.costPerKeywordReplyCredit  ?? DEFAULT_PRICING.costPerKeywordReplyCredit,
        costPerImageCredit:         data.costPerImageCredit         ?? DEFAULT_PRICING.costPerImageCredit,
        costPerImageLocalCredit:    data.costPerImageLocalCredit    ?? DEFAULT_PRICING.costPerImageLocalCredit,
        costPerOcrLocalCredit:      data.costPerOcrLocalCredit      ?? DEFAULT_PRICING.costPerOcrLocalCredit,
        costPerOcrAiCredit:         data.costPerOcrAiCredit         ?? DEFAULT_PRICING.costPerOcrAiCredit,
        costPerVoiceMsgCredit:      data.costPerVoiceMsgCredit      ?? DEFAULT_PRICING.costPerVoiceMsgCredit,
        costPerAnalyzeCredit:       data.costPerAnalyzeCredit       ?? DEFAULT_PRICING.costPerAnalyzeCredit,
        costPerAiGenerateCredit:    data.costPerAiGenerateCredit    ?? DEFAULT_PRICING.costPerAiGenerateCredit,
        costPerBroadcastMsgCredit:  data.costPerBroadcastMsgCredit  ?? DEFAULT_PRICING.costPerBroadcastMsgCredit,
        costPerRecurringNotifCredit: data.costPerRecurringNotifCredit ?? DEFAULT_PRICING.costPerRecurringNotifCredit,
        costPerCommentReplyCredit:  data.costPerCommentReplyCredit  ?? DEFAULT_PRICING.costPerCommentReplyCredit,
        costPerMemoPrintCredit:     data.costPerMemoPrintCredit     ?? DEFAULT_PRICING.costPerMemoPrintCredit,
        creditsPerBdt:              data.creditsPerBdt              ?? DEFAULT_PRICING.creditsPerBdt,
      });
    } catch { /* silent — fallback to defaults */ }
    try {
      const g = await request<any>(`${BASE}/bot-knowledge/global`);
      if (g?.pricingInfo) setGlobalPricingInfo(g.pricingInfo);
    } catch { /* silent */ }
  }, [BASE]);

  const loadCreditPackages = useCallback(async () => {
    setPackagesLoading(true);
    try {
      const data = await request<any[]>(`${BASE}/wallet/packages`);
      setCreditPackages(data || []);
    } catch { /* silent */ }
    finally { setPackagesLoading(false); }
  }, [BASE]);

  const createCreditPackage = async () => {
    const priceBdt = Number(newPackageForm.priceBdt);
    const credits = Number(newPackageForm.credits);
    if (!priceBdt || priceBdt <= 0 || !credits || credits <= 0) {
      onToast('Price ও credits দিন', 'error'); return;
    }
    try {
      await request(`${BASE}/wallet/packages`, {
        method: 'POST',
        body: JSON.stringify({ name: newPackageForm.name.trim() || undefined, priceBdt, credits }),
      });
      onToast('✅ Package যোগ হয়েছে', 'success');
      setNewPackageForm({ name: '', priceBdt: '', credits: '' });
      loadCreditPackages();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const toggleCreditPackage = async (id: number, isActive: boolean) => {
    try {
      await request(`${BASE}/wallet/packages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });
      loadCreditPackages();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const deleteCreditPackage = async (id: number) => {
    if (!window.confirm('এই package delete করতে চান?')) return;
    try {
      await request(`${BASE}/wallet/packages/${id}`, { method: 'DELETE' });
      onToast('✅ Package মুছে ফেলা হয়েছে', 'success');
      loadCreditPackages();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const saveGlobalPricingInfo = async () => {
    setPricingInfoSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/global/pricing-info`, {
        method: 'PATCH',
        body: JSON.stringify({ pricingInfo: globalPricingInfo }),
      });
      onToast('✅ Bot pricing text saved — bot এর পরের reply থেকেই নতুন price বলবে', 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPricingInfoSaving(false); }
  };

  const saveDefaultPricing = async () => {
    setPricingSaving(true);
    try {
      await request<any>(`${BASE}/wallet/pricing/save-default`, {
        method: 'POST',
        body: JSON.stringify(pricingForm),
      });
      onToast('✅ Default pricing saved — নতুন client রা এই rate পাবে এবং landing page আপডেট হয়েছে', 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPricingSaving(false); }
  };

  const applyPricingToAll = async () => {
    setPricingSaving(true);
    try {
      const r = await request<any>(`${BASE}/wallet/pricing/apply-all`, {
        method: 'POST',
        body: JSON.stringify(pricingForm),
      });
      onToast(`✅ ${r.updated} client এ pricing update হয়েছে — landing page ও আপডেট হয়েছে`, 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPricingSaving(false); }
  };

  const confirmPayment = async (paymentId: string) => {
    try {
      const r = await request<any>(`${API_BASE}/billing/admin/payments/${paymentId}/confirm`, {
        method: 'POST', body: JSON.stringify({}),
      });
      onToast(r.message || '✅ Payment confirmed'); loadBilling();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const setSubscription = async (userId: string, payload: any) => {
    try {
      await request(`${API_BASE}/billing/admin/users/${userId}/subscription`, {
        method: 'PATCH', body: JSON.stringify(payload),
      });
      onToast('✅ Subscription updated'); loadBilling();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const saveBillingSupport = async (payload: BillingSupportConfig) => {
    try {
      const updated = await request<any>(`${BASE}/global-config`, {
        method: 'PATCH',
        body: JSON.stringify({ billingSupport: payload }),
      });
      setBillingSupport(updated?.billingSupport || payload);
      onToast('✅ Admin contact info saved');
    } catch (e: any) {
      onToast(e.message, 'error');
    }
  };

  const saveAdminPayConfig = async () => {
    setAdminPaySaving(true);
    try {
      await request(`${BASE}/payment-config`, { method: 'POST', body: JSON.stringify(adminPayCfg) });
      onToast('✅ Payment config saved');
      loadBilling();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setAdminPaySaving(false); }
  };

  const saveTutorials = async () => {
    setSaving(true);
    try {
      await request(`${BASE}/tutorials`, { method: 'PATCH', body: JSON.stringify(tutorials) });
      onToast('✅ Tutorial videos saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const createClient = async () => {
    if (!newClient.identifier.trim()) return onToast('Phone / email / username দিন', 'error');
    if (!newClient.password || newClient.password.length < 6) return onToast('Password কমপক্ষে ৬ character', 'error');
    setCreating(true);
    try {
      const raw     = newClient.identifier.trim();
      const isPhone = /^(\+88)?01[3-9]\d{8}$/.test(raw.replace(/[\s-]/g,''));
      const isEmail = raw.includes('@');
      const body: any = {
        password: newClient.password,
        name:     newClient.name || raw,
        pageIds:  newClient.pageIds ? newClient.pageIds.split(',').map(n => Number(n.trim())).filter(Boolean) : [],
      };
      if (isPhone)      { body.phone = raw.replace(/[\s-]/g,''); body.username = body.phone; }
      else if (isEmail) { body.email = raw.toLowerCase(); body.username = body.email; }
      else              { body.username = raw; }

      await request(`${BASE}/../auth/admin/create-client`, { method: 'POST', body: JSON.stringify(body) });
      onToast(`✅ Client "${newClient.name || raw}" created`);
      setNewClient({ identifier: '', name: '', password: '', pageIds: '' });
      setShowCreateClient(false);
      loadClients();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setCreating(false); }
  };

  useEffect(() => {
    if (tab === 'overview')                                        loadOverview();
    if (tab === 'clients' || tab === 'users')                      loadClients();
    if (tab === 'global-questions' || tab === 'global-replies')   loadGlobal();
    if (tab === 'learning-log')                                    loadLog();
    if (tab === 'courier-tutorials')                               loadTutorials();
    if (tab === 'call-servers')                                    loadGlobalCfgCall();
    if (tab === 'wallet')                                          loadWallet();
    if (tab === 'subscriptions') loadSubscriptions();
    if (tab === 'page-requests' || tab === 'overview') loadPageRequests();
    if (tab === 'page-requests') loadModeratorAccess();
    if (tab === 'customers') loadCustomers('', 0);
    if (tab === 'domain-setup') loadDomainTab();
    if (tab === 'api-keys' && !apiKeysLoaded) loadApiKeys();
    if (tab === 'reports') loadReport();
    if (tab === 'agents') loadAgents();
    if (tab === 'my-clients') loadMyClients();
    if (tab === 'earnings') loadMyEarnings();
  }, [tab]);

  useEffect(() => {
    if (tab === 'billing') loadBilling();
  }, [tab, billingSubFilter]);

  // Poll admin SMS devices every 30s when on billing tab
  useEffect(() => {
    if (tab !== 'billing') return;
    const interval = setInterval(async () => {
      try {
        const devList = await request<any[]>(`${API_BASE}/sms-gateway/devices`).catch(() => null);
        if (!Array.isArray(devList)) return;
        setAdminSmsDevices(devList);
        // If all devices inactive and gateway is on → disable immediately
        const hasActive = devList.some((d: any) => d.isActive);
        if (!hasActive) {
          setAdminPayCfg((prev: any) => {
            if (prev?.smsGatewayEnabled) {
              // Save via the payment config save — just update local state, backend scheduler handles persistence
              return { ...prev, smsGatewayEnabled: false };
            }
            return prev;
          });
        }
      } catch { /* silent */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    if (tab === 'pricing') { loadPricing(); loadCreditPackages(); }
  }, [tab]);

  const loadReport = async (month?: string) => {
    setReportLoading(true);
    try {
      const qs = (month ?? reportMonth) ? `?month=${month ?? reportMonth}` : '';
      const data = await request<any>(`${BASE}/reports/revenue${qs}`);
      if (data) setReportData(data);
    } catch { /* silent */ }
    finally { setReportLoading(false); }
  };

  const loadApiKeys = async () => {
    try {
      const data = await request<Record<string, string>>(`${BASE}/api-keys`);
      setApiKeys(data || {});
      setApiKeysDraft(data || {});
      setApiKeysLoaded(true);
      // Load rotator status first (needed for masked key count)
      let status: any = null;
      try {
        status = await request<any>(`${BASE}/gemini-key-status`);
        setGeminiStatus(status);
      } catch {}
      // Load multi-key list
      try {
        const raw = (data as any)?.geminiApiKeys;
        if (raw && raw !== '***SAVED***') {
          const parsed: string[] = JSON.parse(raw);
          setGeminiKeys(parsed.length > 0 ? parsed : ['']);
        } else if (raw === '***SAVED***' && status?.total > 0) {
          // Keys are saved but masked — use positional IDs so delete works correctly
          setGeminiKeys(Array.from({ length: status.total }, (_, i) => `***SAVED:${i}***`));
        } else {
          setGeminiKeys(['']);
        }
      } catch { setGeminiKeys(['']); }
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const saveApiKeys = async () => {
    setApiKeysSaving(true);
    try {
      // Save geminiApiKeys array (filter empty, keep ***SAVED*** placeholders for existing keys)
      const keys = geminiKeys.filter(k => k.trim());
      const patch = { ...apiKeysDraft, geminiApiKeys: keys.length > 0 ? JSON.stringify(keys) : '' };
      await request(`${BASE}/api-keys`, { method: 'PATCH', body: JSON.stringify(patch) });
      onToast('✅ API Keys সংরক্ষিত হয়েছে', 'success');
      setApiKeysLoaded(false);
      loadApiKeys();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setApiKeysSaving(false); }
  };

  const loadDomainTab = async () => {
    try {
      const [allPages, domains] = await Promise.all([
        request<any[]>(`${BASE}/pages`),
        request<any[]>(`${BASE}/custom-domains`),
      ]);
      setDomainPages(allPages || []);
      setDomainList(domains || []);
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const handleSetupDomain = async () => {
    if (!domainSelectedPage) { onToast('একটি page select করুন', 'error'); return; }
    if (!domainInput.trim()) { onToast('Domain লিখুন', 'error'); return; }
    setDomainBusy(true);
    setDomainResult(null);
    try {
      const res = await request(`${BASE}/pages/${domainSelectedPage.id}/setup-domain`, {
        method: 'POST',
        body: JSON.stringify({ domain: domainInput.trim(), skipSsl: domainSkipSsl }),
      });
      setDomainResult(res);
      if (res?.success) {
        onToast(`✅ ${domainInput.trim()} setup সফল!`, 'success');
        loadDomainTab();
      } else {
        onToast('Setup-এ সমস্যা হয়েছে — নিচে log দেখুন', 'error');
      }
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setDomainBusy(false); }
  };

  const handleRemoveDomain = async (pageId: number, domain: string) => {
    if (!window.confirm(`"${domain}" সরিয়ে দেবেন?`)) return;
    setDomainRemoveBusy(pageId);
    try {
      await request(`${BASE}/pages/${pageId}/remove-domain`, { method: 'POST' });
      onToast(`✅ ${domain} সরানো হয়েছে`, 'success');
      loadDomainTab();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setDomainRemoveBusy(null); }
  };

  const loadPageRequests = async (filter?: 'all' | 'pending') => {
    const f = filter ?? pageReqFilter;
    try {
      const data = await request<any[]>(`${BASE}/page-requests${f === 'pending' ? '?status=pending' : ''}`);
      setPageRequests(data || []);
    } catch { /* silent */ }
  };

  const loadModeratorAccess = useCallback(async () => {
    try {
      const cfg = await request<any>(`${BASE}/global-config`);
      setModeratorAccess(cfg?.moderatorAccess || {});
    } catch { /* silent */ }
  }, []);

  const saveModeratorAccess = async (payload: ModeratorAccessConfig) => {
    setModeratorAccessSaving(true);
    try {
      const updated = await request<any>(`${BASE}/global-config`, {
        method: 'PATCH',
        body: JSON.stringify({ moderatorAccess: payload }),
      });
      setModeratorAccess(updated?.moderatorAccess || payload);
      onToast('✅ Moderator access info saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setModeratorAccessSaving(false); }
  };

  const handlePageReqReject = async (id: number, note?: string) => {
    setPageReqBusy(id);
    try {
      await request(`${BASE}/page-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ adminNote: note || undefined }) });
      onToast('Rejected!', 'success');
      await loadPageRequests();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPageReqBusy(null); }
  };

  const handlePageReqApprove = async (id: number) => {
    setPageReqBusy(id);
    try {
      const data = await request<{ url: string }>(`${BASE}/page-requests/${id}/approve-url`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPageReqBusy(null); }
  };

  const loadPageWallet = useCallback(async (pageId: number) => {
    setPageWalletLoading(true);
    try {
      const data = await request<any>(`${BASE}/wallet/${pageId}`);
      setPageWallet(data);
      setPwPricing({
        costPerKeywordReplyCredit: data.page.costPerKeywordReplyCredit,
        costPerImageCredit: data.page.costPerImageCredit,
        costPerImageLocalCredit: data.page.costPerImageLocalCredit,
        costPerOcrLocalCredit: data.page.costPerOcrLocalCredit,
        costPerOcrAiCredit: data.page.costPerOcrAiCredit,
        costPerVoiceMsgCredit: data.page.costPerVoiceMsgCredit,
        costPerAnalyzeCredit: data.page.costPerAnalyzeCredit,
        costPerAiGenerateCredit: data.page.costPerAiGenerateCredit,
        costPerBroadcastMsgCredit: data.page.costPerBroadcastMsgCredit,
        costPerRecurringNotifCredit: data.page.costPerRecurringNotifCredit,
        costPerCommentReplyCredit: data.page.costPerCommentReplyCredit,
        costPerMemoPrintCredit: data.page.costPerMemoPrintCredit,
      });
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPageWalletLoading(false); }
  }, [BASE]);

  const pwDoRecharge = async () => {
    if (!selectedPage) return;
    const amt = Number(pwRecharge.creditAmount);
    if (!amt || amt <= 0 || !pwRecharge.transactionId.trim()) {
      onToast('Amount ও Transaction ID দিন', 'error'); return;
    }
    setPwRechargeSaving(true);
    try {
      await request(`${BASE}/wallet/${selectedPage.id}/recharge`, {
        method: 'POST',
        body: JSON.stringify({
          creditAmount: amt,
          transactionId: pwRecharge.transactionId.trim(),
          note: pwRecharge.note.trim() || undefined,
        }),
      });
      onToast(`✅ ${amt} credit যোগ হয়েছে`, 'success');
      setPwRecharge({ creditAmount: '', transactionId: '', note: '' });
      await loadPageWallet(selectedPage.id);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPwRechargeSaving(false); }
  };

  const pwDoAdjust = async () => {
    if (!selectedPage) return;
    const amt = Number(pwAdjust.creditAmount);
    if (!amt) {
      onToast('Amount দিন (কমাতে negative number দিন, যেমন: -100)', 'error'); return;
    }
    setPwAdjustSaving(true);
    try {
      await request(`${BASE}/wallet/${selectedPage.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ creditAmount: amt, note: pwAdjust.note.trim() || undefined }),
      });
      onToast(`✅ Balance ${amt > 0 ? '+' : ''}${amt} credit adjust হয়েছে`, 'success');
      setPwAdjust({ creditAmount: '', note: '' });
      await loadPageWallet(selectedPage.id);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPwAdjustSaving(false); }
  };

  const pwSavePricing = async () => {
    if (!selectedPage || !pwPricing) return;
    setPwPricingSaving(true);
    try {
      await request(`${BASE}/wallet/${selectedPage.id}/pricing`, {
        method: 'PATCH', body: JSON.stringify(pwPricing),
      });
      onToast('✅ Page pricing override save হয়েছে', 'success');
      await loadPageWallet(selectedPage.id);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPwPricingSaving(false); }
  };

  const loadPageCfg = async (page: ClientPage) => {
    setSelectedPage(page); setClientCfg(null); setClientLoading(true);
    setPageSettings(null); setClientPageTab('settings');
    setAdminFbAppId(''); setAdminFbAppSecret('');
    setPageWallet(null); setPwPricing(null);
    try {
      const [cfg, settings, appCreds] = await Promise.all([
        request(`${BASE}/bot-knowledge/page/${page.id}`),
        request(`${BASE}/pages/${page.id}/settings`),
        request(`${BASE}/pages/${page.id}/app-credentials`),
      ]);
      setClientCfg(cfg);
      setPageSettings(settings);
      setAdminFbAppId((appCreds as any)?.fbAppId ?? '');
    }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setClientLoading(false); }
  };

  const saveAppCredentials = async () => {
    if (!selectedPage) return;
    setAppCredSaving(true);
    try {
      const body: any = { fbAppId: adminFbAppId.trim() || null };
      if (adminFbAppSecret.trim()) body.fbAppSecret = adminFbAppSecret.trim();
      await request(`${BASE}/pages/${selectedPage.id}/app-credentials`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      setAdminFbAppSecret('');
      setPages(prev => prev.map(p => p.id === selectedPage.id ? { ...p, fbAppId: body.fbAppId, hasCustomApp: !!body.fbAppId } : p));
      onToast('✅ App credentials saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setAppCredSaving(false); }
  };

  const clearAppCredentials = async () => {
    if (!selectedPage) return;
    if (!window.confirm('Custom app credentials সরিয়ে platform default app use করবেন?')) return;
    setAppCredSaving(true);
    try {
      await request(`${BASE}/pages/${selectedPage.id}/app-credentials`, {
        method: 'PATCH', body: JSON.stringify({ fbAppId: null, fbAppSecret: null }),
      });
      setAdminFbAppId(''); setAdminFbAppSecret('');
      setPages(prev => prev.map(p => p.id === selectedPage.id ? { ...p, fbAppId: null, hasCustomApp: false } : p));
      onToast('✅ Cleared — platform default app will be used');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setAppCredSaving(false); }
  };

  const savePageSettings = async () => {
    if (!selectedPage || !pageSettings) return;
    setPageSettingsSaving(true);
    try {
      const updated = await request(`${BASE}/pages/${selectedPage.id}/settings`, {
        method: 'PATCH', body: JSON.stringify(pageSettings),
      });
      setPageSettings(updated);
      setPages(prev => prev.map(p => p.id === selectedPage.id ? { ...p, automationOn: updated.automationOn } : p));
      onToast('✅ Settings saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setPageSettingsSaving(false); }
  };

  const saveGlobalQuestions = async (questions: any[]) => {
    setSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/global/questions`, { method: 'PATCH', body: JSON.stringify({ questions }) });
      onToast('✅ Global questions saved'); await loadGlobal();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveGlobalReplies = async () => {
    setSaving(true);
    const sr: Record<string, any> = {};
    for (const k of REPLY_KEYS) sr[k] = { template: editReplies[k] || '', fallback: editReplies[k] || '', enabled: true };
    try {
      await request(`${BASE}/bot-knowledge/global/system-replies`, { method: 'PATCH', body: JSON.stringify({ systemReplies: sr }) });
      onToast('✅ Global replies saved'); await loadGlobal();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const pushGlobalToPage = async (pageId: number, key: string) => {
    setSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/page/${pageId}/push-global/${key}`, { method: 'POST' });
      onToast(`✅ "${key}" pushed to page`);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveClientQuestions = async (pageId: number, questions: any[]) => {
    setSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/page/${pageId}/questions`, { method: 'PATCH', body: JSON.stringify({ questions }) });
      onToast('✅ Client questions saved'); if (selectedPage?.id === pageId) await loadPageCfg(selectedPage);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const createFromLog = async (entry: any, target: 'global' | 'client', pageId?: number) => {
    setSaving(true);
    try {
      await request(`${BASE}/bot-knowledge/learning-log/create-question`, {
        method: 'POST', body: JSON.stringify({ logId: entry.id, target, pageId }),
      });
      onToast(`✅ Question created → ${target}`); await loadLog();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  // ── Tab Bar ───────────────────────────────────────────────────────────────
  const TabBar = () => {
    const visibleTabs = isAgent
      ? AGENT_TABS
      : (secretUnlocked ? [...ADMIN_TABS, SECRET_TAB] : ADMIN_TABS);
    const currentTabHelp = visibleTabs.find(t => t.key === tab)?.help || '';
    // Preserve declaration order while collecting tabs under their group header.
    const groups: { name: string; tabs: typeof visibleTabs }[] = [];
    for (const t of visibleTabs) {
      let g = groups.find(x => x.name === t.group);
      if (!g) { g = { name: t.group, tabs: [] }; groups.push(g); }
      g.tabs.push(t);
    }
    const renderTab = (t: typeof visibleTabs[number]) => {
      const pendingCount = t.key === 'page-requests' && overview?.pendingPageRequests > 0
        ? overview.pendingPageRequests : 0;
      const isSecret = t.key === 'customers';
      const active = tab === t.key;
      return (
        <button key={t.key} onClick={() => { setTab(t.key); localStorage.setItem('admin_tab', t.key); }} style={{
          padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
          fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
          background: active ? (isSecret ? '#7c3aed' : th.accent) : 'transparent',
          color: active ? '#fff' : (isSecret ? '#7c3aed' : th.muted),
          transition: 'all .15s',
          display: 'flex', alignItems: 'center', gap: 5, position: 'relative' as const,
        }}>
          <span>{t.icon}</span>{t.label}
          {pendingCount > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 900, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
              {pendingCount}
            </span>
          )}
        </button>
      );
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: th.surface, borderRadius: 14, padding: 8, border: `1px solid ${th.border}` }}>
        {groups.map((g, gi) => (
          <div key={g.name} style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const,
            padding: '4px 2px',
            borderTop: gi === 0 ? 'none' : `1px solid ${th.border}`,
            marginTop: gi === 0 ? 0 : 2, paddingTop: gi === 0 ? 4 : 8,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 800, color: th.muted, textTransform: 'uppercase',
              letterSpacing: '0.06em', minWidth: 96, opacity: 0.75,
            }}>{g.name}</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' as const, flex: 1 }}>
              {g.tabs.map(renderTab)}
            </div>
          </div>
        ))}
        {currentTabHelp && (
          <div style={{ fontSize: 12, color: th.muted, padding: '8px 8px 4px', borderTop: `1px solid ${th.border}`, marginTop: 4 }}>
            ℹ️ {currentTabHelp}
          </div>
        )}
      </div>
    );
  };

  // ── OVERVIEW ──────────────────────────────────────────────────────────────
  const OverviewTab = () => !overview
    ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={20}/></div>
    : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Health banner */}
        {overview.unmatchedMessages > 10 ? (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', color: '#991b1b' }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Bot Training Needed</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{overview.unmatchedMessages}টি unmatched message — Learning Log এ গিয়ে নতুন question যোগ করুন</div>
            </div>
            <button onClick={() => { setTab('learning-log'); localStorage.setItem('admin_tab', 'learning-log'); }} style={{ ...th.btnGhost, marginLeft: 'auto', fontSize: 12, color: '#991b1b', borderColor: '#fecaca' }}>
              Learning Log →
            </button>
          </div>
        ) : (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', color: '#166534' }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Bot সব question বুঝতে পারছে</div>
          </div>
        )}

        {/* Pending page requests banner */}
        {overview.pendingPageRequests > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', color: '#92400e' }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{overview.pendingPageRequests}টি Page Access Request Pending</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>Client রা page connect করার জন্য request করেছে — review করুন</div>
            </div>
            <button onClick={() => { setTab('page-requests'); localStorage.setItem('admin_tab', 'page-requests'); }} style={{ ...th.btnGhost, marginLeft: 'auto', fontSize: 12, color: '#92400e', borderColor: '#fcd34d' }}>
              Review →
            </button>
          </div>
        )}

        {/* Pages + Users */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(155px,1fr))', gap: 12 }}>
          {[
            { icon: '📄', label: 'Total Pages',    val: overview.totalPages,      color: th.accent },
            { icon: '🟢', label: 'Bot Active',      val: overview.pagesWithBot,    color: '#16a34a' },
            { icon: '🔴', label: 'Bot OFF',          val: overview.pagesWithoutBot, color: overview.pagesWithoutBot > 0 ? '#ef4444' : '#16a34a' },
            { icon: '👥', label: 'Active Clients',  val: overview.activeUsers,     color: '#8b5cf6' },
          ].map(k => (
            <div key={k.label} style={{ ...th.card, padding: '18px 20px' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{k.icon}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: k.color, letterSpacing: '-1px' }}>{k.val}</div>
              <div style={{ fontSize: 11, color: th.muted, marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Bot Knowledge Health */}
        <div style={th.card}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
            🧠 Bot Knowledge Health
            <InfoButton text="Unmatched messages বেশি হলে Learning Log এ গিয়ে নতুন question যোগ করুন।" th={th} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <div style={{ ...th.card2, padding: '14px 16px' }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: overview.unmatchedMessages > 10 ? '#ef4444' : '#16a34a' }}>
                {overview.unmatchedMessages}
              </div>
              <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, textTransform: 'uppercase', marginTop: 3 }}>
                Unmatched Messages
              </div>
              {overview.unmatchedMessages > 10 && (
                <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 6 }}>
                  ⚠️ Learning Log এ গিয়ে নতুন question যোগ করুন
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: th.muted, marginTop: 10 }}>
            Generated: {new Date(overview.generatedAt).toLocaleString()}
          </div>
        </div>

        {/* Image Provider Order */}
        <div style={th.card}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
            🎨 Image Generation Provider Order
          </div>
          <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 14 }}>
            উপরে যেটা থাকবে সেটা আগে call হবে। সেটা fail করলে পরেরটা try করবে।
          </div>
          {(() => {
            const PROVIDER_INFO: Record<string, { icon: string; name: string; desc: string; color: string }> = {
              gemini:   { icon: '✨', name: 'Gemini Imagen 3',  desc: 'Google — Free tier available',       color: '#4285f4' },
              openai:   { icon: '🤖', name: 'OpenAI DALL-E 3',  desc: '$0.04/image — High quality',         color: '#10a37f' },
              fal:      { icon: '⚡', name: 'fal.ai FLUX',      desc: '$0.003/image — Fastest & cheapest',  color: '#8b5cf6' },
              ideogram: { icon: '🖼️', name: 'Ideogram V2',      desc: '$0.08/image — Best text in image',   color: '#f59e0b' },
            };
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {imageProviderOrder.map((p, i) => {
                  const info = PROVIDER_INFO[p];
                  return (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface, borderRadius: 10, padding: '10px 14px', border: `1.5px solid ${i === 0 ? info.color : th.border}` }}>
                      <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>{info.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: th.text }}>{info.name}</span>
                          {i === 0 && <span style={{ background: `${info.color}22`, color: info.color, fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 8px' }}>PRIMARY</span>}
                        </div>
                        <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>{info.desc}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button onClick={() => moveImageProvider(i, -1)} disabled={i === 0} style={{ background: 'none', border: `1px solid ${th.border}`, borderRadius: 5, cursor: i === 0 ? 'not-allowed' : 'pointer', color: th.muted, fontSize: 11, padding: '2px 8px', opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                        <button onClick={() => moveImageProvider(i, 1)} disabled={i === imageProviderOrder.length - 1} style={{ background: 'none', border: `1px solid ${th.border}`, borderRadius: 5, cursor: i === imageProviderOrder.length - 1 ? 'not-allowed' : 'pointer', color: th.muted, fontSize: 11, padding: '2px 8px', opacity: i === imageProviderOrder.length - 1 ? 0.3 : 1 }}>▼</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <button onClick={saveImageProviderOrder} disabled={imgProviderSaving} style={{ ...th.btnPrimary, opacity: imgProviderSaving ? 0.6 : 1 }}>
            {imgProviderSaving ? 'সেভ হচ্ছে...' : '💾 Order সেভ করো'}
          </button>
        </div>

        {/* Laptop AI Mode */}
        <div style={th.card}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
            🤖 AI Provider Control
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Laptop (Ollama) Mode</div>
          <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 14 }}>
            {localAiMode === 'all'
              ? '✅ Laptop ON — Bot + AI Generate সব Ollama দিয়ে চলবে। Laptop বন্ধ করলে নিচের option বেছে নিন।'
              : localAiMode === 'generate_only'
                ? '⚡ Laptop OFF (Bot) — Messenger bot সরাসরি OpenAI, AI Generate এখনো Ollama চেষ্টা করবে।'
                : '❌ Laptop OFF (সব) — সব কিছু সরাসরি OpenAI ব্যবহার করবে।'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { mode: 'all', label: '💻 Laptop ON', desc: 'সব Ollama' },
              { mode: 'generate_only', label: '⚡ Bot OFF', desc: 'Bot → OpenAI, Generate → Ollama' },
              { mode: 'none', label: '🌐 সব OFF', desc: 'সব → OpenAI' },
            ] as const).map(({ mode, label, desc }) => (
              <button
                key={mode}
                disabled={laptopAiSaving}
                onClick={() => setAiMode(mode)}
                style={{
                  ...(localAiMode === mode ? th.btnPrimary : th.btnGhost),
                  opacity: laptopAiSaving ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '8px 14px', gap: 2,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>{laptopAiSaving && localAiMode === mode ? '...' : label}</span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>{desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );

  // ── Impersonate handler (shared) ──────────────────────────────────────────
  const impersonateUser = async (u: { id: string; email?: string | null; username?: string; name?: string }) => {
    const label = u.email || u.username || u.name || u.id;
    if (!window.confirm(`"${label}" এর account এ impersonate করে ঢুকবেন?\n\nআপনি তার dashboard এ চলে যাবেন। যেকোনো সময় floating bar থেকে Exit করে admin এ ফিরতে পারবেন।`)) return;
    setImpersonatingId(u.id);
    try {
      const res = await request<{ token: string; user?: { email?: string; username?: string; name?: string } }>(
        `${BASE}/users/${u.id}/impersonate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (!res?.token) throw new Error('Impersonation token পাওয়া যায়নি');
      startImpersonation(res.token, res.user?.email || res.user?.username || label);
    } catch (e: any) { onToast(e.message, 'error'); setImpersonatingId(null); }
  };

  // ── USERS (reference-style table: name · email · credits · used · businesses · status · impersonate)
  const UsersTab = () => {
    const q = userSearch.trim().toLowerCase();
    const rows = !q ? clients : clients.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q));
    const fmtCr = (n: number) => `${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CR`;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={th.card}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <input style={{ ...th.input, paddingLeft: 34 }} placeholder="Name / email দিয়ে search করুন…"
                value={userSearch} onChange={e => setUserSearch(e.target.value)} />
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
            </div>
            <button style={th.btnGhost} onClick={loadClients}>{loading ? <Spinner size={13}/> : '🔄 Refresh'}</button>
            <div style={{ fontSize: 12.5, color: th.muted, fontWeight: 700 }}>{rows.length} users</div>
          </div>
        </div>

        <div style={{ ...th.card, padding: 0, overflow: 'hidden' }}>
          {loading && !clients.length
            ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={20}/></div>
            : rows.length === 0
            ? <EmptyState icon="👤" title="কোনো user নেই" />
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: th.surface, color: th.muted, textAlign: 'left' }}>
                      {['Name', 'Email', 'Credits', 'Credit Used', 'Businesses', 'Status', 'Impersonate'].map((h, i) => (
                        <th key={h} style={{
                          padding: '11px 14px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
                          letterSpacing: '0.04em', whiteSpace: 'nowrap',
                          textAlign: i >= 2 && i <= 4 ? 'right' : 'left',
                          borderBottom: `1px solid ${th.border}`,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(u => (
                      <tr key={u.id} style={{ borderBottom: `1px solid ${th.border}` }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{u.name || u.username || '—'}</td>
                        <td style={{ padding: '10px 14px', color: th.muted, whiteSpace: 'nowrap' }}>{u.email || u.username || '—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtCr(u.credits)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: th.muted, whiteSpace: 'nowrap' }}>{fmtCr(u.creditUsed)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{u.pageCount}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            ...th.pill, ...(u.isActive !== false ? th.pillGreen : th.pillRed),
                            fontSize: 10, fontWeight: 800,
                          }}>{u.isActive !== false ? 'ACTIVE' : 'OFF'}</span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <button
                            onClick={() => impersonateUser(u)}
                            disabled={impersonatingId === u.id}
                            style={{
                              padding: '6px 16px', borderRadius: 8, border: `1.5px solid ${th.border}`,
                              cursor: 'pointer', fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
                              background: 'transparent', color: th.accent, whiteSpace: 'nowrap',
                            }}>
                            {impersonatingId === u.id ? <Spinner size={12}/> : 'Impersonate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    );
  };

  // ── CLIENTS ───────────────────────────────────────────────────────────────
  const ClientsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Create Client button + form */}
      <div style={th.card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: showCreateClient ? 18 : 0 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:14.5, letterSpacing:'-0.02em' }}>👤 Create Client</div>
            <div style={{ fontSize:12.5, color:th.muted, marginTop:2 }}>Manually add a new client account</div>
          </div>
          <button style={{ ...th.btnPrimary, fontSize:12.5 }} onClick={() => setShowCreateClient(v => !v)}>
            {showCreateClient ? '✕ Cancel' : '+ New Client'}
          </button>
        </div>

        {showCreateClient && (
          <div style={{ display:'flex', flexDirection:'column', gap:12, animation:'fadeIn .2s ease' }}>
            <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <div style={{ fontSize:11.5, fontWeight:600, color:th.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>
                  Phone / Email / Username *
                </div>
                <input style={th.input} placeholder="01XXXXXXXXX বা email@gmail.com"
                  value={newClient.identifier}
                  onChange={e => setNewClient(c => ({ ...c, identifier: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize:11.5, fontWeight:600, color:th.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>
                  Full Name
                </div>
                <input style={th.input} placeholder="Client এর নাম"
                  value={newClient.name}
                  onChange={e => setNewClient(c => ({ ...c, name: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize:11.5, fontWeight:600, color:th.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>
                  Password *
                </div>
                <input style={th.input} type="password" placeholder="কমপক্ষে ৬ character"
                  value={newClient.password}
                  onChange={e => setNewClient(c => ({ ...c, password: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize:11.5, fontWeight:600, color:th.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>
                  Page IDs (optional)
                </div>
                <input style={th.input} placeholder="1, 2, 3 (comma separated)"
                  value={newClient.pageIds}
                  onChange={e => setNewClient(c => ({ ...c, pageIds: e.target.value }))} />
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button
                style={{
                  ...th.btnPrimary,
                  background: creating ? th.muted : 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                  padding: '10px 20px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 800
                }}
                onClick={createClient} disabled={creating}
              >
                {creating ? <Spinner size={14} color="#fff" /> : '✓ Create Account'}
              </button>
              <button style={th.btnGhost} onClick={() => { setShowCreateClient(false); setNewClient({ identifier:'', name:'', password:'', pageIds:'' }); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

    <div style={{ display: 'grid', gridTemplateColumns: selectedPage ? '340px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

      {/* Page list */}
      <div style={th.card}>
        <CardHeader th={th} title="📄 All Pages"
          sub={`${pages.length} pages`}
          action={<button style={th.btnGhost} onClick={loadClients}>{loading ? <Spinner size={13}/> : '🔄'}</button>}
        />
        {loading && !pages.length
          ? <div style={{ textAlign: 'center', padding: 30 }}><Spinner size={20}/></div>
          : pages.length === 0
          ? <EmptyState icon="📄" title="কোনো page নেই" />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflowY: 'auto' }}>
              {pages.map(pg => (
                <div key={pg.id}
                  onClick={() => loadPageCfg(pg)}
                  style={{
                    ...th.card2, cursor: 'pointer',
                    border: `1.5px solid ${selectedPage?.id === pg.id ? th.accent : th.border}`,
                    background: selectedPage?.id === pg.id ? th.accentSoft : undefined,
                    transition: 'all .12s',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {pg.masterPageId ? '↳ ' : ''}{pg.pageName}
                        {pg.hasCustomApp && (
                          <span style={{ fontSize: 9, background: 'rgba(99,102,241,0.15)', color: '#6366f1', borderRadius: 5, padding: '1px 6px', fontWeight: 800 }}>Custom App</span>
                        )}
                      </div>
                      {pg.owner && (
                        <div style={{ fontSize: 11.5, color: th.muted, marginTop: 2 }}>
                          👤 {pg.owner.name || pg.owner.username}
                          {' · '}
                          {pages.filter(p => p.owner?.id === pg.owner?.id).length} page
                        </div>
                      )}
                      {pg.lastReconnectedAt && (
                        <div style={{ fontSize: 10.5, color: '#f59e0b', marginTop: 2 }}>
                          🔄 {new Date(pg.lastReconnectedAt).toLocaleDateString('bn-BD', { day:'numeric', month:'short', year:'numeric' })}
                          {pg.previousPageId && <span style={{ color: th.muted }}> ← {pg.previousPageId}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                      <span style={{ ...th.pill, ...(pg.automationOn ? th.pillGreen : th.pillRed), fontSize: 10 }}>
                        {pg.automationOn ? '🟢 Bot ON' : '🔴 Bot OFF'}
                      </span>
                      {pg.owner?.isActive === false && (
                        <span style={{ ...th.pill, background: 'rgba(239,68,68,.15)', color: '#ef4444', fontSize: 10 }}>🚫 Account OFF</span>
                      )}
                      {pg.websiteEnabled === false && (
                        <span style={{ ...th.pill, background: 'rgba(245,158,11,.15)', color: '#d97706', fontSize: 10 }}>⏸ Website OFF</span>
                      )}
                      <span style={{ fontSize: 10, color: th.muted }}>#{pg.id}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Selected page panel */}
      {selectedPage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header */}
          <div style={{ ...th.card, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>{selectedPage.pageName}</div>
              <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>
                {selectedPage.owner?.name || selectedPage.owner?.username} · #{selectedPage.id} · FB: {selectedPage.pageId}
                {pageSettings && <span style={{ marginLeft: 8, ...th.pill, ...(pageSettings.automationOn ? th.pillGreen : th.pillRed), fontSize: 10 }}>{pageSettings.automationOn ? '🟢 Bot ON' : '🔴 Bot OFF'}</span>}
              </div>
              {/* Reconnect history */}
              {selectedPage.lastReconnectedAt ? (
                <div style={{ marginTop: 6, fontSize: 11.5, padding: '5px 10px', borderRadius: 7, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span>🔄</span>
                  <span style={{ color: '#d97706', fontWeight: 700 }}>
                    Page পরিবর্তন হয়েছে: {new Date(selectedPage.lastReconnectedAt).toLocaleString('bn-BD', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                  </span>
                  {selectedPage.previousPageId && (
                    <span style={{ color: th.muted }}>· আগের FB ID: {selectedPage.previousPageId}</span>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 5, fontSize: 11, color: th.muted }}>Page কখনো পরিবর্তন হয়নি</div>
              )}
              {/* Owner's total page count */}
              <div style={{ marginTop: 4, fontSize: 11, color: th.muted }}>
                এই owner এর মোট {pages.filter(p => p.owner?.id === selectedPage.owner?.id).length} টি page আছে
              </div>
              {/* Account & Website controls */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {selectedPage.owner && (
                  <button
                    style={{
                      padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
                      background: selectedPage.owner.isActive !== false ? 'rgba(239,68,68,.12)' : 'rgba(22,163,74,.12)',
                      color: selectedPage.owner.isActive !== false ? '#ef4444' : '#16a34a',
                    }}
                    onClick={async () => {
                      const newVal = selectedPage.owner!.isActive === false;
                      try {
                        await request(`${BASE}/users/${selectedPage.owner!.id}/account-status`, {
                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ isActive: newVal }),
                        });
                        setPages(prev => prev.map(p =>
                          p.owner?.id === selectedPage.owner?.id
                            ? { ...p, owner: { ...p.owner!, isActive: newVal } }
                            : p
                        ));
                        setSelectedPage(prev => prev ? { ...prev, owner: { ...prev.owner!, isActive: newVal } } : prev);
                        onToast(newVal ? 'Account চালু করা হয়েছে' : 'Account বন্ধ করা হয়েছে', 'success');
                      } catch (e: any) { onToast(e.message, 'error'); }
                    }}
                  >
                    {selectedPage.owner.isActive !== false ? '🚫 Account OFF করুন' : '✅ Account ON করুন'}
                  </button>
                )}
                {selectedPage.owner && (
                  <button
                    title="এই user এর account এ login করুন — সব কিছু তার চোখে দেখুন"
                    style={{
                      padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
                      background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff',
                    }}
                    onClick={() => impersonateUser(selectedPage.owner!)}
                  >
                    🎭 Impersonate
                  </button>
                )}
                <button
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
                    background: selectedPage.websiteEnabled !== false ? 'rgba(245,158,11,.12)' : 'rgba(22,163,74,.12)',
                    color: selectedPage.websiteEnabled !== false ? '#d97706' : '#16a34a',
                  }}
                  onClick={async () => {
                    const newVal = selectedPage.websiteEnabled === false;
                    try {
                      await request(`${BASE}/pages/${selectedPage.id}/website-status`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: newVal }),
                      });
                      setPages(prev => prev.map(p => p.id === selectedPage.id ? { ...p, websiteEnabled: newVal } : p));
                      setSelectedPage(prev => prev ? { ...prev, websiteEnabled: newVal } : prev);
                      onToast(newVal ? 'Website চালু করা হয়েছে' : 'Website বন্ধ করা হয়েছে', 'success');
                    } catch (e: any) { onToast(e.message, 'error'); }
                  }}
                >
                  {selectedPage.websiteEnabled !== false ? '⏸ Website OFF করুন' : '▶ Website ON করুন'}
                </button>
              </div>
            </div>
            <button style={th.btnGhost} onClick={() => { setSelectedPage(null); setClientCfg(null); setPageSettings(null); }}>✕</button>
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 4, background: th.surface, padding: 4, borderRadius: 10, border: `1px solid ${th.border}` }}>
            {([['settings','⚙️ Settings'],['wallet','💰 Wallet'],['bot','🤖 Bot Knowledge']] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setClientPageTab(k); if (k === 'wallet') loadPageWallet(selectedPage.id); }} style={{
                flex: 1, padding: '7px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                background: clientPageTab === k ? th.accent : 'transparent',
                color: clientPageTab === k ? '#fff' : th.muted,
              }}>{label}</button>
            ))}
          </div>

          {clientLoading
            ? <div style={{ textAlign: 'center', padding: 32 }}><Spinner size={20}/></div>
            : clientPageTab === 'settings' ? (
              /* ── Settings Panel ── */
              pageSettings && (
                <div style={{ ...th.card, display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Bot ON/OFF */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', ...th.card2, borderRadius: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>Bot Automation</div>
                      <div style={{ fontSize: 11.5, color: th.muted, marginTop: 2 }}>Messenger webhook থেকে auto reply</div>
                    </div>
                    <button onClick={() => setPageSettings((p: any) => ({ ...p, automationOn: !p.automationOn }))}
                      style={{ ...th.btnPrimary, background: pageSettings.automationOn ? '#16a34a' : '#ef4444', fontSize: 12, padding: '6px 16px' }}>
                      {pageSettings.automationOn ? '🟢 ON' : '🔴 OFF'}
                    </button>
                  </div>

                  {/* Business Info */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Business Info</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {[
                        ['businessName','Business Name','Limon Tech Diary'],
                        ['businessPhone','Phone','01XXXXXXXXX'],
                        ['currencySymbol','Currency','৳'],
                        ['codLabel','COD Label','COD'],
                      ].map(([key, label, ph]) => (
                        <div key={key}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
                          <input style={th.input} value={pageSettings[key] ?? ''} placeholder={ph}
                            onChange={e => setPageSettings((p: any) => ({ ...p, [key]: e.target.value }))} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SmartBot Mode */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', ...th.card2, borderRadius: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>SmartBot Mode</div>
                      <div style={{ fontSize: 11.5, color: th.muted, marginTop: 2 }}>ON = সব reply AI দিয়ে (persona পুরোটায় কাজ করে, খরচ বেশি) · OFF = keyword+AI hybrid (সস্তা)</div>
                    </div>
                    <button onClick={() => setPageSettings((p: any) => ({ ...p, smartBotOn: !p.smartBotOn }))}
                      style={{ ...th.btnPrimary, background: pageSettings.smartBotOn ? '#16a34a' : '#ef4444', fontSize: 12, padding: '6px 16px' }}>
                      {pageSettings.smartBotOn ? '🟢 ON' : '🔴 OFF'}
                    </button>
                  </div>

                  {/* Bot Personality / System Prompt */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Bot Personality (System Prompt)</div>
                    <textarea
                      style={{ ...th.input, minHeight: 100, resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
                      value={pageSettings.customPersonaPrompt ?? ''}
                      maxLength={2000}
                      placeholder="এই client-এর bot কীভাবে কথা বলবে তার custom instructions — খালি রাখলে default agent persona ব্যবহার হবে"
                      onChange={e => setPageSettings((p: any) => ({ ...p, customPersonaPrompt: e.target.value }))}
                    />
                    <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                      Client নিজেও এটা তাদের Settings থেকে edit করতে পারে — এটা সেই একই field।
                    </div>
                  </div>

                  {/* Product Code Prefix */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Product Code</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>
                          Code Prefix <span style={{ color: th.accent }}>*</span>
                        </div>
                        <input style={{ ...th.input, textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.05em' }}
                          value={pageSettings.productCodePrefix ?? 'DF'} maxLength={6} placeholder="DF"
                          onChange={e => setPageSettings((p: any) => ({ ...p, productCodePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g,'') }))} />
                        <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                          OCR এই prefix দিয়ে product code খুঁজবে · Preview: <b style={{ color: th.accent }}>{pageSettings.productCodePrefix || 'DF'}-0001</b>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>Catalog Slug</div>
                        <input style={th.input} value={pageSettings.catalogSlug ?? ''} placeholder="limon-tech-diary"
                          onChange={e => setPageSettings((p: any) => ({ ...p, catalogSlug: e.target.value.toLowerCase().replace(/[^\w-]/g,'') }))} />
                        <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                          /catalog/<b>{pageSettings.catalogSlug || '...'}</b>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Delivery */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Delivery Fees</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      {[
                        ['deliveryFeeInsideDhaka','Inside Dhaka','80'],
                        ['deliveryFeeOutsideDhaka','Outside Dhaka','120'],
                        ['deliveryTimeText','Delivery Time','3-5 days'],
                      ].map(([key, label, ph]) => (
                        <div key={key}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
                          <input style={th.input} value={pageSettings[key] ?? ''} placeholder={ph}
                            onChange={e => setPageSettings((p: any) => ({ ...p, [key]: e.target.value }))} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Payment */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Payment</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>Mode</div>
                        <select style={th.input} value={pageSettings.paymentMode ?? 'cod'}
                          onChange={e => setPageSettings((p: any) => ({ ...p, paymentMode: e.target.value }))}>
                          <option value="cod">COD (ক্যাশ অন ডেলিভারি)</option>
                          <option value="advance_outside">Advance (Outside Dhaka)</option>
                          <option value="full_advance">Full Advance</option>
                        </select>
                      </div>
                      {[['advanceBkash','Bkash','01XXXXXXXXX'],['advanceNagad','Nagad','01XXXXXXXXX']].map(([key, label, ph]) => (
                        <div key={key}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
                          <input style={th.input} value={pageSettings[key] ?? ''} placeholder={ph}
                            onChange={e => setPageSettings((p: any) => ({ ...p, [key]: e.target.value }))} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Auto Payment Verification */}
                  <PaymentGatewaySection
                    th={th}
                    pageId={selectedPage.id}
                    request={request}
                  />

                  {/* Catalog link */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>Catalog Order Button Link</div>
                    <input style={th.input} value={pageSettings.catalogMessengerUrl ?? ''} placeholder="https://m.me/PageName"
                      onChange={e => setPageSettings((p: any) => ({ ...p, catalogMessengerUrl: e.target.value }))} />
                  </div>

                  {/* Feature Toggles */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Feature Toggles</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                      {[
                        ['automationOn','🤖 Bot Automation'],
                        ['ocrOn','📸 OCR Mode'],
                        ['infoModeOn','📦 Info Mode'],['orderModeOn','🛒 Order Mode'],
                        ['printModeOn','🖨️ Print Mode'],['callConfirmModeOn','📞 Call Confirm'],
                        ['memoSaveModeOn','📝 Memo Save'],
                        ['memoTemplateModeOn','📄 Memo Template'],
                        ['autoMemoDesignModeOn','🎨 Auto Memo Design'],
                        ['commentReplyAllowed','💬 Comment Reply Allow'],
                        ['commentReplyOn','💬 Comment Reply On'],
                      ].map(([key, label]) => (
                        <label key={key} style={{ ...th.card2, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px', borderRadius: 8 }}>
                          <input type="checkbox" checked={Boolean(pageSettings[key])}
                            onChange={e => setPageSettings((p: any) => ({ ...p, [key]: e.target.checked }))} />
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Save button */}
                  <button style={{ ...th.btnPrimary, alignSelf: 'flex-start' }} onClick={savePageSettings} disabled={pageSettingsSaving}>
                    {pageSettingsSaving ? <><Spinner size={13} color="#fff"/> Saving…</> : '💾 Save Settings'}
                  </button>

                  {/* Facebook App Credentials (BYOA) */}
                  <div style={{ borderTop: `1px solid ${th.border}`, paddingTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                      🔑 Facebook App Credentials
                    </div>
                    <div style={{ fontSize: 11.5, color: th.muted, marginBottom: 10 }}>
                      {adminFbAppId
                        ? <>Custom App: <strong style={{ color: th.text }}>{adminFbAppId}</strong></>
                        : 'Platform default app (no custom credentials set)'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>App ID</div>
                        <input style={th.input} value={adminFbAppId} onChange={e => setAdminFbAppId(e.target.value)} placeholder="1234567890123456" />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>App Secret (blank = no change)</div>
                        <input style={th.input} type="password" value={adminFbAppSecret} onChange={e => setAdminFbAppSecret(e.target.value)} placeholder="Enter new secret to update" autoComplete="new-password" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ ...th.btnPrimary, flex: 1 }} onClick={saveAppCredentials} disabled={appCredSaving}>
                        {appCredSaving ? <><Spinner size={12} color="#fff"/> Saving…</> : '🔑 Save App Credentials'}
                      </button>
                      {adminFbAppId && (
                        <button style={{ ...th.btnGhost, color: '#ef4444', fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }} onClick={clearAppCredentials} disabled={appCredSaving}>
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            ) : clientPageTab === 'wallet' ? (
              /* ── Wallet Panel ── */
              pageWalletLoading && !pageWallet ? (
                <div style={{ textAlign: 'center', padding: 32 }}><Spinner size={20}/></div>
              ) : !pageWallet ? null : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Balance header */}
                  <div style={{ ...th.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Credit Balance</div>
                      <div style={{ fontSize: 26, fontWeight: 900, color: pageWallet.page.creditBalance <= 0 ? '#ef4444' : pageWallet.page.creditBalance < 4000 ? '#f59e0b' : '#22c55e' }}>
                        {Math.round(pageWallet.page.creditBalance).toLocaleString()} credit
                      </div>
                      <span style={{ ...th.pill, ...(pageWallet.page.subscriptionStatus === 'ACTIVE' ? th.pillGreen : th.pillRed), fontSize: 10, marginTop: 4, display: 'inline-block' }}>
                        {pageWallet.page.subscriptionStatus}
                      </span>
                    </div>
                    <button style={th.btnGhost} onClick={() => loadPageWallet(selectedPage.id)}>{pageWalletLoading ? <Spinner size={13}/> : '🔄'}</button>
                  </div>

                  {/* Recharge + Adjust */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={th.card}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>💳 Recharge</div>
                      <input style={{ ...th.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} type="number" placeholder="Amount (credit)"
                        value={pwRecharge.creditAmount} onChange={e => setPwRecharge(f => ({ ...f, creditAmount: e.target.value }))} />
                      <input style={{ ...th.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} placeholder="Transaction ID"
                        value={pwRecharge.transactionId} onChange={e => setPwRecharge(f => ({ ...f, transactionId: e.target.value }))} />
                      <input style={{ ...th.input, width: '100%', boxSizing: 'border-box', marginBottom: 10 }} placeholder="Note (optional)"
                        value={pwRecharge.note} onChange={e => setPwRecharge(f => ({ ...f, note: e.target.value }))} />
                      <button style={{ ...th.btnPrimary, width: '100%' }} disabled={pwRechargeSaving} onClick={pwDoRecharge}>
                        {pwRechargeSaving ? <Spinner size={13} color="#fff"/> : '💰 Recharge করুন'}
                      </button>
                    </div>
                    <div style={th.card}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>⚖️ Adjust (Add/Subtract)</div>
                      <input style={{ ...th.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} type="number" placeholder="Amount — কমাতে negative, যেমন -100"
                        value={pwAdjust.creditAmount} onChange={e => setPwAdjust(f => ({ ...f, creditAmount: e.target.value }))} />
                      <input style={{ ...th.input, width: '100%', boxSizing: 'border-box', marginBottom: 10 }} placeholder="Note (optional)"
                        value={pwAdjust.note} onChange={e => setPwAdjust(f => ({ ...f, note: e.target.value }))} />
                      <button style={{ ...th.btnGhost, width: '100%', border: `1px solid ${th.border}` }} disabled={pwAdjustSaving} onClick={pwDoAdjust}>
                        {pwAdjustSaving ? <Spinner size={13}/> : '⚖️ Adjust করুন'}
                      </button>
                    </div>
                  </div>

                  {/* Per-page pricing override */}
                  <div style={th.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>🎯 Per-Page Pricing Override</div>
                      <div style={{ fontSize: 11, color: th.muted }}>খালি রাখলে global default pricing চলবে এই page-এ</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {PRICING_FIELDS.filter(f => f.key !== 'creditsPerBdt').map(f => (
                        <div key={f.key}>
                          <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>{f.label}</div>
                          <input style={{ ...th.input, width: '100%', boxSizing: 'border-box' }} type="number" step="0.01"
                            value={pwPricing?.[f.key] ?? ''}
                            onChange={e => setPwPricing((p: any) => ({ ...p, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                        </div>
                      ))}
                    </div>
                    <button style={{ ...th.btnPrimary, marginTop: 12 }} disabled={pwPricingSaving} onClick={pwSavePricing}>
                      {pwPricingSaving ? <Spinner size={13} color="#fff"/> : '💾 Pricing Override Save করুন'}
                    </button>
                  </div>

                  {/* Transaction history */}
                  <div style={th.card}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>📜 Transaction History ({pageWallet.transactions.length})</div>
                    {pageWallet.transactions.length === 0 ? (
                      <div style={{ textAlign: 'center', color: th.muted, padding: 20, fontSize: 12 }}>কোনো transaction নেই।</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                        {pageWallet.transactions.map((t: any) => (
                          <div key={t.id} style={{ ...th.card2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, fontSize: 12 }}>
                            <div>
                              <div style={{ fontWeight: 700 }}>{t.type}</div>
                              <div style={{ color: th.muted, fontSize: 11 }}>{t.description}</div>
                              <div style={{ color: th.muted, fontSize: 10 }}>{new Date(t.createdAt).toLocaleString('en-BD')}</div>
                            </div>
                            <div style={{ fontWeight: 800, color: t.amountCredit >= 0 ? '#22c55e' : '#ef4444' }}>
                              {t.amountCredit >= 0 ? '+' : ''}{Math.round(t.amountCredit).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              /* ── Bot Knowledge Panel ── */
              !clientCfg ? null : (
                <div style={{ ...th.card, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Questions list */}
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                      Questions ({clientCfg.questions?.length || 0})
                      <InfoButton text="এই page এ active সব questions। Edit করে helpText বা keyword বদলাতে পারেন।" th={th} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                      {(clientCfg.questions || []).map((q: any) => (
                        <ClientQuestionRow
                          key={q.key} q={q} th={th} saving={saving}
                          onSaveHelpText={(helpText) => {
                            const updated = clientCfg.questions.map((x: any) => x.key === q.key ? { ...x, helpText } : x);
                            saveClientQuestions(selectedPage.id, updated);
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Push global question */}
                  {(globalCfg?.questions?.length > 0) && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                        Global Question Push করুন
                        <InfoButton text="Global bank থেকে এই page এ question push করুন।" th={th} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(globalCfg.questions || []).map((gq: any) => {
                          const alreadyHas = (clientCfg.questions || []).some((q: any) => q.key === gq.key);
                          return (
                            <button key={gq.key}
                              style={{ ...th.btnSmGhost, fontSize: 11.5, opacity: alreadyHas ? 0.4 : 1 }}
                              disabled={saving || alreadyHas}
                              onClick={() => pushGlobalToPage(selectedPage.id, gq.key)}>
                              {alreadyHas ? '✓' : '⬇️'} {gq.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
        </div>
      )}
    </div>
    </div>  
  );

  // ── GLOBAL QUESTIONS ──────────────────────────────────────────────────────
  const GlobalQuestionsTab = () => {
    const [questions, setQuestions] = useState<any[]>(globalCfg?.questions || []);
    const [editIdx, setEditIdx]     = useState<number | null>(null);
    const [adding, setAdding]       = useState(false);
    const [newQ, setNewQ]           = useState<{ label: string; realMeaning: string; keywords: string[]; helpText: string; replyTemplate: string }>({ label: '', realMeaning: '', keywords: [], helpText: '', replyTemplate: '' });
    const [newKwInput, setNewKwInput] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    useEffect(() => { setQuestions(globalCfg?.questions || []); }, [globalCfg]);

    const upd = (i: number, patch: any) =>
      setQuestions(qs => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));

    const addNew = () => {
      if (!newQ.label.trim()) return;
      const autoKey = newQ.label.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '') || `custom_${Date.now()}`;
      const q = {
        key: autoKey,
        label: newQ.label.trim(),
        realMeaning: newQ.realMeaning.trim(),
        keywords: newQ.keywords,
        helpText: newQ.helpText.trim(),
        replyTemplate: newQ.replyTemplate.trim(),
        priority: questions.length + 1,
      };
      setQuestions(qs => [...qs, q]);
      setNewQ({ label: '', realMeaning: '', keywords: [], helpText: '', replyTemplate: '' });
      setNewKwInput('');
      setAdding(false);
      setEditIdx(questions.length);
    };

    const deleteQ = (i: number) => {
      setQuestions(qs => qs.filter((_, idx) => idx !== i));
      setDeleteConfirm(null);
      if (editIdx === i) setEditIdx(null);
    };

    return (
      <div style={th.card}>
        <CardHeader th={th} title="🌐 Global Question Bank"
          sub={`সব client এর জন্য default questions — ${questions.length} টি question`}
          action={
            <button style={th.btnPrimary} onClick={() => { setAdding(a => !a); setNewQ({ label: '', realMeaning: '', keywords: [], helpText: '', replyTemplate: '' }); setNewKwInput(''); }}>
              {adding ? '✕ Cancel' : '➕ New Question'}
            </button>
          }
        />

        {/* ── Add New Question Form ── */}
        {adding && (
          <div style={{ border: `2px solid ${th.accent}`, borderRadius: 14, padding: '18px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 15, color: th.accent }}>➕ নতুন Global Question তৈরি করুন</div>
                <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>Key স্বয়ংক্রিয়ভাবে Label থেকে তৈরি হবে</div>
              </div>
            </div>

            {/* Step 1 */}
            <div style={{ background: th.surface, borderRadius: 10, padding: '14px 16px', marginBottom: 10, border: `1px solid ${th.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: th.accent, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 }}>
                Step 1 · Question পরিচয়
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: th.text, marginBottom: 5 }}>
                    প্রশ্নের নাম (Label) <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <input style={th.input} placeholder="যেমন: Delivery Time" value={newQ.label}
                    onChange={e => setNewQ(p => ({ ...p, label: e.target.value }))} />
                  {newQ.label && (
                    <div style={{ fontSize: 10.5, color: th.muted, marginTop: 4 }}>
                      Key হবে: <code style={{ background: th.accentSoft, color: th.accent, padding: '1px 5px', borderRadius: 4 }}>
                        {newQ.label.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '') || '…'}
                      </code>
                    </div>
                  )}
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: th.text, marginBottom: 5 }}>Real Meaning</div>
                  <input style={th.input} placeholder="Customer delivery সময় জানতে চাইছে" value={newQ.realMeaning}
                    onChange={e => setNewQ(p => ({ ...p, realMeaning: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Step 2 — Keywords */}
            <div style={{ background: th.surface, borderRadius: 10, padding: '14px 16px', marginBottom: 10, border: `1px solid ${th.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: th.accent, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 }}>
                Step 2 · Keywords
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 10, minHeight: 28 }}>
                {newQ.keywords.map((k, i) => (
                  <span key={i} style={{ background: th.accentSoft, color: th.accent, fontSize: 12, padding: '3px 9px', borderRadius: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, border: `1px solid ${th.accent}40` }}>
                    {k}
                    <button onClick={() => setNewQ(p => ({ ...p, keywords: p.keywords.filter((_, j) => j !== i) }))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.accent, fontSize: 13, lineHeight: '1', padding: 0, opacity: 0.7 }}>×</button>
                  </span>
                ))}
                {newQ.keywords.length === 0 && <span style={{ fontSize: 12, color: th.muted, fontStyle: 'italic' }}>কোনো keyword নেই</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...th.input, flex: 1 }}
                  placeholder="keyword লিখুন, তারপর Enter — যেমন: delivery, কতদিন"
                  value={newKwInput}
                  onChange={e => setNewKwInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = newKwInput.trim();
                      if (val && !newQ.keywords.includes(val)) {
                        setNewQ(p => ({ ...p, keywords: [...p.keywords, val] }));
                        setNewKwInput('');
                      }
                    }
                  }} />
                <button style={th.btnGhost} onClick={() => {
                  const val = newKwInput.trim();
                  if (val && !newQ.keywords.includes(val)) {
                    setNewQ(p => ({ ...p, keywords: [...p.keywords, val] }));
                    setNewKwInput('');
                  }
                }}>+ Add</button>
              </div>
            </div>

            {/* Step 3 — Reply */}
            <div style={{ background: th.surface, borderRadius: 10, padding: '14px 16px', marginBottom: 14, border: `1px solid ${th.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: th.accent, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 }}>
                Step 3 · Reply &amp; Help
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: th.text, marginBottom: 5 }}>Reply Template</div>
                <textarea style={{ ...th.input, height: 68, resize: 'vertical' as const, fontFamily: 'inherit', fontSize: 13 }}
                  placeholder="আমাদের delivery time {{deliveryTime}} দিন।" value={newQ.replyTemplate}
                  onChange={e => setNewQ(p => ({ ...p, replyTemplate: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: th.text, marginBottom: 5 }}>Help Text (client ⓘ tooltip)</div>
                <input style={th.input} placeholder="Customer delivery সময় জিজ্ঞেস করলে এই reply যাবে..." value={newQ.helpText}
                  onChange={e => setNewQ(p => ({ ...p, helpText: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...th.btnPrimary, padding: '10px 20px' }} onClick={addNew}
                disabled={!newQ.label.trim()}>
                ✅ Add Question
              </button>
              <button style={th.btnGhost} onClick={() => { setAdding(false); setNewKwInput(''); }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, i) => (
            <div key={`${q.key}-${i}`} style={{ border: `1.5px solid ${editIdx === i ? th.accent : th.border}`, borderRadius: 12, padding: '12px 14px' }}>
              {editIdx === i ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <FieldWithInfo th={th} label="Key" helpText="Unique identifier। একবার set করলে বদলানো উচিত না।">
                      <input style={th.input} value={q.key} onChange={e => upd(i, { key: e.target.value })} />
                    </FieldWithInfo>
                    <FieldWithInfo th={th} label="Label" helpText="Dashboard এ দেখানো নাম।">
                      <input style={th.input} value={q.label} onChange={e => upd(i, { label: e.target.value })} />
                    </FieldWithInfo>
                    <FieldWithInfo th={th} label="Real Meaning" helpText="এই question এর actual meaning। Bot এটা দেখে বোঝার চেষ্টা করে।">
                      <input style={th.input} value={q.realMeaning || ''} onChange={e => upd(i, { realMeaning: e.target.value })} />
                    </FieldWithInfo>
                    <FieldWithInfo th={th} label="Keywords (comma)" helpText="Customer এই words লিখলে match হবে। Bangla + English দুটোই রাখুন।">
                      <input style={th.input} value={(q.keywords || []).join(', ')}
                        onChange={e => upd(i, { keywords: e.target.value.split(',').map((k: string) => k.trim()).filter(Boolean) })} />
                    </FieldWithInfo>
                  </div>
                  <FieldWithInfo th={th} label="📝 Help Text (ⓘ tooltip)" helpText="Client dashboard এ ⓘ hover করলে এই text দেখাবে।">
                    <input style={th.input} value={q.helpText || ''}
                      placeholder="উদাহরণ: Customer delivery সময় জিজ্ঞেস করলে এই reply যাবে..."
                      onChange={e => upd(i, { helpText: e.target.value })} />
                  </FieldWithInfo>
                  <FieldWithInfo th={th} label="Reply Template" helpText="Bot এই template দিয়ে reply করবে। {{deliveryTime}}, {{insideFee}} ইত্যাদি variables ব্যবহার করুন।">
                    <textarea style={{ ...th.input, height: 72, resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }}
                      value={q.replyTemplate || ''} onChange={e => upd(i, { replyTemplate: e.target.value })} />
                  </FieldWithInfo>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={th.btnSmGhost} onClick={() => setEditIdx(null)}>✓ Done editing</button>
                    {deleteConfirm === i ? (
                      <>
                        <span style={{ fontSize: 12, color: '#ef4444', alignSelf: 'center' }}>Delete করবেন?</span>
                        <button style={{ ...th.btnSmGhost, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => deleteQ(i)}>হ্যাঁ, Delete</button>
                        <button style={th.btnSmGhost} onClick={() => setDeleteConfirm(null)}>না</button>
                      </>
                    ) : (
                      <button style={{ ...th.btnSmGhost, color: '#ef4444' }} onClick={() => setDeleteConfirm(i)}>🗑️ Delete</button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5, color: th.accent }}>{q.label}</span>
                      <code style={{ fontSize: 10.5, color: th.muted, fontFamily: 'monospace' }}>{q.key}</code>
                      <InfoButton text={q.helpText || q.realMeaning || ''} th={th} />
                    </div>
                    <div style={{ fontSize: 11.5, color: th.muted, marginBottom: 6 }}>{q.realMeaning}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(q.keywords || []).map((k: string) => (
                        <span key={k} style={{ background: th.accentSoft, color: th.accent, padding: '2px 8px', borderRadius: 6, fontSize: 10.5 }}>{k}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {pages.length > 0 && (
                      <select
                        style={{ ...th.input, fontSize: 11.5, padding: '4px 8px', width: 'auto', minWidth: 130 }}
                        defaultValue=""
                        onChange={e => { if (e.target.value) { pushGlobalToPage(Number(e.target.value), q.key); e.target.value = ''; } }}
                      >
                        <option value="" disabled>⬇️ Push to page…</option>
                        {pages.map((pg: any) => (
                          <option key={pg.id} value={pg.id}>{pg.pageName || pg.name || `Page #${pg.id}`}</option>
                        ))}
                      </select>
                    )}
                    <button style={th.btnSmGhost} onClick={() => { setEditIdx(i); setDeleteConfirm(null); }}>✏️ Edit</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {questions.length === 0 && !adding && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: th.muted, fontSize: 13 }}>
            কোনো question নেই। "+ New Question" দিয়ে যোগ করুন।
          </div>
        )}

        <button style={{ ...th.btnPrimary, marginTop: 16 }}
          onClick={() => saveGlobalQuestions(questions)} disabled={saving}>
          {saving ? <><Spinner size={13}/> Saving…</> : `💾 Save All (${questions.length} questions)`}
        </button>
      </div>
    );
  };

  // ── GLOBAL REPLIES ────────────────────────────────────────────────────────
  const GlobalRepliesTab = () => (
    <div style={th.card}>
      <CardHeader th={th} title="💬 Global System Replies"
        sub="সব page এর জন্য default replies — client override না করলে এগুলোই ব্যবহার হবে" />

      {/* Variables reference */}
      <div style={{ ...th.card2, marginBottom: 18, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: th.muted, marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Available Variables <InfoButton text="Reply template এ এই variables লিখলে bot automatically সঠিক value বসিয়ে দেবে।" th={th} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['{{productCode}}','{{productPrice}}','{{productStock}}','{{insideFee}}','{{outsideFee}}','{{businessName}}','{{deliveryTime}}'].map(v => (
            <code key={v} style={{ background: th.accentSoft, color: th.accent, padding: '2px 8px', borderRadius: 5, fontSize: 11 }}>{v}</code>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {REPLY_KEYS.map(k => (
          <div key={k}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <code style={{ background: th.accentSoft, color: th.accent, padding: '2px 8px', borderRadius: 5, fontSize: 11.5, fontWeight: 700 }}>{k}</code>
              <InfoButton text={REPLY_KEY_HELP[k] || ''} th={th} />
            </div>
            <textarea
              style={{ ...th.input, height: 68, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              value={editReplies[k] || ''}
              onChange={e => setEditReplies(r => ({ ...r, [k]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <button style={{ ...th.btnPrimary, marginTop: 18 }}
        onClick={saveGlobalReplies} disabled={saving}>
        {saving ? <><Spinner size={13}/> Saving…</> : '💾 Save Global Replies'}
      </button>
    </div>
  );

  // ── LEARNING LOG ──────────────────────────────────────────────────────────
  const LearningLogTab = () => (
    <div style={th.card}>
      <CardHeader th={th} title="🧠 Learning Log"
        sub="Bot যা বোঝেনি — এখান থেকে শিখিয়ে দিন"
        action={<button style={th.btnGhost} onClick={loadLog}>{loading ? <Spinner size={13}/> : '🔄'}</button>}
      />

      <div style={{ ...th.card2, ...th.alert, ...th.alertInfo, marginBottom: 16, fontSize: 12.5 }}>
        💡 এখানে দেখানো messages গুলো bot বুঝতে পারেনি। <b>"→ Global"</b> চাপলে সব page এর জন্য question তৈরি হবে।
        <b> "→ Client"</b> চাপলে শুধু ওই page এর জন্য।
      </div>

      {loading
        ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={20}/></div>
        : learningLog.length === 0
        ? <EmptyState icon="🎉" title="কোনো unmatched message নেই" sub="Bot সব question বুঝতে পারছে!" />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {learningLog.map(l => (
              <div key={l.id} style={{ ...th.card2, borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>"{l.message}"</div>
                    <div style={{ fontSize: 11.5, color: th.muted, marginBottom: 6 }}>
                      Page ID: {l.pageId} · {new Date(l.createdAt).toLocaleString()} · Best guess: <b>{l.bestGuess?.label || 'None'}</b>
                    </div>
                    {l.suggestedKeywords?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {l.suggestedKeywords.map((k: string) => (
                          <span key={k} style={{ background: th.accentSoft, color: th.accent, fontSize: 10.5, padding: '2px 8px', borderRadius: 6 }}>{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                    <button style={th.btnSmAccent} onClick={() => createFromLog(l, 'global')} disabled={saving}>
                      🌐 → Global
                    </button>
                    {l.pageId && (
                      <button style={th.btnSmGhost} onClick={() => createFromLog(l, 'client', l.pageId)} disabled={saving}>
                        👤 → Client
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );

  return (
    <div style={{ ...th.app, minHeight: '100vh' }}>
      <header style={{ ...th.topbar, background: `linear-gradient(135deg, #1e1b4b, #312e81)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={handleSecretClick} style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#ef4444,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', userSelect: 'none' }}>🛡️</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: '-0.3px', color: '#fff' }}>FlamboyAI Admin</div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em' }}>SYSTEM CONTROL PANEL</div>
          </div>
        </div>
        <button onClick={onLogout} style={{ ...th.btnGhost, fontSize: 12.5 }}>Logout</button>
      </header>

      <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <TabBar />
        {tab === 'overview'          && <OverviewTab />}
        {tab === 'users'             && <UsersTab />}
        {tab === 'clients'           && <ClientsTab />}
        {tab === 'global-questions'  && (globalCfg ? <GlobalQuestionsTab /> : <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22}/></div>)}
        {tab === 'global-replies'    && (globalCfg ? <GlobalRepliesTab /> : <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22}/></div>)}
        {tab === 'learning-log'      && <LearningLogTab />}
        {tab === 'courier-tutorials' && <CourierTutorialsTab th={th} tutorials={tutorials} setTutorials={setTutorials} saveTutorials={saveTutorials} saving={saving} />}
        {tab === 'call-servers' && (
          globalCfgCall
            ? <CallServersTab th={th} cfg={globalCfgCall} setCfg={setGlobalCfgCall} onSave={saveGlobalCfgCall} saving={callCfgSaving} />
            : <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22}/></div>
        )}
        {tab === 'billing' && (
          <>
            <AdminPaymentSetup
              th={th}
              cfg={adminPayCfg}
              setCfg={setAdminPayCfg}
              activeTab={adminPayTab}
              setActiveTab={setAdminPayTab}
              smsLog={adminSmsLog}
              adminSmsDevices={adminSmsDevices}
              saving={adminPaySaving}
              onSave={saveAdminPayConfig}
            />
            <BillingTab
              th={th}
              data={billingData}
              supportConfig={billingSupport}
              loading={billingLoading}
              subFilter={billingSubFilter}
              setSubFilter={setBillingSubFilter}
              onRefresh={loadBilling}
              onConfirmPayment={confirmPayment}
              onSetSubscription={setSubscription}
              onSaveSupport={saveBillingSupport}
            />
          </>
        )}

        {tab === 'wallet' && (
          <AdminWalletTab
            th={th}
            loading={walletLoading}
            pages={walletPages}
            requests={walletRequests}
            reqFilter={walletReqFilter}
            setReqFilter={setWalletReqFilter}
            directForm={walletDirectForm}
            setDirectForm={setWalletDirectForm}
            directSaving={walletDirectSaving}
            adjustForm={walletAdjustForm}
            setAdjustForm={setWalletAdjustForm}
            adjustSaving={walletAdjustSaving}
            onRefresh={loadWallet}
            onApprove={approveRequest}
            onReject={rejectRequest}
            onDirectRecharge={directRecharge}
            onAdjust={adjustWallet}
          />
        )}
        {tab === 'pricing' && (
          <AdminPricingTab
            th={th}
            form={pricingForm}
            setForm={setPricingForm}
            saving={pricingSaving}
            onSaveDefault={saveDefaultPricing}
            onApplyAll={applyPricingToAll}
            globalPricingInfo={globalPricingInfo}
            setGlobalPricingInfo={setGlobalPricingInfo}
            pricingInfoSaving={pricingInfoSaving}
            onSavePricingInfo={saveGlobalPricingInfo}
            packages={creditPackages}
            packagesLoading={packagesLoading}
            newPackageForm={newPackageForm}
            setNewPackageForm={setNewPackageForm}
            onCreatePackage={createCreditPackage}
            onTogglePackage={toggleCreditPackage}
            onDeletePackage={deleteCreditPackage}
          />
        )}
        {tab === 'subscriptions' && (
          <AdminSubscriptionsTab
            th={th}
            loading={subLoading}
            pages={subPages}
            onRefresh={loadSubscriptions}
            BASE={BASE}
            request={request}
            onToast={onToast}
            onReload={loadSubscriptions}
          />
        )}
        {tab === 'agents' && (
          <AdminAgentsTab
            th={th}
            loading={agentsLoading}
            agents={agents}
            newAgentForm={newAgentForm}
            setNewAgentForm={setNewAgentForm}
            onCreate={createAgent}
            onUpdateRates={updateAgentRates}
            onToggleActive={toggleAgentActive}
            onPayout={recordAgentPayout}
          />
        )}
        {tab === 'my-clients' && (
          <AgentClientsTab th={th} loading={myClientsLoading} clients={myClients} />
        )}
        {tab === 'earnings' && (
          <AgentEarningsTab th={th} loading={earningsLoading} profile={myProfile} earnings={myEarnings} payouts={myPayouts} />
        )}
        {tab === 'page-requests' && (
          <PageRequestsTab
            th={th}
            requests={pageRequests}
            filter={pageReqFilter}
            busy={pageReqBusy}
            moderatorAccess={moderatorAccess}
            moderatorAccessSaving={moderatorAccessSaving}
            onSaveModeratorAccess={saveModeratorAccess}
            onFilterChange={(f) => { setPageReqFilter(f); loadPageRequests(f); }}
            onApprove={handlePageReqApprove}
            onReject={(id) => {
              const note = window.prompt('কেন reject করছেন? (optional):') ?? '';
              handlePageReqReject(id, note);
            }}
          />
        )}
        {tab === 'wa-requests' && <WaRequestsTab th={th} request={request} BASE={BASE} onToast={onToast} />}
        {tab === 'customers' && (
          <AdminCustomersTab
            th={th}
            data={customers}
            loading={customersLoading}
            search={customerSearch}
            offset={customerOffset}
            limit={CUSTOMER_LIMIT}
            onSearch={(s) => { setCustomerSearch(s); setCustomerOffset(0); loadCustomers(s, 0); }}
            onPage={(o) => { setCustomerOffset(o); loadCustomers(customerSearch, o); }}
            BASE={BASE}
          />
        )}

        {tab === 'domain-setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Setup Form */}
            <div style={{ ...th.card }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>🌐 Custom Domain Setup</div>
              <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 18 }}>
                Customer-এর page select করুন, তাদের domain লিখুন — Nginx config + SSL সব automatic হবে।
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Page selector */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: th.muted, marginBottom: 6 }}>১. Customer Page Select করুন</div>
                  <select
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${th.border}`, background: th.surface, color: th.text, fontSize: 13 }}
                    value={domainSelectedPage?.id || ''}
                    onChange={e => {
                      const p = domainPages.find(x => String(x.id) === e.target.value);
                      setDomainSelectedPage(p || null);
                      setDomainInput(p?.customDomain || '');
                      setDomainResult(null);
                    }}
                  >
                    <option value="">-- Page select করুন --</option>
                    {domainPages.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.pageName || p.pageId} {p.owner?.username ? `(${p.owner.username})` : ''} {p.customDomain ? `— 🌐 ${p.customDomain}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Domain input */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: th.muted, marginBottom: 6 }}>২. Customer-এর Domain লিখুন</div>
                  <input
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${th.border}`, background: th.surface, color: th.text, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }}
                    placeholder="shop.rahim-fashion.com"
                    value={domainInput}
                    onChange={e => setDomainInput(e.target.value.toLowerCase().replace(/\s/g, ''))}
                  />
                  {domainInput && (
                    <div style={{ fontSize: 11.5, color: th.muted, marginTop: 6 }}>
                      DNS CNAME: <span style={{ fontFamily: 'monospace', color: th.accent }}>{domainInput} → api.flamboyai.com</span>
                    </div>
                  )}
                </div>

                {/* SSL option */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    id="skip-ssl"
                    checked={domainSkipSsl}
                    onChange={e => setDomainSkipSsl(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="skip-ssl" style={{ fontSize: 13, cursor: 'pointer' }}>
                    SSL skip করুন (Cloudflare proxy ব্যবহার করলে এটা tick করুন)
                  </label>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: 10, background: `${th.accent}0d`, border: `1px dashed ${th.accent}33`, fontSize: 12, color: th.muted, lineHeight: 1.7 }}>
                  <strong>⚠️ Setup করার আগে নিশ্চিত করুন:</strong><br/>
                  ১. Customer DNS-এ CNAME set করেছে এবং propagate হয়েছে (<code>nslookup {domainInput || 'domain'}</code>)<br/>
                  ২. VPS-এ এই script root privilege-এ চলছে (certbot এবং nginx reload দরকার)
                </div>

                <button
                  style={{ ...th.btnPrimary, padding: '12px 24px', fontSize: 14, fontWeight: 800, opacity: domainBusy ? 0.7 : 1 }}
                  onClick={handleSetupDomain}
                  disabled={domainBusy}
                >
                  {domainBusy ? '⏳ Setup হচ্ছে...' : '🚀 Setup Domain'}
                </button>
              </div>

              {/* Result log */}
              {domainResult && (
                <div style={{ marginTop: 20, borderTop: `1px solid ${th.border}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: domainResult.success ? '#16a34a' : '#dc2626' }}>
                    {domainResult.success ? '✅ Setup সফল!' : '⚠️ Setup partially হয়েছে'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(domainResult.steps || []).map((s: any, i: number) => (
                      <div key={i} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '8px 12px', borderRadius: 8,
                        background: s.status === 'ok' ? '#dcfce7' : s.status === 'skip' ? `${th.accent}0d` : '#fee2e2',
                      }}>
                        <span style={{ fontSize: 15, flexShrink: 0 }}>
                          {s.status === 'ok' ? '✅' : s.status === 'skip' ? '⏭️' : '❌'}
                        </span>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: s.status === 'ok' ? '#16a34a' : s.status === 'skip' ? th.muted : '#dc2626' }}>{s.step}</div>
                          {s.detail && <div style={{ fontSize: 11, color: '#666', marginTop: 2, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{s.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {domainResult.success && (
                    <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: '#dcfce7', fontSize: 13, fontWeight: 700, color: '#16a34a' }}>
                      🎉 এখন browser-এ https://{domainResult.domain} open করে দেখুন!
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Active Domains List */}
            <div style={{ ...th.card }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>
                📋 Active Custom Domains ({domainList.length})
                <button style={{ ...th.btnGhost, fontSize: 11, padding: '3px 10px', marginLeft: 10 }} onClick={loadDomainTab}>🔄</button>
              </div>
              {domainList.length === 0 ? (
                <div style={{ color: th.muted, fontSize: 13 }}>এখনো কোনো custom domain নেই।</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {domainList.map((d: any) => (
                    <div key={d.id} style={{ ...th.card2, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: th.accent }}>{d.customDomain}</div>
                        <div style={{ fontSize: 11.5, color: th.muted, marginTop: 2 }}>
                          {d.businessName || d.pageName} {d.owner?.username ? `· ${d.owner.username}` : ''}
                          {d.catalogSlug ? ` · slug: ${d.catalogSlug}` : ''}
                        </div>
                      </div>
                      <a
                        href={`https://${d.customDomain}`}
                        target="_blank" rel="noreferrer"
                        style={{ ...th.btnGhost, fontSize: 11, padding: '5px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        🔗 Open
                      </a>
                      <button
                        style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, border: '1.5px solid #fca5a5', background: '#fee2e2', color: '#dc2626', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={() => handleRemoveDomain(d.id, d.customDomain)}
                        disabled={domainRemoveBusy === d.id}
                      >
                        {domainRemoveBusy === d.id ? '...' : '🗑 Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {tab === 'api-keys' && (
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* ── Gemini Multi-Key Manager ── */}
            <div style={{ ...th.card, borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>✨ Gemini API Keys (Rotation Pool)</div>
              <div style={{ fontSize: 12, color: th.muted, marginBottom: 16 }}>
                একাধিক free Gemini API key add করুন। একটা quota শেষ হলে automatically পরেরটায় চলে যাবে। Quota reset হলে (1 ঘণ্টা পর) আবার ব্যবহার হবে।
              </div>

              {/* Premium Gemini Key Health Board */}
              {geminiStatus && geminiStatus.keys && geminiStatus.keys.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${th.border}`, paddingBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: th.text }}>📡 Rotation Pool Health</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: th.muted }}>
                      <span style={{ color: geminiStatus.available > 0 ? '#34d399' : '#f87171', fontWeight: 800 }}>
                        {geminiStatus.available}
                      </span>
                      /{geminiStatus.total} active keys
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                    {geminiStatus.keys.map((k, i) => {
                      // Status styling
                      let statusBg = 'rgba(255,255,255,0.04)';
                      let statusBorder = 'rgba(255,255,255,0.08)';
                      let statusColor = th.muted;
                      let statusLabel = 'Unknown';
                      let statusIcon = '⚪';

                      if (k.status === 'active') {
                        statusBg = 'rgba(16,185,129,0.08)';
                        statusBorder = 'rgba(16,185,129,0.18)';
                        statusColor = '#10b981';
                        statusLabel = 'Active';
                        statusIcon = '🟢';
                      } else if (k.status === 'cooldown') {
                        statusBg = 'rgba(245,158,11,0.08)';
                        statusBorder = 'rgba(245,158,11,0.18)';
                        statusColor = '#f59e0b';
                        const minLeft = k.exhaustedUntil ? Math.ceil((k.exhaustedUntil - Date.now()) / 60000) : 0;
                        statusLabel = minLeft > 0 ? `Cooldown (${minLeft}m)` : 'Cooldown';
                        statusIcon = '⏳';
                      } else if (k.status === 'disabled') {
                        statusBg = 'rgba(239,68,68,0.08)';
                        statusBorder = 'rgba(239,68,68,0.18)';
                        statusColor = '#ef4444';
                        statusLabel = 'Disabled';
                        statusIcon = '❌';
                      }

                      // Health score coloring
                      let healthColor = '#10b981';
                      if (k.healthScore < 50) healthColor = '#ef4444';
                      else if (k.healthScore < 80) healthColor = '#f59e0b';

                      return (
                        <div
                          key={i}
                          style={{
                            background: th.elevated,
                            border: `1px solid ${statusBorder}`,
                            borderRadius: 12,
                            padding: '14px 16px',
                            boxShadow: th.shadow,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                            position: 'relative',
                            transition: 'all 0.2s ease-in-out',
                            cursor: 'default',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = th.shadowMd;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = th.shadow;
                          }}
                        >
                          {/* Top Row: Index, Masked Key & Badge */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: th.muted }}>KEY #{i + 1}</span>
                              <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: 'monospace', color: th.text }}>{k.masked}</span>
                            </div>
                            <span style={{
                              fontSize: 10.5,
                              fontWeight: 800,
                              padding: '3px 8px',
                              borderRadius: 20,
                              background: statusBg,
                              border: `1px solid ${statusBorder}`,
                              color: statusColor,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}>
                              <span>{statusIcon}</span>
                              <span>{statusLabel}</span>
                            </span>
                          </div>

                          {/* Stats Grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '8px 0', borderTop: `1px dashed ${th.border}`, borderBottom: `1px dashed ${th.border}` }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: th.muted, textTransform: 'uppercase' }}>Reqs</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: th.text }}>
                                <span style={{ color: '#10b981' }}>{k.successCount}</span>
                                <span style={{ color: th.muted, margin: '0 2px' }}>/</span>
                                <span style={{ color: k.failureCount > 0 ? '#ef4444' : th.muted }}>{k.failureCount}</span>
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: th.muted, textTransform: 'uppercase' }}>Health</span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: healthColor }}>{k.healthScore}%</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: th.muted, textTransform: 'uppercase' }}>Latency</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: th.text }}>{k.avgLatencyMs ? `${k.avgLatencyMs}ms` : '—'}</span>
                            </div>
                          </div>

                          {/* Error message if present */}
                          {k.errorMessage && (
                            <div style={{
                              fontSize: 10.5,
                              color: '#ef4444',
                              background: 'rgba(239,68,68,0.05)',
                              border: '1px solid rgba(239,68,68,0.15)',
                              padding: '6px 8px',
                              borderRadius: 6,
                              wordBreak: 'break-word',
                              maxHeight: 48,
                              overflowY: 'auto'
                            }}>
                              ⚠️ {k.errorMessage}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Key list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {geminiKeys.map((k, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: th.muted, width: 24, textAlign: 'right', flexShrink: 0 }}>#{i + 1}</div>
                    <input
                      type={k.startsWith('***SAVED:') ? 'text' : 'password'}
                      value={k.startsWith('***SAVED:') ? `••••••••  (${geminiStatus?.keys?.[parseInt(k.slice(9, -3))]?.masked ?? 'saved'})` : k}
                      readOnly={k.startsWith('***SAVED:')}
                      onChange={e => { if (!k.startsWith('***SAVED:')) { const arr = [...geminiKeys]; arr[i] = e.target.value; setGeminiKeys(arr); } }}
                      onFocus={e => { if (k.startsWith('***SAVED:')) { const arr = [...geminiKeys]; arr[i] = ''; setGeminiKeys(arr); e.currentTarget.readOnly = false; } }}
                      placeholder="AIza..."
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${th.border}`, backgroundColor: k.startsWith('***SAVED:') ? 'rgba(52,211,153,.07)' : 'rgba(255,255,255,.05)', color: k.startsWith('***SAVED:') ? '#34d399' : th.text, fontSize: 13, fontFamily: 'monospace' }}
                    />
                    <button
                      onClick={() => setGeminiKeys(geminiKeys.filter((_, j) => j !== i))}
                      disabled={geminiKeys.length === 1}
                      style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,.15)', color: '#f87171', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                    >✕</button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setGeminiKeys([...geminiKeys, ''])}
                style={{ fontSize: 12, padding: '7px 16px', borderRadius: 8, border: `1px dashed ${th.border}`, background: 'transparent', color: th.muted, cursor: 'pointer', width: '100%' }}
              >+ আরেকটি Key যোগ করুন</button>
            </div>

            <div style={{ ...th.card, borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>🔑 API Keys Manager</div>
              <div style={{ fontSize: 13, color: th.muted, marginBottom: 20 }}>এখানে সংরক্ষিত values .env ফাইলের চেয়ে priority পাবে। কোনো field খালি রাখলে .env এর value ব্যবহার হবে।</div>

              {(
                [
                  { group: '🤖 AI / Gemini', fields: [
                    { key: 'aiIntentProvider', label: 'AI Intent Provider', placeholder: 'gemini / openai' },
                    { key: 'aiIntentModel', label: 'AI Intent Model', placeholder: 'gemini-2.0-flash' },
                  ]},
                  { group: '🧠 OpenAI', fields: [
                    { key: 'openaiApiKey', label: 'OpenAI API Key', secret: true },
                    { key: 'openaiModel', label: 'OpenAI Chat Model', placeholder: 'gpt-4o' },
                    { key: 'openaiVisionModel', label: 'OpenAI Vision Model', placeholder: 'gpt-4o' },
                    { key: 'fallbackAiProvider', label: 'Fallback AI Provider', placeholder: 'openai / gemini' },
                    { key: 'fallbackAiModel', label: 'Fallback AI Model', placeholder: 'gpt-4o-mini' },
                  ]},
                  { group: '🔀 OpenRouter', fields: [
                    { key: 'openrouterApiKey', label: 'OpenRouter API Key', secret: true },
                    { key: 'openrouterModel', label: 'OpenRouter Model', placeholder: 'openai/gpt-4o-mini' },
                  ]},
                ] as { group: string; fields: { key: string; label: string; placeholder?: string; secret?: boolean }[] }[]
              ).filter(g => g.group !== '👁 Vision').map(({ group, fields }) => (
                <div key={group} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: th.accent, marginBottom: 10, borderBottom: `1px solid ${th.border}`, paddingBottom: 6 }}>{group}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                    {fields.map(({ key, label, placeholder, secret }) => (
                      <div key={key}>
                        <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>{label}</div>
                        <input
                          type={secret && apiKeysDraft[key] === '***SAVED***' ? 'password' : 'text'}
                          value={apiKeysDraft[key] ?? ''}
                          placeholder={placeholder || (secret ? '••••••• (সংরক্ষিত)' : '')}
                          onChange={e => setApiKeysDraft(d => ({ ...d, [key]: e.target.value }))}
                          onFocus={e => { if (secret && e.target.value === '***SAVED***') setApiKeysDraft(d => ({ ...d, [key]: '' })); }}
                          style={{ ...th.input, width: '100%', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* ── AI Provider Priority — which one gets tried first for bot replies ── */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: th.accent, marginBottom: 4, borderBottom: `1px solid ${th.border}`, paddingBottom: 6 }}>🎯 AI Provider Priority</div>
                <div style={{ fontSize: 12, color: th.muted, marginBottom: 10 }}>Bot reply-এর জন্য কোন API আগে try হবে — প্রথমটা fail/unavailable হলে পরেরটায় যাবে।</div>
                {(() => {
                  const PROVIDER_OPTIONS = [
                    { value: 'gemini', label: '✨ Gemini' },
                    { value: 'openai', label: '🧠 OpenAI' },
                    { value: 'openrouter', label: '🔀 OpenRouter' },
                  ];
                  const DEFAULT_PRIORITY = ['gemini', 'openai', 'openrouter'];
                  const currentPriority: string[] = (() => {
                    try {
                      const parsed = JSON.parse(apiKeysDraft.aiProviderPriority || '[]');
                      if (Array.isArray(parsed) && parsed.length === 3) return parsed;
                    } catch {}
                    return DEFAULT_PRIORITY;
                  })();
                  const setPriorityAt = (idx: number, value: string) => {
                    const next = [...currentPriority];
                    const otherIdx = next.indexOf(value);
                    if (otherIdx !== -1 && otherIdx !== idx) next[otherIdx] = next[idx];
                    next[idx] = value;
                    setApiKeysDraft(d => ({ ...d, aiProviderPriority: JSON.stringify(next) }));
                  };
                  const ORDINAL = ['১ম চেষ্টা', '২য় চেষ্টা', '৩য় চেষ্টা'];
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                      {[0, 1, 2].map(idx => (
                        <div key={idx}>
                          <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>{ORDINAL[idx]}</div>
                          <select
                            value={currentPriority[idx]}
                            onChange={e => setPriorityAt(idx, e.target.value)}
                            style={{ ...th.input, width: '100%', fontSize: 13, boxSizing: 'border-box', cursor: 'pointer' }}
                          >
                            {PROVIDER_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ── Vision Smart Config ── */}
              {(() => {
                const VISION_PROVIDERS = [
                  { value: 'gemini', label: '✨ Gemini only', desc: 'শুধু Gemini ব্যবহার হবে' },
                  { value: 'gemini-with-fallback', label: '✨ Gemini → 🧠 OpenAI fallback', desc: 'Gemini fail হলে OpenAI তে যাবে' },
                  { value: 'openai', label: '🧠 OpenAI only', desc: 'শুধু OpenAI ব্যবহার হবে' },
                  { value: 'mock', label: '🧪 Mock (Test)', desc: 'API call হবে না — testing এর জন্য' },
                ];
                const GEMINI_MODELS = [
                  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash', desc: '⚡ Latest — Fast & Accurate (Recommended)' },
                  { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite', desc: '💸 Cheapest — Good for simple images' },
                  { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash', desc: '🔄 Previous default — Stable' },
                  { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash', desc: '📦 Older generation' },
                  { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro', desc: '🏆 Most accurate — Higher cost' },
                ];
                const OPENAI_MODELS = [
                  { value: 'gpt-4o', label: 'gpt-4o', desc: '🏆 Best accuracy' },
                  { value: 'gpt-4o-mini', label: 'gpt-4o-mini', desc: '💸 Cheaper option' },
                ];

                const currentProvider = apiKeysDraft['visionProvider'] || 'gemini';
                const currentModel = apiKeysDraft['visionModel'] || '';
                const isGemini = currentProvider === 'gemini' || currentProvider === 'gemini-with-fallback';
                const models = isGemini ? GEMINI_MODELS : currentProvider === 'openai' ? OPENAI_MODELS : [];

                const selectStyle: React.CSSProperties = {
                  ...th.input as any,
                  width: '100%',
                  fontSize: 13,
                  boxSizing: 'border-box' as const,
                  cursor: 'pointer',
                  appearance: 'auto' as any,
                };

                return (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: th.accent, marginBottom: 10, borderBottom: `1px solid ${th.border}`, paddingBottom: 6 }}>👁 Vision (Image Analysis)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>

                      {/* Provider Dropdown */}
                      <div>
                        <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>Vision Provider</div>
                        <select
                          value={currentProvider}
                          onChange={e => {
                            const p = e.target.value;
                            setApiKeysDraft(d => ({
                              ...d,
                              visionProvider: p,
                              visionModel: p === 'openai' ? 'gpt-4o' : p === 'mock' ? '' : 'gemini-2.5-flash',
                            }));
                          }}
                          style={selectStyle}
                        >
                          {VISION_PROVIDERS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                          {VISION_PROVIDERS.find(p => p.value === currentProvider)?.desc}
                        </div>
                      </div>

                      {/* Model Dropdown */}
                      {models.length > 0 && (
                        <div>
                          <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>
                            Vision Model {isGemini ? '(Gemini)' : '(OpenAI)'}
                          </div>
                          <select
                            value={currentModel || models[0].value}
                            onChange={e => setApiKeysDraft(d => ({ ...d, visionModel: e.target.value }))}
                            style={selectStyle}
                          >
                            {models.map(m => (
                              <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
                            ))}
                          </select>
                          <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>
                            {models.find(m => m.value === (currentModel || models[0].value))?.desc}
                          </div>
                        </div>
                      )}

                      {/* Confidence Threshold */}
                      <div>
                        <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>Vision Confidence Threshold</div>
                        <input
                          type="number"
                          min="0" max="1" step="0.05"
                          value={apiKeysDraft['visionConfidenceThreshold'] ?? ''}
                          placeholder="0.15"
                          onChange={e => setApiKeysDraft(d => ({ ...d, visionConfidenceThreshold: e.target.value }))}
                          style={{ ...th.input, width: '100%', fontSize: 13, boxSizing: 'border-box' }}
                        />
                        <div style={{ fontSize: 11, color: th.muted, marginTop: 4 }}>0.0 – 1.0 | কম হলে বেশি image accept হবে (default: 0.15)</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {([
                  { group: '🦙 Ollama (Local)', fields: [
                    { key: 'ollamaBaseUrl', label: 'Ollama Base URL', placeholder: 'http://localhost:11434' },
                    { key: 'ollamaChatModel', label: 'Ollama Chat Model', placeholder: 'qwen2.5:0.5b' },
                    { key: 'ollamaVisionModel', label: 'Ollama Vision Model', placeholder: 'llava:7b' },
                  ]},
                  { group: '📱 Telegram Notifications', fields: [
                    { key: 'telegramBotToken', label: 'Telegram Bot Token', secret: true, placeholder: '1234567890:AAG...' },
                    { key: 'telegramChatId', label: 'Admin Chat ID', placeholder: '8183240678' },
                  ]},
                  { group: '📧 Resend (OTP/Email)', fields: [
                    { key: 'resendApiKey', label: 'Resend API Key', secret: true, placeholder: 're_...' },
                    { key: 'resendFromEmail', label: 'From Address', placeholder: 'FlamboyAI <noreply@flamboyai.com>' },
                  ]},
                  { group: '📧 Gmail (legacy, unused)', fields: [
                    { key: 'gmailUser', label: 'Gmail Address' },
                    { key: 'gmailAppPassword', label: 'Gmail App Password', secret: true },
                  ]},
                  { group: '📱 Facebook OAuth (Global App)', fields: [
                    { key: 'fbAppId', label: 'FB App ID' },
                    { key: 'fbAppSecret', label: 'FB App Secret', secret: true },
                    { key: 'fbRedirectUri', label: 'FB Redirect URI', placeholder: 'https://api.flamboyai.com/facebook/callback' },
                    { key: 'fbOauthStateSecret', label: 'FB OAuth State Secret', secret: true },
                  ]},
                  { group: '🖼 Image Generation', fields: [
                    { key: 'falApiKey', label: 'Fal.ai API Key 1', secret: true },
                    { key: 'falApiKey2', label: 'Fal.ai API Key 2', secret: true },
                    { key: 'falApiKey3', label: 'Fal.ai API Key 3', secret: true },
                    { key: 'ideogramApiKey', label: 'Ideogram API Key', secret: true },
                  ]},
                  { group: '🔊 TTS / Voice', fields: [
                    { key: 'elevenlabsApiKey', label: 'ElevenLabs API Key', secret: true },
                    { key: 'googleTtsKeyFile', label: 'Google TTS Key File Path', placeholder: '/path/to/key.json' },
                  ]},
                  { group: '📞 Call Integrations', fields: [
                    { key: 'twilioAccountSid', label: 'Twilio Account SID' },
                    { key: 'twilioAuthToken', label: 'Twilio Auth Token', secret: true },
                    { key: 'twilioFromNumber', label: 'Twilio From Number', placeholder: '+1234567890' },
                    { key: 'twilioTwimlBase', label: 'Twilio TwiML Base URL' },
                    { key: 'sslWirelessApiKey', label: 'SSL Wireless API Key', secret: true },
                    { key: 'sslWirelessApiUrl', label: 'SSL Wireless API URL' },
                    { key: 'sslWirelessCallerId', label: 'SSL Wireless Caller ID' },
                    { key: 'bdCallingApiKey', label: 'BDCalling API Key', secret: true },
                    { key: 'bdCallingApiUrl', label: 'BDCalling API URL' },
                    { key: 'bdCallingCallerId', label: 'BDCalling Caller ID' },
                  ]},
                  { group: '🌐 URLs', fields: [
                    { key: 'landingPageUrl', label: 'Landing Page URL', placeholder: 'https://flamboyai.com' },
                    { key: 'catalogBaseUrl', label: 'Catalog Base URL' },
                    { key: 'storagePublicUrl', label: 'Storage Public URL' },
                    { key: 'apiBaseUrl', label: 'API Base URL' },
                  ]},
                  { group: '💬 Misc', fields: [
                    { key: 'adminWhatsappNumber', label: 'Admin WhatsApp Number', placeholder: '01575897887' },
                  ]},
                ] as { group: string; fields: { key: string; label: string; placeholder?: string; secret?: boolean }[] }[]
              ).map(({ group, fields }) => (
                <div key={group} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: th.accent, marginBottom: 10, borderBottom: `1px solid ${th.border}`, paddingBottom: 6 }}>{group}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                    {fields.map(({ key, label, placeholder, secret }) => (
                      <div key={key}>
                        <div style={{ fontSize: 12, color: th.muted, marginBottom: 4 }}>{label}</div>
                        <input
                          type={secret && apiKeysDraft[key] === '***SAVED***' ? 'password' : 'text'}
                          value={apiKeysDraft[key] ?? ''}
                          placeholder={placeholder || (secret ? '••••••• (সংরক্ষিত)' : '')}
                          onChange={e => setApiKeysDraft(d => ({ ...d, [key]: e.target.value }))}
                          onFocus={e => { if (secret && e.target.value === '***SAVED***') setApiKeysDraft(d => ({ ...d, [key]: '' })); }}
                          style={{ ...th.input, width: '100%', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  style={{ ...th.btn, opacity: apiKeysSaving ? 0.6 : 1 }}
                  onClick={saveApiKeys}
                  disabled={apiKeysSaving}
                >
                  {apiKeysSaving ? 'Saving...' : '💾 Save All API Keys'}
                </button>
                <button style={th.btnGhost} onClick={() => { setApiKeysDraft(apiKeys); }}>↩ Reset</button>
                <button style={th.btnGhost} onClick={() => { setApiKeysLoaded(false); loadApiKeys(); }}>🔄 Reload</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div style={{ maxWidth: 960, margin: '0 auto' }}>
            {/* Filter bar */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
              <input
                type="month"
                value={reportMonth}
                onChange={e => setReportMonth(e.target.value)}
                style={{ ...th.input, fontSize: 13, width: 'auto' }}
              />
              <button style={th.btn} onClick={() => loadReport(reportMonth || undefined)} disabled={reportLoading}>
                {reportLoading ? 'Loading...' : '🔍 Load'}
              </button>
              {reportMonth && (
                <button style={th.btnGhost} onClick={() => { setReportMonth(''); loadReport(''); }}>✕ All Time</button>
              )}
              {reportData && (
                <span style={{ fontSize: 12, color: th.muted, marginLeft: 8 }}>at $1 = ৳{reportData.usdToBdt}</span>
              )}
            </div>

            {reportLoading && <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22}/></div>}

            {reportData && !reportLoading && (() => {
              const s = reportData.summary;
              const fmt = (n: number) => '৳' + n.toFixed(2);
              const fmtUsd = (n: number) => '$' + n.toFixed(4);

              const cardStyle: React.CSSProperties = {
                ...th.card,
                borderRadius: 14,
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                  {/* Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 14 }}>
                    <div style={cardStyle}>
                      <div style={{ fontSize: 11, color: th.muted }}>💰 মোট Revenue</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: '#16a34a' }}>{fmt(s.totalRevenueBdt)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: 11, color: th.muted }}>📤 Client কে Charge</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: th.accent }}>{fmt(s.totalBilledBdt)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: 11, color: th.muted }}>🔧 আমার API Cost</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b' }}>{fmt(s.totalApiCostBdt)}</div>
                      <div style={{ fontSize: 11, color: th.muted }}>{fmtUsd(s.totalApiCostUsd)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: 11, color: th.muted }}>📈 Net Profit</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: s.netProfitBdt >= 0 ? '#16a34a' : '#ef4444' }}>{fmt(s.netProfitBdt)}</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={{ fontSize: 11, color: th.muted }}>💹 Profit Margin</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: th.accent }}>{s.profitMarginPct.toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Per-Page Revenue Table */}
                  <div style={{ ...th.card, borderRadius: 14, padding: 20 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>👤 Per-Page Revenue</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ borderBottom: `2px solid ${th.border}` }}>
                            {['Page', 'Owner', 'Recharged', 'Billed', 'API Cost', 'Profit', 'Balance', 'Status', 'Next Billing'].map(h => (
                              <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: th.muted, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.perPage.map((p: any) => (
                            <tr key={p.pageId} style={{ borderBottom: `1px solid ${th.border}` }}>
                              <td style={{ padding: '7px 10px', fontWeight: 600, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.pageName}</td>
                              <td style={{ padding: '7px 10px', color: th.muted }}>{p.ownerName}</td>
                              <td style={{ padding: '7px 10px', color: '#16a34a', fontWeight: 700 }}>{fmt(p.rechargedBdt)}</td>
                              <td style={{ padding: '7px 10px', color: th.accent }}>{fmt(p.billedBdt)}</td>
                              <td style={{ padding: '7px 10px', color: '#f59e0b' }}>{fmt(p.apiCostBdt)}</td>
                              <td style={{ padding: '7px 10px', color: p.netProfitBdt >= 0 ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{fmt(p.netProfitBdt)}</td>
                              <td style={{ padding: '7px 10px', color: p.currentBalanceCredit < 2000 ? '#ef4444' : th.text }}>{Math.round(p.currentBalanceCredit).toLocaleString()} cr</td>
                              <td style={{ padding: '7px 10px' }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: p.subscriptionStatus === 'ACTIVE' ? '#16a34a' : '#ef4444', background: p.subscriptionStatus === 'ACTIVE' ? '#dcfce7' : '#fee2e2', padding: '2px 7px', borderRadius: 6 }}>
                                  {p.subscriptionStatus}
                                </span>
                              </td>
                              <td style={{ padding: '7px 10px', color: th.muted, fontSize: 11 }}>
                                {p.nextBillingDate ? new Date(p.nextBillingDate).toLocaleDateString('bn-BD') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* API Usage Breakdown */}
                  <div style={{ ...th.card, borderRadius: 14, padding: 20 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>⚙️ API Usage Breakdown (কখন কোন API)</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ borderBottom: `2px solid ${th.border}` }}>
                            {['Type', 'Provider', 'Count', 'Billed (৳)', 'Real Cost (৳)', 'Real Cost ($)', 'Profit (৳)'].map(h => (
                              <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: th.muted, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.usageBreakdown.map((u: any) => (
                            <tr key={`${u.type}|${u.provider}`} style={{ borderBottom: `1px solid ${th.border}` }}>
                              <td style={{ padding: '7px 10px', fontWeight: 600 }}>{u.type}</td>
                              <td style={{ padding: '7px 10px' }}>
                                <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6,
                                  color: u.provider === 'gemini' ? '#7c3aed' : u.provider === 'openai' ? '#2563eb' : '#6b7280',
                                  background: u.provider === 'gemini' ? '#ede9fe' : u.provider === 'openai' ? '#dbeafe' : '#f3f4f6',
                                }}>
                                  {u.provider === 'gemini' ? '✨ Gemini' : u.provider === 'openai' ? '🧠 OpenAI' : '💻 Local'}
                                </span>
                              </td>
                              <td style={{ padding: '7px 10px', color: th.muted }}>{u.count.toLocaleString()}</td>
                              <td style={{ padding: '7px 10px', color: th.accent }}>{u.billedBdt.toFixed(2)}</td>
                              <td style={{ padding: '7px 10px', color: '#f59e0b' }}>{u.costBdt.toFixed(4)}</td>
                              <td style={{ padding: '7px 10px', color: th.muted, fontSize: 11 }}>{u.costUsd.toFixed(5)}</td>
                              <td style={{ padding: '7px 10px', color: u.profitBdt >= 0 ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{u.profitBdt.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Monthly Trend */}
                  {reportData.monthlyTrend.length > 0 && (
                    <div style={{ ...th.card, borderRadius: 14, padding: 20 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>📅 Monthly Trend</div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                          <thead>
                            <tr style={{ borderBottom: `2px solid ${th.border}` }}>
                              {['Month', 'Revenue (৳)', 'API Cost (৳)', 'Profit (৳)'].map(h => (
                                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: th.muted, fontWeight: 700 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.monthlyTrend.map((m: any) => (
                              <tr key={m.month} style={{ borderBottom: `1px solid ${th.border}` }}>
                                <td style={{ padding: '7px 10px', fontWeight: 700 }}>{m.month}</td>
                                <td style={{ padding: '7px 10px', color: '#16a34a', fontWeight: 700 }}>{fmt(m.revenueBdt)}</td>
                                <td style={{ padding: '7px 10px', color: '#f59e0b' }}>{fmt(m.apiCostBdt)}</td>
                                <td style={{ padding: '7px 10px', color: m.profitBdt >= 0 ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{fmt(m.profitBdt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                </div>
              );
            })()}

            {!reportData && !reportLoading && (
              <div style={{ textAlign: 'center', padding: 40, color: th.muted }}>📊 Load বাটন চাপুন report দেখতে</div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Page Requests Tab ─────────────────────────────────────────────────────────
function PageRequestsTab({ th, requests, filter, busy, moderatorAccess, moderatorAccessSaving, onSaveModeratorAccess, onFilterChange, onApprove, onReject }: {
  th: Theme;
  requests: any[];
  filter: 'all' | 'pending';
  busy: number | null;
  moderatorAccess: { fbProfileLink?: string; email?: string };
  moderatorAccessSaving: boolean;
  onSaveModeratorAccess: (payload: { fbProfileLink?: string; email?: string }) => void;
  onFilterChange: (f: 'all' | 'pending') => void;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  const statusColor = (s: string) => s === 'approved' ? '#16a34a' : s === 'rejected' ? '#ef4444' : '#f59e0b';
  const statusLabel = (s: string) => s === 'approved' ? '✅ Approved' : s === 'rejected' ? '❌ Rejected' : '⏳ Pending';
  const [modForm, setModForm] = useState(moderatorAccess || {});
  useEffect(() => { setModForm(moderatorAccess || {}); }, [moderatorAccess]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: th.text }}>📋 Page Access Requests</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['pending', 'all'] as const).map(f => (
            <button key={f} onClick={() => onFilterChange(f)} style={{
              padding: '6px 14px', borderRadius: 8, border: `1px solid ${filter === f ? th.accent : th.border}`,
              background: filter === f ? th.accent : 'transparent', color: filter === f ? '#fff' : th.muted,
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>{f === 'pending' ? '⏳ Pending' : '📋 All'}</button>
          ))}
        </div>
      </div>

      <div style={{ ...th.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: th.text }}>🛡️ Moderator Access Info</div>
        <div style={{ fontSize: 11.5, color: th.muted, lineHeight: 1.6 }}>
          Client-দের এই profile link ও Gmail দেখানো হবে — এগুলো দিয়ে তারা আপনাকে তাদের Page-এ moderator হিসেবে add করবে।
        </div>
        <div>
          <label style={{ fontSize: 11.5, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>Admin FB Profile Link</label>
          <input style={th.input} value={modForm.fbProfileLink || ''} onChange={e => setModForm(f => ({ ...f, fbProfileLink: e.target.value }))} placeholder="https://facebook.com/yourprofile" />
        </div>
        <div>
          <label style={{ fontSize: 11.5, color: th.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>Admin Gmail</label>
          <input style={th.input} value={modForm.email || ''} onChange={e => setModForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@gmail.com" />
        </div>
        <button style={th.btnPrimary} disabled={moderatorAccessSaving} onClick={() => onSaveModeratorAccess(modForm)}>
          {moderatorAccessSaving ? <Spinner size={12} /> : '💾 Save'}
        </button>
      </div>

      {requests.length === 0 ? (
        <div style={{ ...th.card, textAlign: 'center', padding: '32px', color: th.muted, fontSize: 13 }}>
          কোনো request নেই
        </div>
      ) : requests.map((r) => (
        <div key={r.id} style={{ ...th.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: statusColor(r.status), background: `${statusColor(r.status)}18`, padding: '2px 8px', borderRadius: 6 }}>
                  {statusLabel(r.status)}
                </span>
                <span style={{ fontSize: 11, color: th.muted }}>#{r.id} · {new Date(r.createdAt).toLocaleDateString('bn-BD')}</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: th.text, marginBottom: 4 }}>
                👤 {r.user?.name || r.user?.username} ({r.user?.email || r.user?.username})
              </div>
              <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 3 }}>
                📄 Page: <a href={r.pageUrl} target="_blank" rel="noreferrer" style={{ color: th.accent }}>{r.pageUrl}</a>
              </div>
              {r.fbProfile && (
                <div style={{ fontSize: 12.5, color: th.muted, marginBottom: r.note ? 3 : 0 }}>
                  🧑 FB Profile: <a href={r.fbProfile} target="_blank" rel="noreferrer" style={{ color: th.accent }}>{r.fbProfile}</a>
                </div>
              )}
              {r.note && (
                <div style={{ fontSize: 12, color: th.muted, marginTop: 4, fontStyle: 'italic' }}>💬 "{r.note}"</div>
              )}
              {r.adminNote && (
                <div style={{ fontSize: 12, color: statusColor(r.status), marginTop: 4, fontWeight: 600 }}>
                  Admin note: {r.adminNote}
                </div>
              )}
            </div>

            {r.status === 'pending' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                <button disabled={busy === r.id} onClick={() => onApprove(r.id)} style={{
                  padding: '8px 12px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff',
                  fontWeight: 800, fontSize: 12, cursor: busy === r.id ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                  {busy === r.id ? <Spinner size={12} /> : '🔗 Login with Facebook & Approve'}
                </button>
                <button disabled={busy === r.id} onClick={() => onReject(r.id)} style={{
                  padding: '8px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                  fontWeight: 800, fontSize: 12, cursor: busy === r.id ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                  ❌ Reject
                </button>
              </div>
            )}
          </div>

          {r.status === 'approved' && (
            <div style={{ background: 'rgba(34,197,94,0.07)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#15803d' }}>
              ✅ Approved — page connect হয়ে গেছে{r.connectedPageId ? ` (Page #${r.connectedPageId})` : ''}।
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── WhatsApp Connection Requests ──────────────────────────────────────────────
function WaRequestsTab({ th, request, BASE, onToast }: {
  th: Theme; request: <T = any>(url: string, opts?: any) => Promise<T>; BASE: string;
  onToast: (m: string, t?: any) => void;
}) {
  const [requests, setRequests] = useState<any[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [busy, setBusy] = useState<number | null>(null);
  const [forms, setForms] = useState<Record<number, { waPhoneNumberId: string; waToken: string; waVerifyToken: string }>>({});

  const load = useCallback(async (f?: 'pending' | 'all') => {
    const ff = f ?? filter;
    try {
      const data = await request<any[]>(`${BASE}/wa-connect-requests${ff === 'pending' ? '?status=pending' : ''}`);
      setRequests(data || []);
    } catch { /* silent */ }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string) => s === 'approved' ? '#16a34a' : s === 'rejected' ? '#ef4444' : '#f59e0b';
  const statusLabel = (s: string) => s === 'approved' ? '✅ Connected' : s === 'rejected' ? '❌ Rejected' : '⏳ Pending';

  const finalize = async (id: number) => {
    const f = forms[id];
    if (!f?.waPhoneNumberId?.trim() || !f?.waToken?.trim()) {
      onToast('Phone Number ID এবং Token দুটোই দিন', 'error');
      return;
    }
    setBusy(id);
    try {
      await request(`${BASE}/wa-connect-requests/${id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({
          waPhoneNumberId: f.waPhoneNumberId.trim(),
          waToken: f.waToken.trim(),
          waVerifyToken: f.waVerifyToken?.trim() || undefined,
        }),
      });
      onToast('✅ WhatsApp connect হয়ে গেছে!', 'success');
      await load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setBusy(null); }
  };

  const reject = async (id: number) => {
    const note = window.prompt('কেন reject করছেন? (optional):') ?? '';
    setBusy(id);
    try {
      await request(`${BASE}/wa-connect-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ adminNote: note || undefined }) });
      onToast('Rejected!', 'success');
      await load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: th.text }}>📲 WhatsApp Connection Requests</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['pending', 'all'] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); load(f); }} style={{
              padding: '6px 14px', borderRadius: 8, border: `1px solid ${filter === f ? th.accent : th.border}`,
              background: filter === f ? th.accent : 'transparent', color: filter === f ? '#fff' : th.muted,
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>{f === 'pending' ? '⏳ Pending' : '📋 All'}</button>
          ))}
        </div>
      </div>

      <div style={{ ...th.card, fontSize: 11.5, color: th.muted, lineHeight: 1.7 }}>
        💡 প্রতিটা request-এর জন্য নিজের (agency-র) Meta Business Manager-এ client-এর নম্বরটা নতুন WhatsApp Business Account হিসেবে register করুন (OTP client-কে দিয়ে verify করান), তারপর Phone Number ID ও একটা permanent System User token generate করে নিচে paste করুন। যেহেতু সব number-ই নিজের Business Portfolio-র ভেতরে থাকবে, App Review/Live mode লাগবে না।
      </div>

      {requests.length === 0 ? (
        <div style={{ ...th.card, textAlign: 'center', padding: '32px', color: th.muted, fontSize: 13 }}>
          কোনো request নেই
        </div>
      ) : requests.map((r) => (
        <div key={r.id} style={{ ...th.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: statusColor(r.status), background: `${statusColor(r.status)}18`, padding: '2px 8px', borderRadius: 6 }}>
                  {statusLabel(r.status)}
                </span>
                <span style={{ fontSize: 11, color: th.muted }}>#{r.id} · {new Date(r.createdAt).toLocaleDateString('bn-BD')}</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: th.text, marginBottom: 4 }}>
                👤 {r.user?.name || r.user?.username} ({r.user?.email || r.user?.username})
              </div>
              <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 3 }}>
                📄 Page: {r.page?.pageName || r.page?.pageId} (#{r.pageId})
              </div>
              <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 3 }}>
                📞 Phone: {r.phoneNumber}
              </div>
              {r.note && (
                <div style={{ fontSize: 12, color: th.muted, marginTop: 4, fontStyle: 'italic' }}>💬 "{r.note}"</div>
              )}
              {r.adminNote && (
                <div style={{ fontSize: 12, color: statusColor(r.status), marginTop: 4, fontWeight: 600 }}>
                  Admin note: {r.adminNote}
                </div>
              )}
            </div>
          </div>

          {r.status === 'pending' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${th.border}`, paddingTop: 10 }}>
              <input
                style={th.input}
                placeholder="Phone Number ID"
                value={forms[r.id]?.waPhoneNumberId || ''}
                onChange={e => setForms(prev => ({ ...prev, [r.id]: { ...prev[r.id], waPhoneNumberId: e.target.value } as any }))}
              />
              <input
                style={th.input}
                type="password"
                placeholder="System User Token (EAAxxxxx...)"
                value={forms[r.id]?.waToken || ''}
                onChange={e => setForms(prev => ({ ...prev, [r.id]: { ...prev[r.id], waToken: e.target.value } as any }))}
              />
              <input
                style={th.input}
                placeholder="Webhook Verify Token (optional — auto-generated if blank)"
                value={forms[r.id]?.waVerifyToken || ''}
                onChange={e => setForms(prev => ({ ...prev, [r.id]: { ...prev[r.id], waVerifyToken: e.target.value } as any }))}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy === r.id} onClick={() => finalize(r.id)} style={{
                  padding: '8px 12px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff',
                  fontWeight: 800, fontSize: 12, cursor: busy === r.id ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                  {busy === r.id ? <Spinner size={12} /> : '✅ Connect করুন'}
                </button>
                <button disabled={busy === r.id} onClick={() => reject(r.id)} style={{
                  padding: '8px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                  fontWeight: 800, fontSize: 12, cursor: busy === r.id ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                  ❌ Reject
                </button>
              </div>
            </div>
          )}

          {r.status === 'approved' && (
            <div style={{ background: 'rgba(34,197,94,0.07)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#15803d' }}>
              ✅ Connected — WhatsApp automation চালু হয়ে গেছে।
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Client Question Row — inline helpText edit ────────────────────────────────
function ClientQuestionRow({ q, th, saving, onSaveHelpText }: {
  q: any; th: Theme; saving: boolean; onSaveHelpText: (v: string) => void;
}) {
  const [editHelp, setEditHelp] = useState<string | null>(null);
  return (
    <div style={{ ...th.card2, borderRadius: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 12.5, color: th.accent }}>{q.label}</span>
            <InfoButton text={q.helpText || q.realMeaning || ''} th={th} />
            {!q.enabled && <span style={{ ...th.pill, ...th.pillRed, fontSize: 9 }}>OFF</span>}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(q.keywords || []).slice(0, 4).map((k: string) => (
              <span key={k} style={{ background: th.accentSoft, color: th.accent, fontSize: 10, padding: '1px 6px', borderRadius: 5 }}>{k}</span>
            ))}
          </div>
          {editHelp !== null && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              <input style={{ ...th.input, flex: 1, fontSize: 12 }} value={editHelp}
                placeholder="Help text for ⓘ tooltip..."
                onChange={e => setEditHelp(e.target.value)} />
              <button style={th.btnSmSuccess} disabled={saving} onClick={() => { onSaveHelpText(editHelp); setEditHelp(null); }}>
                {saving ? <Spinner size={11}/> : '💾'}
              </button>
              <button style={th.btnSmGhost} onClick={() => setEditHelp(null)}>✕</button>
            </div>
          )}
        </div>
        <button style={{ ...th.btnSmGhost, fontSize: 10.5, whiteSpace: 'nowrap' }}
          onClick={() => setEditHelp(q.helpText || '')}>
          ✏️ Help
        </button>
      </div>
    </div>
  );
}

// ── Call Servers Tab ──────────────────────────────────────────────────────────
const CALL_SERVER_FIELDS: Record<string, { key: string; label: string; placeholder: string; secret?: boolean }[]> = {
  MANUAL:      [],
  TWILIO:      [
    { key: 'accountSid',  label: 'Account SID',   placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    { key: 'authToken',   label: 'Auth Token',     placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', secret: true },
    { key: 'fromNumber',  label: 'From Number',    placeholder: '+1234567890' },
    { key: 'twimlBase',   label: 'TwiML Base URL', placeholder: 'https://your-server.com/twiml' },
  ],
  SSLWIRELESS: [
    { key: 'apiUrl',    label: 'API URL',   placeholder: 'https://api.sslwireless.com/...' },
    { key: 'apiKey',    label: 'API Key',   placeholder: 'xxxx-xxxx-xxxx', secret: true },
    { key: 'callerId',  label: 'Caller ID', placeholder: '01800000000' },
  ],
  BDCALLING: [
    { key: 'apiUrl',    label: 'API URL',   placeholder: 'https://api.bdcalling.com/...' },
    { key: 'apiKey',    label: 'API Key',   placeholder: 'xxxx-xxxx-xxxx', secret: true },
    { key: 'callerId',  label: 'Caller ID', placeholder: '01800000000' },
  ],
};

function CallServersTab({ th, cfg, setCfg, onSave, saving }: {
  th: Theme;
  cfg: { callFeatureEnabled: boolean; callServers: any[] };
  setCfg: (v: any) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleServer = (id: string) => {
    setCfg((prev: any) => ({
      ...prev,
      callServers: prev.callServers.map((s: any) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    }));
  };

  const updateCred = (serverId: string, key: string, value: string) => {
    setCfg((prev: any) => ({
      ...prev,
      callServers: prev.callServers.map((s: any) =>
        s.id === serverId
          ? { ...s, credentials: { ...(s.credentials || {}), [key]: value } }
          : s,
      ),
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Master toggle */}
      <div style={{ ...th.card, border: cfg.callFeatureEnabled ? `2px solid ${th.accent}` : `1px solid ${th.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              📞 Call Confirm Feature
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                background: cfg.callFeatureEnabled ? '#dcfce7' : '#fef2f2',
                color: cfg.callFeatureEnabled ? '#16a34a' : '#dc2626',
              }}>
                {cfg.callFeatureEnabled ? 'LIVE' : 'COMING SOON'}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: th.muted, marginTop: 4 }}>
              এটি চালু করলে সব client-এর Settings → Call Confirm section থেকে "Coming Soon" overlay সরে যাবে।
            </div>
          </div>
          <button
            onClick={() => setCfg((prev: any) => ({ ...prev, callFeatureEnabled: !prev.callFeatureEnabled }))}
            style={{
              padding: '10px 22px', borderRadius: 10, cursor: 'pointer',
              fontWeight: 800, fontSize: 13, fontFamily: 'inherit', transition: 'all .15s',
              background: cfg.callFeatureEnabled ? th.accent : th.surface,
              color: cfg.callFeatureEnabled ? '#fff' : th.muted,
              border: `2px solid ${cfg.callFeatureEnabled ? th.accent : th.border}`,
              flexShrink: 0,
            } as React.CSSProperties}
          >
            {cfg.callFeatureEnabled ? '✅ চালু আছে' : '🔒 বন্ধ আছে'}
          </button>
        </div>
      </div>

      {/* Server list */}
      <div style={{ ...th.card }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>📡 Call Servers</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(cfg.callServers || []).map((srv: any) => {
            const fields = CALL_SERVER_FIELDS[srv.id] || [];
            const isEditing = editingId === srv.id;
            const creds = srv.credentials || {};
            const filledCount = fields.filter(f => creds[f.key]?.trim()).length;

            return (
              <div key={srv.id} style={{
                border: `1.5px solid ${srv.enabled ? th.accent + '88' : th.border}`,
                borderRadius: 12, overflow: 'hidden',
                background: srv.enabled ? th.accentSoft : th.surface,
                transition: 'all .15s',
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                  <span style={{ fontSize: 22 }}>{srv.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: srv.enabled ? th.accentText : th.text }}>
                      {srv.name}
                    </div>
                    {fields.length === 0 && (
                      <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>কোনো API key লাগবে না। Agent dashboard থেকে manually trigger করবে।</div>
                    )}
                    {fields.length > 0 && (
                      <div style={{ fontSize: 11.5, color: filledCount === fields.length ? '#16a34a' : th.muted, marginTop: 2 }}>
                        {filledCount === fields.length ? `✅ ${filledCount}/${fields.length} credentials set` : `⚠️ ${filledCount}/${fields.length} credentials set`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {fields.length > 0 && (
                      <button
                        onClick={() => setEditingId(isEditing ? null : srv.id)}
                        style={{
                          padding: '6px 13px', borderRadius: 8, cursor: 'pointer',
                          fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
                          background: isEditing ? th.accent + '22' : th.panel,
                          color: isEditing ? th.accentText : th.muted,
                          border: `1.5px solid ${isEditing ? th.accent : th.border}`,
                          flexShrink: 0,
                        } as React.CSSProperties}
                      >
                        {isEditing ? '✕ বন্ধ' : '✏️ Edit'}
                      </button>
                    )}
                    <button
                      onClick={() => toggleServer(srv.id)}
                      style={{
                        padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                        fontWeight: 700, fontSize: 12, fontFamily: 'inherit', transition: 'all .12s',
                        background: srv.enabled ? th.accent : th.panel,
                        color: srv.enabled ? '#fff' : th.muted,
                        border: `1.5px solid ${srv.enabled ? th.accent : th.border}`,
                        flexShrink: 0,
                      } as React.CSSProperties}
                    >
                      {srv.enabled ? 'Enabled ✓' : 'Disabled'}
                    </button>
                  </div>
                </div>

                {/* Credential edit panel */}
                {isEditing && fields.length > 0 && (
                  <div style={{
                    borderTop: `1px solid ${th.border}`,
                    padding: '16px 16px 18px',
                    background: th.bg,
                    display: 'flex', flexDirection: 'column', gap: 12,
                  }}>
                    <div style={{ fontSize: 12, color: th.muted, marginBottom: 2 }}>Credentials সংরক্ষিত হবে server-side (global-config.json)। নিচে সব field পূরণ করুন তারপর Save করুন।</div>
                    {fields.map(f => (
                      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: th.muted }}>{f.label}</label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type={f.secret && !showSecrets[`${srv.id}_${f.key}`] ? 'password' : 'text'}
                            value={creds[f.key] || ''}
                            onChange={e => updateCred(srv.id, f.key, e.target.value)}
                            placeholder={f.placeholder}
                            style={{
                              ...th.input,
                              width: '100%', boxSizing: 'border-box',
                              fontSize: 12.5,
                              paddingRight: f.secret ? 36 : undefined,
                            } as React.CSSProperties}
                          />
                          {f.secret && (
                            <button
                              type="button"
                              onClick={() => setShowSecrets(prev => ({ ...prev, [`${srv.id}_${f.key}`]: !prev[`${srv.id}_${f.key}`] }))}
                              style={{
                                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', cursor: 'pointer', color: th.muted, fontSize: 14,
                              }}
                            >
                              {showSecrets[`${srv.id}_${f.key}`] ? '🙈' : '👁️'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{ ...th.btnPrimary, opacity: saving ? 0.6 : 1, fontSize: 13.5, padding: '11px 28px' }}
        >
          {saving ? 'Saving…' : '💾 Save Call Settings'}
        </button>
      </div>
    </div>
  );
}

// ── Tutorials Tab (Courier + Facebook + Onboarding) ──────────────────────────
function CourierTutorialsTab({ th, tutorials, setTutorials, saveTutorials, saving }: {
  th: Theme; tutorials: TutorialsConfig;
  setTutorials: (v: any) => void; saveTutorials: () => void; saving: boolean;
}) {
  const COURIERS = [
    { key: 'pathao',    label: 'Pathao',    color: '#e11d48', icon: '🚴', desc: 'API key ও Store ID কোথায় পাবেন' },
    { key: 'steadfast', label: 'Steadfast', color: '#0369a1', icon: '📦', desc: 'API Key ও Secret Key setup' },
    { key: 'redx',      label: 'RedX',      color: '#dc2626', icon: '🔴', desc: 'API Token setup' },
    { key: 'paperfly',  label: 'Paperfly',  color: '#7c3aed', icon: '✈️', desc: 'API Key ও Password setup' },
  ];

  function extractId(url: string): string | null {
    const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return m?.[1] ?? null;
  }

  const setCourier = (key: string, val: string) =>
    setTutorials((t: TutorialsConfig) => ({ ...t, courier: { ...(t.courier || {}), [key]: val } }));

  const setTop = (key: keyof TutorialsConfig, val: string) =>
    setTutorials((t: TutorialsConfig) => ({ ...t, [key]: val }));

  const fbUrl   = tutorials.facebookAccessToken || '';
  const obUrl   = tutorials.generalOnboarding   || '';
  const pcUrl   = tutorials.pageConnect         || '';
  const fbYtId  = extractId(fbUrl);
  const obYtId  = extractId(obUrl);
  const pcYtId  = extractId(pcUrl);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Page Connect Tutorial ──────────────────────────────────────── */}
      <div style={th.card}>
        <CardHeader th={th} title="🔗 Page Connect Tutorial (Sidebar)"
          sub="ConnectPageScreen এর পাশে sidebar এ এই tutorial দেখাবে। নতুন client দের Meta Developer Account খুলতে ও page connect করতে guide করবে।"
        />
        <div style={{ ...th.card2, ...th.alert, ...th.alertInfo, marginBottom: 18, fontSize: 12.5 }}>
          💡 এই video ConnectPageScreen এর ডান পাশে sidebar এ দেখাবে যখন client প্রথমবার page add করতে আসবে।
        </div>
        <div style={{ ...th.card2, borderRadius: 14, border: `1.5px solid #6366f122` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 22 }}>🔗</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#6366f1' }}>Page Connect Guide</div>
              <div style={{ fontSize: 12, color: th.muted }}>Meta Developer Account খুলে page connect করার সম্পূর্ণ guide</div>
            </div>
            {pcUrl && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 10, marginLeft: 'auto' }}>✓ Set</span>}
          </div>
          <input
            style={{ ...th.input, marginBottom: pcYtId ? 12 : 0 }}
            placeholder="Page connect tutorial YouTube URL..."
            value={pcUrl}
            onChange={e => setTop('pageConnect', e.target.value)}
          />
          {pcYtId && (
            <div style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9', maxWidth: 400, background: '#000' }}>
              <iframe
                src={`https://www.youtube.com/embed/${pcYtId}`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen title="Page connect tutorial"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Facebook Access Token Tutorial ─────────────────────────────── */}
      <div style={th.card}>
        <CardHeader th={th} title="🔑 Facebook Access Token Tutorial"
          sub="Client যখন প্রথমবার Facebook Page connect করবে, এই video দেখবে। YouTube URL দিন।"
        />
        <div style={{ ...th.card2, ...th.alert, ...th.alertInfo, marginBottom: 18, fontSize: 12.5 }}>
          💡 এই video ConnectPageScreen এবং Settings → PAGE tab এ দেখাবে।
          Client বুঝতে পারবে কীভাবে Facebook Access Token নিতে হয়।
        </div>
        <div style={{ ...th.card2, borderRadius: 14, border: `1.5px solid #1877f222` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 22 }}>f</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#1877f2' }}>Facebook Page Connection</div>
              <div style={{ fontSize: 12, color: th.muted }}>Access Token কোথায় পাবেন তার guide</div>
            </div>
            {fbUrl && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 10, marginLeft: 'auto' }}>✓ Set</span>}
          </div>
          <input
            style={{ ...th.input, marginBottom: fbYtId ? 12 : 0 }}
            placeholder="Facebook Access Token tutorial YouTube URL..."
            value={fbUrl}
            onChange={e => setTop('facebookAccessToken', e.target.value)}
          />
          {fbYtId && (
            <div style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9', maxWidth: 400, background: '#000' }}>
              <iframe
                src={`https://www.youtube.com/embed/${fbYtId}`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen title="Facebook Access Token tutorial"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── General Onboarding Tutorial ────────────────────────────────── */}
      <div style={th.card}>
        <CardHeader th={th} title="🎓 General Onboarding Tutorial"
          sub="নতুন client দের জন্য সাধারণ onboarding video। YouTube URL দিন।"
        />
        <div style={{ ...th.card2, borderRadius: 14, border: `1.5px solid #16a34a22` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 22 }}>🎓</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#16a34a' }}>FlamboyAI Onboarding</div>
              <div style={{ fontSize: 12, color: th.muted }}>Platform কীভাবে ব্যবহার করবেন — সম্পূর্ণ guide</div>
            </div>
            {obUrl && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 10, marginLeft: 'auto' }}>✓ Set</span>}
          </div>
          <input
            style={{ ...th.input, marginBottom: obYtId ? 12 : 0 }}
            placeholder="General onboarding YouTube URL..."
            value={obUrl}
            onChange={e => setTop('generalOnboarding', e.target.value)}
          />
          {obYtId && (
            <div style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9', maxWidth: 400, background: '#000' }}>
              <iframe
                src={`https://www.youtube.com/embed/${obYtId}`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen title="General onboarding tutorial"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Courier API Tutorials ──────────────────────────────────────── */}
      <div style={th.card}>
        <CardHeader th={th} title="🚚 Courier API Tutorial Videos"
          sub="Client রা courier API setup করার সময় এই video দেখবে। YouTube URL দিন।"
        />
        <div style={{ ...th.card2, ...th.alert, ...th.alertInfo, marginBottom: 18, fontSize: 12.5 }}>
          💡 প্রতিটা courier এর settings page এ এই tutorial video দেখাবে।
          Client সহজেই বুঝতে পারবে কোথায় গিয়ে API key নিতে হবে।
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {COURIERS.map(c => {
            const url  = (tutorials.courier as any)?.[c.key] || '';
            const ytId = extractId(url);
            return (
              <div key={c.key} style={{ ...th.card2, borderRadius: 14, border: `1.5px solid ${c.color}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 20 }}>{c.icon}</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: c.color }}>{c.label}</div>
                    <div style={{ fontSize: 12, color: th.muted }}>{c.desc}</div>
                  </div>
                  {url && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 10, marginLeft: 'auto' }}>✓ Set</span>}
                </div>
                <input
                  style={{ ...th.input, marginBottom: ytId ? 12 : 0 }}
                  placeholder={`${c.label} setup tutorial YouTube URL...`}
                  value={url}
                  onChange={e => setCourier(c.key, e.target.value)}
                />
                {ytId && (
                  <div style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9', maxWidth: 400, background: '#000' }}>
                    <iframe
                      src={`https://www.youtube.com/embed/${ytId}`}
                      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen title={`${c.label} tutorial`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button style={{ ...th.btnPrimary, marginTop: 18 }} onClick={saveTutorials} disabled={saving}>
          {saving ? <><Spinner size={13}/> Saving…</> : '💾 Save All Tutorial Videos'}
        </button>
      </div>
    </div>
  );
}

// ── Billing Tab ───────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  trial: '#f59e0b', active: '#16a34a', expired: '#ef4444',
  grace: '#f97316', cancelled: '#9ca3af', pending: '#3b82f6', confirmed: '#16a34a', failed: '#ef4444',
};

function BillingTab({ th, data, supportConfig, loading, subFilter, setSubFilter, onRefresh, onConfirmPayment, onSetSubscription, onSaveSupport }: {
  th: Theme;
  data: { subscriptions: any[]; pending: any[] };
  supportConfig: BillingSupportConfig;
  loading: boolean;
  subFilter: string;
  setSubFilter: (v: string) => void;
  onRefresh: () => void;
  onConfirmPayment: (id: string) => void;
  onSetSubscription: (userId: string, payload: any) => void;
  onSaveSupport: (payload: BillingSupportConfig) => void;
}) {
  const [setSubModal, setSetSubModal] = useState<any>(null);
  const [setSubForm, setSetSubFormState] = useState<any>({
    status: 'active',
    days: 30,
    ordersLimit: -1,
    note: '',
    featureAccess: { ...DEFAULT_FEATURE_ACCESS },
  });
  const [supportForm, setSupportForm] = useState<BillingSupportConfig>(supportConfig || {});

  const STATUSES = ['trial', 'active', 'grace', 'expired', 'cancelled'];

  useEffect(() => {
    setSupportForm(supportConfig || {});
  }, [supportConfig]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>💳 Billing Management</h2>
          <p style={{ fontSize: 12.5, color: th.muted, margin: '3px 0 0' }}>Subscriptions, payments, and plan management</p>
        </div>
        <button style={th.btnGhost} onClick={onRefresh}>{loading ? <Spinner size={13}/> : '🔄 Refresh'}</button>
      </div>

      <div style={{ ...th.card }}>
        <CardHeader
          th={th}
          title="📞 Client Contact Admin"
          sub="Client dashboard-এ package submit এর বদলে এই contact info দেখাবে"
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Label</div>
            <input style={th.input} value={supportForm.label || ''} onChange={e => setSupportForm(f => ({ ...f, label: e.target.value }))} placeholder="Admin Support" />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Phone</div>
            <input style={th.input} value={supportForm.phone || ''} onChange={e => setSupportForm(f => ({ ...f, phone: e.target.value }))} placeholder="01XXXXXXXXX" />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>WhatsApp URL</div>
            <input style={th.input} value={supportForm.whatsappUrl || ''} onChange={e => setSupportForm(f => ({ ...f, whatsappUrl: e.target.value }))} placeholder="https://wa.me/8801..." />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Messenger URL</div>
            <input style={th.input} value={supportForm.messengerUrl || ''} onChange={e => setSupportForm(f => ({ ...f, messengerUrl: e.target.value }))} placeholder="https://m.me/..." />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Email</div>
            <input style={th.input} value={supportForm.email || ''} onChange={e => setSupportForm(f => ({ ...f, email: e.target.value }))} placeholder="support@example.com" />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Note</div>
          <textarea
            style={{ ...th.input, minHeight: 82, resize: 'vertical', fontFamily: 'inherit' }}
            value={supportForm.note || ''}
            onChange={e => setSupportForm(f => ({ ...f, note: e.target.value }))}
            placeholder="Client-কে কীভাবে যোগাযোগ করতে হবে সেটা লিখুন"
          />
        </div>
        <div style={{ borderTop: `1px solid ${th.border}`, paddingTop: 16, marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 12, textTransform: 'uppercase' }}>Payment Numbers</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>bKash Number</div>
              <input style={th.input} value={supportForm.bkash || ''} onChange={e => setSupportForm(f => ({ ...f, bkash: e.target.value }))} placeholder="01XXXXXXXXX" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Nagad Number</div>
              <input style={th.input} value={supportForm.nagad || ''} onChange={e => setSupportForm(f => ({ ...f, nagad: e.target.value }))} placeholder="01XXXXXXXXX" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Rocket Number</div>
              <input style={th.input} value={supportForm.rocket || ''} onChange={e => setSupportForm(f => ({ ...f, rocket: e.target.value }))} placeholder="01XXXXXXXXX" />
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${th.border}`, paddingTop: 16, marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 12, textTransform: 'uppercase' }}>Bank Account</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Account Number</div>
              <input style={th.input} value={supportForm.bankAccount || ''} onChange={e => setSupportForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="Account number" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Account Holder</div>
              <input style={th.input} value={supportForm.bankHolder || ''} onChange={e => setSupportForm(f => ({ ...f, bankHolder: e.target.value }))} placeholder="Holder name" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Bank Name</div>
              <input style={th.input} value={supportForm.bankName || ''} onChange={e => setSupportForm(f => ({ ...f, bankName: e.target.value }))} placeholder="Dutch-Bangla Bank" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Branch</div>
              <input style={th.input} value={supportForm.bankBranch || ''} onChange={e => setSupportForm(f => ({ ...f, bankBranch: e.target.value }))} placeholder="Branch name" />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={th.btnPrimary} onClick={() => onSaveSupport(supportForm)}>💾 Save Contact Info</button>
        </div>
      </div>

      {/* Pending Payments */}
      {data.pending.length > 0 && (
        <div style={{ ...th.card, border: `1.5px solid #f59e0b44` }}>
          <CardHeader th={th} title={`⏳ Pending Payments (${data.pending.length})`}
            sub="এই payments গুলো confirm করুন subscription activate করতে" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.pending.map((p: any) => (
              <div key={p.id} style={{ ...th.card2, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {p.subscription?.user?.name || p.subscription?.user?.username}
                    <span style={{ ...th.pill, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', fontSize: 10, marginLeft: 8 }}>PENDING</span>
                  </div>
                  <div style={{ fontSize: 12, color: th.muted }}>
                    ৳{p.amount} · {p.method} · Txn: <b>{p.transactionId}</b>
                  </div>
                  <div style={{ fontSize: 11, color: th.muted }}>
                    {new Date(p.createdAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={th.btnSmAccent} onClick={() => onConfirmPayment(p.id)}>
                    ✅ Confirm
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Subscriptions */}
      <div style={th.card}>
        <CardHeader th={th} title="📋 All Subscriptions"
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={{ ...th.input, width: 120, padding: '5px 10px', fontSize: 12 }}
                value={subFilter} onChange={e => { setSubFilter(e.target.value); setTimeout(onRefresh, 50); }}>
                <option value="">All Status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          }
        />
        {loading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><Spinner size={20}/></div>
        ) : data.subscriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: th.muted, fontSize: 13 }}>কোনো subscription নেই</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.subscriptions.map((sub: any) => (
              <div key={sub.id} style={{ ...th.card2 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>
                        {sub.user?.name || sub.user?.username}
                      </span>
                      <span style={{ fontSize: 11, color: th.muted }}>{sub.user?.email}</span>
                      <span style={{
                        ...th.pill,
                        background: `${STATUS_COLOR[sub.status] || '#9ca3af'}22`,
                        color: STATUS_COLOR[sub.status] || '#9ca3af',
                        border: `1px solid ${STATUS_COLOR[sub.status] || '#9ca3af'}44`,
                        fontSize: 10,
                      }}>{sub.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: th.muted }}>
                      Orders: {sub.ordersUsed}/{sub.ordersLimit === -1 ? '∞' : sub.ordersLimit} ·
                      Period ends: {new Date(sub.periodEnd).toLocaleDateString()} ·
                      Created: {new Date(sub.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button style={th.btnSmGhost}
                    onClick={() => {
                      const firstPage = sub.user?.pages?.[0];
                      const featureAccess = { ...DEFAULT_FEATURE_ACCESS };
                      for (const item of BILLING_FEATURES) {
                        featureAccess[item.key] = firstPage?.[item.key] !== false;
                      }
                      setSetSubModal(sub);
                      setSetSubFormState({
                        status: sub.status,
                        days: 30,
                        ordersLimit: sub.ordersLimit === -1 ? -1 : Number(sub.ordersLimit || 0),
                        note: sub.note || '',
                        featureAccess,
                      });
                    }}>
                    ✏️ Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Set Subscription Modal */}
      {setSubModal && (
        <div style={{ ...th.card, border: `2px solid ${th.accent}` }}>
          <CardHeader th={th}
            title={`✏️ Edit Subscription — ${setSubModal.user?.name || setSubModal.user?.username}`}
            action={<button style={th.btnGhost} onClick={() => setSetSubModal(null)}>✕</button>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Status</div>
              <select style={th.input} value={setSubForm.status}
                onChange={e => setSetSubFormState((f: any) => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Days</div>
              <input style={th.input} type="number" min={1} max={365}
                value={setSubForm.days}
                onChange={e => setSetSubFormState((f: any) => ({ ...f, days: Number(e.target.value) }))} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Orders Limit</div>
              <input style={th.input} type="number" min={-1}
                value={setSubForm.ordersLimit}
                onChange={e => setSetSubFormState((f: any) => ({ ...f, ordersLimit: Number(e.target.value) }))} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase' }}>Admin Note</div>
            <textarea
              style={{ ...th.input, minHeight: 72, resize: 'vertical', fontFamily: 'inherit' }}
              value={setSubForm.note}
              onChange={e => setSetSubFormState((f: any) => ({ ...f, note: e.target.value }))}
              placeholder="কেন update/downgrade করা হচ্ছে লিখে রাখুন"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 8, textTransform: 'uppercase' }}>Feature Access</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {BILLING_FEATURES.map(item => (
                <label key={item.key} style={{ ...th.card2, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '10px 12px' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(setSubForm.featureAccess?.[item.key])}
                    onChange={e => setSetSubFormState((f: any) => ({
                      ...f,
                      featureAccess: { ...(f.featureAccess || {}), [item.key]: e.target.checked },
                    }))}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: th.text }}>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={th.btnPrimary}
              onClick={() => {
                onSetSubscription(setSubModal.user?.id, {
                  status: setSubForm.status,
                  periodDays: setSubForm.days,
                  ordersLimit: setSubForm.ordersLimit,
                  note: setSubForm.note,
                  featureAccess: setSubForm.featureAccess,
                });
                setSetSubModal(null);
              }}>
              💾 Save
            </button>
            <button style={th.btnGhost} onClick={() => setSetSubModal(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Wallet Tab ──────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  bkash: 'bKash', nagad: 'Nagad', bank: 'Bank', manual: 'Manual',
};
const STATUS_COLORS_W: Record<string, string> = {
  pending: '#f59e0b', approved: '#16a34a', rejected: '#ef4444',
};

function AdminWalletTab({ th, loading, pages, requests, reqFilter, setReqFilter,
  directForm, setDirectForm, directSaving, adjustForm, setAdjustForm, adjustSaving,
  onRefresh, onApprove, onReject, onDirectRecharge, onAdjust,
}: {
  th: Theme; loading: boolean; pages: any[]; requests: any[];
  reqFilter: 'all' | 'pending'; setReqFilter: (v: 'all' | 'pending') => void;
  directForm: any; setDirectForm: (f: any) => void;
  directSaving: boolean;
  adjustForm: any; setAdjustForm: (f: any) => void;
  adjustSaving: boolean;
  onRefresh: () => void; onApprove: (id: number) => void;
  onReject: (id: number) => void; onDirectRecharge: () => void;
  onAdjust: () => void;
}) {
  const [showDirect, setShowDirect] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [pageSearch, setPageSearch] = useState('');

  const card: React.CSSProperties = { ...th.card, borderRadius: 12, padding: 18, marginBottom: 16 };
  const inp: React.CSSProperties = { ...th.input, width: '100%', boxSizing: 'border-box' };

  const filteredPages = pages.filter(p =>
    !pageSearch || p.pageName?.toLowerCase().includes(pageSearch.toLowerCase()) ||
    p.owner?.username?.toLowerCase().includes(pageSearch.toLowerCase())
  );

  // Group pages by owner
  const groupedByUser = filteredPages.reduce((acc: any, p: any) => {
    const key = p.owner?.id || 'unknown';
    if (!acc[key]) acc[key] = { owner: p.owner, pages: [] };
    acc[key].pages.push(p);
    return acc;
  }, {});

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1, fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px' }}>💰 Wallet Management</h3>
        <button style={{ ...th.btnGhost, borderRadius: 10, padding: '8px 16px' }} onClick={onRefresh}>↻ Refresh</button>
        <button
          style={{
            ...th.btnPrimary,
            fontSize: 13.5,
            fontWeight: 800,
            padding: '9px 18px',
            borderRadius: 11,
            background: showDirect ? th.muted : 'linear-gradient(135deg, #4f46e5, #7e22ce)',
            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
            border: 'none',
            transition: 'all 0.2s'
          }}
          onClick={() => setShowDirect(v => !v)}
        >
          {showDirect ? '✕ Close' : '➕ Manual Recharge'}
        </button>
        <button
          style={{
            ...th.btnGhost,
            fontSize: 13.5,
            fontWeight: 800,
            padding: '9px 18px',
            borderRadius: 11,
            border: `1px solid ${th.border}`,
          }}
          onClick={() => setShowAdjust(v => !v)}
        >
          {showAdjust ? '✕ Close' : '⚖️ Adjust Balance'}
        </button>
      </div>

      {/* ── Adjust balance form (add or subtract, no transaction ID needed) ── */}
      {showAdjust && (
        <div style={{ ...card, border: `1px solid ${th.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 20 }}>⚖️</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Adjust Balance (Add/Subtract)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client / Page</label>
              <select style={{ ...inp, cursor: 'pointer', fontWeight: 600, background: th.bg, color: th.text }} value={adjustForm.pageId}
                onChange={e => setAdjustForm({ ...adjustForm, pageId: e.target.value })}>
                <option value="" style={{ background: th.bg, color: th.muted }}>— Page বেছে নিন —</option>
                {pages.map(p => (
                  <option key={p.id} value={p.id} style={{ background: th.bg, color: th.text }}>
                    {p.pageName || '(no name)'}  @{p.owner?.username || '?'}  [ID:{p.id}]  {Math.round(p.creditBalance ?? 0)} credit
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount (credit) — negative দিলে কমবে</label>
              <input style={{ ...inp, fontWeight: 700, fontSize: 16 }} type="number" placeholder="200 বা -100" value={adjustForm.creditAmount}
                onChange={e => setAdjustForm({ ...adjustForm, creditAmount: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Note (optional)</label>
              <input style={inp} placeholder="কারণ লিখুন" value={adjustForm.note}
                onChange={e => setAdjustForm({ ...adjustForm, note: e.target.value })} />
            </div>
          </div>
          <button
            style={{
              marginTop: 16, width: '100%', padding: '13px 0',
              background: adjustSaving ? th.muted : 'linear-gradient(135deg, #0891b2, #0e7490)',
              color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800,
              fontSize: 15, cursor: adjustSaving ? 'not-allowed' : 'pointer',
              letterSpacing: '0.01em', opacity: adjustSaving ? 0.7 : 1,
            }}
            disabled={adjustSaving} onClick={onAdjust}>
            {adjustSaving ? <Spinner size={16} color="#fff" /> : <span>⚖️ Adjust করুন</span>}
          </button>
        </div>
      )}

      {/* ── Direct recharge form ─────────────────────────────────────── */}
      {showDirect && (
        <div style={{ ...card, border: `1px solid ${th.accent}55`, background: 'linear-gradient(135deg,rgba(99,102,241,0.07) 0%,rgba(34,211,238,0.04) 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 20 }}>💳</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Manual Balance Add</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client / Page</label>
              <select style={{ ...inp, cursor: 'pointer', fontWeight: 600, background: th.bg, color: th.text }} value={directForm.pageId}
                onChange={e => setDirectForm({ ...directForm, pageId: e.target.value })}>
                <option value="" style={{ background: th.bg, color: th.muted }}>— Page বেছে নিন —</option>
                {pages.map(p => (
                  <option key={p.id} value={p.id} style={{ background: th.bg, color: th.text }}>
                    {p.pageName || '(no name)'}  @{p.owner?.username || '?'}  [ID:{p.id}]  {Math.round(p.creditBalance ?? 0)} credit
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount (credit)</label>
              <input style={{ ...inp, fontWeight: 700, fontSize: 16 }} type="number" placeholder="500" value={directForm.creditAmount}
                onChange={e => setDirectForm({ ...directForm, creditAmount: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transaction ID</label>
              <input style={inp} placeholder="bKash/Nagad TrxID" value={directForm.transactionId}
                onChange={e => setDirectForm({ ...directForm, transactionId: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: th.muted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Note (optional)</label>
              <input style={inp} placeholder="Admin note — কিসের payment, কোন date..." value={directForm.note}
                onChange={e => setDirectForm({ ...directForm, note: e.target.value })} />
            </div>
          </div>
          <button
            style={{
              marginTop: 16, width: '100%', padding: '13px 0',
              background: directSaving ? th.muted : 'linear-gradient(135deg, #4f46e5, #7e22ce)',
              color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800,
              fontSize: 15, cursor: directSaving ? 'not-allowed' : 'pointer',
              letterSpacing: '0.01em', boxShadow: directSaving ? 'none' : '0 6px 18px rgba(79,70,229,0.3)',
              transition: 'all 0.2s', opacity: directSaving ? 0.7 : 1,
            }}
            onMouseOver={e => !directSaving && (e.currentTarget.style.transform = 'translateY(-1px)')}
            onMouseOut={e => !directSaving && (e.currentTarget.style.transform = 'translateY(0)')}
            disabled={directSaving} onClick={onDirectRecharge}>
            {directSaving ? <Spinner size={16} color="#fff" /> : <span>💰 Balance Add করুন</span>}
          </button>
        </div>
      )}

      {/* ── Recharge requests ────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>📋 Recharge Requests</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['pending', 'all'] as const).map(f => (
              <button key={f} onClick={() => { setReqFilter(f); onRefresh(); }} style={{
                ...th.btnGhost, padding: '4px 10px', fontSize: 12,
                background: reqFilter === f ? th.accent : 'transparent',
                color: reqFilter === f ? '#fff' : th.muted,
              }}>{f === 'pending' ? '⏳ Pending' : '📜 All'}</button>
            ))}
          </div>
        </div>
        {requests.length === 0 ? (
          <div style={{ textAlign: 'center', color: th.muted, padding: 28, fontSize: 13 }}>
            {reqFilter === 'pending' ? 'কোনো pending request নেই।' : 'কোনো request নেই।'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.map((r: any) => (
              <div key={r.id} style={{
                padding: '12px 14px', borderRadius: 10, border: `1px solid ${th.border}`,
                background: (th.card as any).background,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      ৳ {r.amountBdt.toLocaleString()} → {Math.round(r.creditsAmount ?? 0).toLocaleString()} credit — {METHOD_LABELS[r.method] || r.method}
                    </div>
                    <div style={{ fontSize: 12, color: th.muted }}>
                      <b>{r.page?.pageName || `Page #${r.pageId}`}</b>
                      {r.page?.owner && ` · @${r.page.owner.username}`}
                    </div>
                    <div style={{ fontSize: 12, color: th.muted }}>
                      TrxID: <b>{r.transactionId}</b>
                      {r.note && ` · ${r.note}`}
                    </div>
                    <div style={{ fontSize: 11, color: th.muted }}>
                      {new Date(r.createdAt).toLocaleString('en-BD')}
                    </div>
                    {r.status === 'rejected' && r.rejectedReason && (
                      <div style={{ fontSize: 12, color: '#ef4444' }}>কারণ: {r.rejectedReason}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <span style={{
                      background: STATUS_COLORS_W[r.status] || '#6b7280', color: '#fff',
                      borderRadius: 99, fontSize: 11, padding: '3px 10px', fontWeight: 700,
                    }}>
                      {r.status === 'pending' ? '⏳ Pending'
                        : r.status === 'approved' ? '✅ Approved' : '❌ Rejected'}
                    </span>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...th.btnSmSuccess, padding: '6px 14px', borderRadius: 8, fontWeight: 700, background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff' }}
                          onClick={() => onApprove(r.id)}>✅ Approve</button>
                        <button style={{ ...th.btnSmGhost, padding: '6px 14px', borderRadius: 8, fontWeight: 700, color: '#ef4444', borderColor: '#ef4444' }}
                          onClick={() => onReject(r.id)}>❌ Reject</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── All pages wallet summary ─────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 700 }}>📊 সব Client এর Wallet ({Object.keys(groupedByUser).length} জন)</div>
          <input style={{ ...th.input, width: 200, fontSize: 12, padding: '6px 10px' }}
            placeholder="Search page / username..."
            value={pageSearch} onChange={e => setPageSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.values(groupedByUser).map((group: any) => {
            const totalBalance = group.pages.reduce((s: number, p: any) => s + p.creditBalance, 0);
            return (
              <div key={group.owner?.id || 'unknown'} style={{ border: `1px solid ${th.border}`, borderRadius: 12, overflow: 'hidden' }}>
                {/* User header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: th.surface as string }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{group.owner?.name || group.owner?.username || 'Unknown'}</span>
                    <span style={{ fontSize: 11, color: th.muted, marginLeft: 6 }}>@{group.owner?.username}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: th.muted }}>{group.pages.length}টি page</span>
                    <span style={{ fontWeight: 800, fontSize: 14, color: totalBalance <= 0 ? '#ef4444' : totalBalance < 4000 ? '#f59e0b' : '#22c55e' }}>
                      মোট {Math.round(totalBalance).toLocaleString()} credit
                    </span>
                  </div>
                </div>
                {/* Pages */}
                {group.pages.map((p: any) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px 8px 24px', borderTop: `1px solid ${th.border}` }}>
                    <div style={{ fontSize: 12, color: th.text }}>{p.pageName || p.pageId}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: p.creditBalance <= 0 ? '#ef4444' : p.creditBalance < 4000 ? '#f59e0b' : '#22c55e' }}>
                        {Math.round(p.creditBalance).toLocaleString()} credit
                      </span>
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700, background: p.subscriptionStatus === 'ACTIVE' ? '#22c55e22' : '#ef444422', color: p.subscriptionStatus === 'ACTIVE' ? '#16a34a' : '#dc2626' }}>
                        {p.subscriptionStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Admin Pricing Tab ─────────────────────────────────────────────────────────
type PricingForm = {
  costPerKeywordReplyCredit: number;
  costPerImageCredit: number;
  costPerImageLocalCredit: number;
  costPerOcrLocalCredit: number;
  costPerOcrAiCredit: number;
  costPerVoiceMsgCredit: number;
  costPerAnalyzeCredit: number;
  costPerAiGenerateCredit: number;
  costPerBroadcastMsgCredit: number;
  costPerRecurringNotifCredit: number;
  costPerCommentReplyCredit: number;
  costPerMemoPrintCredit: number;
  creditsPerBdt: number;
};

const PRICING_FIELDS: { key: keyof PricingForm; label: string; help: string }[] = [
  { key: 'costPerKeywordReplyCredit',   label: 'Keyword/Template Reply (credit)',    help: 'Pure keyword/rule-based reply — AI call নেই' },
  { key: 'costPerImageCredit',          label: 'Customer Image — Vision (credit)',   help: 'Gemini Vision API দিয়ে customer image analyze' },
  { key: 'costPerImageLocalCredit',     label: 'Customer Image — Local (credit)',    help: 'Local CLIP model দিয়ে customer image search' },
  { key: 'costPerOcrLocalCredit',       label: 'OCR — Local Tesseract (credit)',     help: 'Local Tesseract দিয়ে image থেকে text extract' },
  { key: 'costPerOcrAiCredit',          label: 'OCR — AI Gemini Fallback (credit)', help: 'Gemini Flash দিয়ে OCR fallback — বেশি accurate' },
  { key: 'costPerVoiceMsgCredit',       label: 'Voice Note STT (credit)',            help: 'OpenAI Whisper দিয়ে voice → text' },
  { key: 'costPerAnalyzeCredit',        label: 'Product Auto-Analyze (credit)',      help: 'Admin product upload এ vision analysis' },
  { key: 'costPerAiGenerateCredit',     label: 'AI Generate (Caption/Desc) (credit)', help: 'AI দিয়ে product description বা broadcast message তৈরি' },
  { key: 'costPerBroadcastMsgCredit',   label: 'Broadcast Message (credit)',         help: 'প্রতিটি broadcast message পাঠানোর charge' },
  { key: 'costPerRecurringNotifCredit', label: 'Subscriber Notification (credit)',   help: 'Recurring subscriber দের offer/product broadcast — Facebook free, আমাদের charge' },
  { key: 'costPerCommentReplyCredit',   label: 'Comment Reply (credit)',             help: 'Facebook post comment এ auto-reply' },
  { key: 'costPerMemoPrintCredit',      label: 'Memo Print (credit)',                help: 'প্রতিটি invoice/memo print এর charge' },
  { key: 'creditsPerBdt',               label: 'Custom Recharge Rate (credit per ৳)', help: 'Package ছাড়া custom BDT amount দিয়ে recharge করলে এই rate ব্যবহার হবে' },
];

function AdminPricingTab({ th, form, setForm, saving, onSaveDefault, onApplyAll, globalPricingInfo, setGlobalPricingInfo, pricingInfoSaving, onSavePricingInfo, packages, packagesLoading, newPackageForm, setNewPackageForm, onCreatePackage, onTogglePackage, onDeletePackage }: {
  th: Theme;
  form: PricingForm;
  setForm: (v: PricingForm | ((p: PricingForm) => PricingForm)) => void;
  saving: boolean;
  onSaveDefault: () => void;
  onApplyAll: () => void;
  globalPricingInfo: string;
  setGlobalPricingInfo: (v: string) => void;
  pricingInfoSaving: boolean;
  onSavePricingInfo: () => void;
  packages: any[];
  packagesLoading: boolean;
  newPackageForm: { name: string; priceBdt: string; credits: string };
  setNewPackageForm: (v: any) => void;
  onCreatePackage: () => void;
  onTogglePackage: (id: number, isActive: boolean) => void;
  onDeletePackage: (id: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520 }}>
      <div style={{ ...th.card }}>
        <CardHeader th={th} title="Global Usage Pricing" sub="এই rates সব client এ একসাথে apply করা যাবে এবং Landing Page এ দেখাবে" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {PRICING_FIELDS.map(({ key, label, help }) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: th.text }}>{label}</label>
                <InfoButton text={help} th={th} />
              </div>
              <input
                type="number"
                min={0}
                step={1}
                style={{ ...th.input, width: '100%' }}
                value={form[key]}
                onChange={e => setForm((p: PricingForm) => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, padding: '12px 14px', background: th.accentSoft, borderRadius: 8, fontSize: 12.5, color: th.muted, lineHeight: 1.6 }}>
          <strong style={{ color: th.accent }}>কীভাবে কাজ করে:</strong><br />
          <strong>Default Save:</strong> Default pricing + <strong style={{ color: th.accent }}>Landing Page</strong> update হবে — নতুন client রা এই price পাবে।<br />
          <strong>সবার জন্য Apply:</strong> Default save + সব existing client এর pricing + <strong style={{ color: th.accent }}>Landing Page</strong> এখনই update হবে।<br />
          <strong>Messenger chatbot:</strong> প্রতিটি page এর নিজস্ব rate অনুযায়ী wallet থেকে কাটে।
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            style={{
              ...th.btnPrimary,
              flex: 1,
              padding: '12px 0',
              fontSize: 14,
              fontWeight: 700,
              background: saving ? th.muted : th.accent,
              border: 'none',
              borderRadius: 10,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            disabled={saving}
            onClick={onSaveDefault}
          >
            {saving ? <Spinner size={14} color="#fff" /> : <span>💾 Default Save</span>}
          </button>
          <button
            style={{
              ...th.btnPrimary,
              flex: 1,
              padding: '12px 0',
              fontSize: 14,
              fontWeight: 800,
              background: saving ? th.muted : 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
              boxShadow: saving ? 'none' : '0 4px 16px rgba(79, 70, 229, 0.35)',
              border: 'none',
              borderRadius: 10,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            disabled={saving}
            onClick={onApplyAll}
          >
            {saving ? <Spinner size={14} color="#fff" /> : <span>✨ সবার জন্য Apply</span>}
          </button>
        </div>
      </div>

      <div style={{ ...th.card }}>
        <CardHeader th={th} title="AI Text / SmartBot Reply — Fixed Tier" sub="Global, character-count based — এখানে editable না (code-এ hardcoded)" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {[
            { label: '0 – 3,000 characters', value: '10 credit' },
            { label: '3,001 – 5,000 characters', value: '11 credit' },
            { label: '5,001 – 7,000 characters', value: '12 credit' },
            { label: '7,001 – 9,000 characters', value: '13 credit' },
            { label: 'এরপর প্রতি +2,000 characters', value: '+1 credit' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, padding: '4px 0', borderBottom: `1px solid ${th.border}` }}>
              <span style={{ color: th.muted }}>{label}</span>
              <span style={{ color: th.text, fontWeight: 700 }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: th.muted, lineHeight: 1.6 }}>
          Character count = AI-কে পাঠানো system prompt (product name+description soho) + customer message + AI reply — সব মিলিয়ে।
        </div>
      </div>

      <div style={{ ...th.card }}>
        <CardHeader th={th} title="💳 Credit Packages" sub="Page owner রা এই fixed package গুলো কিনে recharge করতে পারবে" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {packagesLoading ? (
            <div style={{ textAlign: 'center', padding: 16 }}><Spinner size={18} /></div>
          ) : packages.length === 0 ? (
            <div style={{ fontSize: 12.5, color: th.muted, textAlign: 'center', padding: 12 }}>কোনো package নেই — নিচে থেকে যোগ করুন।</div>
          ) : packages.map((pkg: any) => (
            <div key={pkg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: `1px solid ${th.border}`, opacity: pkg.isActive ? 1 : 0.5 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{pkg.name || `Package #${pkg.id}`}</div>
                <div style={{ fontSize: 12, color: th.muted }}>৳{pkg.priceBdt.toLocaleString()} → {pkg.credits.toLocaleString()} credit</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => onTogglePackage(pkg.id, pkg.isActive)}
                  style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: `1px solid ${th.border}`, background: 'transparent', color: th.text, cursor: 'pointer' }}
                >{pkg.isActive ? 'Deactivate' : 'Activate'}</button>
                <button
                  onClick={() => onDeletePackage(pkg.id)}
                  style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #ef444455', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 }}>
          <input placeholder="Name (optional)" style={{ ...th.input }} value={newPackageForm.name}
            onChange={e => setNewPackageForm((p: any) => ({ ...p, name: e.target.value }))} />
          <input placeholder="৳ Price" type="number" style={{ ...th.input }} value={newPackageForm.priceBdt}
            onChange={e => setNewPackageForm((p: any) => ({ ...p, priceBdt: e.target.value }))} />
          <input placeholder="Credits" type="number" style={{ ...th.input }} value={newPackageForm.credits}
            onChange={e => setNewPackageForm((p: any) => ({ ...p, credits: e.target.value }))} />
        </div>
        <button
          onClick={onCreatePackage}
          style={{ marginTop: 10, width: '100%', padding: '10px 0', background: th.accent, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >+ Package যোগ করুন</button>
      </div>

      {/* Bot Pricing Info */}
      <div style={{ ...th.card }}>
        <CardHeader th={th} title="💰 Bot Pricing Text (Auto-Injected)" sub="এখানে যা লিখবেন bot সেটা মনে রেখে customer কে price বলবে — সব page এ global ভাবে apply হবে" />
        <div style={{ marginBottom: 10, padding: '10px 12px', background: th.accentSoft, borderRadius: 8, fontSize: 12, color: th.muted, lineHeight: 1.7 }}>
          Price change করলে শুধু এখানে update করুন → <strong style={{ color: th.accent }}>Save</strong> → bot পরের reply থেকেই নতুন price বলবে।<br />
          Individual page এ আলাদা pricing দিতে Bot Knowledge → 💰 Pricing Info ব্যবহার করুন।
        </div>
        <textarea
          value={globalPricingInfo}
          onChange={e => setGlobalPricingInfo(e.target.value)}
          rows={12}
          style={{ ...th.input, width: '100%', resize: 'vertical' as const, fontFamily: 'monospace', fontSize: 12.5, boxSizing: 'border-box' }}
          placeholder={'উদাহরণ:\n- Free trial: ১০০ AI reply/দিন\n- Paid: ৳০.১০/AI reply\n- Monthly base fee: ৳৬৯৯/মাস\n- একটা complete order conversation গড়ে ৳১ এরও কম'}
        />
        <button
          onClick={onSavePricingInfo}
          disabled={pricingInfoSaving}
          style={{
            marginTop: 10, padding: '10px 20px', background: th.accent, color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13,
            cursor: pricingInfoSaving ? 'not-allowed' : 'pointer', opacity: pricingInfoSaving ? 0.7 : 1,
          }}
        >{pricingInfoSaving ? 'Saving…' : '💾 Save Bot Pricing Text'}</button>
      </div>
    </div>
  );
}

// ── Admin Subscriptions Tab ───────────────────────────────────────────────────
function AdminSubscriptionsTab({ th, loading, pages, onRefresh, BASE, request, onToast, onReload }: {
  th: Theme; loading: boolean; pages: any[];
  onRefresh: () => void; BASE: string;
  request: (url: string, opts?: any) => Promise<any>;
  onToast: (m: string, t?: any) => void;
  onReload: () => void;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  const [forms, setForms] = useState<Record<number, { days: string; date: string }>>({});

  const now = new Date();

  const filtered = pages.filter(p =>
    !search || p.pageName?.toLowerCase().includes(search.toLowerCase()) ||
    p.owner?.username?.toLowerCase().includes(search.toLowerCase())
  );

  const getForm = (id: number) => forms[id] || { days: '30', date: '' };
  const setForm = (id: number, f: any) => setForms(prev => ({ ...prev, [id]: f }));

  const handleExtend = async (pageId: number) => {
    const f = getForm(pageId);
    const days = parseInt(f.days);
    if (!days || days <= 0) { onToast('দিনের সংখ্যা দিন', 'error'); return; }
    setSaving(pageId);
    try {
      await request(`${BASE}/subscriptions/${pageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ daysToAdd: days }),
      });
      onToast(`✅ ${days} দিন বাড়ানো হয়েছে`, 'success');
      onReload();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(null); }
  };

  const handleSetDate = async (pageId: number) => {
    const f = getForm(pageId);
    if (!f.date) { onToast('তারিখ দিন', 'error'); return; }
    setSaving(pageId);
    try {
      await request(`${BASE}/subscriptions/${pageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nextBillingDate: new Date(f.date).toISOString() }),
      });
      onToast('✅ Expiry date সেট হয়েছে', 'success');
      onReload();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(null); }
  };

  const handleToggleStatus = async (pageId: number, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setSaving(pageId);
    try {
      await request(`${BASE}/subscriptions/${pageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ subscriptionStatus: newStatus }),
      });
      onToast(`✅ Status → ${newStatus}`, 'success');
      onReload();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(null); }
  };

  const getDaysLeft = (nextBillingDate: string | null) => {
    if (!nextBillingDate) return null;
    const expiry = new Date(nextBillingDate);
    const diff = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
    return diff;
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1, fontSize: 16 }}>📅 Server Subscription Management</h3>
        <button style={th.btnGhost} onClick={onRefresh}>↻ Refresh</button>
      </div>
      <div style={{ fontSize: 13, color: th.muted, marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: th.surface }}>
        💡 প্রতিটি page এর server fee মেয়াদ এখান থেকে set করুন। মেয়াদ শেষ হলে bot automatically বন্ধ হয়ে যায়।
      </div>
      <input
        style={{ ...th.input, width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
        placeholder="Search page / username..."
        value={search} onChange={e => setSearch(e.target.value)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((p: any) => {
          const daysLeft = getDaysLeft(p.nextBillingDate);
          const expired = p.nextBillingDate && new Date(p.nextBillingDate) < now;
          const isSuspended = p.subscriptionStatus === 'SUSPENDED';
          const f = getForm(p.id);
          const isSaving = saving === p.id;
          const expiryStr = p.nextBillingDate ? new Date(p.nextBillingDate).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : 'সেট করা নেই';

          return (
            <div key={p.id} style={{
              borderRadius: 12, border: `1px solid ${expired || isSuspended ? '#ef444440' : th.border}`,
              background: expired || isSuspended ? 'rgba(239,68,68,0.06)' : (th.card as any).background,
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.pageName || p.pageId}</div>
                  {p.owner && <div style={{ fontSize: 11, color: th.muted }}>@{p.owner.username} · {p.owner.name}</div>}
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 9px', borderRadius: 99, fontWeight: 700,
                      background: isSuspended ? '#ef444422' : expired ? '#f9731622' : '#22c55e22',
                      color: isSuspended ? '#ef4444' : expired ? '#f97316' : '#16a34a',
                    }}>
                      {isSuspended ? '🔴 SUSPENDED' : expired ? '🟠 EXPIRED' : '🟢 ACTIVE'}
                    </span>
                    <span style={{ fontSize: 12, color: th.muted }}>
                      মেয়াদ: <strong style={{ color: expired ? '#ef4444' : th.text }}>{expiryStr}</strong>
                    </span>
                    {daysLeft !== null && !expired && (
                      <span style={{ fontSize: 12, color: daysLeft <= 2 ? '#ef4444' : daysLeft <= 7 ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>
                        ({daysLeft} দিন বাকি)
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Quick extend */}
                  <input
                    type="number" min={1} max={365}
                    style={{ ...th.input, width: 60, padding: '5px 8px', fontSize: 13, textAlign: 'center' }}
                    value={f.days}
                    onChange={e => setForm(p.id, { ...f, days: e.target.value })}
                    title="দিনের সংখ্যা"
                  />
                  <button
                    style={{ ...th.btnSmAccent, padding: '5px 12px', fontSize: 12 }}
                    disabled={isSaving}
                    onClick={() => handleExtend(p.id)}
                    title="এই পেজের expiry এক্সটেন্ড করুন"
                  >
                    {isSaving ? <Spinner size={12} /> : `+${f.days}d`}
                  </button>

                  {/* Set date */}
                  <input
                    type="date"
                    style={{ ...th.input, padding: '5px 8px', fontSize: 12 }}
                    value={f.date}
                    onChange={e => setForm(p.id, { ...f, date: e.target.value })}
                  />
                  <button
                    style={{ ...th.btnSmSuccess || th.btnSmAccent, padding: '5px 10px', fontSize: 12, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}
                    disabled={isSaving || !f.date}
                    onClick={() => handleSetDate(p.id)}
                  >
                    Set
                  </button>

                  {/* Suspend/Activate toggle */}
                  <button
                    style={{
                      padding: '5px 12px', fontSize: 12, borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700,
                      background: isSuspended ? '#16a34a' : '#ef4444', color: '#fff',
                    }}
                    disabled={isSaving}
                    onClick={() => handleToggleStatus(p.id, p.subscriptionStatus)}
                  >
                    {isSuspended ? '▶ Activate' : '⏸ Suspend'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Admin Agents Tab (create/manage resellers, set commission, record payouts) ──
function AdminAgentsTab({ th, loading, agents, newAgentForm, setNewAgentForm, onCreate, onUpdateRates, onToggleActive, onPayout }: {
  th: Theme; loading: boolean; agents: any[];
  newAgentForm: { username: string; password: string; name: string; commissionPercentRecharge: string; commissionPercentSubscription: string };
  setNewAgentForm: (v: any) => void;
  onCreate: () => void;
  onUpdateRates: (id: string, data: { commissionPercentRecharge?: number; commissionPercentSubscription?: number }) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onPayout: (id: string, amountBdt: number, note?: string) => void;
}) {
  const [rateEdits, setRateEdits] = useState<Record<string, { recharge: string; subscription: string }>>({});
  const [payoutForms, setPayoutForms] = useState<Record<string, { amount: string; note: string }>>({});

  const getRates = (a: any) => rateEdits[a.id] || {
    recharge: a.commissionPercentRecharge != null ? String(a.commissionPercentRecharge) : '',
    subscription: a.commissionPercentSubscription != null ? String(a.commissionPercentSubscription) : '',
  };
  const getPayoutForm = (id: string) => payoutForms[id] || { amount: '', note: '' };

  const card: React.CSSProperties = { ...th.card, borderRadius: 14, padding: 20, marginBottom: 16 };
  const inp: React.CSSProperties = { ...th.input, width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={card}>
        <CardHeader th={th} title="➕ নতুন Agent তৈরি করুন" sub="Agent তাদের referral link দিয়ে client onboard করবে এবং recharge/platform-fee-এর উপর commission পাবে" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <input style={inp} placeholder="Username" value={newAgentForm.username}
            onChange={e => setNewAgentForm((f: any) => ({ ...f, username: e.target.value }))} />
          <input style={inp} placeholder="Password" type="password" value={newAgentForm.password}
            onChange={e => setNewAgentForm((f: any) => ({ ...f, password: e.target.value }))} />
          <input style={inp} placeholder="Name (optional)" value={newAgentForm.name}
            onChange={e => setNewAgentForm((f: any) => ({ ...f, name: e.target.value }))} />
          <div />
          <input style={inp} placeholder="Recharge commission %" type="number" value={newAgentForm.commissionPercentRecharge}
            onChange={e => setNewAgentForm((f: any) => ({ ...f, commissionPercentRecharge: e.target.value }))} />
          <input style={inp} placeholder="Platform fee commission %" type="number" value={newAgentForm.commissionPercentSubscription}
            onChange={e => setNewAgentForm((f: any) => ({ ...f, commissionPercentSubscription: e.target.value }))} />
        </div>
        <button style={{ ...th.btnPrimary, marginTop: 14, padding: '10px 20px' }} onClick={onCreate}>+ Agent তৈরি করুন</button>
      </div>

      <div style={card}>
        <CardHeader th={th} title="🤝 সব Agent" sub={`মোট ${agents.length} জন agent`} />
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spinner size={20} /></div>
        ) : agents.length === 0 ? (
          <div style={{ textAlign: 'center', color: th.muted, padding: 24, fontSize: 13 }}>কোনো agent নেই।</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {agents.map((a: any) => {
              const rates = getRates(a);
              const pf = getPayoutForm(a.id);
              return (
                <div key={a.id} style={{ border: `1px solid ${th.border}`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>
                        {a.name || a.username} <span style={{ fontSize: 11, color: th.muted, fontWeight: 500 }}>@{a.username}</span>
                        {!a.isActive && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: '#ef4444', background: '#ef444422', padding: '2px 7px', borderRadius: 6 }}>SUSPENDED</span>}
                      </div>
                      <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>
                        Referral code: <b>{a.referralCode}</b> · {a.clientCount} client
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <div><span style={{ color: th.muted }}>Earned:</span> <b>৳{a.lifetimeEarnedBdt.toFixed(2)}</b></div>
                      <div><span style={{ color: th.muted }}>Paid:</span> <b>৳{a.lifetimePaidBdt.toFixed(2)}</b></div>
                      <div><span style={{ color: th.muted }}>Owed:</span> <b style={{ color: a.owedBalanceBdt > 0 ? '#16a34a' : th.text }}>৳{a.owedBalanceBdt.toFixed(2)}</b></div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, color: th.muted, textTransform: 'uppercase' }}>Recharge %</label>
                      <input style={inp} type="number" value={rates.recharge}
                        onChange={e => setRateEdits(prev => ({ ...prev, [a.id]: { ...rates, recharge: e.target.value } }))}
                        onBlur={() => onUpdateRates(a.id, { commissionPercentRecharge: Number(rates.recharge) || 0 })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: th.muted, textTransform: 'uppercase' }}>Platform Fee %</label>
                      <input style={inp} type="number" value={rates.subscription}
                        onChange={e => setRateEdits(prev => ({ ...prev, [a.id]: { ...rates, subscription: e.target.value } }))}
                        onBlur={() => onUpdateRates(a.id, { commissionPercentSubscription: Number(rates.subscription) || 0 })} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        onClick={() => onToggleActive(a.id, a.isActive)}
                        style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${th.border}`, background: 'transparent', color: th.text, cursor: 'pointer', width: '100%' }}
                      >{a.isActive ? 'Suspend' : 'Activate'}</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input style={{ ...inp, width: 120 }} placeholder="৳ Amount" type="number" value={pf.amount}
                      onChange={e => setPayoutForms(prev => ({ ...prev, [a.id]: { ...pf, amount: e.target.value } }))} />
                    <input style={{ ...inp, width: 200 }} placeholder="Note (optional)" value={pf.note}
                      onChange={e => setPayoutForms(prev => ({ ...prev, [a.id]: { ...pf, note: e.target.value } }))} />
                    <button
                      onClick={() => onPayout(a.id, Number(pf.amount), pf.note)}
                      style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', background: th.accent, color: '#fff', cursor: 'pointer' }}
                    >💸 Record Payout</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Self-Service: My Clients Tab ───────────────────────────────────────
function AgentClientsTab({ th, loading, clients }: { th: Theme; loading: boolean; clients: any[] }) {
  const card: React.CSSProperties = { ...th.card, borderRadius: 14, padding: 20 };
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={card}>
        <CardHeader th={th} title="👥 আমার Clients" sub="আপনার referral link দিয়ে signup করা client এবং তাদের page" />
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spinner size={20} /></div>
        ) : clients.length === 0 ? (
          <div style={{ textAlign: 'center', color: th.muted, padding: 24, fontSize: 13 }}>এখনো কোনো client নেই — নিচের referral link share করুন।</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {clients.map((c: any) => (
              <div key={c.id} style={{ border: `1px solid ${th.border}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {c.name || c.username} <span style={{ fontSize: 11, color: th.muted, fontWeight: 500 }}>@{c.username}</span>
                  {!c.isActive && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: '#ef4444' }}>INACTIVE</span>}
                </div>
                {c.pages.length === 0 ? (
                  <div style={{ fontSize: 12, color: th.muted, marginTop: 4 }}>এখনো কোনো page connect করেনি।</div>
                ) : c.pages.map((p: any) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, padding: '6px 0', borderTop: `1px solid ${th.border}` }}>
                    <span>{p.pageName || p.pageId}</span>
                    <span style={{ color: th.muted }}>{p.subscriptionStatus} · {Math.round(p.creditBalance)} credit</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Self-Service: Earnings Tab ─────────────────────────────────────────
function AgentEarningsTab({ th, loading, profile, earnings, payouts }: {
  th: Theme; loading: boolean; profile: any; earnings: any[]; payouts: any[];
}) {
  const [copied, setCopied] = useState(false);
  const card: React.CSSProperties = { ...th.card, borderRadius: 14, padding: 20, marginBottom: 16 };

  const copyLink = () => {
    if (!profile?.referralLink) return;
    navigator.clipboard.writeText(profile.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || !profile) return <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22} /></div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ ...card, background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>💰 Owed Balance</div>
        <div style={{ fontSize: 36, fontWeight: 900 }}>৳{profile.owedBalanceBdt.toFixed(2)}</div>
        <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          <div>Lifetime Earned: ৳{profile.lifetimeEarnedBdt.toFixed(2)}</div>
          <div>Lifetime Paid: ৳{profile.lifetimePaidBdt.toFixed(2)}</div>
          <div>Clients: {profile.clientCount}</div>
        </div>
      </div>

      <div style={card}>
        <CardHeader th={th} title="🔗 আমার Referral Link" sub="এই link দিয়ে signup করলে client automatically আপনার account-এ যুক্ত হবে" />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <code style={{ ...th.input, flex: 1, minWidth: 220, padding: '10px 14px', fontSize: 12.5, overflow: 'auto', whiteSpace: 'nowrap' }}>
            {profile.referralLink || '—'}
          </code>
          <button onClick={copyLink} style={{ padding: '10px 18px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: 'none', background: copied ? '#16a34a' : th.accent, color: '#fff', cursor: 'pointer' }}>
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, fontSize: 12.5 }}>
          <div><span style={{ color: th.muted }}>Recharge commission:</span> <b>{profile.commissionPercentRecharge ?? 0}%</b></div>
          <div><span style={{ color: th.muted }}>Platform fee commission:</span> <b>{profile.commissionPercentSubscription ?? 0}%</b></div>
        </div>
      </div>

      <div style={card}>
        <CardHeader th={th} title="📜 Earnings History" sub={`সর্বশেষ ${earnings.length} টি`} />
        {earnings.length === 0 ? (
          <div style={{ textAlign: 'center', color: th.muted, padding: 20, fontSize: 13 }}>কোনো earning নেই।</div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {earnings.map((e: any) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.08)' }}>
                <span>{e.sourceType === 'RECHARGE' ? '💳 Recharge' : '📅 Platform Fee'} · ৳{e.grossAmountBdt} × {e.commissionPercent}%</span>
                <span style={{ fontWeight: 700, color: '#16a34a' }}>+৳{e.commissionAmountBdt.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <CardHeader th={th} title="💸 Payout History" sub={`সর্বশেষ ${payouts.length} টি`} />
        {payouts.length === 0 ? (
          <div style={{ textAlign: 'center', color: th.muted, padding: 20, fontSize: 13 }}>এখনো কোনো payout হয়নি।</div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {payouts.map((p: any) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                <span>{p.note || 'Payout'} · {new Date(p.createdAt).toLocaleDateString('en-BD')}</span>
                <span style={{ fontWeight: 700 }}>৳{p.amountBdt.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Admin Customers Tab ───────────────────────────────────────────────────────
function AdminCustomersTab({ th, data, loading, search, offset, limit, onSearch, onPage, BASE }: {
  th: Theme;
  data: { total: number; items: any[] };
  loading: boolean;
  search: string;
  offset: number;
  limit: number;
  onSearch: (s: string) => void;
  onPage: (o: number) => void;
  BASE: string;
}) {
  const [searchInput, setSearchInput] = useState(search);
  const [downloading, setDownloading] = useState(false);

  const downloadExcel = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const res = await fetch(`${BASE}/syslog/snapshot`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `registry-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDownloading(false);
    }
  };

  const totalPages = Math.ceil(data.total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const COL: { label: string; key: string; width?: number }[] = [
    { label: '#',            key: '_no',          width: 48 },
    { label: 'Name',         key: 'name',         width: 160 },
    { label: 'Phone',        key: 'phone',        width: 130 },
    { label: 'FB ID',        key: 'psid',         width: 160 },
    { label: 'Address',      key: 'address',      width: 200 },
    { label: 'Page',         key: '_page',        width: 140 },
    { label: 'Client',       key: '_client',      width: 110 },
    { label: 'Orders',       key: 'totalOrders',  width: 70 },
    { label: 'Joined',       key: '_joined',      width: 110 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: th.text }}>🧑‍🤝‍🧑 সব Client এর Customer ({data.total.toLocaleString()})</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...th.input, width: 220, padding: '7px 12px', fontSize: 13 }}
            placeholder="নাম / ফোন / FB ID খুঁজুন..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearch(searchInput); }}
          />
          <button style={{ ...th.btnPrimary, padding: '7px 16px', fontSize: 13 }} onClick={() => onSearch(searchInput)}>
            Search
          </button>
          {search && (
            <button style={{ ...th.btnGhost, padding: '7px 12px', fontSize: 13 }} onClick={() => { setSearchInput(''); onSearch(''); }}>
              Clear
            </button>
          )}
          <button
            style={{ padding: '7px 16px', fontSize: 13, background: '#16a34a', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', fontWeight: 700, opacity: downloading ? 0.7 : 1, fontFamily: 'inherit' }}
            onClick={downloadExcel}
            disabled={downloading}
          >
            {downloading ? '...' : '⬇ Excel Download'}
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22} /></div>
      ) : data.items.length === 0 ? (
        <EmptyState icon="🔍" title="কোনো তথ্য পাওয়া যায়নি" />
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${th.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: th.surface }}>
                {COL.map(c => (
                  <th key={c.key} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: th.muted, borderBottom: `1px solid ${th.border}`, whiteSpace: 'nowrap', width: c.width }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${th.border}`, background: i % 2 === 0 ? 'transparent' : th.surface }}>
                  <td style={{ padding: '9px 12px', color: th.muted, fontWeight: 600 }}>{offset + i + 1}</td>
                  <td style={{ padding: '9px 12px', color: th.text, fontWeight: 600 }}>{c.name || <span style={{ color: th.muted }}>—</span>}</td>
                  <td style={{ padding: '9px 12px', color: th.text, fontFamily: 'monospace' }}>{c.phone || <span style={{ color: th.muted }}>—</span>}</td>
                  <td style={{ padding: '9px 12px', color: th.muted, fontSize: 11, fontFamily: 'monospace' }}>{c.psid}</td>
                  <td style={{ padding: '9px 12px', color: th.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address || <span style={{ color: th.muted }}>—</span>}</td>
                  <td style={{ padding: '9px 12px', color: th.text, fontWeight: 600 }}>{c.page?.pageName || '—'}</td>
                  <td style={{ padding: '9px 12px', color: th.muted }}>{c.page?.owner?.username || '—'}</td>
                  <td style={{ padding: '9px 12px', color: th.text, textAlign: 'center' }}>{c.totalOrders}</td>
                  <td style={{ padding: '9px 12px', color: th.muted, fontSize: 12 }}>{c.createdAt ? new Date(c.createdAt).toLocaleDateString('bn-BD') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data.total > limit && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 4 }}>
          <button
            style={{ ...th.btnGhost, padding: '6px 14px', fontSize: 13 }}
            disabled={offset === 0}
            onClick={() => onPage(Math.max(0, offset - limit))}
          >
            ← আগে
          </button>
          <span style={{ fontSize: 13, color: th.muted, fontWeight: 600 }}>
            {currentPage} / {totalPages} ({data.total.toLocaleString()} জন)
          </span>
          <button
            style={{ ...th.btnGhost, padding: '6px 14px', fontSize: 13 }}
            disabled={offset + limit >= data.total}
            onClick={() => onPage(offset + limit)}
          >
            পরে →
          </button>
        </div>
      )}
    </div>
  );
}


// ── Payment Gateway Section ────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { key: 'bkash', label: 'bKash (Direct API)', type: 'direct', fields: [
    { key: 'app_key', label: 'App Key', ph: 'bKash App Key' },
    { key: 'app_secret', label: 'App Secret', ph: 'bKash App Secret' },
    { key: 'username', label: 'Username', ph: 'bKash Username' },
    { key: 'password', label: 'Password', ph: 'bKash Password', secret: true },
  ]},
  { key: 'nagad', label: 'Nagad (Direct API)', type: 'direct', fields: [
    { key: 'merchant_id', label: 'Merchant ID', ph: 'Nagad Merchant ID' },
    { key: 'api_key', label: 'API Key', ph: 'Nagad API Key', secret: true },
  ]},
  { key: 'sslcommerz', label: 'SSLCommerz Gateway', type: 'gateway', fields: [
    { key: 'store_id', label: 'Store ID', ph: 'SSLCommerz Store ID' },
    { key: 'store_passwd', label: 'Store Password', ph: 'SSLCommerz Store Password', secret: true },
  ]},
  { key: 'shurjopay', label: 'ShurjoPay Gateway', type: 'gateway', fields: [
    { key: 'username', label: 'Username', ph: 'ShurjoPay Username' },
    { key: 'password', label: 'Password', ph: 'ShurjoPay Password', secret: true },
    { key: 'prefix', label: 'Prefix', ph: 'e.g. SP' },
  ]},
  { key: 'zinipay', label: 'ZiniPay Gateway', type: 'gateway', fields: [
    { key: 'store_id', label: 'Store ID', ph: 'ZiniPay Store ID' },
    { key: 'api_key', label: 'API Key', ph: 'ZiniPay API Key', secret: true },
  ]},
];

function PaymentGatewaySection({ th, pageId, request }: { th: any; pageId: number; request: any }) {
  const BASE = (window as any).__API_BASE__ || '';
  const [configured, setConfigured] = useState<string[]>([]);
  const [selected, setSelected] = useState('bkash');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [sandbox, setSandbox] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    request(`${BASE}/pages/${pageId}/payment-credentials`)
      .then((r: any) => {
        if (Array.isArray(r)) setConfigured(r.filter((x: any) => x.isActive).map((x: any) => x.method));
      })
      .catch(() => {});
  }, [pageId]);

  const selectedDef = PAYMENT_METHODS.find(m => m.key === selected)!;

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await request(`${BASE}/pages/${pageId}/payment-credentials`, {
        method: 'POST',
        body: JSON.stringify({
          method: selected,
          credentials: { ...creds, sandbox: sandbox ? 'true' : 'false' },
          isActive: true,
        }),
      });
      setConfigured(prev => prev.includes(selected) ? prev : [...prev, selected]);
      setMsg({ ok: true, text: 'Credentials saved!' });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || 'Failed' });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setMsg(null);
    try {
      const r = await request(`${BASE}/pages/${pageId}/payment-credentials/${selected}/test`, { method: 'POST' });
      setMsg({ ok: r.ok, text: r.message });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || 'Test failed' });
    } finally { setTesting(false); }
  };

  const handleRemove = async (method: string) => {
    await request(`${BASE}/pages/${pageId}/payment-credentials/${method}`, { method: 'DELETE' });
    setConfigured(prev => prev.filter(m => m !== method));
  };

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        Auto Payment Verification
      </div>
      {configured.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {configured.map(m => (
            <div key={m} style={{ ...th.card2, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ color: '#22c55e' }}>✓</span> {m.toUpperCase()}
              <button onClick={() => handleRemove(m)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.muted, fontSize: 13, padding: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ ...th.card2, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>Payment Method</div>
          <select style={th.input} value={selected} onChange={e => { setSelected(e.target.value); setCreds({}); setMsg(null); }}>
            {PAYMENT_METHODS.map(m => (
              <option key={m.key} value={m.key}>{m.label} {configured.includes(m.key) ? '✓' : ''}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {selectedDef.fields.map(f => (
            <div key={f.key}>
              <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 4, textTransform: 'uppercase' }}>{f.label}</div>
              <input
                style={th.input}
                type={(f as any).secret ? 'password' : 'text'}
                placeholder={f.ph}
                value={creds[f.key] ?? ''}
                onChange={e => setCreds(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} />
          Sandbox / Test Mode
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...th.btnPrimary, padding: '8px 18px', fontSize: 13 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <button style={{ ...th.btnGhost, padding: '8px 18px', fontSize: 13 }} onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : '🔌 Test Connection'}
          </button>
        </div>
        {msg && (
          <div style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? '#22c55e' : '#ef4444' }}>
            {msg.ok ? '✓' : '✗'} {msg.text}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: th.muted, marginTop: 8 }}>
        <strong>Direct API</strong> (bKash/Nagad): Customer transaction ID automatically verify হবে।{' '}
        <strong>Gateway</strong> (SSLCommerz/ShurjoPay/ZiniPay): Bot payment link পাঠাবে।
      </div>
    </div>
  );
}

// ── Admin Payment Setup Component ─────────────────────────────────────────
function AdminPaymentSetup({ th, cfg, setCfg, activeTab, setActiveTab, smsLog, adminSmsDevices, saving, onSave }: {
  th: Theme; cfg: any; setCfg: (v: any) => void;
  activeTab: string; setActiveTab: (t: any) => void;
  smsLog: any[]; adminSmsDevices: any[]; saving: boolean; onSave: () => void;
}) {
  const inp = { ...th.input, marginTop: 4 };
  const [tokenCopied, setTokenCopied] = (useState as any)(false);
  const TABS = [
    { key: 'sms',    icon: '📲', label: 'SMS Gateway',  color: '#8b5cf6' },
    { key: 'bkash',  icon: '💜', label: 'bKash API',    color: '#e11d9b' },
    { key: 'nagad',  icon: '🟠', label: 'Nagad API',    color: '#f97316' },
    { key: 'manual', icon: '✍️', label: 'Manual Only',  color: '#6b7280' },
  ];
  return (
    <div style={{ ...th.card, marginTop: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: th.text }}>💳 আমার Payment System</div>
        <div style={{ fontSize: 12.5, color: th.muted, marginTop: 3 }}>
          Users কীভাবে আপনাকে payment করে wallet recharge করবে তা setup করুন।
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{ padding: '7px 14px', borderRadius: 20, border: `1.5px solid ${activeTab === t.key ? t.color : th.border}`,
              background: activeTab === t.key ? t.color + '18' : 'transparent',
              color: activeTab === t.key ? t.color : th.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'sms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#8b5cf618', border: '1px solid #8b5cf640', borderRadius: 10, padding: 12, fontSize: 13, color: th.text }}>
            📲 আপনার ফোনে FlamboyAI PaySync app install করুন → Secret Token দিয়ে connect করুন → আপনার bKash/Nagad/Rocket-এ payment এলে bot auto-verify করবে।
          </div>

          {/* Step 1 — Download App */}
          <div style={{ borderRadius: 10, padding: '12px 14px', background: '#8b5cf610', border: '1px solid #8b5cf630' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 8 }}>📱 ধাপ ১ — App ডাউনলোড করুন</div>
            <div style={{ fontSize: 12, color: th.muted, marginBottom: 10, lineHeight: 1.6 }}>
              যে ফোনে bKash/Nagad/Rocket-এর payment SMS আসে সেই Android ফোনে নিচের app install করুন।
            </div>
            <div style={{ padding: '7px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 11.5, color: '#92400e', marginBottom: 10, lineHeight: 1.6 }}>
              ⚠️ এই app গুলো Google Play Store-এ নেই। GitHub থেকে APK download করে install করুন। Install-এর সময় "Unknown Sources" allow করুন।
            </div>
            {[
              { name: 'FlamboyAI PaySync', badge: '⭐ Official (Recommended)', badgeColor: '#10b981', desc: 'FlamboyAI-এর নিজস্ব app। সবচেয়ে সহজ।', url: `${API_BASE}/storage/downloads/FlamboyAI-paysync.apk`, btn: '⬇ APK Download', btnColor: '#10b981' },
            ].map(app => (
              <div key={app.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, background: th.surface, border: `1px solid ${th.border}`, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5, color: th.text }}>{app.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: app.badgeColor + '20', color: app.badgeColor }}>{app.badge}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: th.muted }}>{app.desc}</div>
                </div>
                <a href={app.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 7, background: app.btnColor, color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  {app.btn}
                </a>
              </div>
            ))}
          </div>

          {/* Step 2 — Token + Webhook URL */}
          <div style={{ borderRadius: 10, padding: '12px 14px', background: '#8b5cf610', border: '1px solid #8b5cf630' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 8 }}>🔑 ধাপ ২ — Secret Token তৈরি করুন</div>
            <div style={{ fontSize: 11, color: th.muted, fontWeight: 600, marginBottom: 4 }}>Secret Token</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inp, flex: 1 }} value={cfg.smsGatewayToken || ''} placeholder="Random secret string"
                onChange={e => setCfg({ ...cfg, smsGatewayToken: e.target.value })} />
              <button style={{ ...th.btnGhost, whiteSpace: 'nowrap', fontSize: 12, background: tokenCopied ? '#10b98120' : undefined, color: tokenCopied ? '#10b981' : undefined }}
                onClick={() => { if (cfg.smsGatewayToken) { navigator.clipboard.writeText(cfg.smsGatewayToken); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000); } }}>
                {tokenCopied ? '✅ Copied!' : '📋 Copy'}
              </button>
              <button style={{ ...th.btnGhost, whiteSpace: 'nowrap', fontSize: 12 }}
                onClick={() => setCfg({ ...cfg, smsGatewayToken: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) })}>
                🔄 Generate
              </button>
            </div>
          </div>

          {/* Step 3 — Connect in app */}
          <div style={{ borderRadius: 10, padding: '12px 14px', background: '#8b5cf610', border: '1px solid #8b5cf630' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 8 }}>⚙️ ধাপ ৩ — App-এ connect করুন</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {['App install করে open করুন → সব permission allow করুন', 'App-এ উপরের Secret Token paste করে ADD চাপুন — connected হলে নিচে device দেখাবে', '⚠️ Battery Optimization OFF করুন — ফোন lock থাকলেও SMS আসবে'].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: '#8b5cf620', color: '#8b5cf6', fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: th.muted }}>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Connected Devices — always visible */}
          <div style={{ borderRadius: 10, padding: '12px 14px', background: '#8b5cf610', border: '1px solid #8b5cf630' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: th.text, marginBottom: 8 }}>📱 Connected Devices</div>
            {adminSmsDevices.length === 0 ? (
              <div style={{ fontSize: 12, color: th.muted, textAlign: 'center', padding: '10px 0' }}>
                কোনো device connect হয়নি। App install করে Secret Token দিন।
              </div>
            ) : adminSmsDevices.map((d: any) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: th.surface, border: `1px solid ${d.isActive ? '#10b98133' : th.border}`, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>📱</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: th.text }}>{d.deviceName}</div>
                  {d.deviceModel && <div style={{ fontSize: 11, color: th.muted }}>{d.deviceModel}</div>}
                  <div style={{ fontSize: 10.5, color: th.muted, marginTop: 1 }}>সর্বশেষ: {new Date(d.lastSeenAt).toLocaleString('bn-BD')}</div>
                </div>
                <div style={{ fontSize: 11, color: d.isActive ? '#10b981' : '#ef4444', fontWeight: 700 }}>{d.isActive ? '● Connected' : '○ Disconnected'}</div>
              </div>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: adminSmsDevices.length === 0 && !cfg.smsGatewayEnabled ? 'not-allowed' : 'pointer', opacity: adminSmsDevices.length === 0 && !cfg.smsGatewayEnabled ? 0.5 : 1 }}
            title={adminSmsDevices.length === 0 && !cfg.smsGatewayEnabled ? 'আগে একটি device connect করুন' : ''}>
            <input type="checkbox" checked={!!cfg.smsGatewayEnabled}
              onChange={e => {
                if (e.target.checked && adminSmsDevices.length === 0) return;
                setCfg({ ...cfg, smsGatewayEnabled: e.target.checked });
              }} disabled={!cfg.smsGatewayEnabled && adminSmsDevices.length === 0} />
            <span style={{ fontWeight: 700, color: th.text }}>SMS Gateway চালু করুন</span>
            {!cfg.smsGatewayEnabled && adminSmsDevices.length === 0 && (
              <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>— আগে device connect করুন</span>
            )}
          </label>
          {smsLog.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: th.muted, fontWeight: 600, marginBottom: 6 }}>সাম্প্রতিক Received SMS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                {smsLog.map((s: any, i: number) => (
                  <div key={i} style={{ ...th.card2, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: s.matched ? '#22c55e22' : '#f59e0b22', color: s.matched ? '#16a34a' : '#d97706', borderRadius: 6, padding: '2px 7px', fontWeight: 700, fontSize: 11 }}>
                      {s.matched ? '✓ Used' : '⏳ New'}
                    </span>
                    <span style={{ color: th.text, fontWeight: 600 }}>{String(s.method || '').toUpperCase()}</span>
                    <span style={{ color: th.muted }}>৳{s.amount}</span>
                    <span style={{ color: '#8b5cf6', fontFamily: 'monospace' }}>{s.txId || '—'}</span>
                    <span style={{ color: th.muted, marginLeft: 'auto', fontSize: 11 }}>{new Date(s.receivedAt).toLocaleTimeString('bn-BD')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'bkash' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#e11d9b18', border: '1px solid #e11d9b40', borderRadius: 10, padding: 12, fontSize: 13, color: th.text }}>
            💜 bKash Merchant API credentials দিন — user TxID submit করলে auto-verify হবে।
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.bkashEnabled} onChange={e => setCfg({ ...cfg, bkashEnabled: e.target.checked })} />
            <span style={{ fontWeight: 700, color: th.text }}>bKash Direct API চালু করুন</span>
          </label>
          {(['bkashUsername', 'bkashAppKey', 'bkashAppSecret', 'bkashPassword'] as const).map(k => (
            <div key={k}>
              <div style={{ fontSize: 11, color: th.muted, fontWeight: 600 }}>{k.replace('bkash', '').replace(/([A-Z])/g, ' $1').trim()}</div>
              <input style={inp} type={k.includes('Secret') || k.includes('Password') ? 'password' : 'text'}
                value={cfg[k] || ''} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} />
            </div>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={!!cfg.bkashSandbox} onChange={e => setCfg({ ...cfg, bkashSandbox: e.target.checked })} />
            <span style={{ color: th.muted }}>Sandbox mode (testing)</span>
          </label>
        </div>
      )}

      {activeTab === 'nagad' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#f9730018', border: '1px solid #f9730040', borderRadius: 10, padding: 12, fontSize: 13, color: th.text }}>
            🟠 Nagad Merchant API credentials দিন — user TxID submit করলে auto-verify হবে।
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.nagadEnabled} onChange={e => setCfg({ ...cfg, nagadEnabled: e.target.checked })} />
            <span style={{ fontWeight: 700, color: th.text }}>Nagad Direct API চালু করুন</span>
          </label>
          {(['nagadMerchantId', 'nagadMerchantPrivateKey', 'nagadApiBaseUrl'] as const).map(k => (
            <div key={k}>
              <div style={{ fontSize: 11, color: th.muted, fontWeight: 600 }}>{k.replace('nagad', '').replace(/([A-Z])/g, ' $1').trim()}</div>
              <input style={inp} type={k.includes('Key') ? 'password' : 'text'}
                value={cfg[k] || ''} placeholder={k === 'nagadApiBaseUrl' ? 'https://api.mynagad.com' : ''}
                onChange={e => setCfg({ ...cfg, [k]: e.target.value })} />
            </div>
          ))}
        </div>
      )}

      {activeTab === 'manual' && (
        <div style={{ background: th.surface, borderRadius: 10, padding: 14, fontSize: 13.5, color: th.muted, lineHeight: 1.7, border: `1px solid ${th.border}` }}>
          ✍️ <strong style={{ color: th.text }}>Manual mode</strong> — user TxID submit করবে, আপনি Wallet tab থেকে manually approve করবেন। এটা সবসময় available।
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button style={{ ...th.btnPrimary, opacity: saving ? 0.7 : 1 }} onClick={onSave} disabled={saving}>
          {saving ? '⏳ Saving…' : '💾 Save Payment Config'}
        </button>
      </div>
    </div>
  );
}
