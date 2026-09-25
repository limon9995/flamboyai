import { useCallback, useEffect, useState } from 'react';
import { CardHeader, EmptyState, FieldWithInfo, Spinner, Toggle } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

export interface FollowUpPagePreset {
  tab?: 'list' | 'settings';
  filterStatus?: string;
  label?: string;
}

const STATUS_COLORS: Record<string,string> = { pending:'#f59e0b', sent:'#16a34a', failed:'#ef4444', cancelled:'#9ca3af' };
const TRIGGER_LABELS: Record<string,string> = {
  order_received: '📦 Order Received', order_delivered: '✅ Order Delivered',
  abandoned_cart: '🛒 Abandoned Cart', custom: '✏️ Custom',
};

export function FollowUpPage({ th, pageId, onToast, preset }: {
  th: Theme; pageId: number; onToast: (m: string, t?: any) => void;
  preset?: FollowUpPagePreset | null;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const [tab, setTab]             = useState<'list' | 'settings'>('list');
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [settings, setSettings]   = useState<any>(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [newFU, setNewFU]         = useState({ psid: '', message: '', scheduledAt: '', platform: 'FACEBOOK' });
  const [showNew, setShowNew]     = useState(false);

  const BASE = `${API_BASE}/client-dashboard/${pageId}`;

  const loadList = useCallback(async () => {
    setLoading(true);
    try { setFollowUps(await request<any[]>(`${BASE}/followup${filterStatus ? `?status=${filterStatus}` : ''}`)); }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [pageId, filterStatus]);

  const loadSettings = useCallback(async () => {
    try { setSettings(await request(`${BASE}/followup/settings`)); } catch {}
  }, [pageId]);

  useEffect(() => { if (tab === 'list') loadList(); else loadSettings(); }, [tab, loadList, loadSettings]);

  useEffect(() => {
    if (!preset) return;
    setTab(preset.tab || 'list');
    setFilterStatus(preset.filterStatus || 'pending');
  }, [preset?.tab, preset?.filterStatus, preset?.label]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await request(`${BASE}/followup/settings`, { method: 'PATCH', body: JSON.stringify(settings) });
      onToast(copy('✅ Settings saved', '✅ Settings saved'));
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const cancelFU = async (id: number) => {
    try {
      await request(`${BASE}/followup/${id}/cancel`, { method: 'POST' });
      onToast(copy('✅ Cancelled', '✅ Cancelled')); await loadList();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const createManual = async () => {
    if (!newFU.psid || !newFU.message) return onToast(copy('PSID এবং Message দিন', 'Enter both PSID and message'), 'error');
    try {
      await request(`${BASE}/followup`, { method: 'POST', body: JSON.stringify(newFU) });
      onToast(copy('✅ Follow-up scheduled', '✅ Follow-up scheduled')); setShowNew(false);
      setNewFU({ psid: '', message: '', scheduledAt: '', platform: 'FACEBOOK' }); await loadList();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 900 }}>🔔 Follow-up</div>
        <div style={{ fontSize: 12.5, color: th.muted, marginTop: 3 }}>{copy('Automatic এবং manual follow-up messages', 'Automatic and manual follow-up messages')}</div>
      </div>

      <div style={{ display: 'flex', gap: 4, background: th.surface, borderRadius: 12, padding: 3, border: `1px solid ${th.border}`, alignSelf: 'flex-start' }}>
        {[['list','📋 Follow-ups'],['settings','⚙️ Auto Settings']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k as any)} style={{
            padding: '8px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            background: tab === k ? th.accent : 'transparent',
            color: tab === k ? '#fff' : th.muted,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          {preset?.label && (
            <div style={{ ...th.card, padding: '10px 12px', fontSize: 12.5, color: th.textSub }}>
              {copy('এখন দেখানো হচ্ছে:', 'Now showing:')} <strong style={{ color: th.text }}>{preset.label}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select style={{ ...th.input, width: 130 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button style={th.btnGhost} onClick={loadList}>{loading ? <Spinner size={13}/> : '🔄'}</button>
            <button style={th.btnPrimary} onClick={() => setShowNew(v => !v)}>
            {showNew ? '✕' : copy('➕ Manual Follow-up', '➕ Manual Follow-up')}
          </button>
          </div>

          {showNew && (
            <div style={{ ...th.card, border: `2px solid ${th.accent}` }}>
              <CardHeader th={th} title={copy('➕ Manual Follow-up', '➕ Manual Follow-up')} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FieldWithInfo th={th} label="Platform" helpText={copy('কোন platform এ follow-up পাঠাবেন।', 'Which platform to send the follow-up on.')}>
                  <select style={th.input} value={newFU.platform} onChange={e => setNewFU(f => ({ ...f, platform: e.target.value }))}>
                    <option value="FACEBOOK">💙 Facebook Messenger</option>
                    <option value="INSTAGRAM">📸 Instagram DM</option>
                    <option value="WHATSAPP">💚 WhatsApp</option>
                  </select>
                </FieldWithInfo>
                <FieldWithInfo th={th} label="Customer PSID / Phone / IG ID" helpText={copy('Facebook PSID, WhatsApp phone number, বা Instagram sender ID। CRM থেকে দেখুন।', 'Facebook PSID, WhatsApp phone number, or Instagram sender ID. Find from CRM.')}>
                  <input style={th.input} placeholder="1234567890" value={newFU.psid}
                    onChange={e => setNewFU(f => ({ ...f, psid: e.target.value }))} />
                </FieldWithInfo>
                <FieldWithInfo th={th} label="Message">
                  <textarea style={{ ...th.input, height: 80, resize: 'vertical' }}
                    value={newFU.message} onChange={e => setNewFU(f => ({ ...f, message: e.target.value }))} />
                </FieldWithInfo>
                <FieldWithInfo th={th} label="Send At (optional)" helpText={copy('খালি রাখলে এখনই পাঠাবে।', 'Leave blank to send immediately.')}>
                  <input style={th.input} type="datetime-local" value={newFU.scheduledAt}
                    onChange={e => setNewFU(f => ({ ...f, scheduledAt: e.target.value }))} />
                </FieldWithInfo>
                <button style={th.btnPrimary} onClick={createManual}>{copy('📤 Schedule', 'Schedule')}</button>
              </div>
            </div>
          )}

          {loading && !followUps.length
            ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22}/></div>
            : followUps.length === 0
            ? <EmptyState icon="🔔" title={copy('কোনো follow-up নেই', 'No follow-ups found')} />
            : (
              <div style={th.card}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {followUps.map(f => (
                    <div key={f.id} style={{ ...th.card2, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ ...th.pill, background: `${STATUS_COLORS[f.status]}22`, color: STATUS_COLORS[f.status], border: `1px solid ${STATUS_COLORS[f.status]}44`, fontSize: 10.5 }}>{f.status}</span>
                          <span style={{ ...th.pill, ...th.pillGray, fontSize: 10 }}>{TRIGGER_LABELS[f.triggerType] || f.triggerType}</span>
                          {f.platform === 'WHATSAPP' && <span style={{ ...th.pill, background: '#25d36622', color: '#25d366', fontSize: 10 }}>💚 WhatsApp</span>}
                          {f.platform === 'INSTAGRAM' && <span style={{ ...th.pill, background: '#e1306c22', color: '#e1306c', fontSize: 10 }}>📸 Instagram</span>}
                        </div>
                        <div style={{ fontSize: 12.5, marginBottom: 4 }}>{f.message.slice(0, 80)}{f.message.length > 80 ? '…' : ''}</div>
                        <div style={{ fontSize: 11, color: th.muted }}>
                          📅 {new Date(f.scheduledAt).toLocaleString()}
                          {f.order && <span style={{ marginLeft: 8 }}>· Order #{f.order.id} — {f.order.customerName}</span>}
                        </div>
                        {f.error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>⚠️ {f.error}</div>}
                      </div>
                      {f.status === 'pending' && (
                        <button style={{ ...th.btnSmDanger, fontSize: 11 }} onClick={() => cancelFU(f.id)}>{copy('Cancel', 'Cancel')}</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
        </>
      )}

      {tab === 'settings' && settings && (
        <div style={th.card}>
          <CardHeader th={th} title={copy('⚙️ Auto Follow-up Settings', '⚙️ Auto Follow-up Settings')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[
              { key: 'orderReceived',  label: '📦 Order Received Follow-up',  help: 'Order নেওয়ার কিছুক্ষণ পর customer কে জিজ্ঞেস করা।', delayHelp: 'Order এর কত ঘণ্টা পরে message যাবে।', msgHelp: '{{orderId}} variable ব্যবহার করতে পারেন।' },
              { key: 'orderDelivered', label: '✅ Order Delivered Follow-up',  help: 'Delivery হওয়ার পর customer কে feedback নেওয়া।', delayHelp: 'Delivery এর কত ঘণ্টা পরে message যাবে।', msgHelp: '{{orderId}} variable ব্যবহার করতে পারেন।' },
              { key: 'abandonedCart',  label: '🛒 Abandoned Cart Reminder',    help: 'Customer "পরে নিব / ভেবে দেখি" বলে চলে গেলে — যারা আগ্রহ দেখিয়েছে শুধু তাদেরই নাম ধরে reminder যাবে।', delayHelp: 'Customer "পরে নিব" বলার কত ঘণ্টা পরে reminder যাবে।', msgHelp: '{{name}} (নাম) ও {{product}} (যে product দেখছিল) variable ব্যবহার করতে পারেন।' },
              { key: 'reviewRequest',  label: '⭐ Review চাওয়ার Follow-up',    help: 'Delivery হওয়ার পর customer কে review link পাঠানো হবে — বন্ধ/চালু করতে পারবেন। {{reviewLink}} variable ব্যবহার করুন।', delayHelp: 'Delivery এর কত ঘণ্টা পরে review link যাবে।', msgHelp: '{{orderId}} ও {{reviewLink}} variable ব্যবহার করতে পারেন।' },
            ].map(({ key, label, help, delayHelp, msgHelp }) => (
              <div key={key} style={{ ...th.card2, borderRadius: 12 }}>
                <Toggle th={th} label={label} sub={help}
                  checked={settings[`${key}Enabled`] || false}
                  onChange={v => setSettings((s: any) => ({ ...s, [`${key}Enabled`]: v }))}
                />
                {settings[`${key}Enabled`] && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 10, marginTop: 12 }}>
                    <FieldWithInfo th={th} label="Delay (ঘণ্টা)" helpText={delayHelp}>
                      <input style={th.input} type="number" min={1} max={168}
                        value={settings[`${key}Delay`] || 24}
                        onChange={e => setSettings((s: any) => ({ ...s, [`${key}Delay`]: Number(e.target.value) }))} />
                    </FieldWithInfo>
                    <FieldWithInfo th={th} label="Message" helpText={msgHelp}>
                      <input style={th.input}
                        value={settings[`${key}Msg`] || ''}
                        onChange={e => setSettings((s: any) => ({ ...s, [`${key}Msg`]: e.target.value }))} />
                    </FieldWithInfo>
                  </div>
                )}
              </div>
            ))}
            <button style={th.btnPrimary} onClick={saveSettings} disabled={saving}>
              {saving ? <Spinner size={13}/> : copy('💾 Save Settings', 'Save Settings')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
