import { useCallback, useEffect, useState } from 'react';
import { CardHeader, EmptyState, InfoButton, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SystemReply { template: string; fallback: string; enabled: boolean; }
interface AreaRule { areaName: string; aliases: string[]; zoneType: 'inside_dhaka' | 'outside_dhaka'; active: boolean; }
interface BotConfig {
  systemReplies: Record<string, SystemReply>;
  areaRules?: { globalInsideDhaka: AreaRule[]; clientCustomAreas: AreaRule[]; };
}

type BkTab = 'system-replies' | 'area-rules';

const SYSTEM_REPLY_KEYS = [
  'ocr_processing','ocr_fail','order_received','order_confirmed',
  'order_cancelled','product_not_found','stock_out','product_info',
  'order_prompt','generic_fallback',
];

const REPLY_KEY_HELP: Record<string, string> = {
  ocr_processing:    'Customer ছবি পাঠালে প্রথমে এই message যাবে। "Processing হচ্ছে" জানান।',
  ocr_fail:          'ছবি থেকে product code বোঝা না গেলে এই message যাবে।',
  order_received:    'Order সফলভাবে নেওয়া হলে এই message যাবে।',
  order_confirmed:   'Order confirm হলে customer কে এই message যাবে।',
  order_cancelled:   'Order cancel হলে customer কে এই message যাবে।',
  product_not_found: 'Product code ভুল বা না থাকলে এই message। {{productCode}} ব্যবহার করুন।',
  stock_out:         'Product stock নেই হলে এই message। {{productCode}} ব্যবহার করুন।',
  product_info:      'Product info দেখানোর template। {{productCode}}, {{productPrice}}, {{productStock}} ব্যবহার করুন।',
  order_prompt:      'Customer order করতে চাইলে এই guide message যাবে।',
  generic_fallback:  'Bot কিছু না বুঝলে এই default message যাবে।',
};

// ── InfoTooltip for system reply keys ─────────────────────────────────────────
function ReplyKeyBadge({ replyKey, th }: { replyKey: string; th: Theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <code style={{ background: th.accentSoft, color: th.accent, padding: '2px 8px', borderRadius: 5, fontSize: 11.5, fontWeight: 700 }}>
        {replyKey}
      </code>
      <InfoButton text={REPLY_KEY_HELP[replyKey] || ''} th={th} />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function BotKnowledgePage({ th, pageId, onToast }: {
  th: Theme; pageId: number; onToast: (m: string, t?: any) => void;
}) {
  const { request } = useApi();
  const [tab, setTab]         = useState<BkTab>('system-replies');
  const [cfg, setCfg]         = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [editReplies, setEditReplies] = useState<Record<string, string>>({});
  const [customAreas, setCustomAreas] = useState<AreaRule[]>([]);
  const [areaForm, setAreaForm] = useState({ areaName: '', aliases: '', zoneType: 'inside_dhaka' as 'inside_dhaka' | 'outside_dhaka' });
  const [savingArea, setSavingArea] = useState(false);

  const BASE = `${API_BASE}/client-dashboard/${pageId}/bot-knowledge`;

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const c = await request<BotConfig>(BASE);
      setCfg(c);
      setCustomAreas(c.areaRules?.clientCustomAreas || []);
      const r: Record<string, string> = {};
      for (const k of SYSTEM_REPLY_KEYS) r[k] = c.systemReplies?.[k]?.template || '';
      setEditReplies(r);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [pageId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveReplies = async () => {
    setSaving(true);
    const sr: Record<string, any> = {};
    for (const k of SYSTEM_REPLY_KEYS) {
      sr[k] = { template: editReplies[k] || '', fallback: editReplies[k] || '', enabled: true };
    }
    try {
      await request(`${BASE}/system-replies`, { method: 'PATCH', body: JSON.stringify({ systemReplies: sr }) });
      onToast('✅ System replies saved'); await loadConfig();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const TabBar = () => (
    <div style={{ display: 'flex', gap: 3, background: th.surface, borderRadius: 10, padding: 3, border: `1px solid ${th.border}`, flexWrap: 'wrap' }}>
      {([
        ['system-replies',  '🔔 System Replies'],
        ['area-rules',      '🗺️ Area Rules'],
      ] as const).map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} style={{
          padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
          background: tab === k ? th.accent : 'transparent',
          color: tab === k ? '#fff' : th.muted, transition: 'all .15s',
        }}>{l}</button>
      ))}
    </div>
  );

  if (loading) return (
    <div style={{ ...th.card, display: 'flex', gap: 10, alignItems: 'center', color: th.muted }}>
      <Spinner size={18}/> Loading bot knowledge…
    </div>
  );
  if (!cfg) return null;

  // ── SYSTEM REPLIES TAB ────────────────────────────────────────────────────
  const SystemRepliesTab = () => (
    <div style={th.card}>
      <CardHeader th={th} title="🔔 System Replies"
        sub="Bot এর সব automatic message এখানে customize করুন" />

      {/* Variables reference */}
      <div style={{ ...th.card2, marginBottom: 18, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: th.muted, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          ব্যবহারযোগ্য Variables <InfoButton text="Reply template এ এই variables লিখলে bot automatically সেখানে সঠিক তথ্য বসিয়ে দেবে।" th={th} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            ['{{productCode}}',    'Product এর code'],
            ['{{productPrice}}',   'Product এর দাম'],
            ['{{productStock}}',   'Stock পরিমাণ'],
            ['{{insideFee}}',      'ঢাকার ভেতরে delivery fee'],
            ['{{outsideFee}}',     'ঢাকার বাইরে delivery fee'],
            ['{{businessName}}',   'আপনার business এর নাম'],
            ['{{deliveryTime}}',   'Delivery সময়কাল'],
          ].map(([v, desc]) => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <code style={{ background: th.accentSoft, color: th.accent, padding: '2px 8px', borderRadius: 5, fontSize: 11 }}>{v}</code>
              <span style={{ fontSize: 10.5, color: th.muted }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {SYSTEM_REPLY_KEYS.map(k => (
          <div key={k}>
            <ReplyKeyBadge replyKey={k} th={th} />
            <textarea
              style={{ ...th.input, height: 68, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              value={editReplies[k] || ''}
              onChange={e => setEditReplies(r => ({ ...r, [k]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <button style={{ ...th.btnPrimary, marginTop: 18, display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={saveReplies} disabled={saving}>
        {saving ? <><Spinner size={13}/> Saving…</> : '💾 Save All Replies'}
      </button>
    </div>
  );

  const saveAreaRules = async (areas: AreaRule[]) => {
    setSavingArea(true);
    try {
      await request(`${BASE}/area-rules`, { method: 'PATCH', body: JSON.stringify({ clientCustomAreas: areas }) });
      setCustomAreas(areas);
      onToast('✅ Area rules saved');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSavingArea(false); }
  };

  const addArea = () => {
    if (!areaForm.areaName.trim()) return;
    const newArea: AreaRule = {
      areaName: areaForm.areaName.trim(),
      aliases: areaForm.aliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean),
      zoneType: areaForm.zoneType,
      active: true,
    };
    const updated = [...customAreas, newArea];
    setAreaForm({ areaName: '', aliases: '', zoneType: 'inside_dhaka' });
    saveAreaRules(updated);
  };

  const removeArea = (i: number) => saveAreaRules(customAreas.filter((_, idx) => idx !== i));

  const AreaRulesTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Info banner */}
      <div style={{ ...th.card2, background: th.accentSoft, border: `1px solid ${th.accent}40`, borderRadius: 12, padding: '12px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: th.accent, marginBottom: 4 }}>🗺️ Area Detection কীভাবে কাজ করে?</div>
        <div style={{ fontSize: 12, color: th.text, lineHeight: 1.6 }}>
          Customer delivery address দিলে bot স্বয়ংক্রিয়ভাবে বুঝবে এটা <b>ঢাকার ভেতরে</b> নাকি <b>বাইরে</b> —
          এবং সেই অনুযায়ী সঠিক delivery fee reply করবে।
          নিচের list-এ আপনার এলাকাগুলো যোগ করুন।
        </div>
      </div>

      {/* Global areas (read-only) */}
      <div style={th.card}>
        <CardHeader th={th} title="🌐 Global Inside Dhaka Areas" sub="এগুলো সব client-এর জন্য default — edit করা যাবে না" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(cfg?.areaRules?.globalInsideDhaka || []).map((a, i) => (
            <div key={i} style={{ background: '#10b98120', border: '1px solid #10b98140', borderRadius: 8, padding: '5px 12px', fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: '#10b981' }}>{a.areaName}</span>
              {a.aliases?.length > 0 && <span style={{ color: th.muted, fontSize: 10.5 }}> · {a.aliases.join(', ')}</span>}
            </div>
          ))}
          {(!cfg?.areaRules?.globalInsideDhaka?.length) && <span style={{ fontSize: 12, color: th.muted }}>Loading…</span>}
        </div>
      </div>

      {/* Client custom areas */}
      <div style={th.card}>
        <CardHeader th={th} title="📍 আপনার Custom Areas" sub={`আপনার নিজস্ব এলাকা — ${customAreas.length} টি`} />

        {/* Add form */}
        <div style={{ background: th.surface, borderRadius: 12, padding: '14px 16px', marginBottom: 14, border: `1px solid ${th.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: th.accent, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 }}>
            ➕ নতুন এলাকা যোগ করুন
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>এলাকার নাম <span style={{ color: '#ef4444' }}>*</span></div>
              <input style={th.input} placeholder="যেমন: Gazipur" value={areaForm.areaName}
                onChange={e => setAreaForm(p => ({ ...p, areaName: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                Alternative নাম <span style={{ fontSize: 10.5, color: th.muted }}>(comma দিয়ে আলাদা করুন)</span>
              </div>
              <input style={th.input} placeholder="gazipur, gazipor, gzpur, গাজীপুর" value={areaForm.aliases}
                onChange={e => setAreaForm(p => ({ ...p, aliases: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>Zone Type</div>
              <select style={{ ...th.input, cursor: 'pointer' }} value={areaForm.zoneType}
                onChange={e => setAreaForm(p => ({ ...p, zoneType: e.target.value as any }))}>
                <option value="inside_dhaka">🟢 Inside Dhaka</option>
                <option value="outside_dhaka">🔵 Outside Dhaka</option>
              </select>
            </div>
          </div>
          <button style={{ ...th.btnPrimary, padding: '9px 20px' }} onClick={addArea}
            disabled={!areaForm.areaName.trim() || savingArea}>
            {savingArea ? <><Spinner size={12}/> Saving…</> : '➕ Add Area'}
          </button>
        </div>

        {/* List */}
        {customAreas.length === 0 ? (
          <EmptyState icon="📍" title="কোনো custom area নেই" sub="উপরে form দিয়ে আপনার এলাকা যোগ করুন" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {customAreas.map((a, i) => (
              <div key={i} style={{ ...th.card2, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{a.areaName}</span>
                    <span style={{
                      fontSize: 10.5, padding: '1px 8px', borderRadius: 20, fontWeight: 700,
                      background: a.zoneType === 'inside_dhaka' ? '#10b98120' : '#3b82f620',
                      color: a.zoneType === 'inside_dhaka' ? '#10b981' : '#3b82f6',
                    }}>
                      {a.zoneType === 'inside_dhaka' ? '🟢 Inside Dhaka' : '🔵 Outside Dhaka'}
                    </span>
                  </div>
                  {a.aliases?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {a.aliases.map(al => (
                        <span key={al} style={{ background: th.accentSoft, color: th.accent, fontSize: 10.5, padding: '1px 7px', borderRadius: 5 }}>{al}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => removeArea(i)}
                  style={{ background: 'none', border: '1px solid #ef444460', color: '#ef4444', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>Bot Knowledge</h1>
        <p style={{ fontSize: 12.5, color: th.muted, margin: '3px 0 0' }}>
          Bot কে শেখান — কোন প্রশ্নের কী উত্তর দিতে হবে
        </p>
      </div>
      <TabBar />
      {tab === 'system-replies' && <SystemRepliesTab />}
      {tab === 'area-rules'     && <AreaRulesTab />}
    </div>
  );
}
