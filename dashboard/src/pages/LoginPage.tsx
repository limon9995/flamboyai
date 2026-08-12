import React, { useState, useRef, useEffect } from 'react';
import { LanguageSwitch } from '../components/ui';
import { useLanguage } from '../i18n';

interface Props {
  dark: boolean;
  setDark: (v: boolean) => void;
  onLogin: (username: string, password: string) => Promise<void>;
  onSignup?: () => void;
  onForgotPassword?: () => void;
  onGoogleLogin?: () => Promise<void>;
}

const HELPLINE_FACEBOOK = 'https://www.facebook.com/share/18CGePjSwQ/';

export function LoginPage({ dark, setDark, onLogin, onSignup, onForgotPassword, onGoogleLogin }: Props) {
  const { language, copy } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]       = useState('');
  const [showPass, setShowPass] = useState(false);
  const [focused, setFocused]   = useState<string | null>(null);
  const [cardTilt, setCardTilt] = useState({ x: 0, y: 0 });
  const unRef = useRef<HTMLInputElement>(null);

  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width - 0.5;
    const cy = (e.clientY - rect.top) / rect.height - 0.5;
    setCardTilt({ x: cy * -6, y: cx * 6 });
  };
  const handleCardMouseLeave = () => setCardTilt({ x: 0, y: 0 });

  useEffect(() => { unRef.current?.focus(); }, []);

  const submit = async () => {
    if (!username.trim() || !password) return setError(copy('Gmail এবং password দিন', 'Enter your email and password'));
    setLoading(true); setError('');
    try { await onLogin(username.trim(), password); }
    catch (e: any) { setError(e?.message || copy('লগইন করা যায়নি', 'Login failed')); }
    finally { setLoading(false); }
  };

  const googleLogin = async () => {
    if (!onGoogleLogin) return;
    setGoogleLoading(true); setError('');
    try { await onGoogleLogin(); }
    catch (e: any) { setError(e?.message || copy('Google login করা যায়নি', 'Google login failed')); setGoogleLoading(false); }
  };

  const bg      = dark ? '#06060a' : '#f7f7f8';
  const border  = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const text    = dark ? '#ededf0' : '#0d0d10';
  const muted   = dark ? 'rgba(237,237,240,0.4)' : 'rgba(13,13,16,0.38)';
  const accent  = '#4f46e5';

  const inpStyle = (name: string): React.CSSProperties => ({
    padding: '11px 14px',
    borderRadius: 9,
    border: `1.5px solid ${focused === name ? accent : border}`,
    outline: 'none',
    background: dark ? 'rgba(255,255,255,0.04)' : '#fafafa',
    color: text,
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 14,
    transition: 'border-color .15s, box-shadow .15s',
    fontFamily: 'inherit',
    boxShadow: focused === name ? `0 0 0 3px ${accent}18` : 'none',
  });

  return (
    <div style={{
      minHeight: '100vh', background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans','Noto Sans Bengali',system-ui,sans-serif",
      position: 'relative', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
        @keyframes spin { to { transform:rotate(360deg); } }
        .lcard { animation: fadeUp .4s cubic-bezier(.22,1,.36,1) forwards; }
        * { box-sizing: border-box; }
        input::placeholder { color: ${muted}; }
      `}</style>

      {/* Background orbs */}
      <div style={{ position:'fixed', top:'-10%', left:'-5%', width:600, height:600, borderRadius:'50%', background:`radial-gradient(circle, ${accent}18, transparent 65%)`, pointerEvents:'none' }}/>
      <div style={{ position:'fixed', bottom:'-10%', right:'-5%', width:500, height:500, borderRadius:'50%', background:`radial-gradient(circle, #7c3aed18, transparent 65%)`, pointerEvents:'none' }}/>

      <div
        className="lcard tilt-card"
        onMouseMove={handleCardMouseMove}
        onMouseLeave={handleCardMouseLeave}
        style={{
          width: 400, padding: '40px 36px',
          background: dark ? 'rgba(17,17,24,0.85)' : 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.09)' : 'rgba(79,70,229,0.14)'}`,
          borderRadius: 22,
          boxShadow: dark
            ? '0 24px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.05)'
            : '0 8px 48px rgba(79,70,229,0.12), 0 0 0 1px rgba(79,70,229,0.06)',
          transform: `perspective(900px) rotateX(${cardTilt.x}deg) rotateY(${cardTilt.y}deg)`,
          transition: 'transform .18s ease, box-shadow .18s ease',
        }}
      >

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/logo.png" alt="FlamboyAI" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: '50%', margin: '0 auto 14px', display: 'block' }} />
          <div style={{ fontSize: 22, fontWeight: 800, color: text, letterSpacing: '-0.04em', lineHeight: 1 }}>
            FlamboyAI
          </div>
          <div style={{ fontSize: 12.5, color: muted, marginTop: 5, fontWeight: 500 }}>
            {copy('কমার্স অটোমেশন ড্যাশবোর্ড', 'Commerce Automation Dashboard')}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)',
            color: '#ef4444', borderRadius: 9, padding: '10px 14px',
            fontSize: 13, marginBottom: 18,
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <span style={{ fontSize: 15 }}>!</span> {error}
          </div>
        )}

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:muted, letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:6 }}>
              {copy('Gmail / Username', 'Gmail / Username')}
            </label>
            <input
              ref={unRef}
              style={inpStyle('username')}
              placeholder={language === 'en' ? 'Gmail or username' : 'Gmail অথবা username'}
              value={username}
              onChange={e => setUsername(e.target.value)}
              onFocus={() => setFocused('username')}
              onBlur={() => setFocused(null)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              autoComplete="off"
            />
          </div>

          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <label style={{ fontSize:11.5, fontWeight:600, color:muted, letterSpacing:'0.05em', textTransform:'uppercase' }}>
                Password
              </label>
              {onForgotPassword && (
                <button onClick={onForgotPassword} style={{ background:'none', border:'none', cursor:'pointer', color:accent, fontSize:11.5, fontWeight:700, fontFamily:'inherit', padding:0 }}>
                  {copy('পাসওয়ার্ড ভুলে গেছেন?', 'Forgot Password?')}
                </button>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                style={inpStyle('password')}
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                autoComplete="current-password"
              />
              <button
                onClick={() => setShowPass(v => !v)}
                style={{
                  position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer', color:muted,
                  fontSize:13, padding:0, display:'flex', alignItems:'center',
                }}
                tabIndex={-1}
              >
                {showPass ? '○' : '●'}
              </button>
            </div>
          </div>

          <button
            onClick={submit}
            disabled={loading}
            style={{
              marginTop: 6,
              padding: '12px',
              borderRadius: 9,
              border: 'none',
              background: loading
                ? `${accent}66`
                : `linear-gradient(135deg, ${accent}, #6d28d9)`,
              color: '#fff',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: 'inherit',
              letterSpacing: '-0.01em',
              boxShadow: loading ? 'none' : `0 2px 12px ${accent}44`,
              transition: 'all .15s',
              width: '100%',
            }}
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation:'spin .65s linear infinite' }}>
                  <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2.5" strokeOpacity=".25"/>
                  <path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                {copy('লগইন হচ্ছে...', 'Logging in...')}
              </>
            ) : (
              <>{copy('সাইন ইন করুন →', 'Sign in ->')}</>
            )}
          </button>

          {onGoogleLogin && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
                <div style={{ flex: 1, height: 1, background: border }} />
                <span style={{ fontSize: 11.5, color: muted }}>{copy('অথবা', 'or')}</span>
                <div style={{ flex: 1, height: 1, background: border }} />
              </div>
              <button
                onClick={googleLogin}
                disabled={googleLoading}
                style={{
                  padding: '11px',
                  borderRadius: 9,
                  border: `1.5px solid ${border}`,
                  background: dark ? 'rgba(255,255,255,0.03)' : '#fff',
                  color: text,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: googleLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  fontFamily: 'inherit',
                  width: '100%',
                  opacity: googleLoading ? 0.7 : 1,
                }}
              >
                <svg width="17" height="17" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.4 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/>
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 5.4 29.6 3 24 3 15.9 3 8.9 7.6 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 45c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4C29.5 36.4 26.9 37 24 37c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C8.9 40.4 15.9 45 24 45z"/>
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.5l6.6 5.4C41.6 35.5 45 30.2 45 24c0-1.2-.1-2.4-.4-3.5z"/>
                </svg>
                {googleLoading ? copy('অপেক্ষা করুন...', 'Please wait...') : copy('Google দিয়ে Sign in করুন', 'Sign in with Google')}
              </button>
            </>
          )}
        </div>

        <div style={{ display:'flex', justifyContent:'center', gap:10, marginTop:22, flexWrap:'wrap' }}>
          <LanguageSwitch dark={dark} compact />
          <button
            onClick={() => setDark(!dark)}
            style={{
              background:'transparent', border:`1px solid ${border}`,
              borderRadius:8, padding:'6px 14px', color:muted,
              cursor:'pointer', fontSize:12.5, fontFamily:'inherit',
              transition:'border-color .15s',
            }}
          >
            {dark ? copy('☀ লাইট', '☀ Light') : copy('☾ ডার্ক', '☾ Dark')}
          </button>
        </div>

        {/* Signup link */}
        {onSignup && (
          <div style={{ textAlign:'center', marginTop:16, fontSize:13, color:muted }}>
            {copy('অ্যাকাউন্ট নেই?', "Don't have an account?")}{' '}
            <button onClick={onSignup} style={{
              background:'none', border:'none', cursor:'pointer',
              color: accent, fontWeight:700, fontSize:13, fontFamily:'inherit',
              padding:0, textDecoration:'underline', textUnderlineOffset:3,
            }}>
              {copy('সাইন আপ করুন', 'Create one')}
            </button>
          </div>
        )}

        <div style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: `1px solid ${border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'center',
        }}>
          <div style={{ fontSize: 11.5, color: muted, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {copy('Helpline', 'Helpline')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a
              href={HELPLINE_FACEBOOK}
              target="_blank"
              rel="noreferrer"
              style={{
                textDecoration: 'none',
                padding: '8px 12px',
                borderRadius: 8,
                background: dark ? 'rgba(59,130,246,0.14)' : '#eff6ff',
                color: '#2563eb',
                fontWeight: 700,
                fontSize: 12.5,
              }}
            >
              {copy('Facebook Page দেখুন', 'Open Facebook Page')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
