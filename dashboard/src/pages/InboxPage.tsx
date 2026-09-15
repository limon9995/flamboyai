import { useCallback, useEffect, useRef, useState } from 'react';
import { CardHeader, EmptyState, Spinner } from '../components/ui';
import type { Theme } from '../components/ui';
import { API_BASE, useApi } from '../hooks/useApi';
import { useLanguage } from '../i18n';

interface Conversation {
  psid: string;
  platform: string;
  lastMessage: string | null;
  lastMessageType: string;
  lastDirection: 'IN' | 'OUT';
  lastMessageAt: string;
  customerName: string | null;
  customerPhone: string | null;
}

interface Message {
  id: number;
  platform: string;
  direction: 'IN' | 'OUT';
  type: string;
  content: string | null;
  createdAt: string;
}

const PLATFORM_META: Record<string, { icon: string; color: string; label: string }> = {
  FACEBOOK:  { icon: '💙', color: '#1877f2', label: 'Facebook' },
  INSTAGRAM: { icon: '📸', color: '#e1306c', label: 'Instagram' },
  WHATSAPP:  { icon: '💚', color: '#25d366', label: 'WhatsApp' },
  TELEGRAM:  { icon: '✈️', color: '#229ed9', label: 'Telegram' },
};

function platformMeta(p?: string) {
  return PLATFORM_META[(p || 'FACEBOOK').toUpperCase()] ?? PLATFORM_META.FACEBOOK;
}

function timeAgo(iso: string, copy: (bn: string, en: string) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return copy('এখনই', 'just now');
  if (mins < 60) return `${mins}${copy('মি', 'm')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${copy('ঘ', 'h')}`;
  const days = Math.floor(hrs / 24);
  return `${days}${copy('দি', 'd')}`;
}

export function InboxPage({ th, pageId, onToast }: {
  th: Theme; pageId: number; onToast: (m: string, t?: any) => void;
}) {
  const { copy } = useLanguage();
  const { request } = useApi();
  const BASE = `${API_BASE}/client-dashboard/${pageId}`;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs]    = useState(false);
  const [platformFilter, setPlatformFilter] = useState('');
  const [search, setSearch]                 = useState('');
  const [selected, setSelected]             = useState<Conversation | null>(null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs]       = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const params = new URLSearchParams();
      if (platformFilter) params.set('platform', platformFilter);
      if (search) params.set('search', search);
      const data = await request<Conversation[]>(`${BASE}/inbox/conversations?${params}`);
      setConversations(data);
    } catch (e: any) { onToast(e.message, 'error'); }
    finally { setLoadingConvs(false); }
  }, [pageId, platformFilter, search]);

  const loadMessages = useCallback(async (conv: Conversation, silent = false) => {
    if (!silent) setLoadingMsgs(true);
    try {
      const params = new URLSearchParams({ platform: conv.platform, psid: conv.psid });
      const data = await request<Message[]>(`${BASE}/inbox/messages?${params}`);
      setMessages(data);
    } catch (e: any) { if (!silent) onToast(e.message, 'error'); }
    finally { if (!silent) setLoadingMsgs(false); }
  }, [pageId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Refresh the conversation list periodically so new messages show up without a manual reload.
  useEffect(() => {
    const t = setInterval(() => loadConversations(), 15000);
    return () => clearInterval(t);
  }, [loadConversations]);

  // Poll the open thread for new messages.
  useEffect(() => {
    if (!selected) return;
    loadMessages(selected);
    const t = setInterval(() => loadMessages(selected, true), 6000);
    return () => clearInterval(t);
  }, [selected?.platform, selected?.psid]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const openConversation = (c: Conversation) => setSelected(c);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>💬 {copy('ইনবক্স', 'Inbox')}</div>
        <div style={{ fontSize: 12.5, color: th.muted, marginTop: 3 }}>
          {copy('সব প্ল্যাটফর্মের মেসেজ একসাথে দেখুন', 'All your platform messages in one place')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '360px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
        {/* Conversation list */}
        <div style={th.card}>
          <CardHeader th={th} title={copy(`কথোপকথন (${conversations.length})`, `Conversations (${conversations.length})`)}
            action={<button style={th.btnGhost} onClick={loadConversations}>{loadingConvs ? <Spinner size={13} /> : '🔄'}</button>}
          />

          {/* Platform filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => setPlatformFilter('')}
              style={{ ...th.btnGhost, padding: '5px 10px', fontSize: 11.5, ...(platformFilter === '' ? { background: th.accentSoft, color: th.accent } : {}) }}
            >{copy('সব', 'All')}</button>
            {Object.entries(PLATFORM_META).map(([key, meta]) => (
              <button key={key}
                onClick={() => setPlatformFilter(key)}
                style={{ ...th.btnGhost, padding: '5px 10px', fontSize: 11.5, ...(platformFilter === key ? { background: th.accentSoft, color: meta.color } : {}) }}
              >{meta.icon} {meta.label}</button>
            ))}
          </div>

          <input style={{ ...th.input, width: '100%', marginBottom: 12 }}
            placeholder={copy('🔍 নাম বা ফোন দিয়ে খুঁজুন', '🔍 Search by name or phone')}
            value={search} onChange={e => setSearch(e.target.value)} />

          {loadingConvs && !conversations.length
            ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22} /></div>
            : conversations.length === 0
            ? <EmptyState icon="💬" title={copy('কোনো মেসেজ নেই', 'No messages yet')}
                sub={copy('কাস্টমার মেসেজ পাঠালে এখানে দেখা যাবে', 'Customer messages will show up here')} />
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 560, overflowY: 'auto' }}>
                {conversations.map(c => {
                  const meta = platformMeta(c.platform);
                  const isSel = selected?.platform === c.platform && selected?.psid === c.psid;
                  return (
                    <div key={`${c.platform}:${c.psid}`}
                      onClick={() => openConversation(c)}
                      style={{
                        ...th.card2, cursor: 'pointer',
                        border: `1.5px solid ${isSel ? th.accent : th.border}`,
                        background: isSel ? th.accentSoft : undefined,
                        transition: 'all .12s',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 12 }}>{meta.icon}</span>
                            <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                              {c.customerName || c.customerPhone || c.psid.slice(0, 12)}
                            </span>
                          </div>
                          <div style={{
                            fontSize: 12, color: th.muted, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', maxWidth: 260,
                          }}>
                            {c.lastDirection === 'OUT' ? `↩ ${c.lastMessage ?? ''}` : (c.lastMessage ?? '')}
                          </div>
                        </div>
                        <div style={{ fontSize: 10.5, color: th.muted, whiteSpace: 'nowrap' }}>
                          {timeAgo(c.lastMessageAt, copy)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {/* Thread panel */}
        {selected && (
          <div style={{ ...th.card, display: 'flex', flexDirection: 'column', height: 640 }}>
            <CardHeader th={th}
              title={`${platformMeta(selected.platform).icon} ${selected.customerName || selected.customerPhone || selected.psid}`}
              sub={platformMeta(selected.platform).label}
              action={<button style={th.btnGhost} onClick={() => setSelected(null)}>✕</button>}
            />

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
              {loadingMsgs && !messages.length
                ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={22} /></div>
                : messages.length === 0
                ? <EmptyState icon="💬" title={copy('কোনো মেসেজ নেই', 'No messages')} />
                : messages.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'OUT' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '72%', padding: '8px 12px', borderRadius: 14,
                      background: m.direction === 'OUT' ? th.accent : th.card2.background,
                      color: m.direction === 'OUT' ? '#fff' : th.text,
                      border: m.direction === 'OUT' ? 'none' : `1px solid ${th.border}`,
                      fontSize: 13, lineHeight: 1.4,
                    }}>
                      <div>{m.content}</div>
                      <div style={{
                        fontSize: 9.5, marginTop: 4, opacity: 0.7,
                        color: m.direction === 'OUT' ? 'rgba(255,255,255,0.85)' : th.muted,
                      }}>
                        {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              <div ref={threadEndRef} />
            </div>

            <div style={{ fontSize: 11, color: th.muted, textAlign: 'center', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${th.border}` }}>
              {copy('রিপ্লাই দিতে Messenger/WhatsApp/Instagram এ গিয়ে সরাসরি লিখুন — এখানে শুধু history দেখা যায়', 'Reply directly from Messenger/WhatsApp/Instagram — this view is read-only history')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
