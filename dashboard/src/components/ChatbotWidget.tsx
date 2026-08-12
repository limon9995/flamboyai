import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, useApi } from '../hooks/useApi';

function LizaAvatar({ size }: { size: number }) {
  const id = 'lz';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: '50%', display: 'block' }}>
      <defs>
        {/* White circle bg like reference */}
        <clipPath id={`${id}-clip`}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
        <linearGradient id={`${id}-skin`} x1="50" y1="20" x2="50" y2="75" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C68642" />
          <stop offset="100%" stopColor="#A0522D" />
        </linearGradient>
        <linearGradient id={`${id}-hair`} x1="30" y1="10" x2="70" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B1F0A" />
          <stop offset="50%" stopColor="#1C0D04" />
          <stop offset="100%" stopColor="#0A0400" />
        </linearGradient>
        <linearGradient id={`${id}-hairhi`} x1="40" y1="10" x2="55" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6B3A1F" />
          <stop offset="100%" stopColor="#3B1F0A" />
        </linearGradient>
        <linearGradient id={`${id}-top`} x1="50" y1="68" x2="50" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7B2D5E" />
          <stop offset="100%" stopColor="#5A1A45" />
        </linearGradient>
        <linearGradient id={`${id}-neck`} x1="50" y1="60" x2="50" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#B8712E" />
          <stop offset="100%" stopColor="#9A5A22" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${id}-clip)`}>
        {/* White background */}
        <circle cx="50" cy="50" r="50" fill="#F8F4F0" />

        {/* ── HAIR BACK (long wavy, flows behind face) ── */}
        {/* Main back hair mass */}
        <path d="
          M28 35
          Q22 28 24 18
          Q28 8  50 7
          Q72 8  76 18
          Q78 28 72 35
          Q68 20 50 18
          Q32 20 28 35Z
        " fill={`url(#${id}-hair)`} />

        {/* Left hair flowing down — wavy */}
        <path d="
          M28 35
          Q18 50 20 70
          Q22 80 25 100
          L38 100
          Q34 80 33 68
          Q32 55 34 45
          Q32 40 28 35Z
        " fill={`url(#${id}-hair)`} />

        {/* Right hair flowing down — wavy */}
        <path d="
          M72 35
          Q82 50 80 70
          Q78 80 75 100
          L62 100
          Q66 80 67 68
          Q68 55 66 45
          Q68 40 72 35Z
        " fill={`url(#${id}-hair)`} />

        {/* Left wave curl lower */}
        <path d="M25 100 Q20 85 22 72 Q24 60 26 55 Q22 65 21 78 Q20 90 24 100Z" fill={`url(#${id}-hair)`} />
        {/* Right wave curl lower */}
        <path d="M75 100 Q80 85 78 72 Q76 60 74 55 Q78 65 79 78 Q80 90 76 100Z" fill={`url(#${id}-hair)`} />

        {/* ── NECK ── */}
        <path d="M43 62 Q43 72 44 74 L56 74 Q57 72 57 62Z" fill={`url(#${id}-neck)`} />

        {/* ── FACE ── slim oval, warm Bangladeshi brown */}
        <ellipse cx="50" cy="42" rx="17" ry="22" fill={`url(#${id}-skin)`} />

        {/* Face shadow sides — gives slim look */}
        <path d="M33 42 Q33 54 38 60 Q34 55 33 44Z" fill="#8B4513" opacity="0.15" />
        <path d="M67 42 Q67 54 62 60 Q66 55 67 44Z" fill="#8B4513" opacity="0.15" />

        {/* ── HAIR FRONT (over face sides) ── */}
        <path d="M33 38 Q30 20 50 17 Q70 20 67 38 Q64 22 50 21 Q36 22 33 38Z" fill={`url(#${id}-hair)`} />

        {/* Hair highlight — center parting shimmer */}
        <path d="M50 17 Q51 22 50 30" stroke="#5C2E0A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
        <path d="M46 18 Q47 24 46 32" stroke="#4A2008" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.35" />
        <path d="M54 18 Q53 24 54 32" stroke="#4A2008" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.35" />

        {/* Side front hair strands over face */}
        <path d="M33 38 Q30 46 31 56 Q32 48 34 42Z" fill={`url(#${id}-hair)`} />
        <path d="M67 38 Q70 46 69 56 Q68 48 66 42Z" fill={`url(#${id}-hair)`} />

        {/* ── EYES — flat style, almond ── */}
        {/* Left eye white */}
        <path d="M37 39 Q42 35.5 47 39 Q42 42.5 37 39Z" fill="white" />
        {/* Left iris */}
        <ellipse cx="42" cy="39.2" rx="3" ry="3.2" fill="#1A0800" />
        <ellipse cx="42" cy="39.2" rx="1.8" ry="2" fill="#2C1008" />
        {/* Left shine */}
        <circle cx="43.2" cy="37.8" r="1.1" fill="white" />
        <circle cx="40.8" cy="40.2" r="0.5" fill="white" opacity="0.5" />
        {/* Left eyelid */}
        <path d="M37 39 Q42 35.5 47 39" stroke="#0A0400" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        {/* Left lower lash line */}
        <path d="M37 39 Q42 41.5 47 39" stroke="#3B1F0A" strokeWidth="0.6" strokeLinecap="round" fill="none" opacity="0.5" />

        {/* Right eye white */}
        <path d="M53 39 Q58 35.5 63 39 Q58 42.5 53 39Z" fill="white" />
        {/* Right iris */}
        <ellipse cx="58" cy="39.2" rx="3" ry="3.2" fill="#1A0800" />
        <ellipse cx="58" cy="39.2" rx="1.8" ry="2" fill="#2C1008" />
        {/* Right shine */}
        <circle cx="59.2" cy="37.8" r="1.1" fill="white" />
        <circle cx="56.8" cy="40.2" r="0.5" fill="white" opacity="0.5" />
        {/* Right eyelid */}
        <path d="M53 39 Q58 35.5 63 39" stroke="#0A0400" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        {/* Right lower lash line */}
        <path d="M53 39 Q58 41.5 63 39" stroke="#3B1F0A" strokeWidth="0.6" strokeLinecap="round" fill="none" opacity="0.5" />

        {/* ── EYEBROWS — thick natural arched ── */}
        <path d="M36 34 Q42 31 47 33.5" stroke="#1A0800" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M53 33.5 Q58 31 64 34" stroke="#1A0800" strokeWidth="2.2" strokeLinecap="round" fill="none" />

        {/* ── NOSE — flat minimal ── */}
        <path d="M48 48 Q50 51 52 48" stroke="#8B4513" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.7" />
        <ellipse cx="47.5" cy="49.5" rx="1" ry="0.7" fill="#7A3B10" opacity="0.5" />
        <ellipse cx="52.5" cy="49.5" rx="1" ry="0.7" fill="#7A3B10" opacity="0.5" />

        {/* ── LIPS — full, warm rose ── */}
        {/* Upper lip */}
        <path d="M43 55 Q46 52.5 50 53.5 Q54 52.5 57 55 Q54 56 50 56 Q46 56 43 55Z" fill="#C0556A" />
        {/* Lower lip */}
        <path d="M43 55 Q46.5 59.5 50 59.5 Q53.5 59.5 57 55 Q54 57.5 50 58 Q46 57.5 43 55Z" fill="#D4667A" />
        {/* Lip line */}
        <path d="M43 55 Q50 53 57 55" stroke="#9B3A50" strokeWidth="0.5" fill="none" />
        {/* Lip gloss */}
        <ellipse cx="48" cy="54.5" rx="2.5" ry="0.8" fill="white" opacity="0.2" />

        {/* ── CHEEKS — very subtle ── */}
        <ellipse cx="37" cy="47" rx="4" ry="2.5" fill="#D4607A" opacity="0.1" />
        <ellipse cx="63" cy="47" rx="4" ry="2.5" fill="#D4607A" opacity="0.1" />

        {/* ── TOP / DRESS — mauve like reference ── */}
        <path d="M24 100 Q26 74 36 70 L44 74 L50 71 L56 74 L64 70 Q74 74 76 100Z" fill={`url(#${id}-top)`} />
        {/* V neckline */}
        <path d="M44 74 Q50 80 56 74" stroke="#A04070" strokeWidth="1" fill="none" strokeLinecap="round" />
        {/* Shoulder line */}
        <path d="M30 76 Q40 72 44 74" stroke="#9B3A65" strokeWidth="0.8" fill="none" opacity="0.5" />
        <path d="M70 76 Q60 72 56 74" stroke="#9B3A65" strokeWidth="0.8" fill="none" opacity="0.5" />
      </g>
    </svg>
  );
}

type NavKey =
  | 'OVERVIEW' | 'AGENT_TASKS' | 'ORDERS' | 'PRODUCTS' | 'ACCOUNTING'
  | 'ANALYTICS' | 'BOT_KNOWLEDGE' | 'PRINT' | 'MEMO_TEMPLATE' | 'CRM'
  | 'COURIER' | 'BROADCAST' | 'FOLLOWUP' | 'CATALOG' | 'RESTAURANT' | 'FRAUD_CHECKER'
  | 'AUTO_POST' | 'UNIVERSITY' | 'WALLET' | 'CONNECT_FB_PAGE'
  | 'SETTINGS_BUSINESS' | 'SETTINGS_DELIVERY' | 'SETTINGS_BOT'
  | 'SETTINGS_KNOWLEDGE' | 'SETTINGS_CALL' | 'SETTINGS_VOICE' | 'SETTINGS_TELEGRAM';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  currentPage: NavKey;
  dark: boolean;
  pageId?: number;
}

const PAGE_LABELS: Record<NavKey, string> = {
  OVERVIEW: 'ওভারভিউ',
  AGENT_TASKS: 'এজেন্ট টাস্ক',
  ORDERS: 'অর্ডার',
  COURIER: 'কুরিয়ার',
  PRINT: 'প্রিন্ট',
  PRODUCTS: 'প্রোডাক্ট',
  CATALOG: 'ক্যাটালগ',
  RESTAURANT: 'রেস্টুরেন্ট',
  ACCOUNTING: 'হিসাব',
  ANALYTICS: 'অ্যানালিটিক্স',
  BOT_KNOWLEDGE: 'বট নলেজ',
  CRM: 'কাস্টমার',
  BROADCAST: 'ব্রডকাস্ট',
  AUTO_POST: 'অটো পোস্ট',
  UNIVERSITY: 'ইউনিভার্সিটি',
  FOLLOWUP: 'ফলো-আপ',
  MEMO_TEMPLATE: 'মেমো টেমপ্লেট',
  FRAUD_CHECKER: 'ফ্রড চেকার',
  CONNECT_FB_PAGE: 'FB পেজ',
  WALLET: 'ওয়ালেট',
  SETTINGS_BUSINESS: 'বিজনেস সেটিংস',
  SETTINGS_DELIVERY: 'ডেলিভারি সেটিংস',
  SETTINGS_BOT: 'বট সেটিংস',
  SETTINGS_KNOWLEDGE: 'নলেজ সেটিংস',
  SETTINGS_CALL: 'কল সেটিংস',
  SETTINGS_VOICE: 'ভয়েস সেটিংস',
  SETTINGS_TELEGRAM: 'টেলিগ্রাম নোটিফিকেশন',
};

// Cross-page suggestions always shown alongside page-specific ones
const CROSS_PAGE_SUGGESTIONS: string[] = [
  'WhatsApp connect করব কীভাবে?',
  'Courier API কীভাবে setup করব?',
  'Bot কীভাবে automatically order নেয়?',
  'bKash payment verify কীভাবে হয়?',
  'Instagram automation চালু করব কীভাবে?',
];

const PAGE_SUGGESTIONS: Record<NavKey, string[]> = {
  OVERVIEW: [
    'আজকের কতটা অর্ডার এসেছে?',
    'ওভারভিউতে কী কী দেখা যায়?',
    'Agent Tasks কীভাবে কাজ করে?',
    'Pending notifications কোথায় দেখব?',
    'Dashboard এর তথ্য কীভাবে refresh হয়?',
  ],
  AGENT_TASKS: [
    'Agent Tasks কীভাবে কাজ করে?',
    'Task complete করব কীভাবে?',
    'কোন task গুলো manually করতে হয়?',
    'Task pending থাকলে কী করব?',
    'নতুন task কীভাবে তৈরি হয়?',
  ],
  ORDERS: [
    'নতুন অর্ডার কীভাবে যোগ করব?',
    'অর্ডার status পরিবর্তন করব কীভাবে?',
    'কুরিয়ারে order পাঠাব কীভাবে?',
    'Bulk print কীভাবে করব?',
    'Cancelled order filter করব কীভাবে?',
  ],
  COURIER: [
    'Pathao-এ order book করব কীভাবে?',
    'Courier API connect করব কীভাবে?',
    'Delivery charge কীভাবে set করব?',
    'Return shipment track করব কীভাবে?',
    'Steadfast vs Pathao কোনটা ভালো?',
  ],
  PRINT: [
    'Invoice print করব কীভাবে?',
    'Bulk invoice print করা যায়?',
    'Invoice template কীভাবে customize করব?',
    'Print-এ logo যোগ করব কীভাবে?',
    'PDF export করা যায়?',
  ],
  PRODUCTS: [
    'নতুন product add করব কীভাবে?',
    'Product code কী এবং কেন দরকার?',
    'OCR দিয়ে product কীভাবে detect হয়?',
    'Product image upload করব কীভাবে?',
    'Stock update করব কীভাবে?',
  ],
  CATALOG: [
    'Public catalog কীভাবে share করব?',
    'Catalog-এ কোন products দেখাবে?',
    'Catalog link কোথায় পাব?',
    'Customer catalog থেকে order দিতে পারে?',
    'Catalog customize করা যায়?',
  ],
  RESTAURANT: [
    'Menu scan কীভাবে কাজ করে?',
    'Ingredient inventory কীভাবে set করব?',
    'Recipe set করলে কী হয়?',
    'Delivery fee slab কীভাবে দেব?',
    'Customer map-এ pin করে কীভাবে order করে?',
  ],
  ACCOUNTING: [
    'মোট profit কীভাবে দেখব?',
    'Expense add করব কীভাবে?',
    'Monthly report export করা যায়?',
    'COD collection record করব কীভাবে?',
    'Courier charge কি automatically ধরা হয়?',
  ],
  ANALYTICS: [
    'Best selling product কোনটি?',
    'Revenue trend কোথায় দেখব?',
    'কোন সময়ে বেশি order আসে?',
    'Customer retention rate দেখব কীভাবে?',
    'Analytics কতদিনের data দেখায়?',
  ],
  BOT_KNOWLEDGE: [
    'Bot reply কীভাবে customize করব?',
    'নতুন keyword add করব কীভাবে?',
    'Greeting message set করব কীভাবে?',
    'Bot Bengali বোঝে?',
    'Bot কীভাবে test করব?',
  ],
  CRM: [
    'Customer order history দেখব কীভাবে?',
    'Customer block করব কীভাবে?',
    'VIP tag দেব কীভাবে?',
    'Customer data export করা যায়?',
    'Customer segment তৈরি করব কীভাবে?',
  ],
  BROADCAST: [
    'Broadcast message পাঠাব কীভাবে?',
    'Facebook broadcast limit কত?',
    'Schedule করে broadcast পাঠানো যায়?',
    'Targeted broadcast কীভাবে করব?',
    'Broadcast fail হলে কী করব?',
  ],
  AUTO_POST: [
    'Auto post কীভাবে schedule করব?',
    'Image সহ auto post করা যায়?',
    'Post template কীভাবে তৈরি করব?',
    'Auto post বন্ধ করব কীভাবে?',
    'Multiple page-এ একসাথে post করা যায়?',
  ],
  UNIVERSITY: [
    'University website থেকে notice কীভাবে collect হয়?',
    'নতুন notice auto-post কীভাবে চালু করব?',
    'Group link কীভাবে যোগ করব?',
    'Student question এর উত্তর bot কীভাবে দেয়?',
    'Scrape interval কীভাবে পরিবর্তন করব?',
  ],
  FOLLOWUP: [
    'Follow-up sequence কীভাবে তৈরি করব?',
    'Abandoned order-এ follow-up দেওয়া যায়?',
    'Follow-up delay কীভাবে set করব?',
    'Follow-up pause করব কীভাবে?',
    'Follow-up message customize করব কীভাবে?',
  ],
  MEMO_TEMPLATE: [
    'নতুন memo template কীভাবে তৈরি করব?',
    'Template-এ variable কীভাবে ব্যবহার করব?',
    'Default template কোনটি?',
    'Template PDF export করা যায়?',
    'Template-এ logo add করব কীভাবে?',
  ],
  FRAUD_CHECKER: [
    'Fraud checker কীভাবে কাজ করে?',
    'Phone number check করব কীভাবে?',
    'Fraud customer block করব কীভাবে?',
    'Fraud score কীভাবে calculate হয়?',
    'False positive হলে কী করব?',
  ],
  CONNECT_FB_PAGE: [
    'Facebook page connect করব কীভাবে?',
    'কোন permission গুলো দিতে হবে?',
    'Connect fail হলে কী করব?',
    'Multiple page add করা যায়?',
    'Page disconnect করব কীভাবে?',
  ],
  WALLET: [
    'Wallet-এ balance add করব কীভাবে?',
    'AI usage charge কত?',
    'Balance শেষ হলে কী হয়?',
    'Transaction history কোথায় দেখব?',
    'AI কত টাকা খরচ হচ্ছে দেখব?',
  ],
  SETTINGS_BUSINESS: [
    'Business name কীভাবে পরিবর্তন করব?',
    'Logo upload করব কীভাবে?',
    'Contact number update করব কীভাবে?',
    'Business address কোথায় set করব?',
    'বিজনেস ইনফো invoice-এ দেখাবে?',
  ],
  SETTINGS_DELIVERY: [
    'Default delivery charge কীভাবে set করব?',
    'Zone-wise charge কীভাবে configure করব?',
    'COD charge আলাদা রাখা যায়?',
    'Payment method কীভাবে যোগ করব?',
    'Free delivery threshold set করা যায়?',
  ],
  SETTINGS_BOT: [
    'Bot on/off করব কীভাবে?',
    'Human handover কীভাবে কাজ করে?',
    'Response delay set করব কীভাবে?',
    'Bot mode পরিবর্তন করব কীভাবে?',
    'Bot কোন ভাষায় reply করবে?',
  ],
  SETTINGS_KNOWLEDGE: [
    'Product knowledge কীভাবে update করব?',
    'Price list bot-এ কীভাবে দেব?',
    'FAQ কীভাবে add করব?',
    'Knowledge base test করব কীভাবে?',
    'Pricing rules কীভাবে configure করব?',
  ],
  SETTINGS_CALL: [
    'Call confirm কীভাবে কাজ করে?',
    'Call script কীভাবে customize করব?',
    'Auto call কখন trigger হয়?',
    'Call log কোথায় দেখব?',
    'Call confirm বন্ধ করব কীভাবে?',
  ],
  SETTINGS_VOICE: [
    'Voice message কীভাবে enable করব?',
    'Bengali voice support আছে?',
    'Voice message charge কত?',
    'TTS ভয়েস কীভাবে পরিবর্তন করব?',
    'Voice quality কীভাবে improve করব?',
  ],
  SETTINGS_TELEGRAM: [
    'Telegram bot কীভাবে তৈরি করব?',
    'Chat ID কোথায় পাব?',
    'Payment notification Telegram-এ আসবে কীভাবে?',
    'Telegram notification enable করব কীভাবে?',
    'BotFather থেকে token কীভাবে নেব?',
  ],
};

export function ChatbotWidget({ currentPage, dark, pageId }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [liveSummary, setLiveSummary] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { request } = useApi();

  const bg = dark ? '#1a1b2e' : '#ffffff';
  const surface = dark ? '#252640' : '#f3f4f6';
  const border = dark ? '#2e3050' : '#e5e7eb';
  const text = dark ? '#e2e3f0' : '#111827';
  const muted = dark ? '#6b7280' : '#9ca3af';
  const accent = '#6366f1';
  const userBubble = accent;
  const aiBubble = dark ? '#252640' : '#f3f4f6';
  const aiText = text;

  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, loading]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setShowSuggestions(false);
    setLoading(true);

    try {
      const res = await request<{ reply: string }>(`${API_BASE}/support-chat`, {
        method: 'POST',
        body: JSON.stringify({
          message: trimmed,
          pageContext: currentPage,
          history: messages.slice(-10),
          liveData: liveSummary ?? undefined,
        }),
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    setMessages([]);
    setShowSuggestions(true);
    setInput('');
    if (pageId) {
      try {
        const [summary, senders] = await Promise.all([
          request<any>(`${API_BASE}/client-dashboard/${pageId}/summary`),
          request<any>(`${API_BASE}/client-dashboard/${pageId}/sender-count`),
        ]);
        setLiveSummary({ ...summary, uniqueSenders: senders?.uniqueSenders ?? 0 });
      } catch {
        // non-critical — chatbot still works without live data
      }
    }
  };

  const handleClose = () => setOpen(false);

  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768;

  const pageSpecific = PAGE_SUGGESTIONS[currentPage] ?? [];
  const suggestions = [
    ...pageSpecific.slice(0, 3),
    ...CROSS_PAGE_SUGGESTIONS.slice(0, 2),
  ];
  const pageLabel = PAGE_LABELS[currentPage] ?? '';

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9500 }}>
      {/* Chat Panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            ...(isMobile
              ? { left: 0, right: 0, bottom: 0, top: 'auto', borderRadius: '16px 16px 0 0', width: '100%' }
              : { right: 24, bottom: 88, width: 370, borderRadius: 16 }),
            height: isMobile ? '85vh' : 520,
            background: bg,
            border: `1px solid ${border}`,
            boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 9500,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 16px',
              borderBottom: `1px solid ${border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: dark ? '#1e1f35' : '#f9fafb',
              flexShrink: 0,
            }}
          >
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <LizaAvatar size={38} />
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 10, height: 10, borderRadius: '50%',
                background: '#22c55e',
                border: `2px solid ${dark ? '#1e1f35' : '#f9fafb'}`,
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: text, letterSpacing: -0.2 }}>
                Liza ✨
              </div>
              <div style={{ fontSize: 11, color: '#22c55e', marginTop: 1, fontWeight: 600 }}>
                ● অনলাইন · AI সহকারী{pageLabel ? ` · ${pageLabel}` : ''}
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: 'none',
                border: 'none',
                color: muted,
                cursor: 'pointer',
                padding: 4,
                fontSize: 18,
                lineHeight: 1,
                borderRadius: 6,
              }}
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 14px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Welcome */}
            <div
              style={{
                background: aiBubble,
                color: aiText,
                borderRadius: '4px 14px 14px 14px',
                padding: '10px 13px',
                fontSize: 13.5,
                lineHeight: 1.5,
                maxWidth: '88%',
              }}
            >
              👋 হ্যালো! আমি <strong>Liza</strong> — FlamboyAI-এর AI সহকারী। Orders, Courier, Bot, WhatsApp, Payment — Dashboard-এর <strong>যেকোনো পেজের</strong> যেকোনো প্রশ্ন করুন!
            </div>

            {/* Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: muted, paddingLeft: 2 }}>
                  যেকোনো বিষয়ে জিজ্ঞেস করুন:
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    style={{
                      background: 'none',
                      border: `1px solid ${border}`,
                      borderRadius: 20,
                      padding: '7px 13px',
                      fontSize: 12.5,
                      color: dark ? '#a5b4fc' : accent,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.background = dark ? '#2a2b45' : '#eef2ff')
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.background = 'none')
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Chat messages */}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    background: m.role === 'user' ? userBubble : aiBubble,
                    color: m.role === 'user' ? '#fff' : aiText,
                    borderRadius:
                      m.role === 'user'
                        ? '14px 4px 14px 14px'
                        : '4px 14px 14px 14px',
                    padding: '10px 13px',
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    maxWidth: '88%',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div style={{ display: 'flex', gap: 5, padding: '6px 4px', alignItems: 'center' }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: muted,
                      animation: `chatbotDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            style={{
              padding: '10px 12px',
              borderTop: `1px solid ${border}`,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
              background: dark ? '#1e1f35' : '#f9fafb',
              flexShrink: 0,
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="প্রশ্ন করুন..."
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                background: surface,
                border: `1px solid ${border}`,
                borderRadius: 10,
                padding: '9px 12px',
                fontSize: 13.5,
                color: text,
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                maxHeight: 100,
                overflowY: 'auto',
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 100) + 'px';
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: !input.trim() || loading ? (dark ? '#2e3050' : '#e5e7eb') : accent,
                border: 'none',
                cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: !input.trim() || loading ? muted : '#fff',
                fontSize: 16,
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* FAB Button */}
      <button
        onClick={open ? handleClose : handleOpen}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${accent}, #8b5cf6)`,
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          boxShadow: '0 4px 20px rgba(99,102,241,0.5)',
          transition: 'transform 0.15s, box-shadow 0.15s',
          color: '#fff',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        }}
        title="Liza — AI সহকারী"
      >
        {open ? (
          <span style={{ fontSize: 20, fontWeight: 700 }}>✕</span>
        ) : (
          <LizaAvatar size={52} />
        )}
      </button>

      {/* Typing animation keyframes */}
      <style>{`
        @keyframes chatbotDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes liza-pulse {
          0%,100% { box-shadow: 0 4px 20px rgba(99,102,241,0.5); }
          50% { box-shadow: 0 4px 28px rgba(139,92,246,0.7); }
        }
      `}</style>
    </div>
  );
}
