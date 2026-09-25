import React, { useEffect, useMemo, useState } from 'react';
import { Field, Spinner } from './ui';
import type { Theme } from './ui';
import { useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

type Courier = 'steadfast' | 'pathao';

interface Source { key: string; label: string; value: string }
interface BookingDraft {
  orderId: number;
  paymentStatus: string;
  sources: Source[];
  fieldMap: Record<string, Record<string, string>>;
  credentials: {
    steadfast: { configured: boolean; apiKey: string; secretKey: string };
    pathao: { configured: boolean; apiKey: string; secretKey: string; username: string; password: string; storeId: string };
  };
  shipment: { courierName: string | null; trackingId: string | null; trackingUrl: string | null; status: string } | null;
}
interface Option { id: number | string; name: string }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Booking form fields per courier, and which order value fills each by default
interface Target { key: string; bn: string; en: string; multiline?: boolean; numeric?: boolean; optional?: boolean }
const TARGETS: Record<Courier, Target[]> = {
  steadfast: [
    { key: 'invoice', bn: 'Invoice ID', en: 'Invoice ID' },
    { key: 'recipientName', bn: 'Recipient Name', en: 'Recipient Name' },
    { key: 'recipientPhone', bn: 'Recipient Phone', en: 'Recipient Phone' },
    { key: 'recipientAddress', bn: 'Recipient Address', en: 'Recipient Address', multiline: true },
    { key: 'codAmount', bn: 'COD Amount', en: 'COD Amount', numeric: true },
    { key: 'note', bn: 'Note', en: 'Note', multiline: true, optional: true },
  ],
  pathao: [
    { key: 'invoice', bn: 'Merchant Order ID', en: 'Merchant Order ID' },
    { key: 'recipientName', bn: 'Recipient Name', en: 'Recipient Name' },
    { key: 'recipientPhone', bn: 'Recipient Phone', en: 'Recipient Phone' },
    { key: 'recipientAddress', bn: 'Recipient Address', en: 'Recipient Address', multiline: true },
    { key: 'codAmount', bn: 'Amount to Collect', en: 'Amount to Collect', numeric: true },
    { key: 'itemQuantity', bn: 'Item Quantity', en: 'Item Quantity', numeric: true },
    { key: 'itemDescription', bn: 'Item Description', en: 'Item Description', optional: true },
    { key: 'note', bn: 'Special Instruction', en: 'Special Instruction', multiline: true, optional: true },
  ],
};
const DEFAULT_MAP: Record<string, string> = {
  invoice: 'invoice', recipientName: 'name', recipientPhone: 'phone',
  recipientAddress: 'address', codAmount: 'total', note: 'products',
  itemDescription: 'products', itemQuantity: 'quantity',
};

const COURIER_META: Record<Courier, { label: string; color: string }> = {
  steadfast: { label: 'SteadFast', color: '#0d9488' },
  pathao: { label: 'Pathao', color: '#e11d48' },
};

export function CourierBookingModal({ th, base, orderId, onClose, onBooked, onToast }: {
  th: Theme; base: string; orderId: number;
  onClose: () => void; onBooked: () => void;
  onToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [tab, setTab] = useState<Courier>('steadfast');
  const [maps, setMaps] = useState<Record<Courier, Record<string, string>>>({ steadfast: {}, pathao: {} });
  const [values, setValues] = useState<Record<Courier, Record<string, string>>>({ steadfast: {}, pathao: {} });
  const [menu, setMenu] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cred, setCred] = useState<Record<string, string>>({});
  const [savingCred, setSavingCred] = useState(false);
  const [booking, setBooking] = useState(false);
  const [rebook, setRebook] = useState(false);
  const [weight, setWeight] = useState('0.5');
  // Pathao location + store pickers
  const [stores, setStores] = useState<Option[]>([]);
  const [cities, setCities] = useState<Option[]>([]);
  const [zones, setZones] = useState<Option[]>([]);
  const [areas, setAreas] = useState<Option[]>([]);
  const [storeId, setStoreId] = useState('');
  const [cityId, setCityId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [locLoading, setLocLoading] = useState(false);

  const sourceByKey = useMemo(
    () => new Map((draft?.sources || []).map(s => [s.key, s])),
    [draft],
  );

  const loadDraft = async () => {
    const d = await request<BookingDraft>(`${base}/courier/booking-draft/${orderId}`);
    setDraft(d);
    return d;
  };

  useEffect(() => {
    loadDraft()
      .then(d => {
        const valueOf = (k: string) => d.sources.find(s => s.key === k)?.value ?? '';
        const nextMaps = { steadfast: {}, pathao: {} } as Record<Courier, Record<string, string>>;
        const nextValues = { steadfast: {}, pathao: {} } as Record<Courier, Record<string, string>>;
        (Object.keys(TARGETS) as Courier[]).forEach(c => {
          for (const t of TARGETS[c]) {
            const saved = d.fieldMap?.[c]?.[t.key];
            // A remembered mapping to a custom field that no longer exists falls back to the default
            const key = saved && d.sources.some(s => s.key === saved) ? saved : DEFAULT_MAP[t.key];
            nextMaps[c][t.key] = key;
            nextValues[c][t.key] = valueOf(key);
          }
        });
        setMaps(nextMaps);
        setValues(nextValues);
        // Open on the courier the order was booked with, else the one that's set up
        const booked = d.shipment?.courierName;
        const first: Courier = booked === 'pathao' || booked === 'steadfast' ? booked
          : !d.credentials.steadfast.configured && d.credentials.pathao.configured ? 'pathao' : 'steadfast';
        setTab(first);
        setSettingsOpen(!d.credentials[first].configured);
        setStoreId(d.credentials.pathao.storeId || '');
      })
      .catch((e: unknown) => { onToast(errMsg(e), 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const pathaoReady = Boolean(draft?.credentials.pathao.configured);

  // Pathao stores + cities once credentials work
  useEffect(() => {
    if (tab !== 'pathao' || !pathaoReady || cities.length) return;
    setLocLoading(true);
    Promise.all([
      request<Option[]>(`${base}/courier/pathao/stores`),
      request<Option[]>(`${base}/courier/pathao/cities`),
    ])
      .then(([st, ci]) => {
        setStores(st); setCities(ci);
        if (!storeId && st.length === 1) setStoreId(String(st[0].id));
      })
      .catch((e: unknown) => onToast(`Pathao: ${errMsg(e)}`, 'error'))
      .finally(() => setLocLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pathaoReady]);

  const pickCity = (id: string) => {
    setCityId(id); setZoneId(''); setAreaId(''); setZones([]); setAreas([]);
    if (!id) return;
    request<Option[]>(`${base}/courier/pathao/zones/${id}`).then(setZones).catch((e: unknown) => onToast(errMsg(e), 'error'));
  };
  const pickZone = (id: string) => {
    setZoneId(id); setAreaId(''); setAreas([]);
    if (!id) return;
    request<Option[]>(`${base}/courier/pathao/areas/${id}`).then(setAreas).catch(() => setAreas([]));
  };

  const setValue = (t: string, v: string) =>
    setValues(vs => ({ ...vs, [tab]: { ...vs[tab], [t]: v } }));

  const pickSource = (t: string, key: string) => {
    setMaps(ms => ({ ...ms, [tab]: { ...ms[tab], [t]: key } }));
    setValue(t, sourceByKey.get(key)?.value ?? '');
    setMenu(null);
  };

  const saveCredentials = async () => {
    if (!Object.values(cred).some(v => v.trim())) { setSettingsOpen(false); return; }
    setSavingCred(true);
    try {
      await request(`${base}/courier/credentials/${tab}`, { method: 'PATCH', body: JSON.stringify(cred) });
      setCred({});
      await loadDraft();
      setCities([]); // re-fetch Pathao lists with the new login
      setSettingsOpen(false);
      onToast(copy('✅ Courier key সেভ হয়েছে', '✅ Courier keys saved'), 'success');
    } catch (e: unknown) { onToast(errMsg(e), 'error'); }
    finally { setSavingCred(false); }
  };

  const book = async () => {
    if (!draft) return;
    const v = values[tab];
    const missing = TARGETS[tab].find(t => !t.optional && !String(v[t.key] ?? '').trim());
    if (missing) { onToast(copy(`${missing.bn} দিন`, `${missing.en} is required`), 'error'); return; }
    const cod = Number(v.codAmount);
    if (!Number.isFinite(cod) || cod < 0) { onToast(copy('COD Amount সঠিক সংখ্যা দিন', 'Enter a valid COD amount'), 'error'); return; }
    if (tab === 'pathao' && (!storeId || !cityId || !zoneId)) {
      onToast(copy('Pathao-র Store, City আর Zone বাছাই করুন', 'Select Pathao store, city and zone'), 'error'); return;
    }
    setBooking(true);
    try {
      const body: Record<string, unknown> = {
        orderId: draft.orderId,
        courier: tab,
        invoice: v.invoice.trim(),
        recipientName: v.recipientName.trim(),
        recipientPhone: v.recipientPhone.trim(),
        recipientAddress: v.recipientAddress.trim(),
        codAmount: cod,
        note: (v.note || '').trim(),
        force: rebook,
      };
      if (tab === 'pathao') {
        Object.assign(body, {
          itemDescription: (v.itemDescription || '').trim(),
          itemQuantity: Math.max(1, Number(v.itemQuantity) || 1),
          weight: Math.min(10, Math.max(0.5, Number(weight) || 0.5)),
          pathaoStoreId: storeId,
          pathaoCityId: Number(cityId),
          pathaoZoneId: Number(zoneId),
          pathaoAreaId: areaId ? Number(areaId) : undefined,
        });
        if (storeId !== draft.credentials.pathao.storeId) {
          void request(`${base}/courier/credentials/pathao`, { method: 'PATCH', body: JSON.stringify({ storeId }) }).catch(() => {});
        }
      }
      const res = await request<{ trackingId: string | null }>(`${base}/courier/book`, { method: 'POST', body: JSON.stringify(body) });
      // Remember the chosen mapping for next time — best-effort
      void request(`${base}/courier/field-map/${tab}`, { method: 'PATCH', body: JSON.stringify(maps[tab]) }).catch(() => {});
      onToast(copy(`✅ ${COURIER_META[tab].label}-এ entry হয়েছে${res?.trackingId ? ` · ${res.trackingId}` : ''}`,
        `✅ Booked with ${COURIER_META[tab].label}${res?.trackingId ? ` · ${res.trackingId}` : ''}`), 'success');
      onBooked();
      onClose();
    } catch (e: unknown) { onToast(errMsg(e), 'error'); }
    finally { setBooking(false); }
  };

  const meta = COURIER_META[tab];
  const creds = draft?.credentials[tab];
  const ship = draft?.shipment;
  const liveShipment = ship && ship.trackingId && ship.courierName !== 'manual' && ship.status !== 'cancelled';

  const credFields: { key: string; label: string; current?: string; type?: string }[] = tab === 'steadfast'
    ? [
        { key: 'apiKey', label: 'API Key', current: draft?.credentials.steadfast.apiKey },
        { key: 'secretKey', label: 'Secret Key', current: draft?.credentials.steadfast.secretKey },
      ]
    : [
        { key: 'apiKey', label: 'Client ID', current: draft?.credentials.pathao.apiKey },
        { key: 'secretKey', label: 'Client Secret', current: draft?.credentials.pathao.secretKey },
        { key: 'username', label: copy('Merchant Email', 'Merchant Email'), current: draft?.credentials.pathao.username },
        { key: 'password', label: copy('Merchant Password', 'Merchant Password'), current: draft?.credentials.pathao.password, type: 'password' },
      ];

  const selectStyle = { ...th.input, cursor: 'pointer' } as React.CSSProperties;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
      onClick={onClose}>
      <div style={{ ...th.card, width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', border: `1.5px solid ${th.border}`, position: 'relative' }}
        onClick={e => { e.stopPropagation(); setMenu(null); }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', background: th.surface, borderRadius: 10, padding: 3, border: `1px solid ${th.border}`, gap: 2, flex: 1 }}>
            {(Object.keys(COURIER_META) as Courier[]).map(c => (
              <button key={c} onClick={() => { setTab(c); setMenu(null); setSettingsOpen(Boolean(draft && !draft.credentials[c].configured)); setCred({}); }}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 700,
                  background: tab === c ? th.panel : 'transparent',
                  color: tab === c ? COURIER_META[c].color : th.muted,
                  boxShadow: tab === c ? th.shadow : 'none',
                }}>
                {COURIER_META[c].label}
                {draft?.credentials[c].configured && <span style={{ marginLeft: 4, fontSize: 10 }}>✓</span>}
              </button>
            ))}
          </div>
          <button style={th.btnSmGhost} onClick={onClose} title={copy('বন্ধ করুন', 'Close')}>✕</button>
        </div>

        <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 900, color: meta.color, letterSpacing: '-0.02em', marginBottom: 12 }}>
          🚚 {meta.label} <span style={{ fontSize: 12, fontWeight: 600, color: th.muted }}>Courier · Order #{orderId}</span>
        </div>

        {!draft ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22} color={th.accent} /></div>
        ) : (
          <>
            {/* Courier settings (API keys) */}
            <div style={{ border: `1px solid ${th.border}`, borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
              <button onClick={() => setSettingsOpen(o => !o)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: th.surface, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: th.text }}>
                <span>⚙️ {meta.label} settings {creds?.configured
                  ? <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 11 }}>· {copy('সংযুক্ত', 'connected')}</span>
                  : <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 11 }}>· {copy('key দেওয়া হয়নি', 'not set up')}</span>}</span>
                <span style={{ color: th.muted }}>{settingsOpen ? '▴' : '▾'}</span>
              </button>
              {settingsOpen && (
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11.5, color: th.muted, lineHeight: 1.5 }}>
                    {tab === 'steadfast'
                      ? copy('Steadfast Merchant app → API Integration থেকে API Key আর Secret Key copy করে বসান।', 'Copy the API Key and Secret Key from Steadfast Merchant → API Integration.')
                      : copy('Pathao Merchant panel → Developers API থেকে Client ID / Secret, আর merchant login-এর email/password দিন।', 'Enter the Client ID / Secret from Pathao Merchant → Developers API, plus your merchant login email/password.')}
                  </div>
                  {credFields.map(f => (
                    <Field key={f.key} th={th} label={f.label}>
                      <input style={th.input} type={f.type || 'text'} autoComplete="off"
                        value={cred[f.key] || ''} onChange={e => setCred(c => ({ ...c, [f.key]: e.target.value }))} />
                      {f.current && (
                        <div style={{ fontSize: 11, color: th.muted, marginTop: 3 }}>
                          {copy('এখন আছে', 'Current')}: <b>{f.current}</b>. {copy('খালি রাখলে আগেরটাই থাকবে।', 'Leave blank to keep current value.')}
                        </div>
                      )}
                    </Field>
                  ))}
                  <button style={{ ...th.btnPrimary, alignSelf: 'flex-end' }} onClick={saveCredentials} disabled={savingCred}>
                    {savingCred ? <Spinner size={12} /> : copy('Key সেভ করুন', 'Save keys')}
                  </button>
                </div>
              )}
            </div>

            {liveShipment && (
              <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f59e0b14', border: '1px solid #f59e0b40', fontSize: 12.5, color: th.text, marginBottom: 14, lineHeight: 1.6 }}>
                ⚠️ {copy('এই order আগেই book করা আছে', 'This order is already booked')}: <b>{ship!.courierName}</b> · {ship!.trackingId}
                {ship!.trackingUrl && <> · <a href={ship!.trackingUrl} target="_blank" rel="noreferrer" style={{ color: th.accent }}>Track</a></>}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rebook} onChange={e => setRebook(e.target.checked)} style={{ accentColor: '#f59e0b' }} />
                  {copy('তবুও আবার book করুন (courier-এ নতুন parcel তৈরি হবে)', 'Book again anyway (creates a new parcel)')}
                </label>
              </div>
            )}

            {/* Booking form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {TARGETS[tab].map(t => {
                const mapped = sourceByKey.get(maps[tab][t.key]);
                const menuKey = `${tab}:${t.key}`;
                const common = {
                  style: { ...th.input, flex: 1, minWidth: 0, ...(t.multiline ? { minHeight: 54, resize: 'vertical' as const } : {}) },
                  value: values[tab][t.key] ?? '',
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(t.key, e.target.value),
                };
                return (
                  <div key={menuKey}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: th.textSub }}>
                        {copy(t.bn, t.en)}{t.optional && <span style={{ color: th.muted, fontWeight: 500 }}> ({copy('ঐচ্ছিক', 'optional')})</span>}
                      </span>
                      {mapped && <span style={{ fontSize: 10.5, color: th.muted }}>← {mapped.label}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', position: 'relative' }}>
                      {t.multiline
                        ? <textarea {...common} />
                        : <input {...common} inputMode={t.numeric ? 'decimal' : undefined} />}
                      <button style={{ ...th.btnSmGhost, padding: '8px 10px', flexShrink: 0 }}
                        title={copy('কোন তথ্য বসবে বাছাই করুন', 'Choose which order value fills this')}
                        onClick={e => { e.stopPropagation(); setMenu(menu === menuKey ? null : menuKey); }}>▾</button>
                      {menu === menuKey && (
                        <div onClick={e => e.stopPropagation()}
                          style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20, background: th.panel, border: `1px solid ${th.border}`, borderRadius: 10, boxShadow: th.shadow, width: 240, maxHeight: 260, overflowY: 'auto' }}>
                          {draft.sources.map(s => (
                            <button key={s.key} onClick={() => pickSource(t.key, s.key)}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                                background: maps[tab][t.key] === s.key ? th.accentSoft : 'transparent', color: th.text,
                              }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                              <div style={{ fontSize: 11, color: th.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {s.value || copy('(খালি)', '(empty)')}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {t.key === 'codAmount' && draft.paymentStatus === 'advance_paid' && (
                      <div style={{ fontSize: 11, color: '#b45309', marginTop: 3 }}>
                        💳 {copy('Customer advance দিয়েছে — COD থেকে advance-এর টাকা বাদ দিন।', 'Customer paid an advance — subtract it from the COD amount.')}
                      </div>
                    )}
                  </div>
                );
              })}

              {tab === 'pathao' && (
                pathaoReady ? (
                  <>
                    {locLoading && <div style={{ fontSize: 12, color: th.muted }}><Spinner size={11} /> {copy('Pathao থেকে লোড হচ্ছে…', 'Loading from Pathao…')}</div>}
                    <Field th={th} label="Store">
                      <select style={selectStyle} value={storeId} onChange={e => setStoreId(e.target.value)}>
                        <option value="">{copy('— Store বাছাই করুন —', '— Select store —')}</option>
                        {stores.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                      </select>
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <Field th={th} label="City">
                        <select style={selectStyle} value={cityId} onChange={e => pickCity(e.target.value)}>
                          <option value="">—</option>
                          {cities.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                        </select>
                      </Field>
                      <Field th={th} label="Zone">
                        <select style={selectStyle} value={zoneId} onChange={e => pickZone(e.target.value)} disabled={!cityId}>
                          <option value="">—</option>
                          {zones.map(z => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <Field th={th} label={copy('Area (ঐচ্ছিক)', 'Area (optional)')}>
                        <select style={selectStyle} value={areaId} onChange={e => setAreaId(e.target.value)} disabled={!zoneId || !areas.length}>
                          <option value="">—</option>
                          {areas.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                        </select>
                      </Field>
                      <Field th={th} label={copy('ওজন (kg)', 'Weight (kg)')}>
                        <input style={th.input} inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} />
                      </Field>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#dc2626' }}>
                    {copy('Pathao-র City/Zone দেখাতে আগে উপরের settings-এ key দিন।', 'Add your Pathao keys above to load cities and zones.')}
                  </div>
                )
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button style={{ ...th.btnGhost, flex: 1 }} onClick={onClose}>{copy('বাতিল', 'Cancel')}</button>
              <button onClick={book}
                disabled={booking || !creds?.configured || (Boolean(liveShipment) && !rebook)}
                style={{ ...th.btnPrimary, flex: 2, background: meta.color, borderColor: meta.color, opacity: (!creds?.configured || (liveShipment && !rebook)) ? 0.5 : 1 }}>
                {booking ? <Spinner size={13} /> : copy('Create Entry', 'Create Entry')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
