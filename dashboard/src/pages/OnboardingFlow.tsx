import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, useApi } from '../hooks/useApi';

interface Props {
  dark: boolean;
  user: { id: string; name: string; role: string };
  activePage: { id: number; pageId: string; pageName?: string };
  onComplete: () => void;
  onSkip: () => void;
}

type OBStep = 1 | 2 | 3 | 4 | 5 | 'uni_setup' | 'uni_done';

const CONFETTI_COLORS = ['#6366f1', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#f97316'];
const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  left: `${2 + i * 2.7}%`,
  size: 7 + (i % 5) * 3,
  delay: `${i * 0.08}s`,
  duration: `${2.2 + (i % 4) * 0.7}s`,
  isCircle: i % 3 === 0,
  rotate: i % 2 === 0,
}));

const STEP_CONFIG = [
  { icon: '🏪', label: 'প্রোফাইল', mascot: 'ব্যবসার তথ্য দিন —\nবট এটি ব্যবহার করবে!' },
  { icon: '🛍️', label: 'পণ্য',     mascot: 'একটি পণ্য যোগ করুন,\nবট সেটি চিনবে!' },
  { icon: '🤖', label: 'বট',       mascot: 'বটের mode ও delivery\nচার্জ ঠিক করুন!' },
  { icon: '💳', label: 'পেমেন্ট',  mascot: 'Payment auto-verify\nসেট করুন!' },
  { icon: '🎉', label: 'সম্পন্ন', mascot: 'দারুণ! সব ঠিক আছে!' },
];

export function OnboardingFlow({ dark, user, activePage, onComplete, onSkip }: Props) {
  const [step, setStep] = useState<OBStep>(1);
  const [dir, setDir] = useState<1 | -1>(1);
  const [animating, setAnimating] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [wizardExiting, setWizardExiting] = useState(false);
  const [pageConnected, setPageConnected] = useState(false);
  const [productAdded, setProductAdded] = useState(false);
  const [productSkipped, setProductSkipped] = useState(false);
  const [botSaved, setBotSaved] = useState(false);
  const [justCompleted, setJustCompleted] = useState<OBStep | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const { request } = useApi();

  // Every client runs the single commerce AI engine — no agent-type picker.
  // Tone/personality is customized per-page via customPersonaPrompt in
  // Settings instead. Turn automation on immediately so the bot is live
  // as soon as onboarding starts.
  useEffect(() => {
    request(`${API_BASE}/client-dashboard/${activePage.id}/modes`, {
      method: 'PATCH',
      body: JSON.stringify({ automationOn: true, universityModeOn: false }),
    }).catch(() => {});
  }, [activePage.id]);

  const bg     = dark ? '#0b0c1a' : '#f0f2ff';
  const panel  = dark ? 'rgba(22,24,46,0.85)' : 'rgba(255,255,255,0.9)';
  const border = dark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.15)';
  const text   = dark ? '#e8eaf6' : '#0f1220';
  const muted  = dark ? '#6b7280' : '#9ca3af';
  const accent = '#6366f1';
  const accentSoft = dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)';

  const advanceStep = useCallback((nextStep: OBStep) => {
    if (animating) return;
    setAnimating(true);
    const numCur = typeof step === 'number' ? step : 99;
    const numNext = typeof nextStep === 'number' ? nextStep : 99;
    setDir(numNext > numCur ? 1 : -1);
    setExiting(true);
    setTimeout(() => {
      setStep(nextStep);
      setExiting(false);
      const prev = typeof nextStep === 'number' && nextStep > 1 ? (nextStep - 1) as OBStep : null;
      setJustCompleted(prev);
      setTimeout(() => { setAnimating(false); setJustCompleted(null); }, 500);
    }, 280);
  }, [animating, step]);

  const handleFinish = () => {
    if (wizardExiting) return;
    setWizardExiting(true);
    setTimeout(onComplete, 550);
  };

  const handleSkipConfirm = () => {
    if (wizardExiting) return;
    setWizardExiting(true);
    setTimeout(onSkip, 550);
  };

  const progress = step === 'uni_setup' || step === 'uni_done'
    ? 0
    : ((step as number) - 1) / 4 * 100;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10100,
      background: bg, overflow: 'auto',
      animation: wizardExiting
        ? 'ob-exit 550ms cubic-bezier(0.4,0,1,1) forwards'
        : 'ob-enter 550ms cubic-bezier(0,0,0.2,1) both',
    }}>
      <style>{`
        @keyframes ob-enter        { from{transform:translateY(100%) scale(0.97);opacity:0;filter:blur(8px)} to{transform:translateY(0) scale(1);opacity:1;filter:blur(0)} }
        @keyframes ob-exit         { from{transform:translateY(0) scale(1);opacity:1;filter:blur(0)} to{transform:translateY(100%) scale(0.97);opacity:0;filter:blur(8px)} }
        @keyframes ob-out-fwd      { from{transform:translateX(0) scale(1);opacity:1;filter:blur(0)} to{transform:translateX(-80px) scale(0.96);opacity:0;filter:blur(4px)} }
        @keyframes ob-out-bwd      { from{transform:translateX(0) scale(1);opacity:1;filter:blur(0)} to{transform:translateX(80px) scale(0.96);opacity:0;filter:blur(4px)} }
        @keyframes ob-in-fwd       { from{transform:translateX(80px) scale(0.96);opacity:0;filter:blur(4px)} to{transform:translateX(0) scale(1);opacity:1;filter:blur(0)} }
        @keyframes ob-in-bwd       { from{transform:translateX(-80px) scale(0.96);opacity:0;filter:blur(4px)} to{transform:translateX(0) scale(1);opacity:1;filter:blur(0)} }
        @keyframes ob-dot-pop      { 0%{transform:scale(1)} 40%{transform:scale(1.4)} 70%{transform:scale(0.9)} 100%{transform:scale(1)} }
        @keyframes ob-pulse-ring   { 0%{box-shadow:0 0 0 0 rgba(99,102,241,.7)} 70%{box-shadow:0 0 0 10px rgba(99,102,241,0)} 100%{box-shadow:0 0 0 0 rgba(99,102,241,0)} }
        @keyframes ob-shake        { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-10px)} 30%{transform:translateX(10px)} 45%{transform:translateX(-8px)} 60%{transform:translateX(8px)} 75%{transform:translateX(-5px)} 90%{transform:translateX(5px)} }
        @keyframes ob-fade-up      { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes ob-orb-float    { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(20px,-28px) scale(1.06)} 66%{transform:translate(-18px,20px) scale(0.95)} }
        @keyframes ob-confetti     { 0%{transform:translateY(-30px) rotate(0deg);opacity:1} 100%{transform:translateY(115vh) rotate(800deg);opacity:0} }
        @keyframes ob-bubble-in    { from{transform:translateX(-24px) scale(0.9);opacity:0} to{transform:translateX(0) scale(1);opacity:1} }
        @keyframes ob-mascot-bob   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes ob-check-circle { from{stroke-dashoffset:289} to{stroke-dashoffset:0} }
        @keyframes ob-check-mark   { from{stroke-dashoffset:60}  to{stroke-dashoffset:0} }
        @keyframes ob-check-bounce { 0%{transform:scale(0.8)} 50%{transform:scale(1.15)} 75%{transform:scale(0.95)} 100%{transform:scale(1)} }
        @keyframes ob-btn-shimmer  { 0%{background-position:200% center} 100%{background-position:-200% center} }
        @keyframes ob-badge-in     { from{transform:translateX(-16px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes ob-progress-fill{ from{width:var(--from)} to{width:var(--to)} }
        @keyframes ob-glow-border  { 0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,.0),0 8px 32px rgba(0,0,0,.12)} 50%{box-shadow:0 0 0 3px rgba(99,102,241,.25),0 8px 32px rgba(0,0,0,.18)} }
        @keyframes ob-field-in     { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes ob-bg-shift     { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }

        .ob-btn-primary {
          background: linear-gradient(135deg,#6366f1,#8b5cf6,#6366f1);
          background-size: 200% auto;
          transition: transform 120ms, box-shadow 200ms, background-position 600ms;
        }
        .ob-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.01);
          box-shadow: 0 6px 24px rgba(99,102,241,0.45);
          background-position: right center;
        }
        .ob-btn-primary:active:not(:disabled) {
          transform: scale(0.97);
        }
        .ob-btn-ghost:hover { opacity: 0.75; }
        .ob-input:focus { outline: none; }
      `}</style>

      {/* Animated background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: dark
          ? 'linear-gradient(135deg,#0b0c1a 0%,#12103a 40%,#0b1a2a 100%)'
          : 'linear-gradient(135deg,#eef2ff 0%,#f5f0ff 50%,#e0f2fe 100%)',
        backgroundSize: '400% 400%',
        animation: 'ob-bg-shift 16s ease infinite',
      }} />

      {/* Glow orbs */}
      {[
        { size: 500, color: dark ? '#6366f1' : '#a5b4fc', top: '-8%',  left: '-8%',  dur: '14s', delay: '0s',  opacity: dark ? 0.18 : 0.35 },
        { size: 400, color: dark ? '#8b5cf6' : '#c4b5fd', top: '60%',  left: '65%',  dur: '19s', delay: '-7s', opacity: dark ? 0.14 : 0.28 },
        { size: 340, color: dark ? '#3b82f6' : '#bae6fd', top: '35%',  left: '42%',  dur: '23s', delay: '-11s',opacity: dark ? 0.10 : 0.20 },
      ].map((o, i) => (
        <div key={i} style={{
          position: 'fixed', borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
          width: o.size, height: o.size, background: o.color,
          opacity: o.opacity, filter: 'blur(90px)',
          top: o.top, left: o.left,
          animation: `ob-orb-float ${o.dur} ease-in-out infinite`,
          animationDelay: o.delay,
        }} />
      ))}

      {/* Confetti */}
      {step === 4 && CONFETTI.map((c, i) => (
        <div key={i} style={{
          position: 'fixed', top: 0, left: c.left, zIndex: 10101, pointerEvents: 'none',
          width: c.size, height: c.isCircle ? c.size : c.size * 0.4,
          borderRadius: c.isCircle ? '50%' : 3,
          background: c.color,
          animation: `ob-confetti ${c.duration} ease-in ${c.delay} both`,
        }} />
      ))}

      {/* Main container */}
      <div style={{
        maxWidth: 600, margin: '0 auto', minHeight: '100vh',
        display: 'flex', flexDirection: 'column', padding: '0 18px',
        position: 'relative', zIndex: 1,
      }}>
        {/* Header */}
        <div style={{
          height: 68, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{
            fontWeight: 900, fontSize: 21, letterSpacing: -0.8,
            background: 'linear-gradient(135deg,#6366f1,#a78bfa)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            🐱 FlamboyAI
          </div>
          {typeof step === 'number' && step > 0 && step < 4 && (
            <button className="ob-btn-ghost" onClick={() => setShowSkipConfirm(true)} style={{
              background: 'none', border: 'none', color: muted,
              cursor: 'pointer', fontSize: 13, padding: '6px 10px', transition: 'opacity 150ms',
            }}>
              এখন না →
            </button>
          )}
        </div>

        {/* Progress stepper — only show for business flow steps 1-5 */}
        <div style={{ paddingBottom: 32, flexShrink: 0, display: (step === 'uni_setup' || step === 'uni_done') ? 'none' : undefined }}>
          {/* Line bar */}
          <div style={{ position: 'relative', height: 4, borderRadius: 4, background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', marginBottom: 20 }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg,#6366f1,#8b5cf6,#a78bfa)',
              width: `${progress}%`,
              transition: 'width 500ms cubic-bezier(0.34,1.56,0.64,1)',
              boxShadow: '0 0 10px rgba(99,102,241,0.5)',
            }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {STEP_CONFIG.map((cfg, i) => {
              const s = (i + 1) as OBStep;
              const stepNum = typeof step === 'number' ? step : 0;
              const completed = stepNum > (s as number);
              const active = step === s;
              const popped = justCompleted === s;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: completed ? 16 : 15, fontWeight: 700,
                    background: completed
                      ? 'linear-gradient(135deg,#6366f1,#8b5cf6)'
                      : active
                        ? (dark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.1)')
                        : (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
                    border: `2px solid ${active || completed ? accent : border}`,
                    color: completed ? '#fff' : active ? accent : muted,
                    animation: popped ? 'ob-dot-pop 450ms cubic-bezier(0.34,1.56,0.64,1)'
                      : active ? 'ob-pulse-ring 2s ease-in-out infinite' : 'none',
                    transition: 'background 350ms, border-color 350ms, color 350ms',
                    boxShadow: active ? `0 0 0 5px ${dark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)'}` : 'none',
                  }}>
                    {completed ? '✓' : cfg.icon}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: active || completed ? 700 : 400,
                    color: active ? accent : completed ? accent : muted,
                    whiteSpace: 'nowrap',
                    transition: 'color 300ms',
                  }}>
                    {cfg.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step card */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', paddingBottom: 96 }}>
          <div style={{
            width: '100%',
            background: panel,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: `1px solid ${border}`,
            padding: '28px 24px',
            boxShadow: dark
              ? '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)'
              : '0 8px 40px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.8)',
            animation: exiting
              ? (dir === 1 ? 'ob-out-fwd 280ms cubic-bezier(0.4,0,1,1) forwards' : 'ob-out-bwd 280ms cubic-bezier(0.4,0,1,1) forwards')
              : (dir === 1 ? 'ob-in-fwd 350ms cubic-bezier(0,0,0.2,1) forwards' : 'ob-in-bwd 350ms cubic-bezier(0,0,0.2,1) forwards'),
          }}>
            {step === 'uni_setup' && (
              <StepUniversitySetup
                dark={dark} border={border} text={text} muted={muted} accent={accent}
                activePage={activePage} request={request}
                onDone={() => advanceStep('uni_done')}
                onSkip={() => advanceStep('uni_done')}
              />
            )}
            {step === 'uni_done' && (
              <StepUniversityDone
                text={text} muted={muted}
                onFinish={handleFinish}
              />
            )}
            {step === 1 && (
              <Step1BusinessProfile
                dark={dark} border={border} text={text} muted={muted} accent={accent}
                activePage={activePage} userName={user.name}
                onSaved={() => { setPageConnected(true); advanceStep(2); }}
                onSkip={() => advanceStep(2)}
                request={request}
              />
            )}
            {step === 2 && (
              <Step2AddProduct
                dark={dark} border={border} text={text} muted={muted}
                accent={accent} accentSoft={accentSoft}
                activePage={activePage}
                onAdded={() => { setProductAdded(true); advanceStep(3); }}
                onSkip={() => { setProductSkipped(true); advanceStep(3); }}
              />
            )}
            {step === 3 && (
              <Step3BotConfig
                dark={dark} border={border} text={text} muted={muted} accent={accent}
                activePage={activePage}
                onSaved={() => { setBotSaved(true); advanceStep(4); }}
                onSkip={() => advanceStep(4)}
                request={request}
              />
            )}
            {step === 4 && (
              <Step4PaymentSetup
                dark={dark} border={border} text={text} muted={muted} accent={accent}
                activePage={activePage}
                request={request}
                onSaved={() => advanceStep(5)}
                onSkip={() => advanceStep(5)}
              />
            )}
            {step === 5 && (
              <Step5Complete
                dark={dark} text={text} muted={muted} accent={accent} accentSoft={accentSoft}
                pageConnected={pageConnected}
                productAdded={productAdded}
                productSkipped={productSkipped}
                botSaved={botSaved}
                onFinish={handleFinish}
              />
            )}
          </div>
        </div>
      </div>

      {/* Mascot */}
      {typeof step === 'number' && step >= 1 && step < 5 && (
        <div style={{
          position: 'fixed', bottom: 24, left: 20, zIndex: 10102,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
          maxWidth: 220,
        }}>
          <div key={step} style={{
            background: panel,
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${border}`,
            borderRadius: '14px 14px 14px 3px',
            padding: '10px 14px',
            fontSize: 12.5, color: text, lineHeight: 1.55,
            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
            animation: 'ob-bubble-in 400ms cubic-bezier(0.34,1.56,0.64,1) both',
            whiteSpace: 'pre-line',
          }}>
            {STEP_CONFIG[(step as number) - 1].mascot}
          </div>
          <div style={{
            fontSize: 30, paddingLeft: 10,
            animation: 'ob-mascot-bob 2.4s ease-in-out infinite',
            display: 'inline-block',
          }}>
            🤖
          </div>
        </div>
      )}

      {/* Skip confirm */}
      {showSkipConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10103, animation: 'ob-fade-up 200ms ease both',
        }}>
          <div style={{
            background: dark ? '#1a1b2e' : '#fff',
            borderRadius: 18, padding: 30,
            maxWidth: 360, width: '90%',
            boxShadow: '0 16px 60px rgba(0,0,0,0.35)',
            border: `1px solid ${border}`,
            animation: 'ob-fade-up 250ms cubic-bezier(0.34,1.56,0.64,1) both',
          }}>
            <div style={{ fontSize: 30, textAlign: 'center', marginBottom: 14 }}>⏭️</div>
            <p style={{ color: text, lineHeight: 1.6, marginBottom: 8, fontWeight: 700, fontSize: 16 }}>
              Onboarding এড়িয়ে যাবেন?
            </p>
            <p style={{ color: muted, fontSize: 13.5, lineHeight: 1.6, marginBottom: 26 }}>
              আপনি পরে Settings থেকে সব সেট করতে পারবেন।
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowSkipConfirm(false)} style={{
                flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5,
                background: 'none', border: `1.5px solid ${border}`, color: text, fontWeight: 600,
                transition: 'opacity 150ms',
              }}>
                বাতিল
              </button>
              <button onClick={handleSkipConfirm} style={{
                flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5,
                background: 'rgba(239,68,68,0.1)', border: '1.5px solid rgba(239,68,68,0.4)',
                color: '#ef4444', fontWeight: 700,
                transition: 'background 200ms',
              }}>
                এড়িয়ে যান
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function inputStyle(dark: boolean, border: string, accent: string, text: string, focused: boolean): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 14px', borderRadius: 11, fontSize: 14,
    background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    border: `1.5px solid ${focused ? accent : border}`,
    color: text, outline: 'none',
    boxShadow: focused ? `0 0 0 4px rgba(99,102,241,0.16), 0 1px 4px rgba(99,102,241,0.1)` : 'none',
    transition: 'border-color 200ms, box-shadow 200ms',
  };
}

function PrimaryBtn({ onClick, disabled, loading, children }: {
  onClick: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      className="ob-btn-primary"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%', padding: '13px',
        background: (disabled || loading) ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        border: 'none', borderRadius: 12, color: '#fff',
        fontWeight: 700, fontSize: 15,
        cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
        letterSpacing: 0.2,
        opacity: (disabled || loading) ? 0.7 : 1,
      }}
    >
      {loading ? '...' : children}
    </button>
  );
}

function SkipBtn({ onClick, muted }: { onClick: () => void; muted: string }) {
  return (
    <div style={{ textAlign: 'right', marginTop: 14 }}>
      <button className="ob-btn-ghost" onClick={onClick} style={{
        background: 'none', border: 'none', color: muted,
        cursor: 'pointer', fontSize: 13, transition: 'opacity 150ms',
      }}>
        এখন না, পরে করব →
      </button>
    </div>
  );
}

function FieldLabel({ children, muted }: { children: React.ReactNode; muted: string }) {
  return (
    <label style={{ fontSize: 12.5, color: muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

// ─── Step 1: Business Profile ─────────────────────────────────────────────────

function Step1BusinessProfile({ dark, border, text, muted, accent, activePage, userName, onSaved, onSkip, request }: any) {
  const [businessName,      setBusinessName]      = useState(userName || '');
  const [businessPhone,     setBusinessPhone]     = useState('');
  const [websiteUrl,        setWebsiteUrl]        = useState('');
  const [productCodePrefix, setProductCodePrefix] = useState('DF');
  const [saveStatus,        setSaveStatus]        = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [f1, setF1] = useState(false);
  const [f2, setF2] = useState(false);
  const [f3, setF3] = useState(false);
  const [f4, setF4] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = async (name: string, phone: string, website: string, prefix: string) => {
    if (!name.trim()) return;
    setSaveStatus('saving');
    try {
      await request(`${API_BASE}/client-dashboard/${activePage.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          businessName: name.trim(),
          businessPhone: phone.trim(),
          websiteUrl: website.trim(),
          productCodePrefix: prefix.trim() || 'DF',
        }),
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch { setSaveStatus('error'); }
  };

  const scheduleAutoSave = (name: string, phone: string, website: string, prefix: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSave(name, phone, website, prefix), 800);
  };

  const handleNext = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await doSave(businessName, businessPhone, websiteUrl, productCodePrefix);
    onSaved();
  };

  const statusLabel = saveStatus === 'saving' ? '💾 সেভ হচ্ছে...'
    : saveStatus === 'saved' ? '✓ সেভ হয়েছে'
    : saveStatus === 'error' ? '⚠️ সেভ হয়নি' : '';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 32 }}>🏪</div>
        {statusLabel && (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
            background: saveStatus === 'saved' ? 'rgba(34,197,94,0.12)' : saveStatus === 'error' ? 'rgba(239,68,68,0.12)' : 'transparent',
            color: saveStatus === 'saved' ? '#22c55e' : saveStatus === 'error' ? '#ef4444' : muted,
            animation: 'ob-fade-up 200ms ease',
          }}>{statusLabel}</span>
        )}
      </div>
      <h2 style={{ fontSize: 23, fontWeight: 900, color: text, margin: '0 0 6px', letterSpacing: -0.5 }}>
        ব্যবসার প্রোফাইল সেট করুন
      </h2>
      <p style={{ color: muted, fontSize: 14, marginBottom: 26, lineHeight: 1.65 }}>
        আপনার ব্যবসার তথ্য দিন — বট এটি ব্যবহার করে কাস্টমারকে সাহায্য করবে।
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14,
          animation: 'ob-field-in 350ms ease 50ms both' }}>
          <div>
            <FieldLabel muted={muted}>ব্যবসার নাম *</FieldLabel>
            <input value={businessName} className="ob-input"
              onChange={e => { setBusinessName(e.target.value); scheduleAutoSave(e.target.value, businessPhone, websiteUrl, productCodePrefix); }}
              onFocus={() => setF1(true)} onBlur={() => setF1(false)}
              placeholder="যেমন: Rina Fashion House"
              style={inputStyle(dark, border, accent, text, f1)} />
          </div>
          <div>
            <FieldLabel muted={muted}>ফোন নম্বর</FieldLabel>
            <input value={businessPhone} className="ob-input"
              onChange={e => { setBusinessPhone(e.target.value); scheduleAutoSave(businessName, e.target.value, websiteUrl, productCodePrefix); }}
              onFocus={() => setF2(true)} onBlur={() => setF2(false)}
              placeholder="01XXXXXXXXX"
              style={inputStyle(dark, border, accent, text, f2)} />
          </div>
        </div>

        <div style={{ animation: 'ob-field-in 350ms ease 120ms both' }}>
          <FieldLabel muted={muted}>ওয়েবসাইট / ক্যাটালগ URL (ঐচ্ছিক)</FieldLabel>
          <input value={websiteUrl} className="ob-input"
            onChange={e => { setWebsiteUrl(e.target.value); scheduleAutoSave(businessName, businessPhone, e.target.value, productCodePrefix); }}
            onFocus={() => setF3(true)} onBlur={() => setF3(false)}
            placeholder="https://example.com/catalog"
            style={inputStyle(dark, border, accent, text, f3)} />
        </div>

        <div style={{ animation: 'ob-field-in 350ms ease 190ms both' }}>
          <FieldLabel muted={muted}>
            Product Code Prefix{' '}
            <span style={{ fontWeight: 400 }}>— পণ্য কোডের শুরুর অক্ষর</span>
          </FieldLabel>
          <input value={productCodePrefix} className="ob-input"
            onChange={e => { const v = e.target.value.toUpperCase(); setProductCodePrefix(v); scheduleAutoSave(businessName, businessPhone, websiteUrl, v); }}
            onFocus={() => setF4(true)} onBlur={() => setF4(false)}
            placeholder="DF" maxLength={6}
            style={{ ...inputStyle(dark, border, accent, text, f4), width: 110 }} />
          <div style={{ fontSize: 11.5, color: muted, marginTop: 5 }}>
            উদাহরণ: prefix "DF" হলে কোড হবে DF01, DF02…
          </div>
        </div>

        <div style={{ animation: 'ob-field-in 350ms ease 260ms both' }}>
          <PrimaryBtn onClick={handleNext} disabled={!businessName.trim()} loading={saveStatus === 'saving'}>
            পরবর্তী →
          </PrimaryBtn>
        </div>
      </div>

      <SkipBtn onClick={onSkip} muted={muted} />
    </div>
  );
}

// ─── Step 2: Add First Product ────────────────────────────────────────────────

function Step2AddProduct({ dark, border, text, muted, accent, accentSoft, activePage, onAdded, onSkip }: any) {
  const [name,      setName]      = useState('');
  const [price,     setPrice]     = useState('');
  const [code,      setCode]      = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl,setPreviewUrl]= useState('');
  const [dragOver,  setDragOver]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [shake,     setShake]     = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [error,     setError]     = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [f1, setF1] = useState(false);
  const [f2, setF2] = useState(false);
  const [f3, setF3] = useState(false);

  const handleFile = (file?: File | null) => {
    if (!file) return;
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !price.trim()) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return;
    }
    setLoading(true); setError('');
    try {
      const token = localStorage.getItem('dfbot_token') || '';
      // Step 1: upload image if provided
      let imageUrl = '';
      if (imageFile) {
        const imgFd = new FormData();
        imgFd.append('file', imageFile);
        const imgRes = await fetch(`${API_BASE}/pages/${activePage.id}/products/upload-image`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: imgFd,
        });
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          imageUrl = imgData.url || imgData.imageUrl || '';
        }
      }
      // Step 2: create product with JSON
      const productBody: any = { pageId: activePage.id, name: name.trim(), price: Number(price.trim()) };
      if (code.trim()) productBody.code = code.trim();
      if (imageUrl) productBody.imageUrl = imageUrl;
      const res = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(productBody),
      });
      if (!res.ok) throw new Error('সংযোগ সমস্যা');
      setSuccess(true);
      setTimeout(onAdded, 1600);
    } catch (e: any) {
      setError(e?.message || 'কিছু একটা ভুল হয়েছে।');
    } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🛍️</div>
      <h2 style={{ fontSize: 23, fontWeight: 900, color: text, margin: '0 0 6px', letterSpacing: -0.5 }}>
        প্রথম পণ্য যোগ করুন
      </h2>
      <p style={{ color: muted, fontSize: 14, marginBottom: 26, lineHeight: 1.65 }}>
        আপনার একটি পণ্যের তথ্য দিন — পরে আরো যোগ করতে পারবেন।
      </p>

      {success ? (
        <div style={{
          animation: 'ob-badge-in 500ms cubic-bezier(0.34,1.56,0.64,1) both',
          background: accentSoft, borderRadius: 16, padding: '18px 20px',
          display: 'flex', gap: 16, alignItems: 'center',
          border: `1px solid rgba(99,102,241,0.2)`,
        }}>
          {previewUrl && (
            <img src={previewUrl} style={{
              width: 58, height: 58, borderRadius: 12, objectFit: 'cover',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }} alt="" />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: text, fontSize: 15 }}>{name}</div>
            <div style={{ color: '#22c55e', fontWeight: 600, marginTop: 4, fontSize: 14 }}>৳{price}</div>
          </div>
          <div style={{
            color: '#22c55e', fontWeight: 800, fontSize: 14,
            background: 'rgba(34,197,94,0.12)', borderRadius: 20, padding: '5px 12px',
          }}>✓ যোগ হয়েছে</div>
        </div>
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 16,
          animation: shake ? 'ob-shake 500ms ease' : 'none',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14,
            animation: 'ob-field-in 350ms ease 50ms both' }}>
            <div>
              <FieldLabel muted={muted}>পণ্যের নাম *</FieldLabel>
              <input value={name} className="ob-input"
                onChange={e => setName(e.target.value)}
                onFocus={() => setF1(true)} onBlur={() => setF1(false)}
                placeholder="যেমন: কটন শার্ট"
                style={inputStyle(dark, border, accent, text, f1)} />
            </div>
            <div>
              <FieldLabel muted={muted}>মূল্য ৳ *</FieldLabel>
              <input value={price} className="ob-input" type="number"
                onChange={e => setPrice(e.target.value)}
                onFocus={() => setF2(true)} onBlur={() => setF2(false)}
                placeholder="৫৫০"
                style={inputStyle(dark, border, accent, text, f2)} />
            </div>
          </div>

          <div style={{ animation: 'ob-field-in 350ms ease 120ms both' }}>
            <FieldLabel muted={muted}>পণ্য কোড (ঐচ্ছিক)</FieldLabel>
            <input value={code} className="ob-input"
              onChange={e => setCode(e.target.value)}
              onFocus={() => setF3(true)} onBlur={() => setF3(false)}
              placeholder="যেমন: SHIRT-01"
              style={inputStyle(dark, border, accent, text, f3)} />
          </div>

          <div style={{ animation: 'ob-field-in 350ms ease 190ms both' }}>
            <FieldLabel muted={muted}>ছবি (ঐচ্ছিক)</FieldLabel>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? accent : border}`,
                borderRadius: 14, cursor: 'pointer',
                padding: previewUrl ? '12px' : '32px 16px', textAlign: 'center',
                background: dragOver ? 'rgba(99,102,241,0.1)' : 'transparent',
                transition: 'all 220ms cubic-bezier(0.34,1.56,0.64,1)',
                transform: dragOver ? 'scale(1.01)' : 'scale(1)',
              }}
            >
              {previewUrl ? (
                <img src={previewUrl}
                  style={{ maxHeight: 90, maxWidth: '100%', borderRadius: 10, animation: 'ob-fade-up 300ms ease' }}
                  alt="preview" />
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                  <div style={{ color: muted, fontSize: 13 }}>ছবি টেনে আনুন বা ক্লিক করুন</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          {error && (
            <div style={{ color: '#ef4444', fontSize: 13, animation: 'ob-fade-up 200ms ease',
              background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '8px 12px' }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ animation: 'ob-field-in 350ms ease 260ms both' }}>
            <PrimaryBtn onClick={handleSubmit} loading={loading}>
              পণ্য যোগ করুন →
            </PrimaryBtn>
          </div>
        </div>
      )}

      <SkipBtn onClick={onSkip} muted={muted} />
    </div>
  );
}

// ─── Step 3: Bot Configuration ────────────────────────────────────────────────

function Step3BotConfig({ dark, border, text, muted, accent, activePage, onSaved, onSkip, request }: any) {
  const [automationOn, setAutomationOn] = useState(true);
  const [orderModeOn,  setOrderModeOn]  = useState(true);
  const [infoModeOn,   setInfoModeOn]   = useState(true);
  const [isDigital,    setIsDigital]    = useState(false);
  const [dhakaCharge,  setDhakaCharge]  = useState('60');
  const [outsideCharge,setOutsideCharge]= useState('120');
  const [saveStatus,   setSaveStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [f1, setF1] = useState(false);
  const [f2, setF2] = useState(false);
  const deliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveModes = async (auto: boolean, order: boolean, info: boolean) => {
    setSaveStatus('saving');
    try {
      await request(`${API_BASE}/client-dashboard/${activePage.id}/modes`, {
        method: 'PATCH',
        body: JSON.stringify({ automationOn: auto, orderModeOn: order, infoModeOn: info }),
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch { setSaveStatus('error'); }
  };

  const saveDelivery = async (digital: boolean, dhaka: string, outside: string) => {
    setSaveStatus('saving');
    try {
      await request(`${API_BASE}/client-dashboard/${activePage.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          deliveryFeeInsideDhaka:  digital ? 0 : (Number(dhaka)   || 60),
          deliveryFeeOutsideDhaka: digital ? 0 : (Number(outside) || 120),
        }),
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch { setSaveStatus('error'); }
  };

  const scheduleDeliverySave = (digital: boolean, dhaka: string, outside: string) => {
    if (deliveryTimerRef.current) clearTimeout(deliveryTimerRef.current);
    deliveryTimerRef.current = setTimeout(() => saveDelivery(digital, dhaka, outside), 800);
  };

  const handleToggle = (key: 'auto' | 'order' | 'info', val: boolean) => {
    if (key === 'auto') setAutomationOn(val);
    if (key === 'order') setOrderModeOn(val);
    if (key === 'info') setInfoModeOn(val);
    const next = {
      auto: key === 'auto' ? val : automationOn,
      order: key === 'order' ? val : orderModeOn,
      info: key === 'info' ? val : infoModeOn,
    };
    saveModes(next.auto, next.order, next.info);
  };

  const handleDigitalToggle = (val: boolean) => {
    setIsDigital(val);
    scheduleDeliverySave(val, dhakaCharge, outsideCharge);
  };

  const handleNext = async () => {
    if (deliveryTimerRef.current) clearTimeout(deliveryTimerRef.current);
    await saveDelivery(isDigital, dhakaCharge, outsideCharge);
    onSaved();
  };

  const statusLabel = saveStatus === 'saving' ? '💾 সেভ হচ্ছে...'
    : saveStatus === 'saved' ? '✓ সেভ হয়েছে'
    : saveStatus === 'error' ? '⚠️ সেভ হয়নি' : '';

  const ToggleRow = ({ label, sub, value, onChange, delay }: {
    label: string; sub: string; value: boolean; onChange: (v: boolean) => void; delay: string;
  }) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      borderRadius: 13, padding: '13px 16px',
      border: `1px solid ${value ? 'rgba(99,102,241,0.25)' : border}`,
      transition: 'border-color 300ms, background 300ms',
      animation: `ob-field-in 350ms ease ${delay} both`,
    }}>
      <div>
        <div style={{ fontWeight: 600, color: text, fontSize: 14 }}>{label}</div>
        <div style={{ color: value ? '#22c55e' : muted, fontSize: 12.5, marginTop: 2, transition: 'color 300ms' }}>{sub}</div>
      </div>
      <div onClick={() => onChange(!value)} style={{
        width: 54, height: 30, borderRadius: 15, cursor: 'pointer', flexShrink: 0, position: 'relative',
        background: value ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : (dark ? '#333' : '#d1d5db'),
        transition: 'background 300ms',
        boxShadow: value ? '0 0 12px rgba(99,102,241,0.4)' : 'none',
      }}>
        <div style={{
          position: 'absolute', top: 4, left: value ? 28 : 4,
          width: 22, height: 22, borderRadius: '50%',
          background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          transition: 'left 260ms cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 32 }}>🤖</div>
        {statusLabel && (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
            background: saveStatus === 'saved' ? 'rgba(34,197,94,0.12)' : 'transparent',
            color: saveStatus === 'saved' ? '#22c55e' : saveStatus === 'error' ? '#ef4444' : muted,
            animation: 'ob-fade-up 200ms ease',
          }}>{statusLabel}</span>
        )}
      </div>
      <h2 style={{ fontSize: 23, fontWeight: 900, color: text, margin: '0 0 6px', letterSpacing: -0.5 }}>
        বট কনফিগারেশন
      </h2>
      <p style={{ color: muted, fontSize: 14, marginBottom: 24, lineHeight: 1.65 }}>
        বটের mode ও ডেলিভারি চার্জ সেট করুন।
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ToggleRow label="Bot Automation" sub={automationOn ? '● বট চালু' : '○ বট বন্ধ'} value={automationOn} onChange={v => handleToggle('auto', v)} delay="50ms" />
        <ToggleRow label="Order Mode"     sub={orderModeOn  ? '● কাস্টমার থেকে order নেবে' : '○ Order নেবে না'} value={orderModeOn} onChange={v => handleToggle('order', v)} delay="110ms" />
        <ToggleRow label="Info Mode"      sub={infoModeOn   ? '● Product code দিলে তথ্য দেবে' : '○ Product info দেবে না'} value={infoModeOn} onChange={v => handleToggle('info', v)} delay="170ms" />

        <div style={{ marginTop: 4, animation: 'ob-field-in 350ms ease 230ms both' }}>
          <div style={{ fontSize: 12.5, color: muted, fontWeight: 600, marginBottom: 8 }}>ডেলিভারি টাইপ</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { val: false, label: '🚚 ফিজিক্যাল পণ্য',       sub: 'ডেলিভারি চার্জ আছে' },
              { val: true,  label: '💻 ডিজিটাল / সার্ভিস', sub: 'কোনো ডেলিভারি নেই' },
            ].map(opt => (
              <div key={String(opt.val)} onClick={() => handleDigitalToggle(opt.val)} style={{
                flex: 1, padding: '13px 14px', borderRadius: 13, cursor: 'pointer',
                border: `2px solid ${isDigital === opt.val ? accent : border}`,
                background: isDigital === opt.val
                  ? (dark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)')
                  : 'transparent',
                transition: 'all 220ms cubic-bezier(0.34,1.56,0.64,1)',
                transform: isDigital === opt.val ? 'scale(1.01)' : 'scale(1)',
                boxShadow: isDigital === opt.val ? '0 0 0 4px rgba(99,102,241,0.1)' : 'none',
              }}>
                <div style={{ fontWeight: 700, color: text, fontSize: 13 }}>{opt.label}</div>
                <div style={{ color: muted, fontSize: 11.5, marginTop: 3 }}>{opt.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {!isDigital && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, animation: 'ob-field-in 300ms ease both' }}>
            <div>
              <FieldLabel muted={muted}>ডেলিভারি ঢাকা ৳</FieldLabel>
              <input value={dhakaCharge} className="ob-input" type="number"
                onChange={e => { setDhakaCharge(e.target.value); scheduleDeliverySave(isDigital, e.target.value, outsideCharge); }}
                onFocus={() => setF1(true)} onBlur={() => setF1(false)}
                placeholder="60" style={inputStyle(dark, border, accent, text, f1)} />
            </div>
            <div>
              <FieldLabel muted={muted}>ডেলিভারি ঢাকার বাইরে ৳</FieldLabel>
              <input value={outsideCharge} className="ob-input" type="number"
                onChange={e => { setOutsideCharge(e.target.value); scheduleDeliverySave(isDigital, dhakaCharge, e.target.value); }}
                onFocus={() => setF2(true)} onBlur={() => setF2(false)}
                placeholder="120" style={inputStyle(dark, border, accent, text, f2)} />
            </div>
          </div>
        )}

        <div style={{ marginTop: 4, animation: 'ob-field-in 350ms ease 290ms both' }}>
          <PrimaryBtn onClick={handleNext} loading={saveStatus === 'saving'}>
            সম্পন্ন করুন →
          </PrimaryBtn>
        </div>
      </div>

      <SkipBtn onClick={onSkip} muted={muted} />
    </div>
  );
}

// ─── Step 4: Payment Setup ────────────────────────────────────────────────────

const PAYMENT_OPTIONS = [
  {
    key: 'bkash',
    icon: '📱',
    title: 'bKash Merchant (Direct)',
    badge: 'RECOMMENDED',
    badgeColor: '#22c55e',
    description: 'আপনার bKash merchant account থাকলে — customer Transaction ID দিলে bot automatically verify করবে।',
    flow: 'Customer TxID দেয় → Bot bKash API-তে verify করে → Order auto-confirm ✅',
    steps: [
      { num: '১', title: 'bKash Merchant Account খুলুন', detail: 'bKash-এর website (merchant.bkash.com) বা নিকটবর্তী bKash agent point-এ গিয়ে Merchant Account-এর জন্য আবেদন করুন। Trade License ও NID লাগবে।' },
      { num: '২', title: 'Developer Portal-এ যান', detail: 'developer.bkash.com এ login করুন। "My Apps" → "Create New App" click করুন।' },
      { num: '৩', title: 'App তৈরি করুন', detail: 'App Name দিন (যেমন: MyShop Payment), Environment হিসেবে "Sandbox" (test) বা "Production" (live) বেছে নিন।' },
      { num: '৪', title: 'Credentials কপি করুন', detail: 'App তৈরি হলে App Key, App Secret পাবেন। Username ও Password হবে আপনার merchant portal login credential।' },
    ],
    fields: [
      { key: 'app_key', label: 'App Key', ph: 'bKash App Key', where: 'developer.bkash.com → My Apps → আপনার App' },
      { key: 'app_secret', label: 'App Secret', ph: 'bKash App Secret', where: 'developer.bkash.com → My Apps → আপনার App' },
      { key: 'username', label: 'Username', ph: 'Merchant Portal Username', where: 'merchant.bkash.com এর login username' },
      { key: 'password', label: 'Password', ph: 'Merchant Portal Password', where: 'merchant.bkash.com এর login password', secret: true },
    ],
  },
  {
    key: 'nagad',
    icon: '💰',
    title: 'Nagad Merchant (Direct)',
    badge: null,
    badgeColor: '',
    description: 'Nagad merchant account থাকলে — customer Transaction ID দিলে bot automatically verify করবে।',
    flow: 'Customer TxID দেয় → Bot Nagad API-তে verify করে → Order auto-confirm ✅',
    steps: [
      { num: '১', title: 'Nagad Merchant Account খুলুন', detail: 'nagad.com.bd/merchant অথবা Nagad helpline 16167-তে যোগাযোগ করুন। Trade License ও NID দিয়ে merchant account এর জন্য apply করুন।' },
      { num: '২', title: 'Merchant Dashboard-এ login করুন', detail: 'merchant.nagad.com.bd এ আপনার credentials দিয়ে login করুন।' },
      { num: '৩', title: 'API Credentials নিন', detail: '"Developer Tools" বা "API Settings" সেকশনে যান। Merchant ID এবং API Key দেখতে পাবেন।' },
    ],
    fields: [
      { key: 'merchant_id', label: 'Merchant ID', ph: 'Nagad Merchant ID', where: 'merchant.nagad.com.bd → API Settings' },
      { key: 'api_key', label: 'API Key', ph: 'Nagad API Key', where: 'merchant.nagad.com.bd → Developer Tools', secret: true },
    ],
  },
  {
    key: 'sslcommerz',
    icon: '🌐',
    title: 'SSLCommerz Gateway',
    badge: 'POPULAR',
    badgeColor: '#3b82f6',
    description: 'নিজস্ব merchant account নেই? SSLCommerz দিয়ে বিকাশ/নগদ/কার্ড সব একসাথে accept করুন। Bot payment link পাঠাবে।',
    flow: 'Bot payment link পাঠায় → Customer link-এ click করে pay করে (bKash/Nagad/Card) → Order auto-confirm ✅',
    steps: [
      { num: '১', title: 'SSLCommerz-এ account খুলুন', detail: 'sslcommerz.com → "Join Now" click করুন। ব্যবসার তথ্য, Trade License, Bank Account নম্বর দিয়ে registration করুন।' },
      { num: '২', title: 'Verification এর জন্য অপেক্ষা করুন', detail: 'SSLCommerz টিম ২-৩ কার্যদিবসে আপনার account verify করবে। Sandbox (test) account তাৎক্ষণিক পাবেন।' },
      { num: '৩', title: 'Merchant Panel-এ login করুন', detail: 'merchant.sslcommerz.com এ login করুন। "Stores" → আপনার Store-এ click করুন।' },
      { num: '৪', title: 'Store ID ও Password নিন', detail: '"API Credentials" বা "Integration" section-এ Store ID এবং Store Password পাবেন।' },
    ],
    fields: [
      { key: 'store_id', label: 'Store ID', ph: 'SSLCommerz Store ID', where: 'merchant.sslcommerz.com → Stores → Integration' },
      { key: 'store_passwd', label: 'Store Password', ph: 'SSLCommerz Store Password', where: 'merchant.sslcommerz.com → Stores → Integration', secret: true },
    ],
  },
  {
    key: 'sms_gateway',
    icon: '📲',
    title: 'SMS Gateway (Phone App)',
    badge: 'কোনো API লাগে না',
    badgeColor: '#8b5cf6',
    description: 'Merchant account বা API credential কিছুই লাগবে না — আপনার ফোনে bKash/Nagad/Rocket-এর payment SMS আসলে সেটা bot নিজে পড়ে verify করে দেবে।',
    flow: 'Phone-এ payment SMS আসে → SMS Forwarder app bot-কে পাঠায় → Customer TxID দিলে match করে → Order auto-confirm ✅',
    steps: [
      { num: '১', title: 'একটা Android ফোন বেছে নিন', detail: 'যে ফোনে আপনার bKash/Nagad/Rocket-এর payment SMS আসে, সেই ফোনে setup করতে হবে।' },
      { num: '২', title: '"FlamboyAI PaySync" app install করুন', detail: 'Onboarding শেষ হওয়ার পর Settings → SMS Gateway section থেকে APK download link পাবেন (Play Store-এ নেই, সরাসরি APK)।' },
      { num: '৩', title: 'Pairing token দিয়ে connect করুন', detail: 'App খুলে Settings page-এ দেখানো token বসিয়ে ফোনটা আপনার account-এর সাথে connect করুন, SMS read permission দিন।' },
      { num: '৪', title: 'SMS Gateway চালু করুন', detail: 'Settings page-এ গিয়ে "SMS Gateway চালু করুন" toggle ON করলেই payment verify শুরু হয়ে যাবে।' },
    ],
    fields: [],
  },
];

function Step4PaymentSetup({ dark, border, text, muted, accent, activePage, request, onSaved, onSkip }: any) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [sandbox, setSandbox] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const opt = PAYMENT_OPTIONS.find(o => o.key === selectedOption);

  const handleSave = async () => {
    if (!opt) return;
    setSaving(true); setError(''); setTestResult(null);
    try {
      await request(`${API_BASE}/pages/${activePage.id}/payment-credentials`, {
        method: 'POST',
        body: JSON.stringify({
          method: opt.key,
          credentials: { ...creds, sandbox: sandbox ? 'true' : 'false' },
          isActive: true,
        }),
      });
      setSaved(true);
      setTimeout(onSaved, 1400);
    } catch (e: any) {
      setError(e?.message || 'সংযোগ সমস্যা হয়েছে।');
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!opt) return;
    setTesting(true); setTestResult(null); setError('');
    try {
      // Save first, then test
      await request(`${API_BASE}/pages/${activePage.id}/payment-credentials`, {
        method: 'POST',
        body: JSON.stringify({
          method: opt.key,
          credentials: { ...creds, sandbox: sandbox ? 'true' : 'false' },
          isActive: true,
        }),
      });
      const r = await request(`${API_BASE}/pages/${activePage.id}/payment-credentials/${opt.key}/test`, { method: 'POST' });
      setTestResult({ ok: r.ok, message: r.message });
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || 'Test failed' });
    } finally { setTesting(false); }
  };

  const inp = (focused: boolean): React.CSSProperties => inputStyle(dark, border, accent, text, focused);
  const [focusMap, setFocusMap] = useState<Record<string, boolean>>({});

  if (saved) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 52, marginBottom: 16, animation: 'ob-check-bounce 500ms cubic-bezier(0.34,1.56,0.64,1) both' }}>✅</div>
        <h3 style={{ fontSize: 20, fontWeight: 900, color: text, marginBottom: 8 }}>Payment Setup সম্পন্ন!</h3>
        <p style={{ color: muted, fontSize: 14 }}>এখন থেকে payment automatically verify হবে।</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 32, marginBottom: 10 }}>💳</div>
      <h2 style={{ fontSize: 22, fontWeight: 900, color: text, margin: '0 0 6px', letterSpacing: -0.5 }}>
        Payment Auto-Verification
      </h2>
      <p style={{ color: muted, fontSize: 13.5, marginBottom: 22, lineHeight: 1.65 }}>
        Customer payment করলে bot automatically verify করে order confirm করবে। কোনো manual check লাগবে না।
      </p>

      {/* Option cards */}
      {!selectedOption && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'ob-field-in 350ms ease both' }}>
          {PAYMENT_OPTIONS.map((o, i) => (
            <div
              key={o.key}
              onClick={() => setSelectedOption(o.key)}
              style={{
                borderRadius: 14, padding: '16px 18px', cursor: 'pointer',
                border: `2px solid ${border}`,
                background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                transition: 'all 200ms cubic-bezier(0.34,1.56,0.64,1)',
                animation: `ob-field-in 350ms ease ${i * 80}ms both`,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = accent;
                (e.currentTarget as HTMLDivElement).style.background = dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateX(4px)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = border;
                (e.currentTarget as HTMLDivElement).style.background = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateX(0)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 24 }}>{o.icon}</span>
                <span style={{ fontWeight: 800, color: text, fontSize: 15 }}>{o.title}</span>
                {o.badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: o.badgeColor + '20', color: o.badgeColor, letterSpacing: 0.5,
                  }}>{o.badge}</span>
                )}
              </div>
              <p style={{ color: muted, fontSize: 13, lineHeight: 1.55, margin: 0 }}>{o.description}</p>
              <div style={{ marginTop: 8, fontSize: 12, color: accent, fontWeight: 600 }}>→ {o.flow}</div>
            </div>
          ))}
          <SkipBtn onClick={onSkip} muted={muted} />
        </div>
      )}

      {/* Selected option detail */}
      {selectedOption && opt && (
        <div style={{ animation: 'ob-in-fwd 300ms cubic-bezier(0,0,0.2,1) both' }}>
          {/* Back button */}
          <button onClick={() => { setSelectedOption(null); setCreds({}); setTestResult(null); setError(''); }} style={{
            background: 'none', border: 'none', color: accent, cursor: 'pointer',
            fontSize: 13, fontWeight: 700, padding: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4,
          }}>← পিছনে যান</button>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 28 }}>{opt.icon}</span>
            <div>
              <div style={{ fontWeight: 800, color: text, fontSize: 16 }}>{opt.title}</div>
              <div style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{opt.flow}</div>
            </div>
          </div>

          {/* Step-by-step instructions */}
          <div style={{
            borderRadius: 12, overflow: 'hidden',
            border: `1px solid ${dark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
            marginBottom: 18,
          }}>
            <div
              onClick={() => setExpandedSteps(!expandedSteps)}
              style={{
                padding: '12px 16px', cursor: 'pointer',
                background: dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, color: accent, fontSize: 13.5 }}>
                📋 Credentials কোথায় পাবেন? Step-by-step দেখুন
              </span>
              <span style={{ color: accent, fontSize: 16, transition: 'transform 200ms', transform: expandedSteps ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
            </div>
            {expandedSteps && (
              <div style={{ padding: '0 16px 16px', background: dark ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.03)' }}>
                {opt.steps.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, marginTop: 14,
                    animation: `ob-field-in 250ms ease ${i * 60}ms both`,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 12,
                    }}>{s.num}</div>
                    <div>
                      <div style={{ fontWeight: 700, color: text, fontSize: 13.5, marginBottom: 3 }}>{s.title}</div>
                      <div style={{ color: muted, fontSize: 12.5, lineHeight: 1.6 }}>{s.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SMS Gateway has no API credentials — device pairing happens later in Settings */}
          {opt.fields.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{
                borderRadius: 12, padding: '14px 16px',
                background: dark ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.06)',
                border: `1px solid ${dark ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.2)'}`,
              }}>
                <div style={{ fontWeight: 700, color: text, fontSize: 13, marginBottom: 4 }}>📲 Phone App দিয়ে Setup হয়</div>
                <div style={{ color: muted, fontSize: 12.5, lineHeight: 1.6 }}>
                  এটার জন্য এখানে কোনো তথ্য দেওয়ার দরকার নেই — onboarding শেষ হওয়ার পর Dashboard → Settings → SMS Gateway section থেকে app download করে phone connect করলেই হয়ে যাবে।
                </div>
              </div>
              <PrimaryBtn onClick={onSaved}>
                বুঝেছি, পরে Settings থেকে করব →
              </PrimaryBtn>
              <SkipBtn onClick={onSkip} muted={muted} />
            </div>
          )}

          {/* Credential fields */}
          {opt.fields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {opt.fields.map((f, i) => (
              <div key={f.key} style={{ animation: `ob-field-in 300ms ease ${i * 60}ms both` }}>
                <FieldLabel muted={muted}>
                  {f.label}
                  {(f as any).where && (
                    <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6, color: accent }}>
                      → {(f as any).where}
                    </span>
                  )}
                </FieldLabel>
                <input
                  className="ob-input"
                  type={(f as any).secret ? 'password' : 'text'}
                  placeholder={f.ph}
                  value={creds[f.key] ?? ''}
                  onChange={e => setCreds(p => ({ ...p, [f.key]: e.target.value }))}
                  onFocus={() => setFocusMap(p => ({ ...p, [f.key]: true }))}
                  onBlur={() => setFocusMap(p => ({ ...p, [f.key]: false }))}
                  style={inp(!!focusMap[f.key])}
                />
              </div>
            ))}

            {/* Sandbox toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 11, border: `1.5px solid ${border}`, marginTop: 2 }}>
              <div onClick={() => setSandbox(!sandbox)} style={{
                width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative', flexShrink: 0,
                background: !sandbox ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : (dark ? '#333' : '#d1d5db'),
                transition: 'background 300ms',
              }}>
                <div style={{
                  position: 'absolute', top: 3, left: !sandbox ? 22 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  transition: 'left 240ms cubic-bezier(0.34,1.56,0.64,1)',
                }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: text, fontSize: 13 }}>
                  {sandbox ? '🧪 Sandbox Mode (Test)' : '🚀 Live Mode (Production)'}
                </div>
                <div style={{ color: muted, fontSize: 11.5, marginTop: 1 }}>
                  {sandbox ? 'প্রথমে test করুন, সব ঠিক হলে Live-এ switch করুন' : 'Real payment এখন process হবে'}
                </div>
              </div>
            </label>

            {/* Test result */}
            {testResult && (
              <div style={{
                padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: testResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: testResult.ok ? '#22c55e' : '#ef4444',
                border: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                animation: 'ob-fade-up 200ms ease',
              }}>
                {testResult.ok ? '✓' : '✗'} {testResult.message}
              </div>
            )}

            {error && (
              <div style={{ color: '#ef4444', fontSize: 13, background: 'rgba(239,68,68,0.08)', padding: '8px 12px', borderRadius: 8 }}>
                ⚠️ {error}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                onClick={handleTest}
                disabled={testing || Object.keys(creds).length === 0}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12, cursor: Object.keys(creds).length === 0 ? 'not-allowed' : 'pointer',
                  background: 'none', border: `1.5px solid ${accent}`, color: accent,
                  fontWeight: 700, fontSize: 14, opacity: Object.keys(creds).length === 0 ? 0.4 : 1,
                  transition: 'opacity 200ms',
                }}
              >
                {testing ? '🔄 Testing…' : '🔌 Test করুন'}
              </button>
              <PrimaryBtn
                onClick={handleSave}
                disabled={Object.keys(creds).length === 0}
                loading={saving}
              >
                💾 Save ও পরবর্তী →
              </PrimaryBtn>
            </div>
          </div>
          )}

          {opt.fields.length > 0 && <SkipBtn onClick={onSkip} muted={muted} />}
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Celebration ──────────────────────────────────────────────────────

function Step5Complete({ dark, text, muted, accent, accentSoft, pageConnected, productSkipped, botSaved, onFinish }: any) {
  const badges = [
    { label: pageConnected ? '✅ ব্যবসার প্রোফাইল সেভ হয়েছে' : '⚠️ ব্যবসার প্রোফাইল এখনো সেভ হয়নি', done: pageConnected, delay: '1.5s' },
    { label: productSkipped ? '⚠️ পণ্য এখনো যোগ হয়নি' : '✅ পণ্য যোগ করা হয়েছে', done: !productSkipped, delay: '1.75s' },
    { label: botSaved ? '✅ বট কনফিগারেশন সেভ হয়েছে' : '⚠️ বট কনফিগারেশন সেভ হয়নি', done: botSaved, delay: '2.0s' },
  ];

  return (
    <div style={{ textAlign: 'center', paddingTop: 10 }}>
      <div style={{ animation: 'ob-check-bounce 500ms cubic-bezier(0.34,1.56,0.64,1) 1.1s both', display: 'inline-block', marginBottom: 26 }}>
        <svg width="108" height="108" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="ob-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="46"
            fill="none" stroke="url(#ob-grad)" strokeWidth="4"
            strokeDasharray="289" strokeDashoffset="289" strokeLinecap="round"
            style={{ animation: 'ob-check-circle 700ms ease-out 200ms forwards' }}
          />
          <path d="M28 52 L43 67 L72 35"
            fill="none" stroke="url(#ob-grad)" strokeWidth="5.5"
            strokeDasharray="60" strokeDashoffset="60" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: 'ob-check-mark 450ms ease-out 900ms forwards' }}
          />
        </svg>
      </div>

      <h2 style={{
        fontSize: 27, fontWeight: 900, color: text, margin: '0 0 8px',
        animation: 'ob-fade-up 400ms ease 1.1s both', opacity: 0, letterSpacing: -0.5,
      }}>
        আপনার বট এখন চালু! 🎉
      </h2>
      <p style={{
        color: muted, fontSize: 14.5, marginBottom: 30,
        animation: 'ob-fade-up 400ms ease 1.3s both', opacity: 0, lineHeight: 1.65,
      }}>
        Messenger-এ অর্ডার নেওয়া এখন থেকে শুরু হয়ে যাবে।
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32, textAlign: 'left' }}>
        {badges.map((b, i) => (
          <div key={i} style={{
            padding: '13px 18px', borderRadius: 13,
            background: b.done ? accentSoft : (dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9'),
            border: `1px solid ${b.done ? 'rgba(99,102,241,0.2)' : 'transparent'}`,
            fontWeight: 600, color: b.done ? text : muted, fontSize: 14,
            opacity: 0,
            animation: `ob-badge-in 450ms cubic-bezier(0.34,1.56,0.64,1) ${b.delay} forwards`,
          }}>
            {b.label}
          </div>
        ))}
      </div>

      <button
        className="ob-btn-primary"
        onClick={onFinish}
        style={{
          padding: '15px 40px', fontSize: 16, fontWeight: 800,
          background: `linear-gradient(135deg,${accent},#8b5cf6)`,
          border: 'none', borderRadius: 14, color: '#fff', cursor: 'pointer',
          letterSpacing: 0.2,
          animation: 'ob-fade-up 400ms ease 2.3s both',
          opacity: 0,
        }}
      >
        Dashboard-এ যান →
      </button>
    </div>
  );
}

// ─── University Setup Step ─────────────────────────────────────────────────────
function StepUniversitySetup({ dark, border, text, muted, accent, activePage, request, onDone, onSkip }: {
  dark: boolean; border: string; text: string; muted: string; accent: string;
  activePage: { id: number };
  request: any;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [crawlUrl, setCrawlUrl] = useState('');
  const [noticeUrl, setNoticeUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const inp = {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '10px 13px', borderRadius: 10, fontSize: 14,
    background: dark ? 'rgba(255,255,255,0.05)' : '#f8f9ff',
    border: `1px solid ${border}`, color: text, outline: 'none',
    fontFamily: 'inherit',
  };

  const handleSave = async () => {
    if (!crawlUrl.trim()) { onSkip(); return; }
    setSaving(true);
    try {
      await request(`${API_BASE}/university/config/${activePage.id}`, {
        method: 'POST',
        body: JSON.stringify({
          crawlBaseUrl: crawlUrl.trim(),
          scrapeUrl: noticeUrl.trim() || crawlUrl.trim(),
          scrapeEnabled: true,
          autoPostEnabled: true,
        }),
      });
    } catch {}
    setSaving(false);
    onDone();
  };

  return (
    <div style={{ animation: 'ob-fade-up 400ms ease both' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🌐</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: text, marginBottom: 6 }}>
        University Website URL দিন
      </div>
      <div style={{ fontSize: 13, color: muted, marginBottom: 22, lineHeight: 1.6 }}>
        Bot এই website crawl করে সব তথ্য সংগ্রহ করবে।<br />
        পরে Settings থেকেও পরিবর্তন করা যাবে।
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>
          Homepage URL (Knowledge Crawl)
        </label>
        <input
          style={inp}
          placeholder="https://uap-bd.edu"
          value={crawlUrl}
          onChange={e => setCrawlUrl(e.target.value)}
        />
        <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>Bot সব তথ্য এই site থেকে সংগ্রহ করবে</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>
          Notice Page URL (Facebook Auto-Post)
        </label>
        <input
          style={inp}
          placeholder="https://uap-bd.edu/news-events/news-events.php"
          value={noticeUrl}
          onChange={e => setNoticeUrl(e.target.value)}
        />
        <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>নতুন notice এই page থেকে নিয়ে Facebook-এ auto-post হবে</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, padding: '12px', background: `linear-gradient(135deg,${accent},#8b5cf6)`,
            border: 'none', borderRadius: 12, color: '#fff', fontSize: 14,
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          {saving ? 'সেভ হচ্ছে...' : 'সেভ করুন ও এগিয়ে যান →'}
        </button>
        <button
          onClick={onSkip}
          style={{
            padding: '12px 18px', background: 'transparent',
            border: `1px solid ${border}`, borderRadius: 12, color: muted,
            fontSize: 13, cursor: 'pointer',
          }}
        >
          পরে দেব
        </button>
      </div>
    </div>
  );
}

// ─── University Done Step ──────────────────────────────────────────────────────
function StepUniversityDone({ text, muted, onFinish }: {
  text: string; muted: string;
  onFinish: () => void;
}) {
  return (
    <div style={{ textAlign: 'center', animation: 'ob-fade-up 400ms ease both' }}>
      <div style={{ fontSize: 56, marginBottom: 16, animation: 'ob-dot-pop 600ms cubic-bezier(0.34,1.56,0.64,1) both' }}>🎓</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: text, marginBottom: 10 }}>
        University Automation প্রস্তুত!
      </div>
      <div style={{ fontSize: 13.5, color: muted, lineHeight: 1.7, marginBottom: 24 }}>
        এখন University সেকশনে গিয়ে website crawl করুন।<br />
        Bot শিক্ষার্থীদের প্রশ্নের উত্তর দিতে শুরু করবে।
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', marginBottom: 28 }}>
        {[
          ['🌐', 'Website crawl → bot-এর knowledge base তৈরি হবে'],
          ['📢', 'নতুন notice → Facebook-এ auto-post'],
          ['💬', 'Messenger → 24/7 student Q&A চালু'],
          ['👥', 'Group link → Department/Semester অনুযায়ী'],
        ].map(([icon, label], i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, alignItems: 'center',
            padding: '10px 14px', borderRadius: 10,
            background: 'rgba(16,185,129,0.07)',
            animation: `ob-fade-up 400ms ease ${i * 120 + 200}ms both`,
          }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <span style={{ fontSize: 13, color: text }}>{label}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onFinish}
        style={{
          padding: '14px 36px', fontSize: 15, fontWeight: 800,
          background: 'linear-gradient(135deg,#10b981,#059669)',
          border: 'none', borderRadius: 14, color: '#fff', cursor: 'pointer',
        }}
      >
        Dashboard-এ যান →
      </button>
    </div>
  );
}
