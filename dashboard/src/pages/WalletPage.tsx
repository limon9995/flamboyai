import { useCallback, useEffect, useState } from 'react';
import { CardHeader, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildWaUrl(raw?: string | null) {
  const d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('880')) return `https://wa.me/${d}`;
  if (d.startsWith('0')) return `https://wa.me/88${d}`;
  return `https://wa.me/${d}`;
}

const METHOD_LABELS: Record<string, string> = {
  bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank Transfer', manual: 'Manual',
};

const METHODS = [
  { key: 'bkash',  label: 'bKash',  icon: '💚', color: '#E2136E', bg: '#fce7f3', light: '#fdf2f8' },
  { key: 'nagad',  label: 'Nagad',  icon: '🟠', color: '#F7941D', bg: '#fff7ed', light: '#fffbf5' },
  { key: 'rocket', label: 'Rocket', icon: '🟣', color: '#8B3FC7', bg: '#f5f3ff', light: '#faf5ff' },
  { key: 'bank',   label: 'Bank',   icon: '🏦', color: '#1d4ed8', bg: '#eff6ff', light: '#f0f9ff' },
] as const;

const TYPE_LABELS: Record<string, string> = {
  RECHARGE: '+ রিচার্জ',
  DEDUCT_TEXT: '− বট রিপ্লাই',
  DEDUCT_VOICE: '− ভয়েস প্রসেস',
  DEDUCT_IMAGE: '− ছবি শনাক্ত',
  DEDUCT_IMAGE_LOCAL: '− ছবি শনাক্ত',
  DEDUCT_IMAGE_OCR: '− OCR স্ক্যান',
  DEDUCT_ADMIN_VISION: '− পণ্য বিশ্লেষণ',
  DEDUCT_IMAGE_UNIQUENESS: '− পণ্য যাচাই',
  DEDUCT_AI_GENERATE: '− AI কন্টেন্ট',
  DEDUCT_DUAL_PHOTO_AI: '− ডুয়েল ফটো AI',
  DEDUCT_SMART_BOT: '− স্মার্ট বট',
  DEDUCT_MEMO_PRINT: '− মেমো প্রিন্ট',
  DEDUCT_KEYWORD_REPLY: '− কীওয়ার্ড বট',
  DEDUCT_COMMENT_REPLY: '− কমেন্ট রিপ্লাই',
  DEDUCT_BROADCAST: '− ব্রডকাস্ট',
  DEDUCT_BASE_FEE: '− মাসিক ফি',
  DEDUCT_FIXED: '− চার্জ',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', approved: '#16a34a', rejected: '#ef4444',
};

// ── RechargeFlow ─────────────────────────────────────────────────────────────

function RechargeFlow({
  th, adminContact, paymentConfig, form, setForm, submitting, submitResult,
  setSubmitResult, onSubmit, copiedKey, copyText, inp, card, packages, creditsPerBdt,
}: {
  th: Theme; pageId: number; adminContact: any; paymentConfig: any;
  form: any; setForm: any; submitting: boolean;
  submitResult: 'auto' | 'manual' | null; setSubmitResult: any;
  onSubmit: () => void; copiedKey: string | null;
  copyText: (k: string, v: string) => void;
  inp: React.CSSProperties; card: React.CSSProperties;
  packages: any[]; creditsPerBdt: number;
}) {
  const smsAuto = paymentConfig?.smsGatewayEnabled;
  const m = METHODS.find(x => x.key === form.method) || METHODS[0];
  const waUrl = adminContact?.whatsappUrl || buildWaUrl(adminContact?.phone);
  const selectedPackage = packages.find((p: any) => p.id === form.packageId) || null;
  const previewCredits = selectedPackage
    ? selectedPackage.credits
    : Math.round((Number(form.amountBdt) || 0) * creditsPerBdt);

  const mobileNum =
    form.method === 'bkash'  ? (adminContact?.bkash  || adminContact?.phone || '')
    : form.method === 'nagad'  ? (adminContact?.nagad  || '')
    : form.method === 'rocket' ? (adminContact?.rocket || '')
    : '';

  const CopyBtn = ({ k, val }: { k: string; val: string }) => {
    const copied = copiedKey === k;
    return (
      <button type="button" onClick={() => val && copyText(k, val)} style={{
        background: copied ? '#16a34a18' : m.color + '18',
        border: `1px solid ${copied ? '#16a34a40' : m.color + '40'}`,
        borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
        fontSize: 12, color: copied ? '#16a34a' : m.color, fontWeight: 700,
        whiteSpace: 'nowrap', transition: 'all 0.2s', flexShrink: 0,
      }}>{copied ? '✓ Copied!' : '📋 Copy'}</button>
    );
  };

  // Success screen
  if (submitResult) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>
          {submitResult === 'auto' ? '✅' : '⏳'}
        </div>
        <div style={{ fontSize: 20, fontWeight: 900, color: submitResult === 'auto' ? '#16a34a' : th.text, marginBottom: 8 }}>
          {submitResult === 'auto' ? 'Balance যোগ হয়েছে!' : 'Request জমা হয়েছে!'}
        </div>
        <div style={{ fontSize: 14, color: th.muted, marginBottom: 24, lineHeight: 1.6 }}>
          {submitResult === 'auto'
            ? 'আপনার payment auto-verify হয়েছে। Balance এখনই wallet এ যোগ হয়ে গেছে।'
            : 'আপনার recharge request পাঠানো হয়েছে। Admin approve করলে balance যোগ হবে।'}
        </div>
        <button onClick={() => setSubmitResult(null)} style={{
          border: 'none', borderRadius: 12, padding: '12px 32px',
          background: 'linear-gradient(135deg,#1d4ed8,#2563eb)',
          color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>আরেকটি Recharge করুন</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Step 0: Package ── */}
      <div style={{ ...card, padding: '16px', marginBottom: 0 }}>
        <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          ধাপ ০ — কত Credit চান বেছে নিন
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {packages.map((pkg: any) => {
            const sel = form.packageId === pkg.id;
            return (
              <button key={pkg.id} onClick={() => setForm((f: any) => ({ ...f, packageId: pkg.id, amountBdt: String(pkg.priceBdt) }))} style={{
                border: `2px solid ${sel ? th.accent : (th.border as string)}`,
                borderRadius: 12, padding: '12px 10px', cursor: 'pointer',
                background: sel ? `${th.accent}18` : (th.card as any).background,
                textAlign: 'left',
              }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: th.text }}>{pkg.name || `Package`}</div>
                <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>৳{pkg.priceBdt.toLocaleString()}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: th.accent, marginTop: 4 }}>{pkg.credits.toLocaleString()} credit</div>
              </button>
            );
          })}
          <button onClick={() => setForm((f: any) => ({ ...f, packageId: null, amountBdt: '' }))} style={{
            border: `2px solid ${form.packageId === null ? th.accent : (th.border as string)}`,
            borderRadius: 12, padding: '12px 10px', cursor: 'pointer',
            background: form.packageId === null ? `${th.accent}18` : (th.card as any).background,
            textAlign: 'left',
          }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: th.text }}>Custom Amount</div>
            <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>নিজের মতো টাকা লিখুন</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: th.accent, marginTop: 4 }}>1 ৳ = {creditsPerBdt} credit</div>
          </button>
        </div>
      </div>

      {/* ── Step 1: Method ── */}
      <div style={{ ...card, padding: '16px', marginBottom: 0 }}>
        <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          ধাপ ১ — Payment Method বেছে নিন
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {METHODS.map(opt => {
            const sel = form.method === opt.key;
            return (
              <button key={opt.key} onClick={() => setForm((f: any) => ({ ...f, method: opt.key }))} style={{
                border: `2px solid ${sel ? opt.color : (th.border as string)}`,
                borderRadius: 12, padding: '10px 6px', cursor: 'pointer',
                background: sel ? opt.color + '15' : (th.card as any).background,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                transition: 'all 0.15s',
                boxShadow: sel ? `0 0 0 3px ${opt.color}22` : 'none',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: sel ? opt.color : opt.color + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 900, fontSize: opt.key === 'bank' ? 18 : 11,
                  color: sel ? '#fff' : opt.color,
                }}>
                  {opt.key === 'bkash' ? 'bK' : opt.key === 'nagad' ? 'Ng' : opt.key === 'rocket' ? 'Rk' : '🏦'}
                </div>
                <div style={{ fontWeight: 700, fontSize: 11, color: sel ? opt.color : th.text }}>{opt.label}</div>
                {sel && <div style={{ width: 6, height: 6, borderRadius: '50%', background: opt.color }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Step 2: Send Money instructions ── */}
      <div style={{
        borderRadius: 14, overflow: 'hidden',
        border: `2px solid ${m.color}50`,
        background: (th.card as any).background,
      }}>
        {/* header */}
        <div style={{
          background: `linear-gradient(135deg, ${m.color}, ${m.color}cc)`,
          padding: '14px 18px',
        }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
            ধাপ ২ — টাকা পাঠান
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
            {form.method === 'bank' ? 'Bank Transfer করুন' : `${m.label} এ Send Money করুন`}
          </div>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {form.method !== 'bank' ? (
            <>
              {/* numbered steps like bKash UI */}
              {[
                `*247# ডায়াল করুন অথবা ${m.label} app-এ যান`,
                '"Send Money"-তে ক্লিক করুন',
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: m.color + '20', border: `1.5px solid ${m.color}60`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: m.color, marginTop: 1,
                  }}>{i + 1}</div>
                  <div style={{ fontSize: 13, color: th.text, lineHeight: 1.5 }}>{step}</div>
                </div>
              ))}

              {/* number to send to */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: m.color + '20', border: `1.5px solid ${m.color}60`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: m.color, marginTop: 1,
                }}>3</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: th.text, marginBottom: 8 }}>
                    প্রাপক নম্বর হিসেবে এই নম্বরটি লিখুনঃ
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: m.color + '12', borderRadius: 10, padding: '10px 14px',
                    border: `1.5px solid ${m.color}40`,
                  }}>
                    <span style={{ fontWeight: 900, fontSize: 20, color: m.color, letterSpacing: 1.5 }}>
                      {mobileNum || '—'}
                    </span>
                    {mobileNum && <CopyBtn k="mobile" val={mobileNum} />}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: m.color + '20', border: `1.5px solid ${m.color}60`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: m.color, marginTop: 1,
                }}>4</div>
                <div style={{ fontSize: 13, color: th.text }}>
                  টাকার পরিমাণঃ <b style={{ color: th.text }}>
                    {form.amountBdt ? `৳ ${Number(form.amountBdt).toLocaleString('en-BD')}` : 'আপনি যত টাকা recharge করতে চান'}
                  </b>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: m.color + '20', border: `1.5px solid ${m.color}60`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: m.color, marginTop: 1,
                }}>5</div>
                <div style={{ fontSize: 13, color: th.text }}>
                  পাঠানোর পর <b>{m.label} app থেকে Transaction ID টি</b> নিচে লিখুন
                </div>
              </div>

              {/* auto-verify badge */}
              {smsAuto && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#16a34a12', border: '1px solid #16a34a40',
                  borderRadius: 10, padding: '8px 14px',
                }}>
                  <span style={{ fontSize: 16 }}>⚡</span>
                  <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                    Transaction ID দিলে payment <b>auto-verify</b> হবে — কোনো অপেক্ষা নেই!
                  </span>
                </div>
              )}

              {/* support links */}
              {(waUrl || adminContact?.messengerUrl) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {waUrl && (
                    <a href={waUrl} target="_blank" rel="noreferrer" style={{
                      textDecoration: 'none', padding: '7px 14px', borderRadius: 9,
                      background: '#25D366', color: '#fff', fontWeight: 700, fontSize: 12,
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}>📱 WhatsApp Support</a>
                  )}
                  {adminContact?.messengerUrl && (
                    <a href={adminContact.messengerUrl} target="_blank" rel="noreferrer" style={{
                      textDecoration: 'none', padding: '7px 14px', borderRadius: 9,
                      background: '#0084FF', color: '#fff', fontWeight: 700, fontSize: 12,
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}>💬 Messenger</a>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Bank Transfer */
            <>
              <div style={{ fontSize: 13, color: th.muted, marginBottom: 4 }}>
                নিচের account এ <b style={{ color: th.text }}>Bank Transfer</b> করুন:
              </div>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${m.color}40` }}>
                {[
                  { k: 'acc',    label: 'Account Number', val: adminContact?.bankAccount || '', copy: true },
                  { k: 'bname',  label: 'Bank Name',       val: adminContact?.bankName    || 'NRB Commercial Bank', copy: false },
                  { k: 'branch', label: 'Branch',          val: adminContact?.bankBranch  || '', copy: false },
                  { k: 'holder', label: 'Account Name',    val: adminContact?.bankHolder  || '', copy: true },
                ].map((row, i) => (
                  <div key={row.k} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '11px 16px',
                    background: i % 2 === 0 ? m.color + '08' : (th.card as any).background,
                    borderBottom: i < 3 ? `1px solid ${m.color}20` : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: 10, color: m.color, marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{row.label}</div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: th.text }}>{row.val || '—'}</div>
                    </div>
                    {row.copy && row.val && <CopyBtn k={row.k} val={row.val} />}
                  </div>
                ))}
              </div>
              <div style={{ padding: '9px 13px', borderRadius: 10, background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.35)', fontSize: 12, color: th.text }}>
                ⚠️ Transfer এর Bank reference/transaction number নিচে Transaction ID তে দিন।
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Step 3: Submit ── */}
      <div style={{ ...card, marginBottom: 0, border: `1px solid ${th.border}` }}>
        <div style={{ fontSize: 11, color: th.muted, fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          ধাপ ৩ — Amount ও Transaction ID দিন
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 5, fontWeight: 600 }}>পরিমাণ (BDT) *</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontWeight: 800, fontSize: 16, color: th.muted }}>৳</span>
              <input style={{ ...inp, paddingLeft: 30 }} type="number" min="10" placeholder="500"
                readOnly={!!selectedPackage}
                value={form.amountBdt} onChange={e => setForm((f: any) => ({ ...f, amountBdt: e.target.value }))} />
            </div>
            {Number(form.amountBdt) > 0 && (
              <div style={{ fontSize: 12, color: th.accent, fontWeight: 700, marginTop: 4 }}>= {previewCredits.toLocaleString()} credit</div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 5, fontWeight: 600 }}>
              {form.method === 'bank' ? 'Bank Reference / TrxID *' : `${METHOD_LABELS[form.method]} Transaction ID *`}
            </label>
            <input style={{ ...inp, fontFamily: 'monospace', letterSpacing: 1, fontWeight: 700, fontSize: 15 }}
              placeholder={form.method === 'bank' ? 'Bank transfer reference' : 'যেমন: 8D3KA2F1P'}
              value={form.transactionId} onChange={e => setForm((f: any) => ({ ...f, transactionId: e.target.value }))} />
          </div>
          <button
            style={{
              border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800,
              padding: '15px 0', cursor: submitting ? 'not-allowed' : 'pointer',
              background: submitting ? '#94a3b8' : `linear-gradient(135deg, ${m.color}, ${m.color}cc)`,
              color: '#fff', letterSpacing: 0.3,
              boxShadow: submitting ? 'none' : `0 4px 16px ${m.color}55`,
              transition: 'all 0.2s',
            }}
            disabled={submitting}
            onClick={onSubmit}
          >
            {submitting ? '⏳ Verify হচ্ছে...' : smsAuto ? `⚡ Submit করুন — Auto Verify হবে` : `📤 Recharge Request পাঠান`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WalletPage ────────────────────────────────────────────────────────────────

export default function WalletPage({
  th, pageId, onToast,
}: { th: Theme; pageId: number; onToast: (m: string, t?: any) => void }) {
  const { request } = useApi();

  const [wallet, setWallet]       = useState<any>(null);
  const [txns, setTxns]           = useState<any[]>([]);
  const [requests, setRequests]   = useState<any[]>([]);
  const [adminContact, setAdminContact] = useState<any>(null);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [packages, setPackages]   = useState<any[]>([]);
  const [creditsPerBdt, setCreditsPerBdt] = useState(40);
  const [loading, setLoading]     = useState(true);
  const [submitResult, setSubmitResult] = useState<'auto' | 'manual' | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Recharge form
  const [form, setForm] = useState<{ packageId: number | null; amountBdt: string; method: string; transactionId: string; note: string }>({
    packageId: null, amountBdt: '', method: 'bkash', transactionId: '', note: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab]   = useState<'recharge' | 'history' | 'requests'>('recharge');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, t, r, billing, pkgData] = await Promise.all([
        request<any>(`${API_BASE}/client-dashboard/${pageId}/wallet`),
        request<any[]>(`${API_BASE}/client-dashboard/${pageId}/wallet/transactions`),
        request<any[]>(`${API_BASE}/client-dashboard/${pageId}/wallet/recharge-requests`),
        request<any>(`${API_BASE}/billing/status`).catch(() => null),
        request<any>(`${API_BASE}/client-dashboard/${pageId}/wallet/packages`).catch(() => null),
      ]);
      setWallet(w);
      setTxns(t || []);
      setRequests(r || []);
      if (billing?.adminContact) setAdminContact(billing.adminContact);
      if (billing?.paymentConfig) setPaymentConfig(billing.paymentConfig);
      if (pkgData) {
        setPackages(pkgData.packages || []);
        setCreditsPerBdt(pkgData.creditsPerBdt ?? 40);
      }
    } catch {
      onToast('Wallet data লোড হয়নি', 'error');
    } finally {
      setLoading(false);
    }
  }, [pageId, request, onToast]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.packageId && (!form.amountBdt || Number(form.amountBdt) <= 0)) {
      onToast('একটি package বেছে নিন অথবা সঠিক amount দিন', 'error'); return;
    }
    if (!form.transactionId.trim()) {
      onToast('Transaction ID দিন', 'error'); return;
    }
    setSubmitting(true);
    try {
      const res = await request<any>(`${API_BASE}/client-dashboard/${pageId}/wallet/recharge-request`, {
        method: 'POST',
        body: JSON.stringify({
          packageId: form.packageId || undefined,
          amountBdt: form.packageId ? undefined : Number(form.amountBdt),
          method: form.method,
          transactionId: form.transactionId.trim(),
          note: form.note.trim() || undefined,
        }),
      });
      if (res?.autoVerified) {
        setSubmitResult('auto');
        onToast('✅ Payment auto-verified! Balance এখনই যোগ হয়েছে।', 'success');
      } else {
        setSubmitResult('manual');
        onToast('✅ Recharge request জমা হয়েছে! Admin approve করলে balance যোগ হবে।', 'success');
      }
      setForm({ packageId: null, amountBdt: '', method: 'bkash', transactionId: '', note: '' });
      load();
    } catch (e: any) {
      onToast(e.message || 'Request জমা হয়নি', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>;

  const isSuspended = wallet?.subscriptionStatus === 'SUSPENDED';
  const balance = wallet?.creditBalance ?? 0;
  const pendingCount = requests.filter((r: any) => r.status === 'pending').length;

  const inp: React.CSSProperties = { ...th.input, width: '100%', boxSizing: 'border-box' };
  const card: React.CSSProperties = { ...th.card, borderRadius: 14, padding: 20, marginBottom: 16 };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 12px 40px' }}>
      {/* ── Balance Card ────────────────────────────────────────────────── */}
      <div style={{
        ...card,
        background: isSuspended
          ? 'linear-gradient(135deg,#7f1d1d,#991b1b)'
          : balance < 4000
            ? 'linear-gradient(135deg,#78350f,#92400e)'
            : 'linear-gradient(135deg,#1e3a5f,#1d4ed8)',
        color: '#fff',
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>💰 Credit Balance</div>
        <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-1px' }}>
          {Math.round(balance).toLocaleString('en-BD')} <span style={{ fontSize: 20, opacity: 0.85 }}>Credit</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{
            background: isSuspended ? '#ef4444' : '#22c55e',
            color: '#fff', borderRadius: 99, fontSize: 11, padding: '3px 10px', fontWeight: 700,
          }}>
            {isSuspended ? '🔴 SUSPENDED' : '🟢 ACTIVE'}
          </span>
          {isSuspended && (
            <span style={{ fontSize: 12, opacity: 0.9 }}>
              Balance zero — bot AI বন্ধ। Recharge করুন।
            </span>
          )}
          {!isSuspended && balance < 4000 && (
            <span style={{ fontSize: 12, opacity: 0.9 }}>⚠️ Balance কম — শীঘ্রই Recharge করুন।</span>
          )}
        </div>

        {/* Pricing breakdown */}
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(255,255,255,0.12)', fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, opacity: 0.9 }}>💰 Usage Pricing (Credit)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', fontSize: 11.5 }}>
            <span style={{ opacity: 0.75 }}>AI Text / SmartBot Reply</span>
            <span style={{ fontWeight: 700 }}>10–13+ (message length অনুযায়ী)</span>
            <span style={{ opacity: 0.75 }}>Customer Image (Vision)</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerImageCredit ?? 8}</span>
            <span style={{ opacity: 0.75 }}>OCR (Local Scan)</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerOcrLocalCredit ?? 1}</span>
            <span style={{ opacity: 0.75 }}>OCR (AI Fallback)</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerOcrAiCredit ?? 2}</span>
            <span style={{ opacity: 0.75 }}>Voice Note (STT)</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerVoiceMsgCredit ?? 40}</span>
            <span style={{ opacity: 0.75 }}>Product Auto-Analyze</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerAnalyzeCredit ?? 8}</span>
            <span style={{ opacity: 0.75 }}>Broadcast (per msg)</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerBroadcastMsgCredit ?? 2}</span>
            <span style={{ opacity: 0.75 }}>Subscriber Notification</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerRecurringNotifCredit ?? 4}</span>
            <span style={{ opacity: 0.75 }}>Comment Reply</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerCommentReplyCredit ?? 2}</span>
            <span style={{ opacity: 0.75 }}>Memo Print</span>
            <span style={{ fontWeight: 700 }}>{wallet?.costPerMemoPrintCredit ?? 4}</span>
          </div>
        </div>
      </div>

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([
          ['recharge', '💳 Recharge'],
          ['history', '📜 লেনদেন'],
          ['requests', `📋 Requests${pendingCount > 0 ? ` (${pendingCount})` : ''}`],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{
            flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: activeTab === k ? th.accent : (th.card as any).background,
            color: activeTab === k ? '#fff' : th.muted,
          }}>{label}</button>
        ))}
      </div>

      {/* ── Recharge Tab ────────────────────────────────────────────────── */}
      {activeTab === 'recharge' && (
        <RechargeFlow
          th={th}
          pageId={pageId}
          adminContact={adminContact}
          paymentConfig={paymentConfig}
          form={form}
          setForm={setForm}
          submitting={submitting}
          submitResult={submitResult}
          setSubmitResult={setSubmitResult}
          onSubmit={submit}
          copiedKey={copiedKey}
          copyText={copyText}
          inp={inp}
          card={card}
          packages={packages}
          creditsPerBdt={creditsPerBdt}
        />
      )}

      {/* ── Transaction History Tab ──────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div style={card}>
          <CardHeader th={th} title="Transaction History" sub={`সর্বশেষ ${txns.length} টি লেনদেন`} />
          {txns.length === 0 ? (
            <div style={{ textAlign: 'center', color: th.muted, padding: 32, fontSize: 13 }}>
              কোনো transaction নেই।
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txns.map((t: any) => (
                <div key={t.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', borderRadius: 10,
                  background: t.amountCredit > 0
                    ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.07)',
                  border: `1px solid ${t.amountCredit > 0 ? '#22c55e30' : '#ef444430'}`,
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {TYPE_LABELS[t.type] || t.type}
                    </div>
                    {t.description && (
                      <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>{t.description}</div>
                    )}
                    <div style={{ fontSize: 11, color: th.muted }}>
                      {new Date(t.createdAt).toLocaleString('en-BD')}
                    </div>
                  </div>
                  <div style={{
                    fontWeight: 800, fontSize: 15,
                    color: t.amountCredit > 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {t.amountCredit > 0 ? '+' : ''}{Math.abs(t.amountCredit).toFixed(0)} credit
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Requests Tab ────────────────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <div style={card}>
          <CardHeader th={th} title="Recharge Requests" sub="আপনার সব recharge request" />
          {requests.length === 0 ? (
            <div style={{ textAlign: 'center', color: th.muted, padding: 32, fontSize: 13 }}>
              কোনো request নেই।
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {requests.map((r: any) => (
                <div key={r.id} style={{
                  padding: '12px 14px', borderRadius: 10, border: `1px solid ${th.border}`,
                  background: (th.card as any).background,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>৳ {fmt(r.amountBdt)} → {Math.round(r.creditsAmount ?? 0).toLocaleString()} credit</div>
                      <div style={{ fontSize: 12, color: th.muted }}>
                        {METHOD_LABELS[r.method] || r.method} · TrxID: <b>{r.transactionId}</b>
                      </div>
                      {r.note && <div style={{ fontSize: 12, color: th.muted }}>{r.note}</div>}
                      <div style={{ fontSize: 11, color: th.muted }}>
                        {new Date(r.createdAt).toLocaleString('en-BD')}
                      </div>
                      {r.status === 'rejected' && r.rejectedReason && (
                        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                          ❌ কারণ: {r.rejectedReason}
                        </div>
                      )}
                    </div>
                    <span style={{
                      background: STATUS_COLORS[r.status] || '#6b7280',
                      color: '#fff', borderRadius: 99, fontSize: 11,
                      padding: '3px 10px', fontWeight: 700, whiteSpace: 'nowrap',
                    }}>
                      {r.status === 'pending' ? '⏳ Pending'
                        : r.status === 'approved' ? '✅ Approved'
                        : '❌ Rejected'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
