import { useEffect, useState } from 'react';
import { CardHeader, Field, Spinner } from './ui';
import type { Theme } from './ui';
import { useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

export interface OrderFieldDef {
  key?: string;
  label: string;
  type: 'text' | 'number' | 'select';
  choices: string[];
  helpText: string;
  optional: boolean;
  visibleToAi: boolean;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EMPTY_FIELD: OrderFieldDef = {
  label: '', type: 'text', choices: [], helpText: '', optional: false, visibleToAi: true,
};

/**
 * "Edit Order Fields" — merchant-defined extra order fields. AI-visible ones
 * are asked by the bot after name/phone/address; all of them show up as
 * value sources in the courier booking dialog.
 */
export function OrderFieldsModal({ th, base, onClose, onToast }: {
  th: Theme; base: string; onClose: () => void;
  onToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const [fields, setFields] = useState<OrderFieldDef[]>([]);
  // Choices are edited as comma-separated text so typing "," isn't eaten
  const [choiceText, setChoiceText] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<{ fields: OrderFieldDef[] }>(`${base}/order-fields`)
      .then(r => {
        setFields(r.fields || []);
        setChoiceText((r.fields || []).map(f => f.choices.join(', ')));
      })
      .catch((e: unknown) => onToast(errMsg(e), 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const update = (i: number, patch: Partial<OrderFieldDef>) =>
    setFields(fs => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const add = () => {
    setFields(fs => [{ ...EMPTY_FIELD }, ...fs]);
    setChoiceText(cs => ['', ...cs]);
    setOpen(0);
  };

  const remove = (i: number) => {
    setFields(fs => fs.filter((_, idx) => idx !== i));
    setChoiceText(cs => cs.filter((_, idx) => idx !== i));
    setOpen(null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const swap = <T,>(arr: T[]) => { const a = [...arr]; [a[i], a[j]] = [a[j], a[i]]; return a; };
    setFields(swap);
    setChoiceText(swap);
    setOpen(o => (o === i ? j : o === j ? i : o));
  };

  const save = async () => {
    const payload = fields
      .map((f, i) => ({
        ...f,
        label: f.label.trim(),
        choices: f.type === 'select'
          ? (choiceText[i] || '').split(',').map(c => c.trim()).filter(Boolean)
          : [],
      }))
      .filter(f => f.label);
    const bad = payload.find(f => f.type === 'select' && f.choices.length === 0);
    if (bad) {
      onToast(copy(`"${bad.label}" — option গুলো কমা দিয়ে লিখুন`, `"${bad.label}" — enter comma-separated options`), 'error');
      return;
    }
    setSaving(true);
    try {
      await request(`${base}/order-fields`, { method: 'PATCH', body: JSON.stringify({ fields: payload }) });
      onToast(copy('✅ Order fields সেভ হয়েছে', '✅ Order fields saved'), 'success');
      onClose();
    } catch (e: unknown) { onToast(errMsg(e), 'error'); }
    finally { setSaving(false); }
  };

  const typeLabel = (t: string) =>
    t === 'number' ? copy('সংখ্যা', 'Number') : t === 'select' ? copy('অপশন থেকে বাছাই', 'Choice list') : copy('লেখা', 'Text');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ ...th.card, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1.5px solid ${th.border}` }}
        onClick={e => e.stopPropagation()}>
        <CardHeader th={th} title={copy('⚙️ Edit Order Fields', '⚙️ Edit Order Fields')}
          sub={copy('নিজের মতো order-এর ঘর যোগ করুন। "AI জিজ্ঞেস করবে" চালু থাকলে bot নাম/ফোন/ঠিকানার পর এটাও জেনে নেবে।',
            'Add your own order fields. With "AI asks" on, the bot collects it after name/phone/address.')} />

        <button style={{ ...th.btnPrimary, alignSelf: 'center', marginBottom: 12 }} onClick={add} disabled={loading}>
          ＋ {copy('নতুন field যোগ করুন', 'Add another field')}
        </button>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spinner size={20} color={th.accent} /></div>
          ) : fields.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, fontSize: 13, color: th.muted }}>
              {copy('এখনো কোনো field নেই। যেমন: Colour, Size, Delivery Date', 'No fields yet. e.g. Colour, Size, Delivery Date')}
            </div>
          ) : fields.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ border: `1px solid ${th.border}`, borderRadius: 10, background: th.surface }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', cursor: 'pointer' }}
                  onClick={() => setOpen(isOpen ? null : i)}>
                  <div style={{ display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                    <button style={{ ...th.btnSmGhost, padding: '0 5px', fontSize: 9, lineHeight: '14px' }} disabled={i === 0} onClick={() => move(i, -1)} title={copy('উপরে', 'Move up')}>▲</button>
                    <button style={{ ...th.btnSmGhost, padding: '0 5px', fontSize: 9, lineHeight: '14px' }} disabled={i === fields.length - 1} onClick={() => move(i, 1)} title={copy('নিচে', 'Move down')}>▼</button>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: f.label ? th.text : th.muted }}>
                      {f.label || copy('নতুন Field', 'New Field')}
                    </div>
                    <div style={{ fontSize: 11, color: th.muted }}>
                      {typeLabel(f.type)}
                      {f.visibleToAi && <> · 🤖 {copy('AI জিজ্ঞেস করবে', 'AI asks')}</>}
                      {f.optional && <> · {copy('ঐচ্ছিক', 'optional')}</>}
                    </div>
                  </div>
                  <span style={{ color: th.muted, fontSize: 12 }}>{isOpen ? '▴' : '▾'}</span>
                  <button style={{ ...th.btnSmDanger, padding: '4px 8px' }} onClick={e => { e.stopPropagation(); remove(i); }} title={copy('মুছুন', 'Delete')}>🗑</button>
                </div>

                {isOpen && (
                  <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${th.border}` }}>
                    <Field th={th} label={copy('Field-এর নাম', 'Display name')}>
                      <input style={th.input} value={f.label} maxLength={60} autoFocus
                        placeholder={copy('যেমন: Colour', 'e.g. Colour')}
                        onChange={e => update(i, { label: e.target.value })} />
                    </Field>
                    <Field th={th} label={copy('ধরন', 'Field type')}>
                      <select style={th.input} value={f.type} onChange={e => update(i, { type: e.target.value as OrderFieldDef['type'] })}>
                        <option value="text">{typeLabel('text')}</option>
                        <option value="number">{typeLabel('number')}</option>
                        <option value="select">{typeLabel('select')}</option>
                      </select>
                    </Field>
                    {f.type === 'select' && (
                      <Field th={th} label={copy('অপশন (কমা দিয়ে)', 'Options (comma separated)')}>
                        <input style={th.input} value={choiceText[i] || ''}
                          placeholder="Red, Blue, Black"
                          onChange={e => setChoiceText(cs => cs.map((c, idx) => (idx === i ? e.target.value : c)))} />
                      </Field>
                    )}
                    <Field th={th} label={copy('সাহায্য লেখা (ঐচ্ছিক)', 'Help text (optional)')}>
                      <textarea style={{ ...th.input, minHeight: 56, resize: 'vertical' }} value={f.helpText} maxLength={200}
                        placeholder={copy('customer-কে প্রশ্নের সাথে দেখানো হবে', 'Shown to the customer with the question')}
                        onChange={e => update(i, { helpText: e.target.value })} />
                    </Field>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: th.text }}>
                      <input type="checkbox" checked={f.optional} style={{ accentColor: th.accent }}
                        onChange={e => update(i, { optional: e.target.checked })} />
                      {copy('ঐচ্ছিক (customer "না" বলে বাদ দিতে পারবে)', 'Optional (customer can reply "no" to skip)')}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: th.text }}>
                      <input type="checkbox" checked={f.visibleToAi} style={{ accentColor: th.accent }}
                        onChange={e => update(i, { visibleToAi: e.target.checked })} />
                      {copy('🤖 AI জিজ্ঞেস করবে (Visible to AI)', '🤖 AI asks this (Visible to AI)')}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button style={{ ...th.btnGhost, flex: 1 }} onClick={onClose}>{copy('বাতিল', 'Cancel')}</button>
          <button style={{ ...th.btnPrimary, flex: 2 }} onClick={save} disabled={saving || loading}>
            {saving ? <Spinner size={13} /> : copy('সেভ করুন', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
