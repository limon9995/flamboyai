import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardHeader, EmptyState, Field, FieldWithInfo, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';
import LocationPickerMap from '../components/LocationPickerMap';
import { previewDeliveryFee } from '../utils/geo';
import type { DeliverySlab } from '../utils/geo';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PriceVariant { label: string; price: number; pieces?: number | null }
interface FoodProduct {
  id: number; code: string; name: string | null; price: number;
  imageUrl: string | null; description: string | null; category: string | null;
  isActive: boolean; catalogVisible: boolean;
  priceVariantsJson: string | null; trackStock: boolean;
  stockQty: number; productType: string;
  referenceImagesJson?: string | null; isFeatured?: boolean;
}
interface Ingredient {
  id: number; name: string; unit: string; stockQty: number;
  minStock: number; costPerUnit: number; isActive: boolean; low?: boolean;
}
interface RecipeRow { ingredientId: number; qty: number; per: 'item' | 'piece'; variantLabel: string | null }
interface ScanDish {
  name: string; category: string | null; description: string | null;
  variants: { label: string; price: number; pieces: number | null }[];
  imageUrl?: string | null;
  ingredients?: { name: string; qty: number; unit: string }[];
  _checked?: boolean;
}
interface RestoSettings {
  restaurantModeEnabled: boolean;
  restaurantLat: number | null;
  restaurantLng: number | null;
  deliverySlabs: DeliverySlab[];
  currencySymbol?: string;
  loyaltyEnabled: boolean;
  loyaltyThresholdOrders: number | null;
  loyaltyDiscountPercent: number | null;
  happyHourEnabled: boolean;
  happyHourDiscountPercent: number | null;
  happyHourLabel: string;
  milestoneRewardsEnabled: boolean;
}
interface HoursRow { day: number; open: string; close: string; closed: boolean }

const CATEGORY_SUGGESTIONS = ['Burger', 'Momo', 'Shawarma', 'Meatbox', 'Pizza', 'Rice', 'Sides', 'Drinks', 'Dessert', 'Combo'];
const UNIT_OPTIONS = ['pcs', 'gm', 'kg', 'ml', 'liter'];

function ingredientHelp(copy: (bn: string, en: string) => string) {
  return {
    name: copy('যা কিছু রান্না/প্যাকেজিং-এ লাগে — যেমন: Small Bun, Chicken (gm), Box, Carry Bag', 'Anything used in cooking or packaging — e.g. Small Bun, Chicken (gm), Box, Carry Bag'),
    unit: copy('কোন এককে হিসাব রাখবেন — gm/kg (ওজন), pcs (সংখ্যা), ml/liter (তরল)', 'The unit you track stock in — gm/kg (weight), pcs (count), ml/liter (liquid)'),
    stockQty: copy('এখন হাতে কত আছে', 'How much you currently have in stock'),
    minStock: copy('এর নিচে নামলে "কম স্টক" সতর্কতা দেখাবে', 'Shows a "low stock" warning once stock drops to or below this'),
    costPerUnit: copy('প্রতি ইউনিটের খরচ — দিলে recipe থেকে dish-এর cost ও লাভ হিসাব করা যাবে', 'Cost per unit — enables per-dish cost/profit calculation from the recipe'),
  };
}
const DAY_NAMES_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultHours(): HoursRow[] {
  return Array.from({ length: 7 }, (_, day) => ({ day, open: '10:00', close: '22:00', closed: false }));
}

function parseVariants(json: string | null): PriceVariant[] {
  try {
    const raw = JSON.parse(json || '[]');
    return Array.isArray(raw) ? raw.filter((v: any) => v?.label && Number.isFinite(Number(v?.price))) : [];
  } catch { return []; }
}

function parseReferenceImages(value: string | null | undefined): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter((url, index, all) => all.indexOf(url) === index);
    }
  } catch {}
  return [];
}

function priceRange(p: FoodProduct, cur: string): string {
  const vars = parseVariants(p.priceVariantsJson);
  if (!vars.length) return `${cur}${Number(p.price).toLocaleString()}`;
  const prices = vars.map(v => Number(v.price));
  const min = Math.min(...prices), max = Math.max(...prices);
  return min === max ? `${cur}${min.toLocaleString()}` : `${cur}${min.toLocaleString()} – ${cur}${max.toLocaleString()}`;
}

// ── Variant rows editor (shared by add/edit/scan-review) ─────────────────────
function VariantEditor({ th, variants, onChange, cur }: {
  th: Theme; variants: PriceVariant[]; cur: string;
  onChange: (v: PriceVariant[]) => void;
}) {
  const { copy } = useLanguage();
  const set = (i: number, k: keyof PriceVariant, val: any) =>
    onChange(variants.map((v, j) => j === i ? { ...v, [k]: val } : v));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {variants.map((v, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 28px', gap: 6, alignItems: 'center' }}>
          <input style={{ ...th.input, padding: '7px 10px' }} placeholder={copy('যেমন: 5 pcs / Regular', 'e.g. 5 pcs / Regular')}
            value={v.label} onChange={e => set(i, 'label', e.target.value)} />
          <input style={{ ...th.input, padding: '7px 10px' }} type="number" min={0} placeholder={`${cur} দাম`}
            value={Number.isFinite(v.price) ? v.price : ''} onChange={e => set(i, 'price', Number(e.target.value))} />
          <input style={{ ...th.input, padding: '7px 10px' }} type="number" min={0} placeholder="pcs"
            title={copy('Piece সংখ্যা (recipe-র per-piece হিসাবের জন্য, optional)', 'Piece count (for per-piece recipes, optional)')}
            value={v.pieces || ''} onChange={e => set(i, 'pieces', Number(e.target.value) || null)} />
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }}
            onClick={() => onChange(variants.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {variants.length < 12 && (
        <button style={{ ...th.btnGhost, fontSize: 12, alignSelf: 'flex-start' }}
          onClick={() => onChange([...variants, { label: '', price: 0, pieces: null }])}>
          + {copy('Size/দাম যোগ করুন', 'Add size/price')}
        </button>
      )}
      <div style={{ fontSize: 11.5, color: th.muted }}>
        {copy('একটাই দাম হলে একটা row রাখুন (যেমন "Regular")। "pcs" ঘরটা momo-র মতো per-piece recipe হিসাবের জন্য — 5 pcs হলে 5 লিখুন।', 'Single price = one row (e.g. "Regular"). The "pcs" box feeds per-piece recipes — write 5 for "5 pcs".')}
      </div>
    </div>
  );
}

// ── Food product form modal (add + edit) ─────────────────────────────────────
function FoodFormModal({ th, pageId, product, categories, cur, onClose, onSaved, onToast }: {
  th: Theme; pageId: number; product: FoodProduct | null; categories: string[]; cur: string;
  onClose: () => void; onSaved: () => void; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const BASE = `${API_BASE}/client-dashboard/${pageId}`;
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [form, setForm] = useState(() => ({
    name: product?.name || '',
    category: product?.category || '',
    description: product?.description || '',
    imageUrl: product?.imageUrl || '',
    isActive: product ? product.isActive : true,
    variants: product ? parseVariants(product.priceVariantsJson) : [] as PriceVariant[],
    singlePrice: product && !parseVariants(product.priceVariantsJson).length ? product.price : 0,
    referenceImages: product ? parseReferenceImages(product.referenceImagesJson) : [] as string[],
    isFeatured: product?.isFeatured || false,
  }));
  const multi = form.variants.length > 0;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE}/products/upload-image`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setForm(f => ({ ...f, imageUrl: data.url }));
    } catch (e: any) { onToast(e.message || 'Upload failed', 'error'); }
    finally { setUploading(false); }
  };

  const uploadGalleryPhoto = async (file: File) => {
    setGalleryUploading(true);
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE}/products/upload-image`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setForm(f => ({ ...f, referenceImages: [...f.referenceImages, data.url] }));
    } catch (e: any) { onToast(e.message || 'Upload failed', 'error'); }
    finally { setGalleryUploading(false); }
  };

  const save = async () => {
    if (!form.name.trim()) return onToast(copy('নাম দিন', 'Name required'), 'error');
    const variants = form.variants.filter(v => v.label.trim() && Number.isFinite(v.price));
    if (!multi && !(Number(form.singlePrice) > 0) && !variants.length)
      return onToast(copy('দাম দিন', 'Price required'), 'error');
    setSaving(true);
    try {
      if (product) {
        await request(`${RBASE}/products/${product.code}/food`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category.trim() || null,
            description: form.description,
            imageUrl: form.imageUrl,
            isActive: form.isActive,
            isFeatured: form.isFeatured,
            referenceImagesJson: form.referenceImages.length ? JSON.stringify(form.referenceImages) : null,
            ...(variants.length
              ? { priceVariants: variants }
              : { priceVariants: null, price: Number(form.singlePrice) }),
          }),
        });
      } else {
        const dish = {
          name: form.name.trim(),
          category: form.category.trim() || null,
          description: form.description || null,
          imageUrl: form.imageUrl || null,
          variants: variants.length
            ? variants
            : [{ label: 'Regular', price: Number(form.singlePrice), pieces: null }],
        };
        const res = await request<any>(`${RBASE}/products/bulk`, {
          method: 'POST', body: JSON.stringify({ dishes: [dish] }),
        });
        if (res?.failed?.length) throw new Error(res.failed[0]?.reason || 'Failed');
      }
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
      onSaved(); onClose();
    } catch (e: any) { onToast(e.message || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...th.card, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', border: `1.5px solid ${th.border}` }}>
        <CardHeader th={th} title={product ? copy('🍽️ খাবার Edit করুন', '🍽️ Edit Item') : copy('🍽️ নতুন খাবার যোগ করুন', '🍽️ Add Food Item')} sub={product ? product.code : undefined} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field th={th} label={copy('খাবারের নাম *', 'Item Name *')}>
            <input style={th.input} placeholder="Beef Burger" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field th={th} label={copy('Category', 'Category')}>
              <input style={th.input} list="resto-cats" placeholder="Burger / Momo / Drinks" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              <datalist id="resto-cats">
                {[...new Set([...categories, ...CATEGORY_SUGGESTIONS])].map(c => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field th={th} label={copy('ছবি', 'Photo')}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {form.imageUrl && <img src={form.imageUrl.startsWith('http') ? form.imageUrl : `${API_BASE}${form.imageUrl}`} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', border: `1px solid ${th.border}` }} />}
                <label style={{ ...th.btnGhost, fontSize: 12, cursor: 'pointer', margin: 0 }}>
                  {uploading ? <Spinner size={12} /> : copy('📷 Upload', '📷 Upload')}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                </label>
              </div>
            </Field>
          </div>

          {product && (
            <Field th={th} label={copy('আরো ছবি (গ্যালারি — একাধিক angle)', 'More photos (gallery — multiple angles)')}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {form.referenceImages.map((url, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={url.startsWith('http') ? url : `${API_BASE}${url}`} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', border: `1px solid ${th.border}` }} />
                    <button type="button" onClick={() => setForm(f => ({ ...f, referenceImages: f.referenceImages.filter((_, j) => j !== i) }))}
                      style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: 'none', background: '#dc2626', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>
                ))}
                <label style={{ ...th.btnGhost, fontSize: 12, cursor: 'pointer', margin: 0 }}>
                  {galleryUploading ? <Spinner size={12} /> : `+ ${copy('ছবি যোগ করুন', 'Add photo')}`}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadGalleryPhoto(f); e.target.value = ''; }} />
                </label>
              </div>
            </Field>
          )}

          <Field th={th} label={copy('বিবরণ (ঐচ্ছিক)', 'Description (optional)')}>
            <textarea style={{ ...th.input, minHeight: 56 }} placeholder={copy('উপকরণ, স্বাদ, স্পেশাল কিছু...', 'Ingredients, taste, anything special...')}
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </Field>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              💰 {copy('দাম — Size/পরিমাণ অনুযায়ী', 'Pricing — by size/portion')}
            </div>
            {!multi && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input style={{ ...th.input, width: 130 }} type="number" min={0} placeholder={`${cur} দাম`}
                  value={form.singlePrice || ''} onChange={e => setForm(f => ({ ...f, singlePrice: Number(e.target.value) }))} />
                <button style={{ ...th.btnGhost, fontSize: 12 }}
                  onClick={() => setForm(f => ({ ...f, variants: [{ label: '', price: f.singlePrice || 0, pieces: null }] }))}>
                  + {copy('একাধিক size/দাম আছে?', 'Multiple sizes?')}
                </button>
              </div>
            )}
            {multi && <VariantEditor th={th} cur={cur} variants={form.variants} onChange={v => setForm(f => ({ ...f, variants: v }))} />}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
            {copy('Active — website-এ দেখাবে ও order নেওয়া যাবে', 'Active — visible & orderable')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isFeatured} onChange={e => setForm(f => ({ ...f, isFeatured: e.target.checked }))} />
            {copy('🔥 Featured / জনপ্রিয় — card-এ badge দেখাবে', '🔥 Featured / best-seller — shows a badge on the card')}
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={th.btnPrimary} onClick={save} disabled={saving}>
              {saving ? <><Spinner size={13} /> {copy('Saving...', 'Saving...')}</> : copy('✓ Save করুন', '✓ Save')}
            </button>
            <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Menu scan modal: upload photos → AI → review table → bulk create ─────────
function MenuScanModal({ th, pageId, cur, onClose, onDone, onToast }: {
  th: Theme; pageId: number; cur: string;
  onClose: () => void; onDone: () => void; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const BASE = `${API_BASE}/client-dashboard/${pageId}`;
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dishes, setDishes] = useState<ScanDish[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  // Per-dish photo during review — the image lands on the product at create
  // time, so it shows on the website + Messenger cards immediately.
  const uploadDishPhoto = async (i: number, file: File) => {
    setUploadingIdx(i);
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE}/products/upload-image`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDishes(ds => ds.map((d, j) => j === i ? { ...d, imageUrl: data.url } : d));
    } catch (e: any) { onToast(e.message || 'Upload failed', 'error'); }
    finally { setUploadingIdx(null); }
  };

  const scan = async () => {
    if (!files.length) return onToast(copy('Menu-র ছবি বেছে নিন', 'Pick menu photo(s)'), 'error');
    setBusy(true);
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const urls: string[] = [];
      for (const f of files.slice(0, 5)) {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch(`${BASE}/products/upload-image`, {
          method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: fd,
        });
        if (!res.ok) throw new Error(await res.text());
        urls.push((await res.json()).url);
      }
      const out = await request<{ dishes: ScanDish[] }>(`${RBASE}/menu-scan`, {
        method: 'POST', body: JSON.stringify({ imageUrls: urls }),
      });
      const found = (out?.dishes || []).map(d => ({ ...d, _checked: true }));
      if (!found.length) {
        onToast(copy('কোনো item পড়া যায়নি — আরো পরিষ্কার ছবি দিয়ে চেষ্টা করুন', 'Nothing readable — try a clearer photo'), 'error');
      } else {
        setDishes(found);
        setStep('review');
      }
    } catch (e: any) { onToast(e.message || 'Scan failed', 'error'); }
    finally { setBusy(false); }
  };

  const createAll = async () => {
    if (uploadingIdx !== null) return onToast(copy('ছবি upload হচ্ছে — একটু অপেক্ষা করুন', 'Photo uploading — wait a moment'), 'error');
    const chosen = dishes.filter(d => d._checked && d.name.trim() && d.variants.length);
    if (!chosen.length) return onToast(copy('কিছু select করুন', 'Select at least one'), 'error');
    setBusy(true);
    try {
      const res = await request<any>(`${RBASE}/products/bulk`, {
        method: 'POST',
        body: JSON.stringify({ dishes: chosen.map(({ _checked, ...d }) => d) }),
      });
      onToast(copy(`✅ ${res.createdCount}টা item যোগ হয়েছে${res.failed?.length ? ` — ${res.failed.length}টা হয়নি` : ''}`, `✅ ${res.createdCount} items added${res.failed?.length ? `, ${res.failed.length} failed` : ''}`), 'success');
      onDone(); onClose();
    } catch (e: any) { onToast(e.message || 'Error', 'error'); }
    finally { setBusy(false); }
  };

  const setDish = (i: number, patch: Partial<ScanDish>) =>
    setDishes(ds => ds.map((d, j) => j === i ? { ...d, ...patch } : d));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...th.card, width: '100%', maxWidth: step === 'review' ? 780 : 480, maxHeight: '90vh', overflowY: 'auto', border: `1.5px solid ${th.border}` }}>
        <CardHeader th={th} title={copy('📷 Menu Scan — AI দিয়ে সব খাবার Add', '📷 Menu Scan — AI import')}
          sub={step === 'upload'
            ? copy('Menu-র পরিষ্কার ছবি দিন (সর্বোচ্চ ৫টা) — AI নাম/দাম/size পড়ে নেবে', 'Upload clear menu photos (max 5) — AI reads names/prices/sizes')
            : copy('AI যা পড়েছে check করুন — 📷 ঘরে খাবারের ছবি দিন (website/card-এ দেখাবে), ভুল ঠিক করুন, তারপর Add চাপুন', 'Review what AI read — add a 📷 photo per dish (shows on the website/cards), fix mistakes, then Add')} />

        {step === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 26, borderRadius: 12, border: `2px dashed ${th.border}`, cursor: 'pointer', color: th.muted, fontSize: 13.5 }}>
              <span style={{ fontSize: 30 }}>📄</span>
              {files.length ? `${files.length}টা ছবি selected` : copy('Menu-র ছবি বেছে নিন / তুলুন', 'Choose / take menu photos')}
              <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 5))} />
            </label>
            {files.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {files.map((f, i) => (
                  <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: th.accentSoft, color: th.accentText }}>
                    🖼️ {f.name.slice(0, 24)}
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={th.btnPrimary} onClick={scan} disabled={busy || !files.length}>
                {busy ? <><Spinner size={13} /> {copy('AI পড়ছে...', 'AI reading...')}</> : copy('🔍 Scan করুন', '🔍 Scan')}
              </button>
              <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: th.muted }}>
              ✅ {dishes.filter(d => d._checked).length}/{dishes.length} {copy('টা item add হবে', 'items will be added')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '52vh', overflowY: 'auto', paddingRight: 4 }}>
              {dishes.map((d, i) => (
                <div key={i} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${d._checked ? th.accent : th.border}`, opacity: d._checked ? 1 : 0.55 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '24px 44px 1fr 150px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <input type="checkbox" checked={!!d._checked} onChange={e => setDish(i, { _checked: e.target.checked })} />
                    <label title={copy('খাবারের ছবি দিন — website ও Messenger card-এ দেখাবে', 'Add a photo — shows on the website & Messenger cards')}
                      style={{ width: 44, height: 44, borderRadius: 9, border: `1.5px dashed ${d.imageUrl ? th.accent : th.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', background: th.accentSoft }}>
                      {uploadingIdx === i
                        ? <Spinner size={14} />
                        : d.imageUrl
                          ? <img src={d.imageUrl.startsWith('http') ? d.imageUrl : `${API_BASE}${d.imageUrl}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 17 }}>📷</span>}
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadDishPhoto(i, f); e.target.value = ''; }} />
                    </label>
                    <input style={{ ...th.input, padding: '7px 10px', fontWeight: 700 }} value={d.name}
                      onChange={e => setDish(i, { name: e.target.value })} />
                    <input style={{ ...th.input, padding: '7px 10px' }} placeholder="Category" value={d.category || ''}
                      onChange={e => setDish(i, { category: e.target.value || null })} />
                  </div>
                  {d._checked && (
                    <VariantEditor th={th} cur={cur} variants={d.variants as PriceVariant[]}
                      onChange={v => setDish(i, { variants: v as any })} />
                  )}
                  {d._checked && !!d.ingredients?.length && (
                    <div style={{ fontSize: 11.5, color: th.muted, marginTop: 6 }}>
                      🥕 {copy('AI suggested recipe', 'AI-suggested recipe')}: {d.ingredients.map(ing => `${ing.name} ${ing.qty}${ing.unit}`).join(', ')}
                      {' — '}{copy('Add-এর পর Recipe editor থেকে দেখুন/বদলান', 'review/edit later via the Recipe editor')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={th.btnPrimary} onClick={createAll} disabled={busy}>
                {busy ? <><Spinner size={13} /> {copy('Add হচ্ছে...', 'Adding...')}</> : copy(`✓ ${dishes.filter(d => d._checked).length}টা Product Add করুন`, `✓ Add ${dishes.filter(d => d._checked).length} products`)}
              </button>
              <button style={th.btnGhost} onClick={() => setStep('upload')}>{copy('← আবার Scan', '← Rescan')}</button>
              <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recipe editor modal ───────────────────────────────────────────────────────
function RecipeModal({ th, pageId, product, ingredients, onClose, onToast }: {
  th: Theme; pageId: number; product: FoodProduct; ingredients: Ingredient[];
  onClose: () => void; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const variants = parseVariants(product.priceVariantsJson);

  useEffect(() => {
    request<any>(`${RBASE}/products/${product.code}/recipe`)
      .then(r => setRows((r?.items || []).map((it: any) => ({
        ingredientId: it.ingredientId, qty: it.qty, per: it.per === 'piece' ? 'piece' : 'item', variantLabel: it.variantLabel ?? null,
      }))))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.code]);

  const set = (i: number, patch: Partial<RecipeRow>) =>
    setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));

  const save = async () => {
    const clean = rows.filter(r => r.ingredientId && r.qty > 0);
    setSaving(true);
    try {
      await request(`${RBASE}/products/${product.code}/recipe`, {
        method: 'PUT', body: JSON.stringify({ rows: clean }),
      });
      onToast(copy('✅ Recipe সেভ হয়েছে', '✅ Recipe saved'), 'success');
      onClose();
    } catch (e: any) { onToast(e.message || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  const unitOf = (id: number) => ingredients.find(x => x.id === id)?.unit || '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...th.card, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', border: `1.5px solid ${th.border}` }}>
        <CardHeader th={th} title={`🧾 Recipe — ${product.name || product.code}`}
          sub={copy('এই খাবার বানাতে কী কী লাগে — order confirm হলে stock থেকে auto বাদ যাবে', 'What goes into this item — auto-deducted on order confirm')} />
        {loading ? <div style={{ padding: 20 }}><Spinner size={16} /></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 88px 120px 120px 26px', gap: 6, alignItems: 'center' }}>
                <select style={{ ...th.input, padding: '7px 10px' }} value={r.ingredientId}
                  onChange={e => set(i, { ingredientId: Number(e.target.value) })}>
                  <option value={0}>-- ingredient --</option>
                  {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>)}
                </select>
                <input style={{ ...th.input, padding: '7px 10px' }} type="number" min={0} step="any"
                  placeholder={`qty ${unitOf(r.ingredientId)}`} value={r.qty || ''}
                  onChange={e => set(i, { qty: Number(e.target.value) })} />
                <select style={{ ...th.input, padding: '7px 10px' }} value={r.per}
                  onChange={e => set(i, { per: e.target.value === 'piece' ? 'piece' : 'item' })}>
                  <option value="item">{copy('প্রতি item-এ', 'per item')}</option>
                  <option value="piece">{copy('প্রতি piece-এ', 'per piece')}</option>
                </select>
                <select style={{ ...th.input, padding: '7px 10px' }} value={r.variantLabel || ''}
                  onChange={e => set(i, { variantLabel: e.target.value || null })}
                  disabled={!variants.length}
                  title={copy('শুধু নির্দিষ্ট variant-এ লাগলে বেছে নিন (যেমন BBQ sauce শুধু BBQ-তে)', 'Only for a specific variant (e.g. BBQ sauce only in BBQ)')}>
                  <option value="">{copy('সব variant', 'all variants')}</option>
                  {variants.map(v => <option key={v.label} value={v.label}>{v.label}</option>)}
                </select>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }}
                  onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button style={{ ...th.btnGhost, fontSize: 12, alignSelf: 'flex-start' }}
              onClick={() => setRows(rs => [...rs, { ingredientId: 0, qty: 0, per: 'item', variantLabel: null }])}>
              + {copy('Ingredient যোগ করুন', 'Add ingredient')}
            </button>
            <div style={{ fontSize: 11.5, color: th.muted, lineHeight: 1.6 }}>
              💡 {copy('"প্রতি piece" মানে size-এর pcs সংখ্যা দিয়ে গুণ হবে — momo-র patty-র জন্য। "প্রতি item" মানে প্রতিটা order line-এ একবার — burger-এর box-এর জন্য।', '"per piece" multiplies by the size\'s piece count (momo patty). "per item" applies once per line (burger box).')}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button style={th.btnPrimary} onClick={save} disabled={saving}>
                {saving ? <Spinner size={13} /> : copy('✓ Recipe Save করুন', '✓ Save Recipe')}
              </button>
              <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ingredient edit modal ────────────────────────────────────────────────────
function IngredientEditModal({ th, pageId, ingredient, onClose, onToast, onSaved }: {
  th: Theme; pageId: number; ingredient: Ingredient;
  onClose: () => void; onToast: (m: string, t?: any) => void; onSaved: () => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const help = ingredientHelp(copy);
  const [form, setForm] = useState({
    name: ingredient.name, unit: ingredient.unit,
    minStock: ingredient.minStock, costPerUnit: ingredient.costPerUnit,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return onToast(copy('নাম দিন', 'Name required'), 'error');
    setSaving(true);
    try {
      await request(`${RBASE}/ingredients/${ingredient.id}`, { method: 'PATCH', body: JSON.stringify(form) });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
      onSaved();
      onClose();
    } catch (e: any) { onToast(e.message || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...th.card, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', border: `1.5px solid ${th.border}` }}>
        <CardHeader th={th} title={`✏️ ${copy('Ingredient Edit করুন', 'Edit Ingredient')}`}
          sub={copy('স্টক পরিমাণ বদলাতে list-এর ± বাটন ব্যবহার করুন', 'To change the stock amount, use the ± buttons on the ingredient row')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldWithInfo th={th} label={copy('নাম', 'Name')} helpText={help.name}>
            <input style={{ ...th.input, padding: '8px 10px' }} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </FieldWithInfo>
          <FieldWithInfo th={th} label={copy('একক', 'Unit')} helpText={help.unit}>
            <select style={{ ...th.input, padding: '8px 10px' }} value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </FieldWithInfo>
          <FieldWithInfo th={th} label={copy('কম স্টক সীমা', 'Low-stock threshold')} helpText={help.minStock}>
            <input style={{ ...th.input, padding: '8px 10px' }} type="number" value={form.minStock || ''}
              onChange={e => setForm(f => ({ ...f, minStock: Number(e.target.value) }))} />
          </FieldWithInfo>
          <FieldWithInfo th={th} label={copy('প্রতি ইউনিট খরচ', 'Cost per unit')} helpText={help.costPerUnit}>
            <input style={{ ...th.input, padding: '8px 10px' }} type="number" value={form.costPerUnit || ''}
              onChange={e => setForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))} />
          </FieldWithInfo>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button style={th.btnPrimary} onClick={save} disabled={saving}>
              {saving ? <Spinner size={13} /> : copy('✓ সেভ করুন', '✓ Save')}
            </button>
            <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Combo builder modal ──────────────────────────────────────────────────────
function ComboModal({ th, pageId, combo, products, cur, onClose, onToast, onSaved }: {
  th: Theme; pageId: number; combo: any; products: FoodProduct[]; cur: string;
  onClose: () => void; onToast: (m: string, t?: any) => void; onSaved: () => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const isEdit = Boolean(combo?.id);
  const [name, setName] = useState(combo?.name || '');
  const [price, setPrice] = useState(combo?.price || 0);
  const [rows, setRows] = useState<{ componentProductId: number; qty: number }[]>(
    (combo?.comboItems || []).map((ci: any) => ({ componentProductId: ci.componentProductId, qty: ci.qty })),
  );
  const [saving, setSaving] = useState(false);

  const set = (i: number, patch: Partial<{ componentProductId: number; qty: number }>) =>
    setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));

  const componentPool = products.filter(p => (p as any).productType !== 'COMBO');

  const save = async () => {
    if (!name.trim()) return onToast(copy('নাম দিন', 'Name required'), 'error');
    const clean = rows.filter(r => r.componentProductId);
    if (clean.length < 2) return onToast(copy('কমপক্ষে ২টা item দিন', 'Add at least 2 items'), 'error');
    setSaving(true);
    try {
      const body = { name: name.trim(), price: Number(price) || 0, items: clean };
      if (isEdit) await request(`${RBASE}/combos/${combo.code}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request(`${RBASE}/combos`, { method: 'POST', body: JSON.stringify(body) });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
      onSaved();
      onClose();
    } catch (e: any) { onToast(e.message || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...th.card, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', border: `1.5px solid ${th.border}` }}>
        <CardHeader th={th} title={isEdit ? `🧩 ${copy('Combo Edit', 'Edit Combo')}` : `🧩 ${copy('নতুন Combo', 'New Combo')}`}
          sub={copy('২টা+ item বেছে নিয়ে একটা special দামে combo বানান', 'Pick 2+ items and set a bundle price')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
            <input style={{ ...th.input, padding: '8px 10px' }} placeholder={copy('Combo-র নাম (যেমন: Combo A)', 'Combo name (e.g. Combo A)')} value={name} onChange={e => setName(e.target.value)} />
            <input style={{ ...th.input, padding: '8px 10px' }} type="number" placeholder={`${cur} দাম`} value={price || ''} onChange={e => setPrice(Number(e.target.value))} />
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 26px', gap: 6, alignItems: 'center' }}>
              <select style={{ ...th.input, padding: '7px 10px' }} value={r.componentProductId}
                onChange={e => set(i, { componentProductId: Number(e.target.value) })}>
                <option value={0}>-- item --</option>
                {componentPool.map(p => <option key={p.id} value={p.id}>{p.name || p.code}</option>)}
              </select>
              <input style={{ ...th.input, padding: '7px 10px' }} type="number" min={1} value={r.qty || 1}
                onChange={e => set(i, { qty: Number(e.target.value) })} />
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }}
                onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button style={{ ...th.btnGhost, fontSize: 12, alignSelf: 'flex-start' }}
            onClick={() => setRows(rs => [...rs, { componentProductId: 0, qty: 1 }])}>
            + {copy('Item যোগ করুন', 'Add item')}
          </button>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button style={th.btnPrimary} onClick={save} disabled={saving}>
              {saving ? <Spinner size={13} /> : copy('✓ Save করুন', '✓ Save')}
            </button>
            <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Milestone reward modal ───────────────────────────────────────────────────
function MilestoneModal({ th, pageId, milestone, products, onClose, onToast, onSaved }: {
  th: Theme; pageId: number; milestone: any; products: FoodProduct[];
  onClose: () => void; onToast: (m: string, t?: any) => void; onSaved: () => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const isEdit = Boolean(milestone?.id);
  const [orderInterval, setOrderInterval] = useState(milestone?.orderInterval || 3);
  const [rewardType, setRewardType] = useState<'FREE_ITEM' | 'FREE_DELIVERY' | 'DISCOUNT'>(milestone?.rewardType || 'FREE_ITEM');
  const [productId, setProductId] = useState<number>(milestone?.productId || 0);
  const [qty, setQty] = useState(milestone?.qty || 1);
  const [discountPercent, setDiscountPercent] = useState<number>(milestone?.discountPercent || 10);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!orderInterval || orderInterval < 2) return onToast(copy('২ বা তার বেশি একটা সংখ্যা দিন', 'Enter a number 2 or higher'), 'error');
    if (rewardType === 'FREE_ITEM' && !productId) return onToast(copy('কোন item free দেবেন বেছে নিন', 'Pick a free item'), 'error');
    if (rewardType === 'DISCOUNT' && (!discountPercent || discountPercent <= 0 || discountPercent > 100))
      return onToast(copy('ছাড়ের পরিমাণ ১-১০০% এর মধ্যে দিন', 'Enter a discount between 1-100%'), 'error');
    setSaving(true);
    try {
      const body = {
        orderInterval: Number(orderInterval), rewardType,
        productId: rewardType === 'FREE_ITEM' ? productId : null,
        qty: Number(qty) || 1,
        discountPercent: rewardType === 'DISCOUNT' ? Number(discountPercent) : null,
      };
      if (isEdit) await request(`${RBASE}/milestones/${milestone.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request(`${RBASE}/milestones`, { method: 'POST', body: JSON.stringify(body) });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
      onSaved();
      onClose();
    } catch (e: any) { onToast(e.message || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...th.card, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', border: `1.5px solid ${th.border}` }}>
        <CardHeader th={th} title={isEdit ? `🎯 ${copy('Milestone Edit', 'Edit Milestone')}` : `🎯 ${copy('নতুন Milestone', 'New Milestone')}`}
          sub={copy('প্রতি N-তম অর্ডারে এই reward auto দেওয়া হবে (combo order বাদে)', 'Every Nth order auto-gets this reward (combo orders excluded)')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldWithInfo th={th} label={copy('প্রতি কত নম্বর অর্ডারে', 'Every Nth order')} helpText={copy('যেমন 3 দিলে 3rd, 6th, 9th... অর্ডারে reward পাবে', 'e.g. 3 means the 3rd, 6th, 9th... order gets the reward')}>
            <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={2} max={100} value={orderInterval}
              onChange={e => setOrderInterval(Number(e.target.value))} />
          </FieldWithInfo>
          <FieldWithInfo th={th} label={copy('Reward ধরন', 'Reward type')} helpText="">
            <select style={{ ...th.input, padding: '8px 10px' }} value={rewardType} onChange={e => setRewardType(e.target.value === 'FREE_DELIVERY' ? 'FREE_DELIVERY' : e.target.value === 'DISCOUNT' ? 'DISCOUNT' : 'FREE_ITEM')}>
              <option value="FREE_ITEM">{copy('🎁 নির্দিষ্ট item Free', '🎁 Specific item free')}</option>
              <option value="FREE_DELIVERY">{copy('🛵 Free Delivery', '🛵 Free Delivery')}</option>
              <option value="DISCOUNT">{copy('💸 ছাড় (Discount %)', '💸 Discount %')}</option>
            </select>
          </FieldWithInfo>
          {rewardType === 'FREE_ITEM' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
              <FieldWithInfo th={th} label={copy('কোন item', 'Which item')} helpText="">
                <select style={{ ...th.input, padding: '8px 10px' }} value={productId} onChange={e => setProductId(Number(e.target.value))}>
                  <option value={0}>-- {copy('বেছে নিন', 'pick one')} --</option>
                  {products.filter(p => (p as any).productType !== 'COMBO').map(p => <option key={p.id} value={p.id}>{p.name || p.code}</option>)}
                </select>
              </FieldWithInfo>
              <FieldWithInfo th={th} label={copy('পরিমাণ', 'Qty')} helpText="">
                <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))} />
              </FieldWithInfo>
            </div>
          )}
          {rewardType === 'DISCOUNT' && (
            <FieldWithInfo th={th} label={copy('ছাড়ের পরিমাণ (%)', 'Discount (%)')} helpText={copy('অর্ডারের সাবটোটালের উপর এই % ছাড় প্রয়োগ হবে', 'This % is applied off the order subtotal')}>
              <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={1} max={100} value={discountPercent}
                onChange={e => setDiscountPercent(Number(e.target.value))} />
            </FieldWithInfo>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button style={th.btnPrimary} onClick={save} disabled={saving}>
              {saving ? <Spinner size={13} /> : copy('✓ Save করুন', '✓ Save')}
            </button>
            <button style={th.btnGhost} onClick={onClose}>{copy('Cancel', 'Cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function RestaurantPage({ th, pageId, onToast }: {
  th: Theme; pageId: number; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const BASE = `${API_BASE}/client-dashboard/${pageId}`;
  const RBASE = `${API_BASE}/restaurant/${pageId}`;
  const ingHelp = ingredientHelp(copy);

  const [tab, setTab] = useState<'MENU' | 'INVENTORY' | 'DELIVERY' | 'ORDERS' | 'OFFERS'>('MENU');
  const [invSubTab, setInvSubTab] = useState<'INGREDIENTS' | 'RECIPE' | 'PACKAGING'>('INGREDIENTS');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<RestoSettings>({
    restaurantModeEnabled: false, restaurantLat: null, restaurantLng: null, deliverySlabs: [],
    loyaltyEnabled: false, loyaltyThresholdOrders: null, loyaltyDiscountPercent: null,
    happyHourEnabled: false, happyHourDiscountPercent: null, happyHourLabel: '',
    milestoneRewardsEnabled: false,
  });
  const [offersSaving, setOffersSaving] = useState(false);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [milestoneModal, setMilestoneModal] = useState<any | null>(null);
  const [happyHourWindow, setHappyHourWindow] = useState<HoursRow[]>(defaultHours());
  const [happyHourWindowSaving, setHappyHourWindowSaving] = useState(false);
  const cur = settings.currencySymbol || '৳';

  // menu
  const [products, setProducts] = useState<FoodProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [catFilter, setCatFilter] = useState('');
  const [editing, setEditing] = useState<FoodProduct | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [recipeFor, setRecipeFor] = useState<FoodProduct | null>(null);
  const [combos, setCombos] = useState<any[]>([]);
  const [comboModal, setComboModal] = useState<any | null>(null);

  // inventory
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [newIng, setNewIng] = useState({ name: '', unit: 'pcs', stockQty: 0, minStock: 0, costPerUnit: 0 });
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);
  const [packaging, setPackaging] = useState<{ ingredientId: number; qty: number }[]>([]);
  const [packSaving, setPackSaving] = useState(false);
  const [invRecipeCode, setInvRecipeCode] = useState('');
  const [showInvGuide, setShowInvGuide] = useState(() => localStorage.getItem(`FlamboyAI_inv_guide_${pageId}`) !== '0');

  // menu photos (sent to customers in Messenger)
  const [menuImages, setMenuImages] = useState<string[]>([]);

  // delivery
  const [delivery, setDelivery] = useState<{ lat: number | null; lng: number | null; slabs: DeliverySlab[] }>({ lat: null, lng: null, slabs: [] });
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // business hours
  const [hours, setHours] = useState<HoursRow[]>(defaultHours());
  const [hoursSaving, setHoursSaving] = useState(false);

  // quick order
  const [orderForm, setOrderForm] = useState({
    customerName: '', phone: '', address: '', orderNote: '',
    deliveryLat: null as number | null, deliveryLng: null as number | null,
    items: [{ productCode: '', variantLabel: '', qty: 1 }],
  });
  const [orderSaving, setOrderSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, prods, ings, cats, pack, mImgs, hrs, hh, combosList, milestonesList] = await Promise.all([
        request<any>(`${BASE}/settings`),
        request<FoodProduct[]>(`${BASE}/products`).catch(() => []),
        request<Ingredient[]>(`${RBASE}/ingredients`).catch(() => []),
        request<string[]>(`${RBASE}/categories`).catch(() => []),
        request<any[]>(`${RBASE}/packaging`).catch(() => []),
        request<string[]>(`${RBASE}/menu-images`).catch(() => []),
        request<HoursRow[]>(`${RBASE}/hours`).catch(() => []),
        request<HoursRow[]>(`${RBASE}/happy-hour`).catch(() => []),
        request<any[]>(`${RBASE}/combos`).catch(() => []),
        request<any[]>(`${RBASE}/milestones`).catch(() => []),
      ]);
      setSettings({
        restaurantModeEnabled: Boolean(s?.restaurantModeEnabled),
        restaurantLat: s?.restaurantLat ?? null,
        restaurantLng: s?.restaurantLng ?? null,
        deliverySlabs: Array.isArray(s?.deliverySlabs) ? s.deliverySlabs : [],
        currencySymbol: s?.currencySymbol || '৳',
        loyaltyEnabled: Boolean(s?.loyaltyEnabled),
        loyaltyThresholdOrders: s?.loyaltyThresholdOrders ?? null,
        loyaltyDiscountPercent: s?.loyaltyDiscountPercent ?? null,
        happyHourEnabled: Boolean(s?.happyHourEnabled),
        happyHourDiscountPercent: s?.happyHourDiscountPercent ?? null,
        happyHourLabel: s?.happyHourLabel || '',
        milestoneRewardsEnabled: Boolean(s?.milestoneRewardsEnabled),
      });
      setDelivery({ lat: s?.restaurantLat ?? null, lng: s?.restaurantLng ?? null, slabs: Array.isArray(s?.deliverySlabs) ? s.deliverySlabs : [] });
      setProducts(Array.isArray(prods) ? prods : []);
      setIngredients(Array.isArray(ings) ? ings : []);
      setCategories(Array.isArray(cats) ? (cats as string[]) : []);
      setPackaging((Array.isArray(pack) ? pack : []).map((p: any) => ({ ingredientId: p.ingredientId, qty: p.qty })));
      setMenuImages(Array.isArray(mImgs) ? (mImgs as string[]) : []);
      setHours(Array.isArray(hrs) && hrs.length === 7 ? hrs : defaultHours());
      setHappyHourWindow(Array.isArray(hh) && hh.length === 7 ? hh : defaultHours());
      setCombos(Array.isArray(combosList) ? combosList : []);
      setMilestones(Array.isArray(milestonesList) ? milestonesList : []);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const reloadProducts = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([
        request<FoodProduct[]>(`${BASE}/products`),
        request<string[]>(`${RBASE}/categories`).catch(() => []),
      ]);
      setProducts(Array.isArray(prods) ? prods : []);
      setCategories(Array.isArray(cats) ? (cats as string[]) : []);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const toggleFeatured = async (p: FoodProduct) => {
    try {
      await request(`${RBASE}/products/${p.code}/food`, { method: 'PATCH', body: JSON.stringify({ isFeatured: !p.isFeatured }) });
      reloadProducts();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const deleteProduct = async (p: FoodProduct) => {
    if (!window.confirm(copy(`"${p.name || p.code}" মুছে ফেলবেন?`, `Delete "${p.name || p.code}"?`))) return;
    try {
      await request(`${BASE}/products/${p.code}`, { method: 'DELETE' });
      onToast(copy('✅ Deleted', '✅ Deleted'), 'success');
      reloadProducts();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const reloadIngredients = useCallback(async () => {
    try { setIngredients(await request<Ingredient[]>(`${RBASE}/ingredients`)); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const reloadCombos = useCallback(async () => {
    try { setCombos(await request<any[]>(`${RBASE}/combos`)); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const saveDelivery = async (alsoEnable = false) => {
    if (delivery.lat == null || delivery.lng == null)
      return onToast(copy('ম্যাপে restaurant-এর location pin করুন', 'Pin your restaurant on the map'), 'error');
    const slabs = delivery.slabs.filter(s => s.maxKm > 0 && s.fee >= 0);
    if (!slabs.length)
      return onToast(copy('অন্তত একটা delivery fee slab দিন', 'Add at least one fee slab'), 'error');
    alsoEnable ? setEnabling(true) : setDeliverySaving(true);
    try {
      await request(`${BASE}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          restaurantLat: delivery.lat, restaurantLng: delivery.lng, deliverySlabs: slabs,
          ...(alsoEnable ? { restaurantModeEnabled: true } : {}),
        }),
      });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
      if (alsoEnable) await loadAll();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setDeliverySaving(false); setEnabling(false); }
  };

  const saveHours = async () => {
    setHoursSaving(true);
    try {
      await request(`${RBASE}/hours`, { method: 'PUT', body: JSON.stringify({ rows: hours }) });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setHoursSaving(false); }
  };

  const saveOffers = async () => {
    setOffersSaving(true);
    try {
      await request(`${BASE}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          loyaltyEnabled: settings.loyaltyEnabled,
          loyaltyThresholdOrders: settings.loyaltyThresholdOrders,
          loyaltyDiscountPercent: settings.loyaltyDiscountPercent,
          happyHourEnabled: settings.happyHourEnabled,
          happyHourDiscountPercent: settings.happyHourDiscountPercent,
          happyHourLabel: settings.happyHourLabel,
          milestoneRewardsEnabled: settings.milestoneRewardsEnabled,
        }),
      });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setOffersSaving(false); }
  };

  const reloadMilestones = useCallback(async () => {
    try { setMilestones(await request<any[]>(`${RBASE}/milestones`)); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const saveHappyHourWindow = async () => {
    setHappyHourWindowSaving(true);
    try {
      await request(`${RBASE}/happy-hour`, { method: 'PUT', body: JSON.stringify({ rows: happyHourWindow }) });
      onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setHappyHourWindowSaving(false); }
  };

  const foodProducts = useMemo(
    () => products.filter(p => !catFilter || (p.category || '') === catFilter),
    [products, catFilter],
  );
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach(p => { const c = (p.category || '').trim(); if (c) m.set(c, (m.get(c) || 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);
  const lowCount = ingredients.filter(i => i.low).length;

  // quick order helpers
  const productByCode = (code: string) => products.find(p => p.code === code);
  const orderTotal = orderForm.items.reduce((s, it) => {
    const p = productByCode(it.productCode);
    if (!p) return s;
    const vars = parseVariants(p.priceVariantsJson);
    const price = vars.length ? (vars.find(v => v.label === it.variantLabel)?.price ?? 0) : p.price;
    return s + price * (Number(it.qty) || 1);
  }, 0);
  const orderFeePreview = settings.restaurantLat != null && settings.restaurantLng != null && orderForm.deliveryLat != null && orderForm.deliveryLng != null && settings.deliverySlabs.length
    ? previewDeliveryFee(settings.deliverySlabs, settings.restaurantLat, settings.restaurantLng, orderForm.deliveryLat, orderForm.deliveryLng)
    : null;

  const createOrder = async () => {
    if (!orderForm.customerName.trim() || !orderForm.phone.trim())
      return onToast(copy('নাম ও ফোন দিন', 'Name & phone required'), 'error');
    const items = orderForm.items
      .filter(it => it.productCode)
      .map(it => {
        const p = productByCode(it.productCode)!;
        const vars = parseVariants(p.priceVariantsJson);
        return {
          productCode: it.productCode,
          qty: Number(it.qty) || 1,
          unitPrice: vars.length ? (vars.find(v => v.label === it.variantLabel)?.price ?? 0) : p.price,
          ...(vars.length ? { variantLabel: it.variantLabel } : {}),
        };
      });
    if (!items.length) return onToast(copy('অন্তত একটা item দিন', 'Add at least one item'), 'error');
    if (orderForm.items.some(it => it.productCode && parseVariants(productByCode(it.productCode)?.priceVariantsJson || null).length > 0 && !it.variantLabel))
      return onToast(copy('Size/পরিমাণ বেছে নিন', 'Choose size for variant items'), 'error');
    setOrderSaving(true);
    try {
      await request(`${BASE}/orders/manual`, {
        method: 'POST',
        body: JSON.stringify({
          customerName: orderForm.customerName, phone: orderForm.phone,
          address: orderForm.address, orderNote: orderForm.orderNote, source: 'PHONE',
          deliveryLat: orderForm.deliveryLat, deliveryLng: orderForm.deliveryLng,
          items,
        }),
      });
      onToast(copy('✅ Order create হয়েছে!', '✅ Order created!'), 'success');
      setOrderForm({ customerName: '', phone: '', address: '', orderNote: '', deliveryLat: null, deliveryLng: null, items: [{ productCode: '', variantLabel: '', qty: 1 }] });
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setOrderSaving(false); }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22} color={th.accent} /></div>;

  // ── Enable CTA ──────────────────────────────────────────────────────────────
  if (!settings.restaurantModeEnabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>🍕 Restaurant Mode</h1>
          <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>
            {copy('Restaurant/food business-এর জন্য: menu, map-pin delivery, ingredient inventory — সব এক জায়গায়', 'For restaurants/food carts: menu, map-pin delivery, ingredient inventory — all in one place')}
          </p>
        </div>
        <div style={{ ...th.card }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{copy('চালু করতে ২টা জিনিস লাগবে:', 'Two things needed to enable:')}</div>
          <div style={{ fontSize: 13, color: th.muted, marginBottom: 16 }}>
            ১. {copy('ম্যাপে আপনার restaurant-এর location pin', 'Pin your restaurant on the map')} &nbsp;&nbsp; ২. {copy('দূরত্ব অনুযায়ী delivery fee', 'Distance-based delivery fees')}
          </div>
          <div style={{ maxWidth: 560 }}>
            <LocationPickerMap lat={delivery.lat} lng={delivery.lng} markerEmoji="🏪"
              onChange={(la, ln) => setDelivery(d => ({ ...d, lat: la, lng: ln }))}
              radiusKm={delivery.slabs.length ? [...delivery.slabs].sort((a, b) => a.maxKm - b.maxKm).slice(-1)[0].maxKm : null} />
            <div style={{ marginTop: 14 }}>
              <SlabEditor th={th} cur={cur} slabs={delivery.slabs} onChange={s => setDelivery(d => ({ ...d, slabs: s }))} />
            </div>
            <button style={{ ...th.btnPrimary, marginTop: 14 }} onClick={() => saveDelivery(true)} disabled={enabling}>
              {enabling ? <Spinner size={13} /> : copy('✅ Restaurant Mode চালু করুন', '✅ Enable Restaurant Mode')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const TABS: { key: typeof tab; label: string; badge?: number }[] = [
    { key: 'MENU', label: copy('🍽️ Menu', '🍽️ Menu') },
    { key: 'INVENTORY', label: copy('🥕 Inventory', '🥕 Inventory'), badge: lowCount || undefined },
    { key: 'DELIVERY', label: copy('🛵 Delivery', '🛵 Delivery') },
    { key: 'ORDERS', label: copy('📦 Order নিন', '📦 Take Order') },
    { key: 'OFFERS', label: copy('🎁 Offers', '🎁 Offers') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {editing && <FoodFormModal th={th} pageId={pageId} product={editing} categories={[...new Set([...categories, ...catCounts.map(c => c[0])])]} cur={cur} onClose={() => setEditing(null)} onSaved={reloadProducts} onToast={onToast} />}
      {showAdd && <FoodFormModal th={th} pageId={pageId} product={null} categories={[...new Set([...categories, ...catCounts.map(c => c[0])])]} cur={cur} onClose={() => setShowAdd(false)} onSaved={reloadProducts} onToast={onToast} />}
      {showScan && <MenuScanModal th={th} pageId={pageId} cur={cur} onClose={() => setShowScan(false)} onDone={reloadProducts} onToast={onToast} />}
      {recipeFor && <RecipeModal th={th} pageId={pageId} product={recipeFor} ingredients={ingredients} onClose={() => setRecipeFor(null)} onToast={onToast} />}
      {editingIng && <IngredientEditModal th={th} pageId={pageId} ingredient={editingIng} onClose={() => setEditingIng(null)} onToast={onToast} onSaved={reloadIngredients} />}
      {comboModal && <ComboModal th={th} pageId={pageId} combo={comboModal} products={products} cur={cur} onClose={() => setComboModal(null)} onToast={onToast} onSaved={reloadCombos} />}
      {milestoneModal && <MilestoneModal th={th} pageId={pageId} milestone={milestoneModal} products={products} onClose={() => setMilestoneModal(null)} onToast={onToast} onSaved={reloadMilestones} />}

      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>🍕 Restaurant</h1>
        <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>{copy('Menu, inventory, delivery, order — restaurant-এর সব এখানে', 'Menu, inventory, delivery, orders — everything restaurant')}</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: 700, fontSize: 13, border: `1.5px solid ${tab === t.key ? th.accent : th.border}`,
              background: tab === t.key ? th.accentSoft : 'transparent',
              color: tab === t.key ? th.accentText : th.muted, position: 'relative',
            }}>
            {t.label}
            {t.badge ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, padding: '1px 7px', borderRadius: 8, background: '#dc2626', color: '#fff' }}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ── MENU ── */}
      {tab === 'MENU' && (
        <>
        {menuImages.length > 0 && (
          <div style={{ ...th.card }}>
            <CardHeader th={th} title={copy('📖 Menu-র ছবি (customer-দের পাঠানো হয়)', '📖 Menu photos (sent to customers)')}
              sub={copy('Messenger-এ কেউ "কি কি আছে" জিজ্ঞেস করলে bot এই ছবিগুলোই পাঠায়। Menu Scan করলেই auto আপডেট হয়।', 'When someone asks what\'s available in Messenger, the bot sends these. Auto-updated on Menu Scan.')} />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {menuImages.map((u, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={u.startsWith('http') ? u : `${API_BASE}${u}`} alt="menu" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, border: `1px solid ${th.border}` }} />
                  <button
                    onClick={async () => {
                      const next = menuImages.filter((_, j) => j !== i);
                      try {
                        await request(`${RBASE}/menu-images`, { method: 'PUT', body: JSON.stringify({ urls: next }) });
                        setMenuImages(next);
                      } catch (e: any) { onToast(e.message, 'error'); }
                    }}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ ...th.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{copy(`খাবারের তালিকা (${products.length})`, `Menu items (${products.length})`)}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...th.btnGhost, fontSize: 12.5 }} onClick={() => setShowScan(true)}>📷 {copy('Menu Scan (AI)', 'Menu Scan (AI)')}</button>
              <button style={{ ...th.btnPrimary, fontSize: 12.5 }} onClick={() => setShowAdd(true)}>+ {copy('খাবার যোগ করুন', 'Add Item')}</button>
            </div>
          </div>
          {catCounts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              <button onClick={() => setCatFilter('')} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${!catFilter ? th.accent : th.border}`, background: !catFilter ? th.accentSoft : 'transparent', color: !catFilter ? th.accentText : th.muted }}>
                {copy('সব', 'All')} ({products.length})
              </button>
              {catCounts.map(([c, n]) => (
                <button key={c} onClick={() => setCatFilter(c)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${catFilter === c ? th.accent : th.border}`, background: catFilter === c ? th.accentSoft : 'transparent', color: catFilter === c ? th.accentText : th.muted }}>
                  {c} ({n})
                </button>
              ))}
            </div>
          )}
          {foodProducts.length === 0 ? (
            <EmptyState icon="🍽️" title={copy('এখনো কোনো খাবার নেই', 'No items yet')} sub={copy('"Menu Scan" দিয়ে menu-র ছবি থেকে সব খাবার এক ক্লিকে আনুন', 'Use "Menu Scan" to import your whole menu from a photo')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {foodProducts.map(p => {
                const vars = parseVariants(p.priceVariantsJson);
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${th.border}`, opacity: p.isActive ? 1 : 0.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {p.imageUrl
                        ? <img src={p.imageUrl.startsWith('http') ? p.imageUrl : `${API_BASE}${p.imageUrl}`} alt="" style={{ width: 42, height: 42, borderRadius: 9, objectFit: 'cover', border: `1px solid ${th.border}`, flexShrink: 0 }} />
                        : <div style={{ width: 42, height: 42, borderRadius: 9, background: th.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🍽️</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.code} {p.isFeatured && <span title={copy('Featured', 'Featured')}>🔥</span>} {!p.isActive && <span style={{ fontSize: 10.5, color: '#dc2626' }}>(off)</span>}</div>
                        <div style={{ fontSize: 12, color: th.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.category ? `${p.category} · ` : ''}{vars.length ? vars.map(v => `${v.label} ${cur}${v.price}`).join(' / ') : ''}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 13.5, color: th.accent, whiteSpace: 'nowrap', flexShrink: 0 }}>{priceRange(p, cur)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button style={{ ...th.btnSmGhost, fontSize: 11.5, opacity: p.isFeatured ? 1 : 0.5 }} onClick={() => toggleFeatured(p)} title={copy('Featured/জনপ্রিয় হিসেবে দেখাও', 'Toggle featured badge')}>🔥</button>
                      <button style={{ ...th.btnSmGhost, fontSize: 11.5 }} onClick={() => setRecipeFor(p)} title="Recipe/BOM">🧾 Recipe</button>
                      <button style={{ ...th.btnSmGhost, fontSize: 11.5 }} onClick={() => setEditing(p)}>✏️ Edit</button>
                      <button style={{ ...th.btnSmGhost, fontSize: 11.5, color: '#dc2626' }} title="Delete" onClick={() => deleteProduct(p)}>🗑 Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ ...th.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{copy(`🧩 Combo (${combos.length})`, `🧩 Combos (${combos.length})`)}</div>
            <button style={{ ...th.btnPrimary, fontSize: 12.5 }} onClick={() => setComboModal({})}>+ {copy('Combo বানান', 'New Combo')}</button>
          </div>
          {combos.length === 0 ? (
            <EmptyState icon="🧩" title={copy('এখনো কোনো combo নেই', 'No combos yet')} sub={copy('২টা+ item একসাথে বিশেষ দামে বিক্রি করতে combo বানান', 'Bundle 2+ items at a special price')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {combos.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, border: `1px solid ${th.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: th.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(c.comboItems || []).map((ci: any) => `${ci.component?.name || ci.component?.code} ×${ci.qty}`).join(' + ')}
                      </div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 13.5, color: th.accent, whiteSpace: 'nowrap' }}>{cur}{Number(c.price).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...th.btnSmGhost, fontSize: 11.5 }} onClick={() => setComboModal(c)}>✏️ {copy('Edit', 'Edit')}</button>
                    <button style={{ ...th.btnSmDanger, fontSize: 11.5 }} onClick={async () => {
                      if (!window.confirm(copy(`"${c.name}" combo মুছে ফেলবেন?`, `Delete combo "${c.name}"?`))) return;
                      try { await request(`${RBASE}/combos/${c.code}`, { method: 'DELETE' }); reloadCombos(); }
                      catch (e: any) { onToast(e.message, 'error'); }
                    }}>🗑 {copy('মুছুন', 'Delete')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </>
      )}

      {/* ── INVENTORY ── */}
      {tab === 'INVENTORY' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {showInvGuide ? (
            <div style={{ ...th.alertInfo, borderRadius: 10, padding: '10px 12px', lineHeight: 1.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <strong style={{ fontSize: 12.5 }}>{copy('💡 Inventory কীভাবে কাজ করে', '💡 How Inventory works')}</strong>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 11.5, fontFamily: 'inherit' }}
                  onClick={() => { setShowInvGuide(false); localStorage.setItem(`FlamboyAI_inv_guide_${pageId}`, '0'); }}>
                  {copy('বন্ধ করুন ✕', 'Dismiss ✕')}
                </button>
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                <li>{copy('🥕 Ingredients — কাঁচামাল/প্যাকেজিং (bun, chicken, box) — কত আছে সেটা এখানে রাখুন।', '🥕 Ingredients — raw materials/packaging (bun, chicken, box) — track how much you have here.')}</li>
                <li>{copy('🧾 Recipe — কোন খাবারে কোন ingredient কতটুকু লাগে, সেটা এখানে সেট করুন।', '🧾 Recipe — set which ingredients (and how much) each dish uses.')}</li>
                <li>{copy('🛍️ Packaging — প্রতিটা order-এ একবার যা লাগে (যেমন carry bag) — এখানে সেট করুন।', '🛍️ Packaging — what every order needs once (e.g. a carry bag) — set it here.')}</li>
                <li>{copy('Order confirm হলে recipe + packaging অনুযায়ী stock auto বাদ যাবে — নিজে হিসাব করতে হবে না।', 'When an order is confirmed, stock is auto-deducted per the recipe + packaging — no manual tracking needed.')}</li>
              </ul>
            </div>
          ) : (
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.muted, fontSize: 11.5, padding: 0, alignSelf: 'flex-start', fontFamily: 'inherit' }}
              onClick={() => { setShowInvGuide(true); localStorage.setItem(`FlamboyAI_inv_guide_${pageId}`, '1'); }}>
              {copy('❔ গাইড দেখুন', '❔ Show guide')}
            </button>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'INGREDIENTS' as const, label: copy('🥕 Ingredients', '🥕 Ingredients') },
              { key: 'RECIPE' as const, label: copy('🧾 Recipe', '🧾 Recipe') },
              { key: 'PACKAGING' as const, label: copy('🛍️ Packaging', '🛍️ Packaging') },
            ].map(t => (
              <button key={t.key} onClick={() => setInvSubTab(t.key)}
                style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${invSubTab === t.key ? th.accent : th.border}`, background: invSubTab === t.key ? th.accentSoft : 'transparent', color: invSubTab === t.key ? th.accentText : th.muted }}>
                {t.label}
              </button>
            ))}
          </div>

          {invSubTab === 'INGREDIENTS' && (
          <div style={{ ...th.card }}>
            <CardHeader th={th} title={copy('🥕 Ingredients — কাঁচামাল ও প্যাকেজিং', '🥕 Ingredients — raw materials & packaging')}
              sub={copy('Bun, chicken (gm), sauce, box, spoon, carry bag... order confirm হলে recipe অনুযায়ী auto বাদ যাবে', 'Bun, chicken (gm), sauces, box, spoon, carry bag... auto-deducted per recipe on confirm')} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 100px 100px 110px auto', gap: 6, marginBottom: 12, alignItems: 'end' }}>
              <FieldWithInfo th={th} label={copy('নাম', 'Name')} helpText={ingHelp.name}>
                <input style={{ ...th.input, padding: '8px 10px' }} placeholder={copy('যেমন: Small Bun', 'e.g. Small Bun')} value={newIng.name}
                  onChange={e => setNewIng(f => ({ ...f, name: e.target.value }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label={copy('একক', 'Unit')} helpText={ingHelp.unit}>
                <select style={{ ...th.input, padding: '8px 10px' }} value={newIng.unit} onChange={e => setNewIng(f => ({ ...f, unit: e.target.value }))}>
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </FieldWithInfo>
              <FieldWithInfo th={th} label={copy('স্টক', 'Stock')} helpText={ingHelp.stockQty}>
                <input style={{ ...th.input, padding: '8px 10px' }} type="number" placeholder="Stock" value={newIng.stockQty || ''}
                  onChange={e => setNewIng(f => ({ ...f, stockQty: Number(e.target.value) }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label={copy('Min', 'Min')} helpText={ingHelp.minStock}>
                <input style={{ ...th.input, padding: '8px 10px' }} type="number" placeholder="Min" value={newIng.minStock || ''}
                  onChange={e => setNewIng(f => ({ ...f, minStock: Number(e.target.value) }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label={copy('খরচ/একক', 'Cost/unit')} helpText={ingHelp.costPerUnit}>
                <input style={{ ...th.input, padding: '8px 10px' }} type="number" placeholder="Cost" value={newIng.costPerUnit || ''}
                  onChange={e => setNewIng(f => ({ ...f, costPerUnit: Number(e.target.value) }))} />
              </FieldWithInfo>
              <button style={{ ...th.btnPrimary, fontSize: 12.5, whiteSpace: 'nowrap' }} onClick={async () => {
                if (!newIng.name.trim()) return onToast(copy('নাম দিন', 'Name required'), 'error');
                try {
                  await request(`${RBASE}/ingredients`, { method: 'POST', body: JSON.stringify(newIng) });
                  setNewIng({ name: '', unit: 'pcs', stockQty: 0, minStock: 0, costPerUnit: 0 });
                  reloadIngredients();
                } catch (e: any) { onToast(e.message, 'error'); }
              }}>+ {copy('যোগ করুন', 'Add')}</button>
            </div>
            {ingredients.length === 0 ? (
              <EmptyState icon="🥕" title={copy('এখনো কোনো ingredient নেই', 'No ingredients yet')} sub={copy('উপরে নাম, unit, stock দিয়ে যোগ করুন', 'Add name, unit, stock above')} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ingredients.map(ing => (
                  <div key={ing.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 9, border: `1px solid ${ing.low ? '#fca5a5' : th.border}`, background: ing.low ? '#fef2f215' : 'transparent' }}>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                      {ing.name} <span style={{ fontSize: 11, color: th.muted }}>({ing.unit})</span>
                      {ing.low && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, padding: '1px 8px', borderRadius: 7, background: '#dc262618', color: '#dc2626', border: '1px solid #dc262635' }}>⚠️ LOW</span>}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: ing.low ? '#dc2626' : th.text, minWidth: 80, textAlign: 'right' }}>
                      {Number(ing.stockQty).toLocaleString()} {ing.unit}
                    </span>
                    {[-10, -1, 1, 10].map(d => (
                      <button key={d} style={{ ...th.btnSmGhost, fontSize: 11, padding: '3px 8px' }} onClick={async () => {
                        try { await request(`${RBASE}/ingredients/${ing.id}/stock`, { method: 'PATCH', body: JSON.stringify({ delta: d }) }); reloadIngredients(); }
                        catch (e: any) { onToast(e.message, 'error'); }
                      }}>{d > 0 ? `+${d}` : d}</button>
                    ))}
                    <button style={{ ...th.btnSmGhost, fontSize: 11.5 }} title={copy('Edit করুন', 'Edit')} onClick={() => setEditingIng(ing)}>✏️ {copy('Edit', 'Edit')}</button>
                    <button style={{ ...th.btnSmDanger, fontSize: 11.5 }} title={copy('মুছে ফেলুন', 'Delete')} onClick={async () => {
                      if (!window.confirm(copy(
                        `"${ing.name}" মুছে ফেলবেন? এই ingredient যেসব recipe-তে ব্যবহার হচ্ছে, সেখান থেকেও এটি বাদ যাবে (recipe-টা মুছবে না, শুধু এই ingredient-এর লাইনটা)।`,
                        `Delete "${ing.name}"? It will also be removed from any recipes that use it (the recipe itself stays, just this ingredient's line is dropped).`,
                      ))) return;
                      try { await request(`${RBASE}/ingredients/${ing.id}`, { method: 'DELETE' }); reloadIngredients(); }
                      catch (e: any) { onToast(e.message, 'error'); }
                    }}>🗑 {copy('মুছুন', 'Delete')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Recipe editor — which ingredients go into each dish */}
          {invSubTab === 'RECIPE' && (
          <div style={{ ...th.card }}>
            <CardHeader th={th} title={copy('🧾 Recipe — কোন খাবারে কী কী লাগে', '🧾 Recipes — what goes into each dish')}
              sub={copy('খাবার বেছে নিয়ে ingredient ও পরিমাণ set করুন — order confirm হলে ঠিক এই হিসাবেই stock থেকে বাদ যাবে', 'Pick a dish and set its ingredients & quantities — stock deducts exactly by this on confirm')} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select style={{ ...th.input, padding: '9px 12px', maxWidth: 320 }} value={invRecipeCode}
                onChange={e => setInvRecipeCode(e.target.value)}>
                <option value="">-- {copy('খাবার বেছে নিন', 'pick a dish')} --</option>
                {products.filter(p => p.isActive).map(p => <option key={p.code} value={p.code}>{p.name || p.code}</option>)}
              </select>
              <button
                style={{ ...th.btnPrimary, fontSize: 12.5 }}
                disabled={!invRecipeCode}
                onClick={() => {
                  const p = products.find(x => x.code === invRecipeCode);
                  if (p) setRecipeFor(p);
                }}
              >
                🧾 {copy('Recipe খুলুন / Edit করুন', 'Open / edit recipe')}
              </button>
            </div>
            <div style={{ fontSize: 12, color: th.muted, marginTop: 10 }}>
              💡 {copy('Menu tab-এর প্রতিটা খাবারের পাশে "🧾 Recipe" button থেকেও একই editor খোলে।', 'The same editor opens from the "🧾 Recipe" button beside each item in the Menu tab.')}
            </div>
          </div>
          )}

          {/* per-order packaging */}
          {invSubTab === 'PACKAGING' && (
          <div style={{ ...th.card }}>
            <CardHeader th={th} title={copy('🛍️ প্রতি Order-এ প্যাকেজিং', '🛍️ Per-order packaging')}
              sub={copy('যা প্রতিটা order-এ একবার লাগে — যেমন ১টা carry bag। item যত-ই হোক, একবারই বাদ যাবে।', 'Consumed once per order regardless of items — e.g. 1 carry bag.')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {packaging.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select style={{ ...th.input, padding: '7px 10px', flex: 1 }} value={row.ingredientId}
                    onChange={e => setPackaging(ps => ps.map((r, j) => j === i ? { ...r, ingredientId: Number(e.target.value) } : r))}>
                    <option value={0}>-- ingredient --</option>
                    {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>)}
                  </select>
                  <input style={{ ...th.input, padding: '7px 10px', width: 90 }} type="number" min={0} step="any" value={row.qty || ''}
                    onChange={e => setPackaging(ps => ps.map((r, j) => j === i ? { ...r, qty: Number(e.target.value) } : r))} />
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }}
                    onClick={() => setPackaging(ps => ps.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...th.btnGhost, fontSize: 12 }} onClick={() => setPackaging(ps => [...ps, { ingredientId: 0, qty: 1 }])}>
                  + {copy('যোগ করুন', 'Add')}
                </button>
                <button style={{ ...th.btnPrimary, fontSize: 12 }} disabled={packSaving} onClick={async () => {
                  setPackSaving(true);
                  try {
                    await request(`${RBASE}/packaging`, { method: 'PUT', body: JSON.stringify({ rows: packaging.filter(r => r.ingredientId && r.qty > 0) }) });
                    onToast(copy('✅ সেভ হয়েছে', '✅ Saved'), 'success');
                  } catch (e: any) { onToast(e.message, 'error'); }
                  finally { setPackSaving(false); }
                }}>{packSaving ? <Spinner size={12} /> : copy('✓ Save', '✓ Save')}</button>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* ── DELIVERY ── */}
      {tab === 'DELIVERY' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ ...th.card }}>
          <CardHeader th={th} title={copy('🛵 Delivery — location ও দূরত্ব-অনুযায়ী fee', '🛵 Delivery — location & distance fees')}
            sub={copy('Customer website-এ ম্যাপে pin করলে এই slab অনুযায়ী auto delivery charge হবে', 'Customers pin on the website map — fee auto-computed from these slabs')} />
          <div style={{ maxWidth: 560 }}>
            <LocationPickerMap lat={delivery.lat} lng={delivery.lng} markerEmoji="🏪"
              onChange={(la, ln) => setDelivery(d => ({ ...d, lat: la, lng: ln }))}
              radiusKm={delivery.slabs.length ? [...delivery.slabs].sort((a, b) => a.maxKm - b.maxKm).slice(-1)[0].maxKm : null} />
            <div style={{ marginTop: 14 }}>
              <SlabEditor th={th} cur={cur} slabs={delivery.slabs} onChange={s => setDelivery(d => ({ ...d, slabs: s }))} />
            </div>
            <button style={{ ...th.btnPrimary, marginTop: 14 }} onClick={() => saveDelivery(false)} disabled={deliverySaving}>
              {deliverySaving ? <Spinner size={13} /> : copy('✓ Save করুন', '✓ Save')}
            </button>
          </div>
        </div>

        <div style={{ ...th.card }}>
          <CardHeader th={th} title={copy('🕐 খোলা/বন্ধের সময়', '🕐 Business hours')}
            sub={copy('Website-এ "এখন খোলা/বন্ধ" badge দেখাবে এই সময় অনুযায়ী', 'Drives the "open now / closed" badge on your website')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560 }}>
            {hours.map((row, i) => (
              <div key={row.day} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 90px', gap: 8, alignItems: 'center', opacity: row.closed ? 0.55 : 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{copy(DAY_NAMES_BN[row.day], DAY_NAMES_EN[row.day])}</div>
                <input style={{ ...th.input, padding: '7px 10px' }} type="time" value={row.open} disabled={row.closed}
                  onChange={e => setHours(hs => hs.map((h, j) => j === i ? { ...h, open: e.target.value } : h))} />
                <input style={{ ...th.input, padding: '7px 10px' }} type="time" value={row.close} disabled={row.closed}
                  onChange={e => setHours(hs => hs.map((h, j) => j === i ? { ...h, close: e.target.value } : h))} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={row.closed}
                    onChange={e => setHours(hs => hs.map((h, j) => j === i ? { ...h, closed: e.target.checked } : h))} />
                  {copy('বন্ধ', 'Closed')}
                </label>
              </div>
            ))}
            <button style={{ ...th.btnPrimary, marginTop: 10, alignSelf: 'flex-start' }} onClick={saveHours} disabled={hoursSaving}>
              {hoursSaving ? <Spinner size={13} /> : copy('✓ Save করুন', '✓ Save')}
            </button>
          </div>
        </div>
        </div>
      )}

      {/* ── OFFERS: Loyalty + Happy Hour ── */}
      {tab === 'OFFERS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ ...th.card }}>
            <CardHeader th={th} title={copy('🎉 Lucky Customer (Loyalty)', '🎉 Lucky Customer (Loyalty)')}
              sub={copy('একই ফোন নম্বর থেকে বার বার order এলে গোনা হয় (কোনো account লাগে না)। চালু থাকলে order দেওয়ার সময় ফোন নম্বর দিলেই customer কে ছাড়ের status জানিয়ে দেওয়া হয়।', 'Counted by phone number — no account needed. When on, the customer is told their discount status right when they give their phone number.')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={settings.loyaltyEnabled}
                  onChange={e => setSettings(s => ({ ...s, loyaltyEnabled: e.target.checked }))} />
                {copy('চালু করুন', 'Enable')}
              </label>
              {settings.loyaltyEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <FieldWithInfo th={th} label={copy('কত অর্ডারে', 'Orders needed')} helpText={copy('এত বার order করলে "Lucky Customer" হয়ে যাবে', 'Reaching this many orders makes them a Lucky Customer')}>
                    <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={1} value={settings.loyaltyThresholdOrders ?? ''}
                      onChange={e => setSettings(s => ({ ...s, loyaltyThresholdOrders: Number(e.target.value) || null }))} />
                  </FieldWithInfo>
                  <FieldWithInfo th={th} label={copy('কত % ছাড়', 'Discount %')} helpText={copy('Lucky Customer হওয়ার পর প্রতি order-এ এই % ছাড় auto apply হবে', 'Applied automatically on every order once qualified')}>
                    <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={0} max={100} value={settings.loyaltyDiscountPercent ?? ''}
                      onChange={e => setSettings(s => ({ ...s, loyaltyDiscountPercent: Number(e.target.value) || null }))} />
                  </FieldWithInfo>
                </div>
              )}
              <button style={{ ...th.btnPrimary, alignSelf: 'flex-start' }} onClick={saveOffers} disabled={offersSaving}>
                {offersSaving ? <Spinner size={13} /> : copy('✓ Save করুন', '✓ Save')}
              </button>
            </div>
          </div>

          <div style={{ ...th.card }}>
            <CardHeader th={th} title={copy('⏰ Happy Hour', '⏰ Happy Hour')}
              sub={copy('নির্দিষ্ট সময়ে সব order-এ auto % ছাড় — website-এ banner হিসেবে দেখাবে', 'Auto % discount during a set window — shown as a banner on your website')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={settings.happyHourEnabled}
                  onChange={e => setSettings(s => ({ ...s, happyHourEnabled: e.target.checked }))} />
                {copy('চালু করুন', 'Enable')}
              </label>
              {settings.happyHourEnabled && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                    <FieldWithInfo th={th} label={copy('কত % ছাড়', 'Discount %')} helpText={copy('Happy Hour চলাকালীন সব order-এ এই % ছাড়', 'Applied to every order during the window')}>
                      <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={0} max={100} value={settings.happyHourDiscountPercent ?? ''}
                        onChange={e => setSettings(s => ({ ...s, happyHourDiscountPercent: Number(e.target.value) || null }))} />
                    </FieldWithInfo>
                    <FieldWithInfo th={th} label={copy('Banner টেক্সট', 'Banner text')} helpText={copy('খালি রাখলে auto টেক্সট দেখাবে', 'Leave blank for an auto-generated message')}>
                      <input style={{ ...th.input, padding: '8px 10px' }} placeholder={copy('যেমন: 🎉 Happy Hour! ২০% ছাড়', 'e.g. 🎉 Happy Hour! 20% off')} value={settings.happyHourLabel}
                        onChange={e => setSettings(s => ({ ...s, happyHourLabel: e.target.value }))} />
                    </FieldWithInfo>
                  </div>
                  <button style={{ ...th.btnPrimary, alignSelf: 'flex-start' }} onClick={saveOffers} disabled={offersSaving}>
                    {offersSaving ? <Spinner size={13} /> : copy('✓ Save করুন', '✓ Save')}
                  </button>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: th.muted, marginTop: 6 }}>{copy('কখন Happy Hour চলবে:', 'When Happy Hour runs:')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {happyHourWindow.map((row, i) => (
                      <div key={row.day} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 90px', gap: 8, alignItems: 'center', opacity: row.closed ? 0.55 : 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{copy(DAY_NAMES_BN[row.day], DAY_NAMES_EN[row.day])}</div>
                        <input style={{ ...th.input, padding: '7px 10px' }} type="time" value={row.open} disabled={row.closed}
                          onChange={e => setHappyHourWindow(hs => hs.map((h, j) => j === i ? { ...h, open: e.target.value } : h))} />
                        <input style={{ ...th.input, padding: '7px 10px' }} type="time" value={row.close} disabled={row.closed}
                          onChange={e => setHappyHourWindow(hs => hs.map((h, j) => j === i ? { ...h, close: e.target.value } : h))} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={row.closed}
                            onChange={e => setHappyHourWindow(hs => hs.map((h, j) => j === i ? { ...h, closed: e.target.checked } : h))} />
                          {copy('বন্ধ', 'Off')}
                        </label>
                      </div>
                    ))}
                    <button style={{ ...th.btnPrimary, marginTop: 4, alignSelf: 'flex-start' }} onClick={saveHappyHourWindow} disabled={happyHourWindowSaving}>
                      {happyHourWindowSaving ? <Spinner size={13} /> : copy('✓ সময় Save করুন', '✓ Save window')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={{ ...th.card }}>
            <CardHeader th={th}
              title={copy('🎯 Milestone Rewards', '🎯 Milestone Rewards')}
              sub={copy('প্রতি N-তম অর্ডারে auto ফ্রি item বা ফ্রি delivery — যেমন প্রতি ৩টা অর্ডারে একটা, প্রতি ৫টায় আরেকটা। Combo order-এ reward পাবে না (কিন্তু গণনায় ধরা হবে)।', 'Auto free item or free delivery every Nth order — e.g. every 3rd order one thing, every 5th another. Combo orders don\'t get a reward (but still count).')}
              action={<button style={{ ...th.btnPrimary, fontSize: 12.5 }} onClick={() => setMilestoneModal({})}>+ {copy('নতুন Milestone', 'New Milestone')}</button>}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
              <input type="checkbox" checked={settings.milestoneRewardsEnabled}
                onChange={e => setSettings(s => ({ ...s, milestoneRewardsEnabled: e.target.checked }))} />
              {copy('চালু করুন', 'Enable')}
              <button style={{ ...th.btnGhost, fontSize: 11.5, marginLeft: 8 }} onClick={saveOffers} disabled={offersSaving}>
                {offersSaving ? <Spinner size={12} /> : copy('✓ Save', '✓ Save')}
              </button>
            </label>
            {milestones.length === 0 ? (
              <EmptyState icon="🎯" title={copy('এখনো কোনো milestone নেই', 'No milestones yet')} sub={copy('"+ নতুন Milestone" দিয়ে যোগ করুন', 'Add one with "+ New Milestone"')} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {milestones.map((m: any) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 9, border: `1px solid ${th.border}`, opacity: m.isActive ? 1 : 0.5 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{copy(`প্রতি ${m.orderInterval} নম্বর অর্ডারে`, `Every ${m.orderInterval}th order`)}</div>
                      <div style={{ fontSize: 12, color: th.muted }}>
                        {m.rewardType === 'FREE_DELIVERY'
                          ? copy('🛵 ফ্রি Delivery', '🛵 Free Delivery')
                          : m.rewardType === 'DISCOUNT'
                            ? copy(`💸 ${m.discountPercent}% ছাড়`, `💸 ${m.discountPercent}% Discount`)
                            : copy(`🎁 ফ্রি ${m.product?.name || m.product?.code} × ${m.qty}`, `🎁 Free ${m.product?.name || m.product?.code} × ${m.qty}`)}
                      </div>
                    </div>
                    <button style={{ ...th.btnSmGhost, fontSize: 11.5 }} onClick={() => setMilestoneModal(m)}>✏️ {copy('Edit', 'Edit')}</button>
                    <button style={{ ...th.btnSmDanger, fontSize: 11.5 }} onClick={async () => {
                      if (!window.confirm(copy('এই milestone মুছে ফেলবেন?', 'Delete this milestone?'))) return;
                      try { await request(`${RBASE}/milestones/${m.id}`, { method: 'DELETE' }); reloadMilestones(); }
                      catch (e: any) { onToast(e.message, 'error'); }
                    }}>🗑 {copy('মুছুন', 'Delete')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ORDERS (quick take-order) ── */}
      {tab === 'ORDERS' && (
        <div style={{ ...th.card, maxWidth: 640 }}>
          <CardHeader th={th} title={copy('📦 Order নিন (ফোন/হেঁটে আসা customer)', '📦 Take an order (phone/walk-in)')}
            sub={copy('Customer-এর location pin করলে delivery fee auto হিসাব হবে; order টা Orders page-এও দেখা যাবে', 'Pin the customer to auto-compute the fee; it shows in the Orders page too')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <Field th={th} label={copy('Customer নাম *', 'Customer name *')}>
              <input style={th.input} value={orderForm.customerName} onChange={e => setOrderForm(f => ({ ...f, customerName: e.target.value }))} />
            </Field>
            <Field th={th} label={copy('ফোন *', 'Phone *')}>
              <input style={th.input} placeholder="01XXXXXXXXX" value={orderForm.phone} onChange={e => setOrderForm(f => ({ ...f, phone: e.target.value }))} />
            </Field>
          </div>
          <Field th={th} label={copy('ঠিকানা (বাসা/রোড)', 'Address (house/road)')}>
            <input style={th.input} value={orderForm.address} onChange={e => setOrderForm(f => ({ ...f, address: e.target.value }))} />
          </Field>

          <div style={{ margin: '12px 0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Items</div>
            {orderForm.items.map((it, i) => {
              const p = productByCode(it.productCode);
              const vars = p ? parseVariants(p.priceVariantsJson) : [];
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 64px 28px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <select style={{ ...th.input, padding: '8px 10px' }} value={it.productCode}
                    onChange={e => setOrderForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, productCode: e.target.value, variantLabel: '' } : x) }))}>
                    <option value="">-- {copy('খাবার', 'item')} --</option>
                    {products.filter(x => x.isActive).map(x => <option key={x.code} value={x.code}>{x.name || x.code}</option>)}
                  </select>
                  <select style={{ ...th.input, padding: '8px 10px' }} value={it.variantLabel} disabled={!vars.length}
                    onChange={e => setOrderForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, variantLabel: e.target.value } : x) }))}>
                    <option value="">{vars.length ? copy('-- size --', '-- size --') : '—'}</option>
                    {vars.map(v => <option key={v.label} value={v.label}>{v.label} — {cur}{v.price}</option>)}
                  </select>
                  <input style={{ ...th.input, padding: '8px 10px' }} type="number" min={1} value={it.qty}
                    onChange={e => setOrderForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) || 1 } : x) }))} />
                  {orderForm.items.length > 1
                    ? <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }} onClick={() => setOrderForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}>×</button>
                    : <div />}
                </div>
              );
            })}
            <button style={{ ...th.btnGhost, fontSize: 12 }} onClick={() => setOrderForm(f => ({ ...f, items: [...f.items, { productCode: '', variantLabel: '', qty: 1 }] }))}>
              + {copy('আরেকটা item', 'Add item')}
            </button>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              📍 {copy('Customer-এর লোকেশন (delivery হলে pin করুন)', 'Customer location (pin for delivery)')}
            </div>
            <LocationPickerMap lat={orderForm.deliveryLat} lng={orderForm.deliveryLng} height={200}
              onChange={(la, ln) => setOrderForm(f => ({ ...f, deliveryLat: la, deliveryLng: ln }))}
              referencePin={settings.restaurantLat != null && settings.restaurantLng != null ? { lat: settings.restaurantLat, lng: settings.restaurantLng, emoji: '🏪' } : null}
              radiusKm={settings.deliverySlabs.length ? [...settings.deliverySlabs].sort((a, b) => a.maxKm - b.maxKm).slice(-1)[0].maxKm : null} />
          </div>

          <div style={{ padding: '10px 14px', background: th.accentSoft, borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: th.accentText, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600 }}>
              <span>Items</span><span>{cur}{orderTotal.toLocaleString()}</span>
            </div>
            {orderFeePreview && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, color: orderFeePreview.fee == null ? '#dc2626' : undefined }}>
                <span>🛵 Delivery ({orderFeePreview.distanceKm} km)</span>
                <span>{orderFeePreview.fee == null ? copy('এলাকার বাইরে!', 'Out of range!') : `${cur}${orderFeePreview.fee}`}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, borderTop: `1px solid ${th.border}`, paddingTop: 4 }}>
              <span>Total</span><span>{cur}{(orderTotal + (orderFeePreview?.fee ?? 0)).toLocaleString()}</span>
            </div>
          </div>

          <button style={th.btnPrimary} onClick={createOrder} disabled={orderSaving || (orderFeePreview != null && orderFeePreview.fee == null)}>
            {orderSaving ? <><Spinner size={13} /> Saving...</> : copy('✓ Order Create করুন', '✓ Create Order')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Slab editor (shared: CTA + Delivery tab) ─────────────────────────────────
function SlabEditor({ th, cur, slabs, onChange }: {
  th: Theme; cur: string; slabs: DeliverySlab[];
  onChange: (s: DeliverySlab[]) => void;
}) {
  const { copy } = useLanguage();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        🛵 {copy('Delivery Fee — দূরত্ব অনুযায়ী', 'Delivery fee by distance')}
      </div>
      {slabs.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: th.muted, minWidth: 48 }}>{copy('পর্যন্ত', 'Up to')}</span>
          <input style={{ ...th.input, width: 86, padding: '7px 10px' }} type="number" min={0.1} step={0.1} value={Number.isFinite(s.maxKm) ? s.maxKm : ''}
            onChange={e => onChange(slabs.map((x, j) => j === i ? { ...x, maxKm: Number(e.target.value) } : x))} />
          <span style={{ fontSize: 12.5, color: th.muted }}>km →</span>
          <input style={{ ...th.input, width: 86, padding: '7px 10px' }} type="number" min={0} value={Number.isFinite(s.fee) ? s.fee : ''}
            onChange={e => onChange(slabs.map((x, j) => j === i ? { ...x, fee: Number(e.target.value) } : x))} />
          <span style={{ fontSize: 12.5, color: th.muted }}>{cur}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }}
            onClick={() => onChange(slabs.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {slabs.length < 10 && (
        <button style={{ ...th.btnGhost, fontSize: 12, alignSelf: 'flex-start' }} onClick={() => {
          const last = slabs[slabs.length - 1];
          onChange([...slabs, { maxKm: last ? Math.round((last.maxKm + 0.5) * 10) / 10 : 1, fee: last ? last.fee + 10 : 30 }]);
        }}>+ {copy('Slab যোগ করুন', 'Add slab')}</button>
      )}
      <div style={{ fontSize: 11.5, color: th.muted }}>
        {copy('শেষ slab-এর বাইরে customer order করতে পারবে না।', 'Customers beyond the last slab cannot order.')}
      </div>
    </div>
  );
}
