import { useState, useRef } from 'react';
import { LanguageSwitch } from '../components/ui';
import { API_BASE } from '../hooks/useApi';
import { useLanguage } from '../i18n';

interface Props {
  dark: boolean;
  setDark: (v: boolean) => void;
  onSignup: (data: { identifier: string; password: string; name: string }) => Promise<void>;
  onBack: () => void;
}

export function SignupPageComponent({ dark, setDark, onBack }: Props) {
  const { copy } = useLanguage();
  const [email, setEmail]           = useState('');
  const [name, setName]             = useState('');
  const [password, setPassword]     = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [focused, setFocused]       = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const bg     = dark ? '#06060a' : '#f7f7f8';
  const panel  = dark ? '#111118' : '#ffffff';
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const text   = dark ? '#ededf0' : '#0d0d10';
  const muted  = dark ? 'rgba(237,237,240,0.4)' : 'rgba(13,13,16,0.38)';
  const accent = '#4f46e5';

  const inp = (n: string): React.CSSProperties => ({
    padding: '11px 14px', borderRadius: 9,
    border: `1.5px solid ${focused === n ? accent : border}`,
    outline: 'none',
    background: dark ? 'rgba(255,255,255,0.04)' : '#fafafa',
    color: text, width: '100%', boxSizing: 'border-box',
    fontSize: 14, fontFamily: 'inherit',
    transition: 'border-color .15s, box-shadow .15s',
    boxShadow: focused === n ? `0 0 0 3px ${accent}18` : 'none',
  });

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const submit = async () => {
    if (!isValidEmail(email))        return setError(copy('একটি valid email address দিন', 'Enter a valid email address'));
    if (!name.trim())                return setError(copy('Username দিন', 'Enter a username'));
    if (password.length < 6)         return setError(copy('Password কমপক্ষে ৬ character হতে হবে', 'Password must be at least 6 characters'));
    if (password !== confirmPass)     return setError(copy('Password match করছে না', 'Passwords do not match'));
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:    email.trim().toLowerCase(),
          username: name.trim(),
          name:     name.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || copy('Account তৈরি হয়নি', 'Failed to create account'));
      setSuccess(copy('অ্যাকাউন্ট তৈরি হয়েছে! এখন লগইন করুন।', 'Account created! Please sign in.'));
      setTimeout(() => onBack(), 1500);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: '100vh', background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans','Noto Sans Bengali',system-ui,sans-serif",
      position: 'relative', overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
        @keyframes spin   { to { transform:rotate(360deg); } }
        .scard { animation: fadeUp .4s cubic-bezier(.22,1,.36,1) forwards; }
        * { box-sizing: border-box; }
        input::placeholder { color: ${muted}; }
      `}</style>

      <div style={{ position:'fixed', top:'-10%', left:'-5%', width:600, height:600, borderRadius:'50%', background:`radial-gradient(circle, ${accent}14, transparent 65%)`, pointerEvents:'none' }}/>
      <div style={{ position:'fixed', bottom:'-10%', right:'-5%', width:500, height:500, borderRadius:'50%', background:`radial-gradient(circle, #7c3aed14, transparent 65%)`, pointerEvents:'none' }}/>

      <div className="scard" style={{
        width: 420, padding: '40px 36px',
        background: panel, border: `1px solid ${border}`, borderRadius: 18,
        boxShadow: dark
          ? '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
          : '0 8px 40px rgba(0,0,0,0.08)',
      }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <img src="/logo.png" alt="FlamboyAI" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: '50%', margin: '0 auto 14px', display: 'block' }} />
          <div style={{ fontSize:22, fontWeight:800, color:text, letterSpacing:'-0.04em' }}>{copy('অ্যাকাউন্ট তৈরি করুন', 'Create Account')}</div>
          {/* Trial badge */}
          <div style={{
            display:'inline-flex', alignItems:'center', gap:6,
            marginTop:10, padding:'6px 14px', borderRadius:999,
            background:'rgba(16,185,129,0.10)', border:'1px solid rgba(16,185,129,0.30)',
            fontSize:12.5, fontWeight:700, color:'#10b981',
          }}>
            <span style={{ fontSize:14 }}>🎁</span>
            {copy('৭ দিন Free Trial — কোনো Card লাগবে না', '7-Day Free Trial — No Card Required')}
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#ef4444', borderRadius:9, padding:'10px 14px', fontSize:13, marginBottom:14, display:'flex', gap:7 }}>
            <span>⚠</span> {error}
          </div>
        )}
        {success && (
          <div style={{ background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.22)', color:'#10b981', borderRadius:9, padding:'10px 14px', fontSize:13, marginBottom:14 }}>
            ✅ {success}
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* Email */}
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:muted, letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:6 }}>
              {copy('Email Address *', 'Email Address *')}
            </label>
            <input
              ref={inputRef}
              style={inp('email')}
              type="email"
              placeholder="yourname@gmail.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              autoComplete="email"
            />
          </div>

          {/* Username */}
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:muted, letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:6 }}>
              {copy('ইউজারনেম *', 'Username *')}
            </label>
            <input
              style={inp('name')}
              placeholder={copy('username দিন (login-এ ব্যবহার হবে)', 'Choose a username')}
              value={name}
              autoComplete="off"
              onChange={e => { setName(e.target.value); setError(''); }}
              onFocus={() => setFocused('name')}
              onBlur={() => setFocused(null)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:muted, letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:6 }}>
              Password *
            </label>
            <div style={{ position:'relative' }}>
              <input
                style={inp('pass')}
                type={showPass ? 'text' : 'password'}
                placeholder={copy('কমপক্ষে ৬ character', 'At least 6 characters')}
                value={password}
                autoComplete="new-password"
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onFocus={() => setFocused('pass')}
                onBlur={() => setFocused(null)}
                onKeyDown={e => e.key === 'Enter' && submit()}
              />
              <button onClick={() => setShowPass(v => !v)} tabIndex={-1}
                style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:muted, fontSize:13, padding:0 }}>
                {showPass ? '○' : '●'}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:muted, letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:6 }}>
              Confirm Password *
            </label>
            <input
              style={{ ...inp('confirm'), borderColor: confirmPass && confirmPass !== password ? '#ef4444' : focused === 'confirm' ? accent : border }}
              type="password"
              placeholder={copy('Password আবার লিখুন', 'Re-enter your password')}
              value={confirmPass}
              autoComplete="new-password"
              onChange={e => { setConfirmPass(e.target.value); setError(''); }}
              onFocus={() => setFocused('confirm')}
              onBlur={() => setFocused(null)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
            {confirmPass && confirmPass !== password && <div style={{ fontSize:11.5, color:'#ef4444', marginTop:4 }}>{copy('Password match হচ্ছে না', 'Passwords do not match')}</div>}
            {confirmPass && confirmPass === password  && <div style={{ fontSize:11.5, color:'#16a34a', marginTop:4 }}>{copy('✓ মিলেছে', '✓ Match')}</div>}
          </div>

          <button onClick={submit}
            disabled={loading || !email || !name || password.length < 6 || password !== confirmPass}
            style={{
              padding:'12px', borderRadius:9, border:'none', fontFamily:'inherit',
              background: loading || !email || !name || password.length < 6 || password !== confirmPass
                ? `${accent}55` : `linear-gradient(135deg, ${accent}, #6d28d9)`,
              color:'#fff', fontWeight:700, fontSize:14.5, cursor: loading ? 'wait' : 'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              boxShadow: loading ? 'none' : `0 2px 12px ${accent}44`, transition:'all .15s',
            }}>
            {loading ? <><Spin/> {copy('Account তৈরি হচ্ছে...', 'Creating account...')}</> : copy('🎉 Account তৈরি করুন', 'Create Account')}
          </button>
        </div>

        <div style={{ textAlign:'center', marginTop:20, fontSize:13, color:muted }}>
          {copy('আগে থেকেই অ্যাকাউন্ট আছে?', 'Already have an account?')}{' '}
          <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:accent, fontWeight:700, fontSize:13, fontFamily:'inherit', padding:0, textDecoration:'underline', textUnderlineOffset:3 }}>
            {copy('সাইন ইন', 'Sign in')}
          </button>
        </div>
        <div style={{ display:'flex', justifyContent:'center', gap:10, marginTop:10, flexWrap:'wrap' }}>
          <LanguageSwitch dark={dark} compact />
          <button onClick={() => setDark(!dark)} style={{ background:'transparent', border:`1px solid ${border}`, borderRadius:8, padding:'5px 12px', color:muted, cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
            {dark ? copy('☀ লাইট', '☀ Light') : copy('☾ ডার্ক', '☾ Dark')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Spin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation:'spin .65s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2.5" strokeOpacity=".25"/>
      <path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
