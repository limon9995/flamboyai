import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, FieldWithInfo, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

type Product = {
  id: number; code: string; name: string | null;
  price: number; costPrice: number; stockQty: number;
  isActive: boolean; postCaption: string | null;
  videoUrl: string | null; fbPostUrl: string | null; catalogVisible: boolean;
  imageUrl: string | null; description: string | null;
  referenceImagesJson: string | null;
  productGroup: string | null;
  variantLabel: string | null;
  variantOptions: string | null;
  // V18: Image recognition metadata
  category: string | null; color: string | null;
  tags: string | null; imageKeywords: string | null;
  visionSearchable: boolean;
  // V19: Detection mode
  detectionMode: 'OCR' | 'AI_VISION';
  // V22: Simple products
  productType: 'CODED' | 'SIMPLE';
  unit: string | null;
  orderEnabled: boolean;
  // V23: Per-product home delivery charge
  deliveryCharge: 'FREE' | 'PAID';
  // V24: discount price and per-product pricing-policy override
  originalPrice: number | null;
  pricingPolicyOverride: string | null;
};

type EditData = {
  name?: string; price?: number; costPrice?: number; stockQty?: number;
  postCaption?: string; videoUrl?: string; fbPostUrl?: string; catalogVisible?: boolean;
  description?: string; imageUrl?: string; referenceImagesJson?: string; productGroup?: string; variantLabel?: string; variantOptions?: string;
  // V18: Image recognition metadata
  category?: string; color?: string; tags?: string; imageKeywords?: string;
  visionSearchable?: boolean;
  // V19: Detection mode
  detectionMode?: 'OCR' | 'AI_VISION';
  // V23: Per-product home delivery charge
  deliveryCharge?: 'FREE' | 'PAID';
  // V24: discount price and per-product pricing-policy override
  originalPrice?: number | null;
  pricingPolicyOverride?: string | null;
};

const EMPTY = { code: '', name: '', price: 0, costPrice: 0, stockQty: 0, postCaption: '', videoUrl: '', fbPostUrl: '', catalogVisible: true, description: '', imageUrl: '', referenceImagesJson: '', productGroup: '', variantLabel: '', variantOptions: '', category: '', color: '', tags: '', imageKeywords: '', visionSearchable: false, detectionMode: 'AI_VISION' as 'OCR' | 'AI_VISION', deliveryCharge: 'PAID' as 'FREE' | 'PAID', originalPrice: null as number | null, pricingPolicyOverride: null as string | null };

// V24: per-product pricing-policy override shape — mirrors the page-level
// PricingPolicy fields (SettingsPage's "Pricing Policy" section /
// bot-knowledge.service.ts's defaultPricingPolicy()) so a product can opt
// out of inheriting the page policy field-for-field.
type PolicyOverrideForm = {
  priceMode: string; allowCustomerOffer: boolean; agentApprovalRequired: boolean;
  minNegotiationType: string; minNegotiationValue: number;
  fixedPriceReplyText: string; negotiationReplyText: string;
};

const POLICY_OVERRIDE_DEFAULT: PolicyOverrideForm = {
  priceMode: 'FIXED', allowCustomerOffer: false, agentApprovalRequired: true,
  minNegotiationType: 'PERCENT', minNegotiationValue: 0,
  fixedPriceReplyText: '', negotiationReplyText: '',
};

/** One box for adding photos three ways: click to pick a file, Ctrl+V a copied image, or drag & drop. */
function ImageDropZone({ th, copy, multiple, uploading, compact, label, onFiles }: {
  th: Theme; copy: (bn: string, en: string) => string;
  multiple?: boolean; uploading: boolean; compact?: boolean; label: string;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [focused, setFocused] = useState(false);

  const emit = (list: File[]) => {
    const images = list.filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    onFiles(multiple ? images : images.slice(0, 1));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].type.startsWith('image/') ? items[i].getAsFile() : null;
      if (file) files.push(file);
    }
    if (!files.length) return;
    e.preventDefault();
    emit(files);
  };

  const active = dragOver || focused;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !uploading && inputRef.current?.click()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
      onPaste={onPaste}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); emit(Array.from(e.dataTransfer.files || [])); }}
      style={{
        border: `1.5px dashed ${active ? th.accent : th.borderMd}`,
        background: active ? `${th.accent}12` : th.surface,
        borderRadius: 10,
        padding: compact ? '8px 10px' : '14px 12px',
        textAlign: 'center',
        cursor: uploading ? 'wait' : 'pointer',
        outline: 'none',
        fontSize: compact ? 11.5 : 12.5,
        color: th.muted,
        transition: 'border-color .15s, background .15s',
      }}
    >
      <div style={{ fontWeight: 700, color: active ? th.accent : th.text, marginBottom: 2 }}>
        {uploading ? copy('Uploading...', 'Uploading...') : label}
      </div>
      {!uploading && (
        <div>
          {focused
            ? copy('এখন Ctrl+V চাপুন ছবি paste করতে', 'Now press Ctrl+V to paste the image')
            : copy('Click করে upload • ছবি copy করে এখানে click দিয়ে Ctrl+V • বা drag & drop', 'Click to upload • Click here then Ctrl+V to paste • or drag & drop')}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        style={{ display: 'none' }}
        onClick={e => e.stopPropagation()}
        onChange={e => { emit(Array.from(e.target.files || [])); e.target.value = ''; }}
      />
    </div>
  );
}

/** Inline "Inherit from Page / Override" pricing-policy editor, reused across all 4 product forms. */
function PricingPolicyOverrideField({ th, copy, value, onChange }: {
  th: Theme; copy: (bn: string, en: string) => string;
  value: string | null | undefined; onChange: (json: string | null) => void;
}) {
  let parsed: PolicyOverrideForm | null = null;
  if (value) {
    try { parsed = { ...POLICY_OVERRIDE_DEFAULT, ...JSON.parse(value) }; } catch { parsed = null; }
  }
  const enabled = parsed !== null;
  const form = parsed ?? POLICY_OVERRIDE_DEFAULT;
  const update = (patch: Partial<PolicyOverrideForm>) => onChange(JSON.stringify({ ...form, ...patch }));

  return (
    <FieldWithInfo th={th} label={copy('💬 Pricing Policy Override', '💬 Pricing Policy Override')} helpText={copy('Page-এর সাধারণ negotiation policy এই product-এর জন্য আলাদা করতে চাইলে চালু করুন — না হলে Settings-এর page-wide policy অনুসরণ হবে।', "Turn on to set a different negotiation policy for just this product — otherwise it inherits the page-wide policy from Settings.")}>
      <div style={{ display: 'flex', gap: 8, marginBottom: enabled ? 10 : 0 }}>
        <button type="button" onClick={() => onChange(null)}
          style={{ ...th.btnSm, flex: 1, justifyContent: 'center',
            background: !enabled ? th.accent : th.surface, color: !enabled ? '#fff' : th.textSub,
            border: `1px solid ${!enabled ? th.accent : th.border}` }}>
          {copy('Page থেকে Inherit', 'Inherit from Page')}
        </button>
        <button type="button" onClick={() => onChange(JSON.stringify(POLICY_OVERRIDE_DEFAULT))}
          style={{ ...th.btnSm, flex: 1, justifyContent: 'center',
            background: enabled ? th.accent : th.surface, color: enabled ? '#fff' : th.textSub,
            border: `1px solid ${enabled ? th.accent : th.border}` }}>
          {copy('Override করুন', 'Override')}
        </button>
      </div>

      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['FIXED', 'NEGOTIABLE'].map(m => (
              <button key={m} type="button" onClick={() => update({ priceMode: m })}
                style={{ ...th.btnSm, flex: 1, justifyContent: 'center',
                  background: form.priceMode === m ? th.accent : th.surface,
                  color: form.priceMode === m ? '#fff' : th.textSub,
                  border: `1px solid ${form.priceMode === m ? th.accent : th.border}` }}>
                {m === 'FIXED' ? copy('🔒 Fixed', '🔒 Fixed') : copy('💬 Negotiable', '💬 Negotiable')}
              </button>
            ))}
          </div>

          {form.priceMode === 'NEGOTIABLE' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.allowCustomerOffer}
                  onChange={e => update({ allowCustomerOffer: e.target.checked })} />
                {copy('Customer offer করতে পারবে', 'Allow customer offers')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.agentApprovalRequired}
                  onChange={e => update({ agentApprovalRequired: e.target.checked })} />
                {copy('Agent approval লাগবে', 'Agent approval required')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select style={{ ...th.input, fontSize: 12.5 }} value={form.minNegotiationType}
                  onChange={e => update({ minNegotiationType: e.target.value })}>
                  <option value="PERCENT">{copy('Percent (%)', 'Percent (%)')}</option>
                  <option value="FIXED">{copy('Fixed (৳)', 'Fixed (৳)')}</option>
                </select>
                <input style={{ ...th.input, fontSize: 12.5 }} type="number" min={0} value={form.minNegotiationValue}
                  onChange={e => update({ minNegotiationValue: Number(e.target.value) })}
                  placeholder={copy('Min discount', 'Min discount')} />
              </div>
            </>
          )}

          <input style={{ ...th.input, fontSize: 12.5 }} value={form.fixedPriceReplyText}
            onChange={e => update({ fixedPriceReplyText: e.target.value })}
            placeholder={copy('Fixed price reply text', 'Fixed price reply text')} />
          <input style={{ ...th.input, fontSize: 12.5 }} value={form.negotiationReplyText}
            onChange={e => update({ negotiationReplyText: e.target.value })}
            placeholder={copy('Negotiation reply text', 'Negotiation reply text')} />
        </div>
      )}
    </FieldWithInfo>
  );
}

/** Convert DB JSON variantOptions → textarea text ("Size: S,M,L,XL\nColor: Red,Blue") */
function variantOptionsToText(json: string | null): string {
  if (!json) return '';
  try {
    const arr: { label: string; choices?: string[] }[] = JSON.parse(json);
    return arr.map(v => v.choices?.length ? `${v.label}: ${v.choices.join(',')}` : v.label).join('\n');
  } catch { return ''; }
}

function referenceImagesToText(value: string | null): string {
  if (!value) return '';
  try {
    const arr = JSON.parse(value);
    if (Array.isArray(arr)) {
      return arr
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .join('\n');
    }
  } catch {}
  return value;
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
  return raw
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index);
}

function getVideoEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch?.[1]) {
    return `https://www.youtube.com/embed/${ytMatch[1]}`;
  }
  if (url.includes('facebook.com') || url.includes('fb.watch')) {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`;
  }
  return null;
}

function UniquenessCard({ data, hidden, onHide, th, onApplyMode }: {
  data: any; hidden: boolean; onHide: () => void; th: any;
  onApplyMode: (mode: 'OCR' | 'AI_VISION') => void;
}) {
  if (!data || hidden) return null;
  const pct: number = data.uniquenessPercent ?? 0;
  const isGood = pct >= 70;
  const isMid = pct >= 45 && pct < 70;
  const color = isGood ? '#34d399' : isMid ? '#f59e0b' : '#f87171';
  const bg = isGood ? 'rgba(16,185,129,0.07)' : isMid ? 'rgba(245,158,11,0.07)' : 'rgba(248,113,113,0.07)';
  const border = isGood ? 'rgba(16,185,129,0.25)' : isMid ? 'rgba(245,158,11,0.25)' : 'rgba(248,113,113,0.25)';
  const icon = isGood ? '✅' : isMid ? '⚠️' : '🔴';
  const topSimilar: any[] = data.topSimilar ?? [];
  return (
    <div style={{ marginTop: 12, background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '12px 14px', position: 'relative' }}>
      <button onClick={onHide} style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: th.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }} title="Hide">×</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color, minWidth: 54, textAlign: 'center', lineHeight: 1 }}>
          {pct}%
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color }}>{icon} Uniqueness Score</div>
          <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>{data.reason}</div>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      {/* Similar products */}
      {topSimilar.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: th.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Similar Products Found ({data.totalProductsChecked} checked)
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {topSimilar.map((s: any) => (
              <div key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '4px 8px', fontSize: 11 }}>
                {s.imageUrl && <img src={s.imageUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />}
                <span style={{ color: th.text }}>{s.name || s.code}</span>
                <span style={{ color, fontWeight: 700 }}>{s.similarity}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Recommendation buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onApplyMode(data.recommendation)}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${color}`, background: `${color}18`, color, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
        >
          {data.recommendation === 'AI_VISION' ? '🤖 AI Vision Mode Apply করুন' : '📷 OCR Mode Apply করুন'} (Recommended)
        </button>
        <button
          type="button"
          onClick={() => onApplyMode(data.recommendation === 'AI_VISION' ? 'OCR' : 'AI_VISION')}
          style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${th.border}`, background: 'transparent', color: th.muted, fontSize: 11, cursor: 'pointer' }}
        >
          {data.recommendation === 'AI_VISION' ? 'OCR দিয়ে চালাবো' : 'AI Vision দিয়ে চালাবো'}
        </button>
      </div>
    </div>
  );
}

export function ProductsPage({ th, pageId, onToast }: {
  th: Theme; pageId: number; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const [products, setProducts]   = useState<Product[]>([]);
  const [loading, setLoading]     = useState(false);
  const [codePrefix, setCodePrefix] = useState('DF');
  const [view, setView]           = useState<'grid' | 'list'>('grid');
  const [search, setSearch]       = useState('');
  const [editId, setEditId]       = useState<number | null>(null);
  const [editData, setEditData]   = useState<EditData>({});
  const [newP, setNewP]           = useState(EMPTY);
  const [showNew, setShowNew]     = useState(false);
  const [busy, setBusy]           = useState(false);
  const [newVideoGuide, setNewVideoGuide] = useState<any | null>(null);
  const [editVideoGuide, setEditVideoGuide] = useState<any | null>(null);
  const [analyzingNew, setAnalyzingNew] = useState(false);
  const [analyzingEdit, setAnalyzingEdit] = useState(false);
  const [uploadingNewImage, setUploadingNewImage] = useState(false);
  const [uploadingEditImage, setUploadingEditImage] = useState(false);
  const [uploadingNewRefs, setUploadingNewRefs] = useState(false);
  const [uploadingEditRefs, setUploadingEditRefs] = useState(false);
  const [uniquenessNew, setUniquenessNew] = useState<any | null>(null);
  const [uniquenessEdit, setUniquenessEdit] = useState<any | null>(null);
  const [uniquenessNewHidden, setUniquenessNewHidden] = useState(false);
  const [uniquenessEditHidden, setUniquenessEditHidden] = useState(false);
  const [generatingDescNew, setGeneratingDescNew] = useState(false);
  const [generatingDescEdit, setGeneratingDescEdit] = useState(false);
  const [extractingNew, setExtractingNew] = useState(false);
  const [extractingEdit, setExtractingEdit] = useState(false);
  const BASE = `${API_BASE}/client-dashboard/${pageId}`;

  // V22: Simple Products tab state
  const [simpleForm, setSimpleForm] = useState({ name: '', price: 0, stockQty: 0, unit: 'kg', description: '', orderEnabled: true, isActive: true, deliveryCharge: 'PAID' as 'FREE' | 'PAID', originalPrice: null as number | null, pricingPolicyOverride: null as string | null });
  const [showSimpleForm, setShowSimpleForm] = useState(false);
  const [simpleEditId, setSimpleEditId] = useState<number | null>(null);
  const [simpleEditData, setSimpleEditData] = useState<{ name?: string; price?: number; stockQty?: number; unit?: string; description?: string; orderEnabled?: boolean; isActive?: boolean; deliveryCharge?: 'FREE' | 'PAID'; originalPrice?: number | null; pricingPolicyOverride?: string | null }>({});
  const [busySimple, setBusySimple] = useState(false);

  // Dual Photo Mode
  const [productTab, setProductTab] = useState<'single' | 'dual' | 'simple'>('single');
  const [dual] = useState<{
    mode: boolean;
    wearingProductId: number | null; wearingCode: string; wearingName: string;
    holdingProductId: number | null; holdingCode: string; holdingName: string;
    holdingRefUrl: string; wearingRefUrl: string; livePhotoUrls: string[];
  }>({ mode: false, wearingProductId: null, wearingCode: '', wearingName: '', holdingProductId: null, holdingCode: '', holdingName: '', holdingRefUrl: '', wearingRefUrl: '', livePhotoUrls: [] });

  // Live Session state (new Dual Photo system)
  const [liveSessions, setLiveSessions] = useState<any[]>([]);
  const [newSession, setNewSession] = useState<{ label: string; screenshots: string[]; wornProductId: number | null; heldProductId: number | null }>({ label: '', screenshots: [], wornProductId: null, heldProductId: null });
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionUploading, setSessionUploading] = useState(false);
  const [sessionAnalyzing, setSessionAnalyzing] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadLiveSessions = useCallback(async () => {
    const rows = await request<any[]>(`${BASE}/live-sessions`).catch(() => []);
    setLiveSessions(rows);
  }, [BASE]);

  // Real per-image cost actually charged by the backend (wallet.service.ts) —
  // shown instead of a guessed number, since admins can customize these per page.
  const [visionCosts, setVisionCosts] = useState({ ocr: 1, vision: 8 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, settings, wallet] = await Promise.all([
        request<Product[]>(`${BASE}/products`),
        request<any>(`${BASE}/settings`).catch(() => null),
        request<any>(`${BASE}/wallet`).catch(() => null),
      ]);
      setProducts(prods);
      if (settings?.productCodePrefix) setCodePrefix(settings.productCodePrefix);
      if (wallet) {
        setVisionCosts({
          ocr: Number(wallet.costPerOcrLocalCredit ?? 1),
          vision: Number(wallet.costPerAnalyzeCredit ?? 8),
        });
      }
    }
    catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (productTab === 'dual') loadLiveSessions(); }, [productTab, loadLiveSessions]);

  const openEdit = (p: Product) => {
    setEditId(p.id);
    setEditData({ name: p.name ?? '', price: p.price, costPrice: p.costPrice, stockQty: p.stockQty, postCaption: p.postCaption ?? '', videoUrl: p.videoUrl ?? '', fbPostUrl: p.fbPostUrl ?? '', catalogVisible: p.catalogVisible ?? true, description: p.description ?? '', imageUrl: p.imageUrl ?? '', referenceImagesJson: referenceImagesToText(p.referenceImagesJson), productGroup: p.productGroup ?? '', variantLabel: p.variantLabel ?? '', variantOptions: variantOptionsToText(p.variantOptions), category: p.category ?? '', color: p.color ?? '', tags: p.tags ?? '', imageKeywords: p.imageKeywords ?? '', visionSearchable: p.visionSearchable ?? false, detectionMode: p.detectionMode ?? 'AI_VISION', deliveryCharge: p.deliveryCharge ?? 'PAID', originalPrice: p.originalPrice ?? null, pricingPolicyOverride: p.pricingPolicyOverride ?? null });
    setEditVideoGuide(null);
    setUniquenessEdit(null);
    setUniquenessEditHidden(false);
  };

  const saveEdit = async (p: Product) => {
    setBusy(true);
    try {
      await request(`${BASE}/products/${p.code}`, { method: 'PATCH', body: JSON.stringify(editData) });
      onToast(copy('✓ Saved', '✓ Saved')); setEditId(null); load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const createProduct = async () => {
    if (!newP.code.trim()) return onToast(copy('Product code দিন', 'Enter a product code'), 'error');
    setBusy(true);
    try {
      await request(`${BASE}/products`, { method: 'POST', body: JSON.stringify(newP) });
      onToast(copy('✓ Product created', '✓ Product created')); setNewP(EMPTY); setShowNew(false); load();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const deleteProduct = async (code: string) => {
    if (!confirm(copy('Delete করবেন?', 'Do you want to delete this product?'))) return;
    try {
      await request(`${BASE}/products/${code}`, { method: 'DELETE' });
      onToast(copy('Deleted', 'Deleted')); load();
    } catch (e: any) { onToast(e.message, 'error'); }
  };

  const uploadProductFile = useCallback(async (file: File): Promise<string> => {
    const token = localStorage.getItem('dfbot_token') || '';
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/products/upload-image`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Upload failed');
    }
    const data = await res.json();
    return `${API_BASE.replace(/\/api$/, '')}${data.url}`;
  }, [BASE]);

  const appendReferenceUrls = (current: string, urls: string[]) => {
    const merged = [...parseReferenceImages(current), ...urls]
      .filter((url, index, all) => all.indexOf(url) === index);
    return merged.join('\n');
  };

  /** Whichever photo is added first — via Image URL upload or Reference Images —
   *  becomes the product's main profile photo (shown in cards/website/catalog).
   *  Any additional photos in the same batch still go to Reference Images. */
  const addImagesPromotingFirst = <T extends { imageUrl?: string; referenceImagesJson?: string }>(
    prev: T,
    urls: string[],
  ): T => {
    if (!urls.length) return prev;
    if (!String(prev.imageUrl || '').trim()) {
      const [first, ...rest] = urls;
      return {
        ...prev,
        imageUrl: first,
        referenceImagesJson: appendReferenceUrls(prev.referenceImagesJson || '', rest),
      };
    }
    return {
      ...prev,
      referenceImagesJson: appendReferenceUrls(prev.referenceImagesJson || '', urls),
    };
  };

  /** Clipboard-image support: copy a screenshot/image and Ctrl+V it straight into a field. */
  const extractPastedImageFiles = (e: React.ClipboardEvent): File[] => {
    const items = e.clipboardData?.items;
    if (!items) return [];
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].type.startsWith('image/') ? items[i].getAsFile() : null;
      if (file) files.push(file);
    }
    return files;
  };

  const uploadMainImageFiles = async (files: File[], target: 'new' | 'edit') => {
    if (!files.length) return;
    const setUploading = target === 'new' ? setUploadingNewImage : setUploadingEditImage;
    setUploading(true);
    try {
      const url = await uploadProductFile(files[0]);
      if (target === 'new') setNewP(p => ({ ...p, imageUrl: url }));
      else setEditData(d => ({ ...d, imageUrl: url }));
      onToast(copy('Main ছবি upload হয়েছে ✓', 'Main image uploaded ✓'), 'success');
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const uploadRefImageFiles = async (files: File[], target: 'new' | 'edit') => {
    if (!files.length) return;
    const setUploading = target === 'new' ? setUploadingNewRefs : setUploadingEditRefs;
    setUploading(true);
    try {
      const urls = await Promise.all(files.map(uploadProductFile));
      if (target === 'new') setNewP(p => addImagesPromotingFirst(p, urls));
      else setEditData(d => addImagesPromotingFirst(d, urls));
      onToast(copy('Angle ছবি upload হয়েছে ✓', 'Angle images uploaded ✓'), 'success');
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleMainImagePaste = (e: React.ClipboardEvent, target: 'new' | 'edit') => {
    const files = extractPastedImageFiles(e);
    if (!files.length) return; // no image on clipboard — let normal text paste happen
    e.preventDefault();
    void uploadMainImageFiles(files, target);
  };

  const handleRefImagesPaste = (e: React.ClipboardEvent, target: 'new' | 'edit') => {
    const files = extractPastedImageFiles(e);
    if (!files.length) return;
    e.preventDefault();
    void uploadRefImageFiles(files, target);
  };

  /** Merges AI-analyze suggestions into a product form — never overwrites fields the user already filled in. */
  const applyAiSuggestions = (prev: any, suggested: any) => {
    if (!prev) return prev;
    const next: any = {
      ...prev,
      category: (suggested.category || prev.category || '').trim(),
      color: (suggested.color || prev.color || '').trim(),
      imageKeywords: (suggested.imageKeywords || prev.imageKeywords || '').trim(),
      tags: (suggested.tags || prev.tags || '').trim(),
      visionSearchable: typeof suggested.visionSearchable === 'boolean' ? suggested.visionSearchable : !!prev.visionSearchable,
    };
    if (!String(prev.name || '').trim() && suggested.nameGuess) next.name = suggested.nameGuess;
    if (!Number(prev.price) && typeof suggested.priceGuess === 'number') next.price = suggested.priceGuess;
    if (!String(prev.description || '').trim()) {
      const extraLines = [
        suggested.sizeGuess ? `মাপ/সাইজ: ${suggested.sizeGuess}` : '',
        suggested.visibleText ? `ছবিতে লেখা তথ্য: ${suggested.visibleText}` : '',
      ].filter(Boolean);
      if (extraLines.length) next.description = extraLines.join('\n');
    }
    return next;
  };

  const analyzeImage = async (imageUrl: string, target: 'new' | 'edit') => {
    if (!imageUrl.trim()) {
      onToast(copy('আগে image দিন', 'Add an image first'), 'error');
      return;
    }
    if (target === 'new') { setAnalyzingNew(true); setUniquenessNewHidden(false); }
    else { setAnalyzingEdit(true); setUniquenessEditHidden(false); }
    try {
      const currentCode = target === 'edit' ? products.find(p => p.id === editId)?.code : undefined;
      const result = await request<any>(`${BASE}/products/analyze-image`, {
        method: 'POST',
        body: JSON.stringify({ imageUrl, excludeCode: currentCode }),
      });
      const suggested = result?.suggested || {};
      if (target === 'new') {
        setNewP((p) => applyAiSuggestions(p, suggested));
        setUniquenessNew(result?.uniqueness || null);
      } else {
        setEditData((d) => applyAiSuggestions(d, suggested));
        setUniquenessEdit(result?.uniqueness || null);
      }
      if (result?.fromCache) {
        onToast(copy('এই ছবিটা আগেই analyze করা হয়েছে — same result ব্যবহার হচ্ছে (wallet charge হয়নি)', 'Same photo detected — cached result used (no charge)'), 'warning');
      } else {
        onToast(copy('AI analysis applied', 'AI analysis applied'), 'success');
      }
    } catch (e: any) {
      onToast((e as any).message ?? copy('AI analysis ব্যর্থ হয়েছে', 'AI analysis failed'), 'error');
    } finally {
      if (target === 'new') setAnalyzingNew(false);
      else setAnalyzingEdit(false);
    }
  };

  const batchAnalyzeAll = async (referenceImagesJson: string | undefined, mainImageUrl: string | undefined, target: 'new' | 'edit') => {
    const urls = [
      ...(mainImageUrl ? [mainImageUrl] : []),
      ...parseReferenceImages(referenceImagesJson ?? ''),
    ].filter(Boolean).slice(0, 5);
    if (urls.length < 2) {
      onToast(copy('কমপক্ষে ২টা reference image দরকার', 'Need at least 2 reference images'), 'error');
      return;
    }
    if (target === 'new') { setAnalyzingNew(true); setUniquenessNewHidden(false); }
    else { setAnalyzingEdit(true); setUniquenessEditHidden(false); }
    try {
      const currentCode = target === 'edit' ? products.find(p => p.id === editId)?.code : undefined;
      const result = await request<any>(`${BASE}/products/batch-analyze`, {
        method: 'POST',
        body: JSON.stringify({ imageUrls: urls, excludeCode: currentCode }),
      });
      const suggested = result?.suggested || {};
      if (target === 'new') {
        setNewP((p) => applyAiSuggestions(p, suggested));
        setUniquenessNew(result?.uniqueness || null);
      } else {
        setEditData((d) => applyAiSuggestions(d, suggested));
        setUniquenessEdit(result?.uniqueness || null);
      }
      if (result?.fromCache) {
        onToast(copy('এই ছবিগুলো আগেই analyze করা হয়েছে — same result ব্যবহার হচ্ছে (wallet charge হয়নি)', 'Same photos detected — cached result used (no charge)'), 'warning');
      } else {
        onToast(copy(`${urls.length}টা angle থেকে AI analysis সম্পন্ন ✓`, `AI analysis from ${urls.length} angles done ✓`), 'success');
      }
    } catch (e: any) {
      onToast((e as any).message ?? copy('AI analysis ব্যর্থ হয়েছে', 'AI analysis failed'), 'error');
    } finally {
      if (target === 'new') setAnalyzingNew(false);
      else setAnalyzingEdit(false);
    }
  };

  const generateDescription = async (target: 'new' | 'edit') => {
    const data = target === 'new' ? newP : editData;
    const name = (data.name || '').trim();
    if (!name) return onToast(copy('আগে product name দিন', 'Enter a product name first'), 'error');
    if (target === 'new') setGeneratingDescNew(true);
    else setGeneratingDescEdit(true);
    try {
      const result = await request<{ text: string | null }>(`${API_BASE}/ai-generate/product-description`, {
        method: 'POST',
        body: JSON.stringify({
          pageId,
          name,
          category: (data.category || '').trim(),
          color: (data.color || '').trim(),
          keywords: (data.imageKeywords || '').trim(),
        }),
      });
      if (result?.text) {
        if (target === 'new') setNewP(p => ({ ...p, description: result.text! }));
        else setEditData(d => ({ ...d, description: result.text! }));
        onToast(copy('AI description তৈরি হয়েছে ✓', 'AI description generated ✓'), 'success');
      }
    } catch (e: any) {
      onToast(e.message ?? copy('AI description ব্যর্থ হয়েছে', 'AI description failed'), 'error');
    } finally {
      if (target === 'new') setGeneratingDescNew(false);
      else setGeneratingDescEdit(false);
    }
  };

  /** Reads the Full Description text and auto-fills Name/Price/Category/Color/etc. — only empty fields, via AI. */
  const extractFieldsFromDescription = async (target: 'new' | 'edit') => {
    const data = target === 'new' ? newP : editData;
    const description = (data.description || '').trim();
    if (!description) return onToast(copy('আগে Full Description লিখুন', 'Write a Full Description first'), 'error');
    if (target === 'new') setExtractingNew(true);
    else setExtractingEdit(true);
    try {
      const result = await request<{ suggested: any }>(`${API_BASE}/ai-generate/product-fields-from-description`, {
        method: 'POST',
        body: JSON.stringify({ pageId, description }),
      });
      if (result?.suggested) {
        if (target === 'new') setNewP((p) => applyAiSuggestions(p, result.suggested));
        else setEditData((d) => applyAiSuggestions(d, result.suggested));
        onToast(copy('Description থেকে fields fill হয়েছে ✓', 'Fields filled from description ✓'), 'success');
      } else {
        onToast(copy('Description থেকে কিছু বোঝা যায়নি', 'Could not extract anything from the description'), 'warning');
      }
    } catch (e: any) {
      onToast(e.message ?? copy('Fields fill ব্যর্থ হয়েছে', 'Failed to fill fields'), 'error');
    } finally {
      if (target === 'new') setExtractingNew(false);
      else setExtractingEdit(false);
    }
  };

  const loadVideoGuide = async (videoUrl: string, existingImages: number, target: 'new' | 'edit') => {
    if (!videoUrl.trim()) {
      onToast(copy('আগে video URL দিন', 'Add a video URL first'), 'error');
      return;
    }
    try {
      const guide = await request<any>(`${BASE}/products/video-guide`, {
        method: 'POST',
        body: JSON.stringify({ videoUrl, existingImages }),
      });
      if (target === 'new') setNewVideoGuide(guide);
      else setEditVideoGuide(guide);
    } catch (e: any) {
      onToast(e.message, 'error');
    }
  };

  // ── Live Session functions ─────────────────────────────────────────────────
  const uploadNewScreenshot = async (file: File) => {
    setSessionUploading(true);
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${BASE}/products/upload-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text() || 'Upload failed');
      const data = await res.json();
      // Construct absolute URL so backend can send it to OpenAI
      const url: string = data.url ? `${API_BASE.replace(/\/api$/, '')}${data.url}` : '';
      if (url) setNewSession(p => ({ ...p, screenshots: [...p.screenshots, url] }));
      else onToast('Upload failed', 'error');
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSessionUploading(false); }
  };

  const saveNewSession = async () => {
    if (!newSession.screenshots.length) return onToast('কমপক্ষে ১টা screenshot upload করুন', 'error');
    if (!newSession.wornProductId && !newSession.heldProductId) return onToast('অন্তত ১টা product assign করুন', 'error');
    setSessionSaving(true);
    try {
      await request(`${BASE}/live-sessions`, { method: 'POST', body: JSON.stringify(newSession) });
      onToast('✓ Session saved');
      setNewSession({ label: '', screenshots: [], wornProductId: null, heldProductId: null });
      setShowNewForm(false);
      await loadLiveSessions();
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setSessionSaving(false); }
  };

  const analyzeSession = async (id: number) => {
    setSessionAnalyzing(id);
    try {
      await request(`${BASE}/live-sessions/${id}/analyze`, { method: 'POST' });
      onToast('✓ AI analysis complete');
      await loadLiveSessions();
    } catch (e: any) { onToast(e.message || 'Analysis failed', 'error'); }
    finally { setSessionAnalyzing(null); }
  };

  const deleteSession = async (id: number) => {
    if (!confirm('এই session delete করবেন?')) return;
    await request(`${BASE}/live-sessions/${id}`, { method: 'DELETE' }).catch(() => null);
    await loadLiveSessions();
  };

  const toggleSession = async (id: number, isActive: boolean) => {
    await request(`${BASE}/live-sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }).catch(() => null);
    await loadLiveSessions();
  };

  const codedProducts = products.filter(p => p.productType !== 'SIMPLE');
  const filtered = codedProducts.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return p.code.toLowerCase().includes(s) || (p.name || '').toLowerCase().includes(s);
  });

  const stats = {
    total:    codedProducts.length,
    active:   codedProducts.filter(p => p.isActive).length,
    lowStock: codedProducts.filter(p => p.stockQty <= 3 && p.isActive).length,
    withImg:  codedProducts.filter(p => p.imageUrl || parseReferenceImages(p.referenceImagesJson).length > 0).length,
    withAngles: codedProducts.filter(p => parseReferenceImages(p.referenceImagesJson).length > 0).length,
    withVid:  codedProducts.filter(p => p.videoUrl).length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>Products</h1>
          <p style={{ fontSize: 13, color: th.muted, margin: '3px 0 0' }}>
            {stats.active} {copy('active', 'active')} · {stats.lowStock > 0 ? <span style={{ color: '#ea580c' }}>{stats.lowStock} {copy('low stock', 'low stock')}</span> : copy('stock ok', 'stock ok')}
          </p>
        </div>
        {productTab === 'single' && (
          <button style={th.btnPrimary} onClick={async () => {
            if (!showNew) {
              // Re-fetch the prefix fresh each time the form opens — codePrefix
              // in state can go stale if Settings was changed without a full
              // page remount, and this form should always use the current one.
              let prefix = codePrefix;
              try {
                const settings = await request<any>(`${BASE}/settings`);
                if (settings?.productCodePrefix) {
                  prefix = settings.productCodePrefix;
                  setCodePrefix(prefix);
                }
              } catch {}
              setNewP(p => ({ ...p, code: `${prefix}-` }));
            }
            setShowNew(v => !v);
          }}>
            {showNew ? copy('✕ Cancel', '✕ Cancel') : copy('+ Add Product', '+ Add Product')}
          </button>
        )}
        {productTab === 'simple' && (
          <button style={th.btnPrimary} onClick={() => { setShowSimpleForm(v => !v); setSimpleEditId(null); }}>
            {showSimpleForm && simpleEditId === null ? '✕ Cancel' : '+ Add Simple Product'}
          </button>
        )}
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([
          { key: 'single', label: '📷 Coded Products' },
          { key: 'simple', label: '🥭 Simple Products' },
          { key: 'dual',   label: dual.mode ? '📸 Dual Photo ●' : '📸 Dual Photo' },
        ] as const).map(({ key, label }) => {
          const active = productTab === key;
          return (
            <button key={key} onClick={() => setProductTab(key)} style={{
              padding: '7px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: active ? th.accent : th.surface,
              color: active ? '#fff' : th.muted,
              boxShadow: active ? `0 0 0 2px ${th.accent}44` : 'none',
              transition: 'all .15s',
            }}>
              {label}
            </button>
          );
        })}
        {dual.mode && productTab === 'single' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            Dual Mode চালু — {dual.wearingCode} / {dual.holdingCode}
          </div>
        )}
      </div>

      {productTab === 'single' && (<>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
        {[
          { label: 'Total',     val: stats.total,    color: th.accent },
          { label: 'Active',    val: stats.active,   color: '#16a34a' },
          { label: 'Low Stock', val: stats.lowStock, color: stats.lowStock > 0 ? '#ea580c' : '#16a34a' },
          { label: 'With Photo',val: stats.withImg,  color: '#8b5cf6' },
          { label: 'Multi Angle',val: stats.withAngles,  color: '#ec4899' },
          { label: 'With Video',val: stats.withVid,  color: '#0891b2' },
        ].map(k => (
          <div key={k.label} style={{ ...th.card2, textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: k.color, letterSpacing: '-0.05em' }}>{k.val}</div>
            <div style={{ fontSize: 10.5, color: th.muted, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* New product form */}
      {showNew && (
        <div style={{ ...th.card, border: `1.5px solid ${th.accent}44` }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>{copy('Add New Product', 'Add New Product')}</div>
          {(() => {
            const newVideoEmbedUrl = getVideoEmbedUrl(newP.videoUrl);
            return (
              <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
            <FieldWithInfo th={th} label="Code *" helpText={copy('Unique product code। যেমন: DF-0001, SK-0042', 'Unique product code, for example: DF-0001, SK-0042')}>
              <input style={th.input} placeholder={`${codePrefix}-0001`} value={newP.code}
                onChange={e => setNewP(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
            </FieldWithInfo>
            <FieldWithInfo th={th} label="Name" helpText={copy('Product এর নাম', 'Product name')}>
              <input style={th.input} placeholder="Blue Kurti" value={newP.name}
                onChange={e => setNewP(p => ({ ...p, name: e.target.value }))} />
            </FieldWithInfo>
            <FieldWithInfo th={th} label="Price (৳)" helpText="Selling price">
              <input style={th.input} type="number" min={0} value={newP.price || ''}
                onChange={e => setNewP(p => ({ ...p, price: Number(e.target.value) }))} />
            </FieldWithInfo>
            <FieldWithInfo th={th} label={copy('আগের দাম (৳)', 'Original Price (৳)')} helpText={copy('ছাড় দেখাতে চাইলে দিন — বট স্বাভাবিকভাবে এই অফারের কথা জানাবে।', "Set this to show a discount — the bot will naturally mention the offer.")}>
              <input style={th.input} type="number" min={0} value={newP.originalPrice ?? ''}
                onChange={e => setNewP(p => ({ ...p, originalPrice: e.target.value === '' ? null : Number(e.target.value) }))} />
            </FieldWithInfo>
            <FieldWithInfo th={th} label="Cost Price (৳)" helpText={copy('আপনার ক্রয় মূল্য — profit হিসাবের জন্য', 'Your purchase cost, used for profit calculation')}>
              <input style={th.input} type="number" min={0} value={newP.costPrice || ''}
                onChange={e => setNewP(p => ({ ...p, costPrice: Number(e.target.value) }))} />
            </FieldWithInfo>
            <FieldWithInfo th={th} label="Stock" helpText={copy('প্রাথমিক stock পরিমাণ', 'Initial stock quantity')}>
              <input style={th.input} type="number" min={0} value={newP.stockQty || ''}
                onChange={e => setNewP(p => ({ ...p, stockQty: Number(e.target.value) }))} />
            </FieldWithInfo>
            <FieldWithInfo th={th} label="Image URL" helpText={copy('Product এর ছবির URL', 'Product image URL')}>
              <div style={{ display: 'grid', gap: 8 }}>
                <input style={th.input} placeholder={copy('https://... (অথবা ছবি copy করে এখানে paste করুন)', 'https://... (or copy an image and paste here)')} value={newP.imageUrl}
                  onChange={e => setNewP(p => ({ ...p, imageUrl: e.target.value }))}
                  onPaste={e => handleMainImagePaste(e, 'new')} />
                <ImageDropZone th={th} copy={copy} uploading={uploadingNewImage}
                  label={copy('📷 Main Image', '📷 Main Image')}
                  onFiles={files => uploadMainImageFiles(files, 'new')} />
                {newP.imageUrl && (
                  <img src={newP.imageUrl} alt="main" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: `1px solid ${th.border}` }} />
                )}
                <button type="button" style={th.btnGhost} onClick={() => analyzeImage(newP.imageUrl || parseReferenceImages(newP.referenceImagesJson)[0] || '', 'new')} disabled={analyzingNew}>
                  {analyzingNew ? copy('Analyzing...', 'Analyzing...') : copy('AI Analyze', 'AI Analyze')}
                </button>
              </div>
            </FieldWithInfo>
            <FieldWithInfo th={th} label="Video URL" helpText={copy('YouTube video link দিন, catalog-এ ভিডিও দেখাবে', 'Add a YouTube video link to show it in the catalog')}>
              <div style={{ display: 'grid', gap: 8 }}>
                <input style={th.input} placeholder="https://youtube.com/watch?v=..." value={newP.videoUrl}
                  onChange={e => setNewP(p => ({ ...p, videoUrl: e.target.value }))} />
                <button type="button" style={th.btnGhost} onClick={() => loadVideoGuide(newP.videoUrl, parseReferenceImages(newP.referenceImagesJson).length, 'new')}>
                  {copy('Video Screenshot Plan', 'Video Screenshot Plan')}
                </button>
              </div>
            </FieldWithInfo>
            <FieldWithInfo th={th} label={copy('🔗 Facebook Post Link (optional)', '🔗 Facebook Post Link (optional)')} helpText={copy('এই post-এ comment করলে bot auto reply দেবে', 'Bot will auto-reply to comments on this post')}>
              <input style={th.input} placeholder="https://facebook.com/yourpage/posts/123456"
                value={(newP as any).fbPostUrl ?? ''}
                onChange={e => setNewP(p => ({ ...p, fbPostUrl: e.target.value }))} />
            </FieldWithInfo>
          </div>
          <div style={{ marginTop: 12 }}>
            <FieldWithInfo th={th} label={copy('Full Description', 'Full Description')} helpText={copy('যা কিছু লিখবেন সবটাই bot মনে রাখবে — customer জিজ্ঞেস করলে এখান থেকে সঠিক উত্তর দিতে পারবে। catalog-এও দেখাবে।', 'Everything you write here the bot remembers and uses to answer customer questions accurately. Also shown in the catalog.')}>
              <div style={{ display: 'grid', gap: 8 }}>
                <textarea
                  style={{ ...th.input, minHeight: 96, resize: 'vertical', fontSize: 12.5 }}
                  placeholder={copy('এই product সম্পর্কে যত তথ্য আছে সব লিখুন (মাপ, উপকরণ, যত্ন, ব্যবহার ইত্যাদি)...', 'Write everything about this product (size, material, care, usage, etc.)...')}
                  value={newP.description}
                  onChange={e => setNewP(p => ({ ...p, description: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={th.btnGhost} onClick={() => generateDescription('new')} disabled={generatingDescNew}>
                    {generatingDescNew ? copy('AI লিখছে...', 'AI writing...') : copy('✨ AI লিখুন', '✨ AI Write')}
                  </button>
                  <button type="button" style={th.btnGhost} onClick={() => extractFieldsFromDescription('new')} disabled={extractingNew || !newP.description.trim()}>
                    {extractingNew ? copy('Fields fill হচ্ছে...', 'Filling fields...') : copy('🪄 Description থেকে Fields Fill করো', '🪄 Fill Fields from Description')}
                  </button>
                </div>
              </div>
            </FieldWithInfo>
          </div>
          <div style={{ marginTop: 12 }}>
            <FieldWithInfo th={th} label={copy('🚚 Home Delivery', '🚚 Home Delivery')} helpText={copy('Free করলে bot সবসময় এই product-এর ডেলিভারি ফ্রি বলবে। Paid হলে Settings-এ সেট করা ঢাকার ভিতরে/বাইরের rate অনুযায়ী বলবে।', 'Free always tells the customer delivery is free for this item. Paid uses the inside/outside Dhaka rate configured in Settings.')}>
              <select style={th.input} value={newP.deliveryCharge}
                onChange={e => setNewP(p => ({ ...p, deliveryCharge: e.target.value as 'FREE' | 'PAID' }))}>
                <option value="PAID">{copy('Paid (Settings rate অনুযায়ী)', 'Paid (uses Settings rate)')}</option>
                <option value="FREE">{copy('Free', 'Free')}</option>
              </select>
            </FieldWithInfo>
          </div>
          <div style={{ marginTop: 12 }}>
            <PricingPolicyOverrideField th={th} copy={copy} value={newP.pricingPolicyOverride}
              onChange={json => setNewP(p => ({ ...p, pricingPolicyOverride: json }))} />
          </div>
          <div style={{ marginTop: 12 }}>
            <FieldWithInfo th={th} label="Reference Images" helpText={copy('একই product-এর front, side, back, close-up, video screenshot আলাদা লাইনে দিন। এতে customer shortlist দেখে সহজে confirm করতে পারবে।', 'Paste multiple angles of the same product, one URL per line: front, side, back, close-up, or clear video screenshots.')}>
              <div style={{ display: 'grid', gap: 8 }}>
                <textarea
                  style={{ ...th.input, minHeight: 92, resize: 'vertical', fontSize: 12.5 }}
                  placeholder={copy('https://...\nhttps://...\n(অথবা ছবি copy করে এখানে paste করুন)', 'https://...\nhttps://...\n(or copy image(s) and paste here)')}
                  value={newP.referenceImagesJson}
                  onChange={e => setNewP(p => ({ ...p, referenceImagesJson: e.target.value }))}
                  onPaste={e => handleRefImagesPaste(e, 'new')}
                />
                <ImageDropZone th={th} copy={copy} multiple uploading={uploadingNewRefs}
                  label={copy('🖼️ Angle Images (একাধিক)', '🖼️ Angle Images (multiple)')}
                  onFiles={files => uploadRefImageFiles(files, 'new')} />
              </div>
            </FieldWithInfo>
            {parseReferenceImages(newP.referenceImagesJson).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))', gap: 8 }}>
                  {parseReferenceImages(newP.referenceImagesJson).slice(0, 6).map((url, idx) => (
                    <div key={url + idx} style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${th.border}`, background: th.surface, aspectRatio: '1 / 1', position: 'relative' }}>
                      <img src={url} alt={`ref-${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <div style={{ position: 'absolute', bottom: 3, right: 4, fontSize: 9, background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 4, padding: '1px 4px' }}>#{idx + 1}</div>
                    </div>
                  ))}
                </div>
                {(() => {
                  const totalImages = parseReferenceImages(newP.referenceImagesJson).length + (newP.imageUrl ? 1 : 0);
                  if (totalImages < 1) return null;
                  const onlyRef = !newP.imageUrl ? parseReferenceImages(newP.referenceImagesJson)[0] : '';
                  return (
                    <button
                      type="button"
                      style={{ ...th.btnGhost, marginTop: 8, width: '100%', justifyContent: 'center', background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399', fontSize: 12, fontWeight: 700 }}
                      onClick={() => totalImages >= 2 ? batchAnalyzeAll(newP.referenceImagesJson, newP.imageUrl, 'new') : analyzeImage(newP.imageUrl || onlyRef, 'new')}
                      disabled={analyzingNew}
                    >
                      {analyzingNew
                        ? '⏳ AI analyzing...'
                        : totalImages >= 2
                          ? `🤖 Analyze All ${totalImages} Angles Together`
                          : '🤖 AI Analyze This Photo'}
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
          {newVideoGuide && (
            <div style={{ marginTop: 12, ...th.card2, borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Video Screenshot Plan</div>
              <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 8 }}>{newVideoGuide.reason}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {(newVideoGuide.checklist || []).map((item: string, idx: number) => (
                  <div key={item + idx} style={{ fontSize: 12.5 }}>{idx + 1}. {item}</div>
                ))}
              </div>
            </div>
          )}
          {newVideoEmbedUrl && (
            <div style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', aspectRatio: '16/9', background: '#000', border: `1px solid ${th.border}` }}>
              <iframe
                src={newVideoEmbedUrl}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allowFullScreen
                title="new-product-video-preview"
              />
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={newP.catalogVisible}
                onChange={e => setNewP(p => ({ ...p, catalogVisible: e.target.checked }))}
                style={{ accentColor: th.accent }}
              />
              {copy('Catalog এ দেখাবে', 'Show in Catalog')}
            </label>
            <div style={{ fontSize: 11.5, color: th.muted, marginTop: 4 }}>
              {copy('Tick থাকলে product catalog-এ দেখাবে। Tick তুলে দিলে add হবে, কিন্তু catalog-এ লুকানো থাকবে।', 'If checked, the product will appear in the catalog. If unchecked, it will be added but stay hidden from the catalog.')}
            </div>
          </div>
          {/* Variant options — bot asks these before order */}
          <div style={{ marginTop: 12 }}>
            <FieldWithInfo th={th} label="Bot Variants (optional)" helpText={copy('Bot order নেওয়ার সময় customer কে জিজ্ঞেস করবে। প্রতি লাইনে: Label: choice1, choice2 — যেমন: Size: S,M,L,XL', 'The bot will ask customers these choices while ordering. Use one line per option group, for example: Size: S,M,L,XL')}>
              <textarea
                style={{ ...th.input, minHeight: 64, resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }}
                placeholder={'Size: S,M,L,XL\nColor: Red,Blue,Black'}
                value={newP.variantOptions}
                onChange={e => setNewP(p => ({ ...p, variantOptions: e.target.value }))}
              />
            </FieldWithInfo>
          </div>
          {/* V19: Detection Mode */}
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#34d399', marginBottom: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Image Detection Mode</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['OCR', 'AI_VISION'] as const).map(mode => (
                <label key={mode} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 10, border: `2px solid ${newP.detectionMode === mode ? '#34d399' : (th.border ?? '#333')}`, background: newP.detectionMode === mode ? 'rgba(16,185,129,0.1)' : 'transparent', cursor: 'pointer', userSelect: 'none', transition: 'all 0.15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" name="new-detectionMode" value={mode} checked={newP.detectionMode === mode}
                      onChange={() => setNewP(p => ({ ...p, detectionMode: mode, visionSearchable: mode === 'AI_VISION' }))} style={{ accentColor: '#34d399' }} />
                    <span style={{ fontWeight: 700, fontSize: 13, color: th.text }}>{mode === 'OCR' ? '📷 OCR Mode' : '🤖 AI Vision Mode'}</span>
                  </div>
                  <span style={{ fontSize: 11, color: th.muted ?? '#888', lineHeight: 1.5 }}>
                    {mode === 'OCR'
                      ? `Customer image থেকে product code পড়বে। কোনো AI API call হবে না। খরচ: ${visionCosts.ocr} credit/image`
                      : `AI দিয়ে product detect করবে। খরচ: ${visionCosts.vision} credit/image`}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <UniquenessCard
            data={uniquenessNew}
            hidden={uniquenessNewHidden}
            onHide={() => setUniquenessNewHidden(true)}
            th={th}
            onApplyMode={(mode) => setNewP(p => ({ ...p, detectionMode: mode, visionSearchable: mode === 'AI_VISION' }))}
          />
          {/* V18: Image recognition metadata */}
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: `${th.accent}0d`, border: `1px solid ${th.accent}22` }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: th.accent, marginBottom: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {copy('Image Recognition Tags (AI)', 'Image Recognition Tags (AI)')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
              <FieldWithInfo th={th} label="Category" helpText={copy('পণ্যের ধরন — dress, saree, panjabi, shirt, kurti, t-shirt', 'Product category for image matching, e.g. dress, saree, panjabi, shirt, kurti')}>
                <input style={th.input} placeholder="dress" value={newP.category}
                  onChange={e => setNewP(p => ({ ...p, category: e.target.value }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label="Color" helpText={copy('প্রধান রঙ — black, red, white, multicolor', 'Primary color for image matching, e.g. black, red, white, multicolor')}>
                <input style={th.input} placeholder="black" value={newP.color}
                  onChange={e => setNewP(p => ({ ...p, color: e.target.value }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label="Product Group" helpText={copy('Same design family/group name — যেমন: Noor Kurti Set', 'Family/group name for similar variants, e.g. Noor Kurti Set')}>
                <input style={th.input} placeholder="Noor Kurti Set" value={newP.productGroup}
                  onChange={e => setNewP(p => ({ ...p, productGroup: e.target.value }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label="Variant Label" helpText={copy('Variant short label — যেমন: Navy Floral / Size M', 'Short variant label, e.g. Navy Floral / Size M')}>
                <input style={th.input} placeholder="Navy Floral" value={newP.variantLabel}
                  onChange={e => setNewP(p => ({ ...p, variantLabel: e.target.value }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label="Keywords" helpText={copy('ছবি থেকে পণ্য খুঁজতে কীওয়ার্ড — floral printed maxi', 'Keywords to help match this product from customer images, e.g. floral printed maxi')}>
                <input style={th.input} placeholder="floral printed summer" value={newP.imageKeywords}
                  onChange={e => setNewP(p => ({ ...p, imageKeywords: e.target.value }))} />
              </FieldWithInfo>
              <FieldWithInfo th={th} label="Tags (JSON)" helpText={copy('JSON array — [\"floral\",\"summer\"]', 'JSON array of tags, e.g. ["floral","summer","cotton"]')}>
                <input style={th.input} placeholder='["floral","cotton"]' value={newP.tags}
                  onChange={e => setNewP(p => ({ ...p, tags: e.target.value }))} />
              </FieldWithInfo>
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button style={th.btnPrimary} onClick={createProduct} disabled={busy}>
              {busy ? <Spinner size={13} color="#fff"/> : null} {copy('Create Product', 'Create Product')}
            </button>
            <button style={th.btnGhost} onClick={() => setShowNew(false)}>{copy('Cancel', 'Cancel')}</button>
          </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 260 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: th.muted, fontSize: 13 }}>⌕</span>
          <input style={{ ...th.input, paddingLeft: 30 }} placeholder="Search products..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', background: th.surface, borderRadius: 8, padding: 3, border: `1px solid ${th.border}` }}>
          {(['grid','list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              background: view === v ? th.panel : 'transparent',
              color: view === v ? th.accent : th.muted,
              boxShadow: view === v ? th.shadow : 'none',
              transition: 'all .12s',
            }}>
              {v === 'grid' ? '⊞' : '☰'} {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button style={th.btnGhost} onClick={load}>{loading ? <Spinner size={13}/> : '↺'}</button>
        <span style={{ fontSize: 12.5, color: th.muted }}>{filtered.length} products</span>
      </div>

      {/* Products — Grid view */}
      {view === 'grid' && (
        loading && !products.length ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner size={22} color={th.accent}/></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="📦" title={copy('No products found', 'No products found')} sub={copy('উপরে Add Product ক্লিক করে শুরু করুন', 'Click Add Product above to get started')} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
            {filtered.map(p => {
              const isEditing = editId === p.id;
              const videoEmbedUrl = getVideoEmbedUrl(editData.videoUrl ?? p.videoUrl ?? '');
              const referenceImages = parseReferenceImages(p.referenceImagesJson);
              const referenceCount = referenceImages.length;
              // Main Image URL and pasted/uploaded Reference Images both land in real
              // hosted URLs the same way — if no main image was set, show the first
              // reference image instead of a blank thumbnail (matches the public catalog).
              const thumbUrl = p.imageUrl || referenceImages[0] || '';

              return (
                <div key={p.id} style={{
                  ...th.card, padding: 0, overflow: 'hidden',
                  border: `1px solid ${isEditing ? th.accent + '66' : th.border}`,
                  opacity: p.isActive ? 1 : 0.55, transition: 'all .15s',
                }}>
                  {/* Image */}
                  <div style={{ position: 'relative', aspectRatio: '4/3', background: th.surface, overflow: 'hidden' }}>
                    {thumbUrl
                      ? <img src={thumbUrl} alt={p.name || p.code} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: th.muted }}>🛍</div>
                    }
                    {/* Badges */}
                    <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
                      {getVideoEmbedUrl(p.videoUrl) && <span style={{ ...th.pill, background: '#0891b244', color: '#0891b2', border: '1px solid #0891b244', fontSize: 9.5 }}>🎬</span>}
                      {referenceCount > 0 && <span style={{ ...th.pill, background: '#ec489922', color: '#db2777', border: '1px solid #ec489944', fontSize: 9.5 }}>📸 {referenceCount + 1}</span>}
                      {p.deliveryCharge === 'FREE' && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 9.5 }}>🚚 Free</span>}
                      {!p.catalogVisible && <span style={{ ...th.pill, ...th.pillGray, fontSize: 9.5 }}>Hidden</span>}
                    </div>
                    {/* Stock badge */}
                    <div style={{ position: 'absolute', top: 8, right: 8 }}>
                      <span style={{ ...th.pill, fontSize: 9.5, ...(p.stockQty === 0 ? th.pillRed : p.stockQty <= 3 ? th.pillYellow : th.pillGreen) }}>
                        {p.stockQty === 0 ? 'Out' : `${p.stockQty}`}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  {!isEditing ? (
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 10.5, color: th.muted, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>{p.code}</div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || '—'}</div>
                      {(p.productGroup || p.variantLabel) && (
                        <div style={{ fontSize: 11, color: th.muted, marginBottom: 6 }}>
                          {[p.productGroup, p.variantLabel].filter(Boolean).join(' • ')}
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 4 }}>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontWeight: 900, fontSize: 16, color: th.accent, letterSpacing: '-0.03em' }}>৳{p.price.toLocaleString()}</span>
                          {p.originalPrice != null && p.originalPrice > p.price && (
                            <span style={{ fontSize: 12, color: th.muted, textDecoration: 'line-through' }}>৳{p.originalPrice.toLocaleString()}</span>
                          )}
                        </span>
                        {p.costPrice > 0 && <span style={{ fontSize: 11, color: '#16a34a' }}>+৳{(p.price - p.costPrice).toLocaleString()} profit</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...th.btnSm, flex: 1, justifyContent: 'center' }} onClick={() => openEdit(p)}>Edit</button>
                        <button style={{ ...th.btnSmDanger }} onClick={() => deleteProduct(p.code)}>✕</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input style={{ ...th.input, fontSize: 12.5 }} placeholder="Name" value={editData.name ?? ''}
                          onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <input style={{ ...th.input, fontSize: 12.5 }} type="number" placeholder="Price" value={editData.price ?? ''}
                            onChange={e => setEditData(d => ({ ...d, price: Number(e.target.value) }))} />
                          <input style={{ ...th.input, fontSize: 12.5 }} type="number" placeholder="Cost" value={editData.costPrice ?? ''}
                            onChange={e => setEditData(d => ({ ...d, costPrice: Number(e.target.value) }))} />
                        </div>
                        <input style={{ ...th.input, fontSize: 12.5 }} type="number" placeholder={copy('আগের দাম (ছাড় দেখাতে)', 'Original price (to show a discount)')}
                          value={editData.originalPrice ?? ''}
                          onChange={e => setEditData(d => ({ ...d, originalPrice: e.target.value === '' ? null : Number(e.target.value) }))} />
                        <input style={{ ...th.input, fontSize: 12.5 }} type="number" placeholder="Stock" value={editData.stockQty ?? ''}
                          onChange={e => setEditData(d => ({ ...d, stockQty: Number(e.target.value) }))} />
                        <input style={{ ...th.input, fontSize: 12.5 }} placeholder={copy('Image URL (বা ছবি paste করুন)', 'Image URL (or paste an image)')} value={editData.imageUrl ?? ''}
                          onChange={e => setEditData(d => ({ ...d, imageUrl: e.target.value }))}
                          onPaste={e => handleMainImagePaste(e, 'edit')} />
                        <ImageDropZone th={th} copy={copy} compact uploading={uploadingEditImage}
                          label={copy('📷 Main Image', '📷 Main Image')}
                          onFiles={files => uploadMainImageFiles(files, 'edit')} />
                        <button type="button" style={th.btnSmGhost} onClick={() => analyzeImage(editData.imageUrl || parseReferenceImages(editData.referenceImagesJson)[0] || '', 'edit')} disabled={analyzingEdit}>
                          {analyzingEdit ? 'Analyzing…' : 'AI Analyze'}
                        </button>
                        <textarea
                          style={{ ...th.input, fontSize: 12, minHeight: 82, resize: 'vertical' }}
                          placeholder={copy('Reference image URLs\nhttps://...\n(বা ছবি paste করুন)', 'Reference image URLs\nhttps://...\n(or paste image(s))')}
                          value={editData.referenceImagesJson ?? ''}
                          onChange={e => setEditData(d => ({ ...d, referenceImagesJson: e.target.value }))}
                          onPaste={e => handleRefImagesPaste(e, 'edit')}
                        />
                        <ImageDropZone th={th} copy={copy} compact multiple uploading={uploadingEditRefs}
                          label={copy('🖼️ Angle Images', '🖼️ Angle Images')}
                          onFiles={files => uploadRefImageFiles(files, 'edit')} />
                        {(editData.referenceImagesJson ?? '').trim() && (
                          <div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(56px,1fr))', gap: 6 }}>
                              {parseReferenceImages(editData.referenceImagesJson).slice(0, 6).map((url, idx) => (
                                <div key={url + idx} style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${th.border}`, aspectRatio: '1 / 1', background: th.surface, position: 'relative' }}>
                                  <img src={url} alt={`edit-ref-${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                  <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 8, background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 3, padding: '1px 3px' }}>#{idx + 1}</div>
                                </div>
                              ))}
                            </div>
                            {(() => {
                              const totalImages = parseReferenceImages(editData.referenceImagesJson).length + (editData.imageUrl ? 1 : 0);
                              if (totalImages < 1) return null;
                              const onlyRef = !editData.imageUrl ? parseReferenceImages(editData.referenceImagesJson)[0] : '';
                              return (
                                <button
                                  type="button"
                                  style={{ ...th.btnSmGhost, marginTop: 6, width: '100%', justifyContent: 'center', background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399', fontSize: 11, fontWeight: 700 }}
                                  onClick={() => totalImages >= 2 ? batchAnalyzeAll(editData.referenceImagesJson, editData.imageUrl, 'edit') : analyzeImage(editData.imageUrl || onlyRef, 'edit')}
                                  disabled={analyzingEdit}
                                >
                                  {analyzingEdit
                                    ? '⏳ Analyzing...'
                                    : totalImages >= 2
                                      ? `🤖 Analyze All ${totalImages} Angles Together`
                                      : '🤖 AI Analyze This Photo'}
                                </button>
                              );
                            })()}
                          </div>
                        )}
                        {/* Video URL */}
                        <div>
                          <input style={{ ...th.input, fontSize: 12.5 }} placeholder="YouTube / Facebook video URL"
                            value={editData.videoUrl ?? ''}
                            onChange={e => setEditData(d => ({ ...d, videoUrl: e.target.value }))} />
                          <button type="button" style={{ ...th.btnSmGhost, marginTop: 6 }} onClick={() => loadVideoGuide(editData.videoUrl || '', parseReferenceImages(editData.referenceImagesJson).length, 'edit')}>
                            Video Screenshot Plan
                          </button>
                          {videoEmbedUrl && (
                            <div style={{ marginTop: 6, borderRadius: 8, overflow: 'hidden', aspectRatio: '16/9', background: '#000' }}>
                              <iframe src={videoEmbedUrl} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} allowFullScreen title="preview"/>
                            </div>
                          )}
                          {editVideoGuide && (
                            <div style={{ marginTop: 6, ...th.card2, borderRadius: 10, padding: 10 }}>
                              <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 6 }}>Manual Capture Guide</div>
                              {(editVideoGuide.checklist || []).map((item: string, idx: number) => (
                                <div key={item + idx} style={{ fontSize: 11.5, color: th.muted }}>{idx + 1}. {item}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* FB Post Link */}
                        <div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>🔗 Facebook Post Link</div>
                          <input style={{ ...th.input, fontSize: 12.5 }} placeholder="https://facebook.com/yourpage/posts/123456"
                            value={editData.fbPostUrl ?? ''}
                            onChange={e => setEditData(d => ({ ...d, fbPostUrl: e.target.value }))} />
                        </div>
                        {/* Catalog visible toggle */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5 }}>
                          <input type="checkbox" checked={editData.catalogVisible ?? true}
                            onChange={e => setEditData(d => ({ ...d, catalogVisible: e.target.checked }))}
                            style={{ accentColor: th.accent }} />
                          Show in Catalog
                        </label>
                        {/* Variant options */}
                        <div>
                          <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>Bot Variants — প্রতি লাইনে: Label: choice1,choice2</div>
                          <textarea
                            style={{ ...th.input, fontSize: 12, minHeight: 56, resize: 'vertical', fontFamily: 'monospace' }}
                            placeholder={'Size: S,M,L,XL\nColor: Red,Blue'}
                            value={editData.variantOptions ?? ''}
                            onChange={e => setEditData(d => ({ ...d, variantOptions: e.target.value }))}
                          />
                        </div>
                        {/* Description + AI */}
                        <div>
                          <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>{copy('Full Description', 'Full Description')}</div>
                          <textarea
                            style={{ ...th.input, fontSize: 12, minHeight: 64, resize: 'vertical' }}
                            placeholder={copy('Product বিবরণ...', 'Product description...')}
                            value={editData.description ?? ''}
                            onChange={e => setEditData(d => ({ ...d, description: e.target.value }))}
                          />
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            <button type="button" style={th.btnSmGhost} onClick={() => generateDescription('edit')} disabled={generatingDescEdit}>
                              {generatingDescEdit ? copy('AI লিখছে...', 'AI writing...') : copy('✨ AI লিখুন', '✨ AI Write')}
                            </button>
                            <button type="button" style={th.btnSmGhost} onClick={() => extractFieldsFromDescription('edit')} disabled={extractingEdit || !(editData.description ?? '').trim()}>
                              {extractingEdit ? copy('Fields fill হচ্ছে...', 'Filling...') : copy('🪄 Fields Fill করো', '🪄 Fill Fields')}
                            </button>
                          </div>
                        </div>
                        {/* V23: Home delivery charge */}
                        <div>
                          <div style={{ fontSize: 11, color: th.muted, marginBottom: 4 }}>{copy('🚚 Home Delivery', '🚚 Home Delivery')}</div>
                          <select style={{ ...th.input, fontSize: 12.5 }} value={editData.deliveryCharge ?? 'PAID'}
                            onChange={e => setEditData(d => ({ ...d, deliveryCharge: e.target.value as 'FREE' | 'PAID' }))}>
                            <option value="PAID">{copy('Paid (Settings rate অনুযায়ী)', 'Paid (uses Settings rate)')}</option>
                            <option value="FREE">{copy('Free', 'Free')}</option>
                          </select>
                        </div>
                        {/* V24: Pricing policy override */}
                        <PricingPolicyOverrideField th={th} copy={copy} value={editData.pricingPolicyOverride}
                          onChange={json => setEditData(d => ({ ...d, pricingPolicyOverride: json }))} />
                        {/* V19: Detection Mode */}
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#34d399', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Image Detection Mode</div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {(['OCR', 'AI_VISION'] as const).map(mode => (
                              <label key={mode} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 8, border: `2px solid ${editData.detectionMode === mode ? '#34d399' : (th.border ?? '#333')}`, background: editData.detectionMode === mode ? 'rgba(16,185,129,0.1)' : 'transparent', cursor: 'pointer', userSelect: 'none', transition: 'all 0.15s' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <input type="radio" name={`detectionMode-${editId}`} value={mode} checked={editData.detectionMode === mode}
                                    onChange={() => setEditData(d => ({ ...d, detectionMode: mode, visionSearchable: mode === 'AI_VISION' }))} style={{ accentColor: '#34d399' }} />
                                  <span style={{ fontWeight: 700, fontSize: 12, color: th.text }}>{mode === 'OCR' ? '📷 OCR Mode' : '🤖 AI Vision'}</span>
                                </div>
                                <span style={{ fontSize: 10, color: th.muted ?? '#888', lineHeight: 1.4 }}>
                                  {mode === 'OCR' ? `Product code পড়বে • ${visionCosts.ocr} credit/image` : `AI দিয়ে detect করবে • ${visionCosts.vision} credit/image`}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <UniquenessCard
                          data={uniquenessEdit}
                          hidden={uniquenessEditHidden}
                          onHide={() => setUniquenessEditHidden(true)}
                          th={th}
                          onApplyMode={(mode) => setEditData(d => ({ ...d, detectionMode: mode, visionSearchable: mode === 'AI_VISION' }))}
                        />
                        {/* V18: Image recognition metadata */}
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: `${th.accent}0d`, border: `1px solid ${th.accent}22` }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: th.accent, marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>AI Tags</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
                              <input type="checkbox" checked={editData.visionSearchable ?? false}
                                onChange={e => setEditData(d => ({ ...d, visionSearchable: e.target.checked }))} />
                              <span style={{ color: th.text }}>
                                {copy('AI Vision দিয়ে খোঁজা হবে (code নেই)', 'Find via AI Vision (no product code)')}
                              </span>
                            </label>
                            <input style={{ ...th.input, fontSize: 12 }} placeholder="Category (dress, saree…)" value={editData.category ?? ''}
                              onChange={e => setEditData(d => ({ ...d, category: e.target.value }))} />
                            <input style={{ ...th.input, fontSize: 12 }} placeholder="Color (black, red…)" value={editData.color ?? ''}
                              onChange={e => setEditData(d => ({ ...d, color: e.target.value }))} />
                            <input style={{ ...th.input, fontSize: 12 }} placeholder="Product group / family" value={editData.productGroup ?? ''}
                              onChange={e => setEditData(d => ({ ...d, productGroup: e.target.value }))} />
                            <input style={{ ...th.input, fontSize: 12 }} placeholder="Variant label" value={editData.variantLabel ?? ''}
                              onChange={e => setEditData(d => ({ ...d, variantLabel: e.target.value }))} />
                            <input style={{ ...th.input, fontSize: 12 }} placeholder="Keywords (floral printed)" value={editData.imageKeywords ?? ''}
                              onChange={e => setEditData(d => ({ ...d, imageKeywords: e.target.value }))} />
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button style={{ ...th.btnSmSuccess, flex: 1, justifyContent: 'center', fontSize: 12 }}
                          onClick={() => saveEdit(p)} disabled={busy}>
                          {busy ? <Spinner size={11}/> : '✓'} Save
                        </button>
                        <button style={th.btnSmGhost} onClick={() => setEditId(null)}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Products — List view */}
      {view === 'list' && (
        <div style={{ ...th.card, padding: 0, overflow: 'hidden' }}>
          {filtered.length === 0
            ? <EmptyState icon="📦" title="No products" />
            : (
              <table style={th.table}>
                <thead>
                  <tr>
                    <th style={th.th}>Code</th>
                    <th style={th.th}>Name</th>
                    <th style={th.th}>Price</th>
                    <th style={th.th}>Cost</th>
                    <th style={th.th}>Stock</th>
                    <th style={th.th}>Status</th>
                    <th style={th.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }}>
                      <td style={{ ...th.td, fontWeight: 700, color: th.accentText, fontSize: 12.5 }}>{p.code}</td>
                      <td style={th.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {(p.imageUrl || parseReferenceImages(p.referenceImagesJson)[0]) && <img src={p.imageUrl || parseReferenceImages(p.referenceImagesJson)[0]} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}/>}
                          <span style={{ fontWeight: 600 }}>{p.name || '—'}</span>
                          {parseReferenceImages(p.referenceImagesJson).length > 0 && (
                            <span style={{ ...th.pill, background: '#ec489922', color: '#db2777', border: '1px solid #ec489944', fontSize: 9.5 }}>
                              {parseReferenceImages(p.referenceImagesJson).length + 1} views
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...th.td, fontWeight: 700 }}>
                        ৳{p.price.toLocaleString()}
                        {p.originalPrice != null && p.originalPrice > p.price && (
                          <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11, color: th.muted, textDecoration: 'line-through' }}>৳{p.originalPrice.toLocaleString()}</span>
                        )}
                      </td>
                      <td style={{ ...th.td, color: th.muted }}>৳{p.costPrice}</td>
                      <td style={th.td}>
                        <span style={{ ...th.pill, fontSize: 11, ...(p.stockQty === 0 ? th.pillRed : p.stockQty <= 3 ? th.pillYellow : th.pillGreen) }}>
                          {p.stockQty}
                        </span>
                      </td>
                      <td style={th.td}>
                        {getVideoEmbedUrl(p.videoUrl) && <span style={{ ...th.pill, ...th.pillBlue, fontSize: 10, marginRight: 4 }}>🎬</span>}
                        {p.deliveryCharge === 'FREE' && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 10, marginRight: 4 }}>🚚 Free</span>}
                        {!p.catalogVisible && <span style={{ ...th.pill, ...th.pillGray, fontSize: 10 }}>Hidden</span>}
                      </td>
                      <td style={th.td}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button style={th.btnSmGhost} onClick={() => openEdit(p)}>Edit</button>
                          <button style={th.btnSmDanger} onClick={() => deleteProduct(p.code)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      </>)}

      {/* ── Simple Products Tab ─────────────────────────────────────────── */}
      {productTab === 'simple' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Info banner */}
          <div style={{ ...th.card2, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', padding: '12px 16px', borderRadius: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>🥭 Simple Products — কোড বা ছবি ছাড়া</div>
            <div style={{ fontSize: 12, color: th.muted, lineHeight: 1.6 }}>
              Mango, Honey, Egg, Fish — এই ধরনের product যেখানে কোনো code বা image detection দরকার নেই।
              Customer নাম লিখলে বা ছবি পাঠালে bot automatically price ও stock জানাবে।
            </div>
          </div>

          {/* Add/Edit form */}
          {(showSimpleForm || simpleEditId !== null) && (
            <div style={{ ...th.card2, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                {simpleEditId !== null ? '✏️ Edit Simple Product' : '+ New Simple Product'}
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 4 }}>Product Name *</label>
                  <input
                    style={th.input}
                    placeholder="যেমন: Himsagar Mango"
                    value={simpleEditId !== null ? (simpleEditData.name ?? '') : simpleForm.name}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, name: e.target.value }))
                      : setSimpleForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 4 }}>Unit</label>
                  <select
                    style={th.input}
                    value={simpleEditId !== null ? (simpleEditData.unit ?? 'kg') : simpleForm.unit}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, unit: e.target.value }))
                      : setSimpleForm(f => ({ ...f, unit: e.target.value }))}
                  >
                    {['kg', 'liter', 'piece', 'dozen', 'gram', 'pcs', 'box', 'bag'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 4 }}>Price *</label>
                  <input
                    style={th.input} type="number" min={0}
                    placeholder="৳"
                    value={simpleEditId !== null ? (simpleEditData.price ?? 0) : simpleForm.price}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, price: Number(e.target.value) }))
                      : setSimpleForm(f => ({ ...f, price: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 4 }}>{copy('আগের দাম (৳)', 'Original Price (৳)')}</label>
                  <input
                    style={th.input} type="number" min={0}
                    placeholder="৳"
                    value={(simpleEditId !== null ? simpleEditData.originalPrice : simpleForm.originalPrice) ?? ''}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, originalPrice: e.target.value === '' ? null : Number(e.target.value) }))
                      : setSimpleForm(f => ({ ...f, originalPrice: e.target.value === '' ? null : Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 4 }}>Stock Qty *</label>
                  <input
                    style={th.input} type="number" min={0}
                    value={simpleEditId !== null ? (simpleEditData.stockQty ?? 0) : simpleForm.stockQty}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, stockQty: Number(e.target.value) }))
                      : setSimpleForm(f => ({ ...f, stockQty: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: th.muted, display: 'block', marginBottom: 4 }}>Details / Description (bot এটা পড়ে reply করবে)</label>
                <textarea
                  style={{ ...th.input, minHeight: 72, resize: 'vertical' }}
                  placeholder="যেমন: রাজশাহীর সেরা হিমসাগর আম। সরাসরি বাগান থেকে সংগ্রহ করা।"
                  value={simpleEditId !== null ? (simpleEditData.description ?? '') : simpleForm.description}
                  onChange={e => simpleEditId !== null
                    ? setSimpleEditData(d => ({ ...d, description: e.target.value }))
                    : setSimpleForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={simpleEditId !== null ? (simpleEditData.orderEnabled !== false) : simpleForm.orderEnabled}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, orderEnabled: e.target.checked }))
                      : setSimpleForm(f => ({ ...f, orderEnabled: e.target.checked }))}
                  />
                  Order নেবে (uncheck = শুধু info দেবে)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={simpleEditId !== null ? (simpleEditData.isActive !== false) : simpleForm.isActive}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, isActive: e.target.checked }))
                      : setSimpleForm(f => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  {copy('🚚 Delivery:', '🚚 Delivery:')}
                  <select style={{ ...th.input, fontSize: 12.5, padding: '4px 8px' }}
                    value={simpleEditId !== null ? (simpleEditData.deliveryCharge ?? 'PAID') : simpleForm.deliveryCharge}
                    onChange={e => simpleEditId !== null
                      ? setSimpleEditData(d => ({ ...d, deliveryCharge: e.target.value as 'FREE' | 'PAID' }))
                      : setSimpleForm(f => ({ ...f, deliveryCharge: e.target.value as 'FREE' | 'PAID' }))}>
                    <option value="PAID">{copy('Paid', 'Paid')}</option>
                    <option value="FREE">{copy('Free', 'Free')}</option>
                  </select>
                </label>
              </div>

              <div>
                <PricingPolicyOverrideField th={th} copy={copy}
                  value={simpleEditId !== null ? simpleEditData.pricingPolicyOverride : simpleForm.pricingPolicyOverride}
                  onChange={json => simpleEditId !== null
                    ? setSimpleEditData(d => ({ ...d, pricingPolicyOverride: json }))
                    : setSimpleForm(f => ({ ...f, pricingPolicyOverride: json }))} />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={th.btnPrimary}
                  disabled={busySimple}
                  onClick={async () => {
                    const isEdit = simpleEditId !== null;
                    const prod = isEdit ? products.find(p => p.id === simpleEditId) : null;
                    if (!isEdit && !simpleForm.name.trim()) return onToast('Product name দিন', 'error');
                    setBusySimple(true);
                    try {
                      if (isEdit && prod) {
                        await request(`${BASE}/products/${prod.code}`, { method: 'PATCH', body: JSON.stringify(simpleEditData) });
                      } else {
                        await request(`${BASE}/products`, { method: 'POST', body: JSON.stringify({ ...simpleForm, productType: 'SIMPLE' }) });
                      }
                      onToast(isEdit ? '✓ Updated' : '✓ Created');
                      setShowSimpleForm(false);
                      setSimpleEditId(null);
                      setSimpleForm({ name: '', price: 0, stockQty: 0, unit: 'kg', description: '', orderEnabled: true, isActive: true, deliveryCharge: 'PAID', originalPrice: null, pricingPolicyOverride: null });
                      setSimpleEditData({});
                      load();
                    } catch (e: any) { onToast(e.message, 'error'); }
                    finally { setBusySimple(false); }
                  }}
                >
                  {busySimple ? 'Saving...' : (simpleEditId !== null ? 'Update' : 'Create')}
                </button>
                <button style={th.btnGhost} onClick={() => { setShowSimpleForm(false); setSimpleEditId(null); setSimpleEditData({}); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Simple Products List */}
          {(() => {
            const simpleProducts = products.filter(p => p.productType === 'SIMPLE');
            if (!simpleProducts.length) return (
              <EmptyState icon="🥭" title="কোনো Simple Product নেই" sub="Mango, Honey, Egg — এই ধরনের product এখানে add করুন" />
            );
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {simpleProducts.map(p => (
                  <div key={p.id} style={{ ...th.card2, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name || p.code}</div>
                      {p.description && <div style={{ fontSize: 12, color: th.muted, marginTop: 2, lineHeight: 1.4 }}>{p.description.slice(0, 80)}{p.description.length > 80 ? '…' : ''}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: th.accent }}>
                        ৳{Number(p.price).toLocaleString()}/{p.unit || 'pcs'}
                        {p.originalPrice != null && p.originalPrice > p.price && (
                          <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11.5, color: th.muted, textDecoration: 'line-through' }}>৳{p.originalPrice.toLocaleString()}</span>
                        )}
                      </span>
                      <span style={{ ...th.pill, fontSize: 11, ...(p.stockQty === 0 ? th.pillRed : p.stockQty <= 5 ? th.pillYellow : th.pillGreen) }}>
                        {p.stockQty} {p.unit || 'pcs'}
                      </span>
                      {p.deliveryCharge === 'FREE' && <span style={{ ...th.pill, ...th.pillGreen, fontSize: 10 }}>🚚 Free</span>}
                      {!p.orderEnabled && <span style={{ ...th.pill, ...th.pillGray, fontSize: 10 }}>Info Only</span>}
                      {!p.isActive && <span style={{ ...th.pill, ...th.pillGray, fontSize: 10 }}>Inactive</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={th.btnSmGhost} onClick={() => {
                        setSimpleEditId(p.id);
                        setSimpleEditData({ name: p.name ?? '', price: p.price, stockQty: p.stockQty, unit: p.unit ?? 'kg', description: p.description ?? '', orderEnabled: p.orderEnabled, isActive: p.isActive, deliveryCharge: p.deliveryCharge ?? 'PAID', originalPrice: p.originalPrice ?? null, pricingPolicyOverride: p.pricingPolicyOverride ?? null });
                        setShowSimpleForm(false);
                      }}>Edit</button>
                      <button style={th.btnSmDanger} onClick={() => deleteProduct(p.code)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

        </div>
      )}

      {/* Live Session tab (new Dual Photo system) */}
      {productTab === 'dual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* How it works */}
          <div style={{ padding: '12px 16px', borderRadius: 12, background: `${th.accent}12`, border: `1px solid ${th.accent}44`, fontSize: 12.5, lineHeight: 1.7 }}>
            <strong>📌 কিভাবে কাজ করে:</strong><br/>
            ১. Live video থেকে screenshot নিন (যেখানে ২টো product একসাথে আছে)<br/>
            ২. আপনি নিজে বলুন — কোনটা <strong>পরা আছে</strong>, কোনটা <strong>হাতে ধরা</strong><br/>
            ৩. <strong>AI কে মনে রাখাও</strong> — AI screenshots দেখে visual profile তৈরি করবে<br/>
            ৪. Customer screenshot পাঠালে AI এই memory দেখে product চিনবে ও auto-reply দেবে
          </div>

          {/* Add new session button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{ ...th.btnPrimary, fontSize: 13 }} onClick={() => setShowNewForm(v => !v)}>
              {showNewForm ? '✕ বাতিল' : '➕ নতুন Live Session যোগ করুন'}
            </button>
          </div>

          {/* New session form */}
          {showNewForm && (
            <div style={{ padding: 18, borderRadius: 14, border: `1.5px solid ${th.accent}55`, background: th.surface, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: th.accent }}>নতুন Live Session</div>

              <input style={{ ...th.input, fontSize: 13 }} placeholder="Session-এর নাম (optional) — যেমন: Live ২৯ এপ্রিল"
                value={newSession.label} onChange={e => setNewSession(p => ({ ...p, label: e.target.value }))} />

              {/* Screenshot upload */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>📸 Live Screenshots (২-৫টা দিন)</div>
                {newSession.screenshots.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {newSession.screenshots.map((url, i) => (
                      <div key={url+i} style={{ position: 'relative' }}>
                        <img src={url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: `1px solid ${th.border}` }} />
                        <button onClick={() => setNewSession(p => ({ ...p, screenshots: p.screenshots.filter((_, idx) => idx !== i) }))}
                          style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <ImageDropZone th={th} copy={copy} compact multiple uploading={sessionUploading}
                  label={`📷 Screenshot যোগ করুন${newSession.screenshots.length > 0 ? ` (${newSession.screenshots.length}টি)` : ''}`}
                  onFiles={async files => { for (const f of files) await uploadNewScreenshot(f); }} />
              </div>

              {/* Product pickers */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {(['worn', 'held'] as const).map(slot => {
                  const label = slot === 'worn' ? '👗 গায়ে পরা product' : '👜 হাতে ধরা product';
                  const val = slot === 'worn' ? newSession.wornProductId : newSession.heldProductId;
                  return (
                    <div key={slot}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: slot === 'worn' ? '#16a34a' : '#7c3aed' }}>{label}</div>
                      <select style={{ ...th.input, fontSize: 12, width: '100%' }}
                        value={val ?? ''}
                        onChange={e => {
                          const v = e.target.value ? Number(e.target.value) : null;
                          setNewSession(p => slot === 'worn' ? { ...p, wornProductId: v } : { ...p, heldProductId: v });
                        }}>
                        <option value="">— product select করুন —</option>
                        {products.filter(p => p.isActive).map(p => (
                          <option key={p.id} value={p.id}>{p.code} — {p.name || '(no name)'}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={{ ...th.btnGhost, fontSize: 12 }} onClick={() => setShowNewForm(false)}>বাতিল</button>
                <button style={{ ...th.btnPrimary, fontSize: 12 }} disabled={sessionSaving || !newSession.screenshots.length} onClick={saveNewSession}>
                  {sessionSaving ? <><Spinner size={12}/> Saving...</> : '✅ Session Save করুন'}
                </button>
              </div>
            </div>
          )}

          {/* Session list */}
          {liveSessions.length === 0 && !showNewForm && (
            <div style={{ textAlign: 'center', padding: 40, color: th.muted, fontSize: 13 }}>
              কোনো Live Session নেই। উপরের বাটন দিয়ে নতুন session তৈরি করুন।
            </div>
          )}

          {liveSessions.map(session => {
            const memo = session.aiMemo;
            const isAnalyzed = !!memo;
            const isAnalyzingThis = sessionAnalyzing === session.id;
            const screenshots: string[] = session.screenshots ?? [];
            return (
              <div key={session.id} style={{ borderRadius: 14, border: `1.5px solid ${session.isActive ? '#16a34a44' : th.border}`, background: th.surface, overflow: 'hidden' }}>
                {/* Session header */}
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${th.border}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {session.label || `Session #${session.id}`}
                      {session.isActive && <span style={{ marginLeft: 8, fontSize: 10, background: '#16a34a22', color: '#16a34a', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>Active</span>}
                    </div>
                    <div style={{ fontSize: 11, color: th.muted, marginTop: 2 }}>
                      {new Date(session.createdAt).toLocaleDateString('bn-BD')} • {screenshots.length} screenshot
                    </div>
                  </div>
                  {/* Active toggle */}
                  <div onClick={() => toggleSession(session.id, !session.isActive)}
                    style={{ width: 40, height: 22, borderRadius: 11, background: session.isActive ? '#16a34a' : th.border, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 2, left: session.isActive ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
                  </div>
                  <button style={{ ...th.btnSm, background: '#dc262622', color: '#dc2626', border: '1px solid #dc262633', fontSize: 11 }} onClick={() => deleteSession(session.id)}>🗑</button>
                </div>

                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Screenshots preview */}
                  {screenshots.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {screenshots.slice(0, 6).map((url, i) => (
                        <img key={url+i} src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${th.border}` }} />
                      ))}
                      {screenshots.length > 6 && <div style={{ width: 72, height: 72, borderRadius: 8, background: th.panel, border: `1px solid ${th.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: th.muted }}>+{screenshots.length - 6}</div>}
                    </div>
                  )}

                  {/* Product assignments */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {(['worn', 'held'] as const).map(slot => {
                      const prod = slot === 'worn' ? session.wornProduct : session.heldProduct;
                      const slotLabel = slot === 'worn' ? '👗 পরা' : '👜 হাতে ধরা';
                      const slotColor = slot === 'worn' ? '#16a34a' : '#7c3aed';
                      return (
                        <div key={slot} style={{ padding: '8px 12px', borderRadius: 8, background: th.panel, border: `1px solid ${th.border}` }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: slotColor, marginBottom: 4 }}>{slotLabel}</div>
                          {prod ? (
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{prod.code} — {prod.name || ''}</div>
                          ) : (
                            <div style={{ fontSize: 11, color: th.muted }}>assign করা হয়নি</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* AI memo status + analyze button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {isAnalyzed ? (
                      <div style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 600 }}>
                        ✅ AI memory ready — Customer screenshot আসলে match করবে
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: '#f59e0b', fontWeight: 600 }}>
                        ⚠️ AI analysis বাকি — নিচের বাটন চাপুন
                      </div>
                    )}
                    <button
                      style={{ ...th.btnPrimary, fontSize: 11.5, padding: '7px 16px', marginLeft: 'auto' }}
                      disabled={isAnalyzingThis || !screenshots.length}
                      onClick={() => analyzeSession(session.id)}>
                      {isAnalyzingThis ? <><Spinner size={11}/> AI analyzing...</> : isAnalyzed ? '🔄 Re-analyze' : '🧠 AI কে মনে রাখাও'}
                    </button>
                  </div>

                  {/* AI memo preview */}
                  {isAnalyzed && memo && (
                    <div style={{ padding: '10px 12px', borderRadius: 8, background: `${th.accent}08`, border: `1px solid ${th.accent}22`, fontSize: 11, color: th.muted, lineHeight: 1.6 }}>
                      {memo.worn?.description && <div><strong style={{ color: '#16a34a' }}>👗 পরা:</strong> {memo.worn.description}</div>}
                      {memo.held?.description && <div style={{ marginTop: 4 }}><strong style={{ color: '#7c3aed' }}>👜 হাতে:</strong> {memo.held.description}</div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
