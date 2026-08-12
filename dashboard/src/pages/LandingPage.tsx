import { useState } from 'react';

interface Props {
  dark: boolean;
  setDark: (next: boolean) => void;
  onLogin: () => void;
  onSignup: () => void;
}

const LANDING_HTML = String.raw`<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>FlamboyAI — Facebook Commerce Automation</title>
<meta name="description" content="Facebook Messenger দিয়ে automatic order নিন, OCR দিয়ে product detect করুন, courier booking করুন — সব একজায়গায়।"/>
<meta name="dashboard-url" content="https://app.flamboyai.com"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900&family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080b14;--surface:#0f1422;--surface2:#161c2e;
  --border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.13);
  --text:#f1f5f9;--muted:rgba(148,163,184,0.7);
  --accent:#6366f1;--accent2:#818cf8;--accent3:#22d3ee;
  --gold:#f59e0b;--green:#10b981;--amber:#f59e0b;--radius:18px;
}
html{scroll-behavior:smooth;scroll-padding-top:80px}
body{font-family:'DM Sans','Noto Sans Bengali',system-ui,sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;overflow-x:hidden}

/* ══ Scrollbar ══ */
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(91,76,245,.3);border-radius:99px}

/* ══ Nav ══ */
nav{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100;width:calc(100% - 48px);max-width:1100px;padding:0 20px;height:54px;display:flex;justify-content:space-between;align-items:center;background:rgba(8,11,20,0.76);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--border2);border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)}
.logo{display:flex;align-items:center;gap:10px}
.logo-icon{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#fff;box-shadow:0 2px 12px rgba(91,76,245,.5)}
.logo-text{font-size:16px;font-weight:800;letter-spacing:-0.03em}
.nav-links{display:flex;align-items:center;gap:4px}
.nav-link{padding:7px 14px;border-radius:8px;text-decoration:none;color:var(--muted);font-size:13px;font-weight:500;transition:color .15s,background .15s}
.nav-link:hover{color:var(--text);background:rgba(255,255,255,.05)}
.nav-cta{padding:8px 18px;border-radius:9px;background:var(--accent);color:#fff;font-weight:700;font-size:13px;text-decoration:none;transition:all .2s;box-shadow:0 2px 12px rgba(91,76,245,.4)}
.nav-cta:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(91,76,245,.5)}
.nav-login{padding:7px 16px;border-radius:9px;border:1px solid var(--border2);color:var(--text);font-weight:600;font-size:13px;text-decoration:none;transition:all .15s;background:rgba(255,255,255,.04)}
.nav-login:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2)}

/* ══ Hero ══ */
.hero{position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:140px 5% 100px;text-align:center;overflow:hidden}

/* Mesh gradient background */
.hero::before{content:'';position:absolute;inset:0;background:
  radial-gradient(ellipse 80% 60% at 20% 10%,rgba(99,102,241,.20),transparent),
  radial-gradient(ellipse 60% 50% at 80% 20%,rgba(34,211,238,.12),transparent),
  radial-gradient(ellipse 50% 40% at 50% 80%,rgba(99,102,241,.08),transparent);pointer-events:none}

.orb{position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none;will-change:transform}
.orb-1{width:580px;height:580px;top:-120px;left:-120px;background:radial-gradient(circle,rgba(91,76,245,.28),transparent 65%);animation:orbFloat 9s ease-in-out infinite}
.orb-2{width:440px;height:440px;bottom:-80px;right:-100px;background:radial-gradient(circle,rgba(139,92,246,.22),transparent 65%);animation:orbFloat 12s ease-in-out infinite reverse}
.orb-3{width:300px;height:300px;top:40%;left:60%;background:radial-gradient(circle,rgba(6,182,212,.14),transparent 65%);animation:orbFloat 15s ease-in-out infinite 2s}

@keyframes orbFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-28px) scale(1.05)}}

.hero-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px 6px 8px;border-radius:999px;background:rgba(91,76,245,.10);border:1px solid rgba(91,76,245,.28);font-size:12.5px;font-weight:600;color:#a5b4fc;margin-bottom:32px;animation:fadeUp .5s ease both}
.hero-badge-dot{width:22px;height:22px;border-radius:50%;background:rgba(91,76,245,.2);display:flex;align-items:center;justify-content:center}
.hero-badge-dot::after{content:'';width:7px;height:7px;border-radius:50%;background:#4ade80;display:block;box-shadow:0 0 10px #4ade80;animation:pulse 2s ease infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 10px #4ade80}50%{opacity:.7;box-shadow:0 0 20px #4ade80,0 0 40px rgba(74,222,128,.3)}}

.hero h1{font-size:clamp(38px,7.5vw,84px);font-weight:900;letter-spacing:-0.045em;line-height:1.0;margin-bottom:24px;animation:fadeUp .6s .1s ease both}
.hero h1 .grad{background:linear-gradient(135deg,#6366f1 0%,#22d3ee 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero-sub{font-size:clamp(15px,2.2vw,19px);color:var(--muted);max-width:600px;line-height:1.75;margin-bottom:44px;animation:fadeUp .6s .2s ease both}
.hero-btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;animation:fadeUp .6s .3s ease both}
.btn-primary{padding:14px 30px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:700;font-size:15px;text-decoration:none;transition:all .22s;box-shadow:0 4px 24px rgba(91,76,245,.5);display:inline-flex;align-items:center;gap:9px}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(91,76,245,.55)}
.btn-ghost{padding:14px 28px;border-radius:11px;border:1px solid var(--border2);color:var(--text);font-weight:600;font-size:15px;text-decoration:none;transition:all .2s;display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.04)}
.btn-ghost:hover{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.22);transform:translateY(-2px)}

/* ══ Hero mockup ══ */
.hero-img{position:relative;margin-top:72px;width:100%;max-width:960px;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.10);box-shadow:0 40px 100px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.04),inset 0 1px 0 rgba(255,255,255,.08);will-change:transform;transform-origin:center center;animation:fadeUp .7s .4s ease both;transition:transform .08s ease,box-shadow .3s ease}
.mockup-bar{background:rgba(13,13,22,.95);height:44px;display:flex;align-items:center;padding:0 16px;gap:8px;border-bottom:1px solid var(--border)}
.dot{width:11px;height:11px;border-radius:50%}
.mockup-content{background:rgba(10,10,18,.97);padding:20px;display:grid;grid-template-columns:190px 1fr;gap:16px;min-height:340px}
.mock-sidebar{display:flex;flex-direction:column;gap:5px}
.mock-nav{height:32px;border-radius:8px;background:rgba(255,255,255,.04)}
.mock-nav.active{background:rgba(91,76,245,.18);border:1px solid rgba(91,76,245,.2)}
.mock-main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-content:start}
.mock-card{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:16px;transition:all .2s}
.mock-card:hover{background:rgba(255,255,255,.06);transform:translateY(-2px)}
.mock-num{font-size:24px;font-weight:900;letter-spacing:-0.04em}
.mock-label{font-size:10px;color:var(--muted);margin-top:5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.mock-trend{font-size:11px;margin-top:8px;font-weight:600}

/* ══ Floating badge ══ */
.float-badge{position:absolute;background:rgba(13,13,25,.9);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px 14px;font-size:12px;font-weight:700;animation:floatBadge 4s ease-in-out infinite;box-shadow:0 8px 24px rgba(0,0,0,.4)}
@keyframes floatBadge{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.badge-tl{top:60px;left:-20px;animation-delay:0s}
.badge-tr{top:40px;right:-20px;animation-delay:1.5s}
.badge-bl{bottom:60px;left:-30px;animation-delay:.8s}

/* ══ Trusted bar ══ */
.trusted{padding:28px 5%;display:flex;align-items:center;justify-content:center;gap:10px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:rgba(255,255,255,.015);font-size:12.5px;color:var(--muted);flex-wrap:wrap;text-align:center}
.trusted strong{color:var(--text)}

/* ══ Stats bar ══ */
.stats-bar{display:flex;justify-content:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:4px;margin:0 5%;flex-wrap:wrap;box-shadow:0 4px 24px rgba(0,0,0,.2)}
.stat{flex:1;min-width:160px;text-align:center;padding:24px 16px;border-right:1px solid var(--border);position:relative}
.stat:last-child{border-right:none}
.stat-num{font-size:30px;font-weight:900;letter-spacing:-0.05em}
.stat-label{font-size:12px;color:var(--muted);margin-top:5px;font-weight:500}

/* ══ Features ══ */
.section{padding:110px 5%}
.section-label{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.10em;margin-bottom:16px}
.section-label::before{content:'';width:18px;height:2px;background:var(--accent);border-radius:2px;display:block}
.section-title{font-size:clamp(30px,5vw,52px);font-weight:900;letter-spacing:-0.045em;line-height:1.08;margin-bottom:16px}
.section-sub{font-size:17px;color:var(--muted);max-width:520px;line-height:1.72}

.features-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px;margin-top:60px}
.feature-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px 26px;transition:all .28s cubic-bezier(.22,1,.36,1);position:relative;overflow:hidden;cursor:default}
.feature-card::before{content:'';position:absolute;top:-60px;right:-60px;width:160px;height:160px;border-radius:50%;background:var(--fc-color,rgba(91,76,245,.12));filter:blur(40px);opacity:0;transition:opacity .28s;pointer-events:none}
.feature-card:hover{transform:translateY(-5px) scale(1.012);border-color:rgba(91,76,245,.28);box-shadow:0 16px 48px rgba(0,0,0,.3),0 0 0 1px rgba(91,76,245,.12)}
.feature-card:hover::before{opacity:1}
.feature-icon-wrap{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:20px;position:relative}
.feature-title{font-size:16px;font-weight:800;letter-spacing:-0.02em;margin-bottom:9px}
.feature-desc{font-size:13.5px;color:var(--muted);line-height:1.72}
.feature-tag{display:inline-flex;align-items:center;gap:5px;margin-top:16px;padding:4px 11px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid rgba(91,76,245,.22);color:#818cf8;background:rgba(91,76,245,.08)}

/* ══ Steps ══ */
.steps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin-top:60px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--surface)}
.step{padding:36px 32px;position:relative;border-right:1px solid var(--border);transition:background .2s}
.step:last-child{border-right:none}
.step:hover{background:rgba(255,255,255,.025)}
.step-num{width:42px;height:42px;border-radius:11px;background:rgba(91,76,245,.12);border:1px solid rgba(91,76,245,.22);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:900;color:var(--accent);margin-bottom:18px}
.step-title{font-size:16px;font-weight:800;letter-spacing:-0.02em;margin-bottom:9px}
.step-desc{font-size:13.5px;color:var(--muted);line-height:1.7}
.step-connector{position:absolute;top:57px;right:-1px;width:1px;height:24px;background:linear-gradient(to bottom,transparent,var(--accent),transparent);display:none}

/* ══ Testimonials ══ */
.testimonials-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:60px}
.tcard{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;transition:all .25s}
.tcard:hover{transform:translateY(-3px);box-shadow:0 12px 36px rgba(0,0,0,.25)}
.tcard-stars{font-size:13px;margin-bottom:14px;letter-spacing:2px}
.tcard-text{font-size:14px;color:rgba(240,240,248,.78);line-height:1.72;margin-bottom:18px;font-style:italic}
.tcard-author{display:flex;align-items:center;gap:10px}
.tcard-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#fff;flex-shrink:0}
.tcard-name{font-size:13.5px;font-weight:700}
.tcard-sub{font-size:11.5px;color:var(--muted);margin-top:1px}

/* ══ Pricing ══ */
.pricing-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:36px;transition:all .25s;position:relative;overflow:hidden}
.pricing-card.featured{background:linear-gradient(145deg,rgba(91,76,245,.10),rgba(139,92,246,.06));border-color:rgba(91,76,245,.36);box-shadow:0 0 0 1px rgba(91,76,245,.10) inset}
.pricing-name{font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
.pricing-price{font-size:48px;font-weight:900;letter-spacing:-0.05em;margin-bottom:4px}
.pricing-period{font-size:13px;color:var(--muted);margin-bottom:28px}
.pricing-features{list-style:none;display:flex;flex-direction:column;gap:11px;margin-bottom:32px;text-align:left}
.pricing-features li{font-size:13.5px;color:rgba(240,240,248,.75);display:flex;align-items:flex-start;gap:9px;line-height:1.5}
.pricing-features li::before{content:'✓';color:var(--green);font-weight:900;flex-shrink:0;margin-top:1px}
.pricing-btn{display:block;text-align:center;padding:13px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;transition:all .18s;letter-spacing:-.01em}
.pricing-btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 4px 20px rgba(91,76,245,.45)}
.pricing-btn.primary:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(91,76,245,.55)}
.pricing-btn.ghost{border:1px solid var(--border2);color:var(--text);background:rgba(255,255,255,.04)}
.pricing-btn.ghost:hover{background:rgba(255,255,255,.08)}
.badge-popular{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:999px;background:rgba(91,76,245,.15);color:#a5b4fc;font-size:11.5px;font-weight:700;border:1px solid rgba(91,76,245,.3);margin-bottom:12px}

/* ══ CTA ══ */
.cta-section{margin:0 5% 80px;padding:72px;text-align:center;background:linear-gradient(145deg,var(--surface),rgba(91,76,245,.07));border:1px solid rgba(91,76,245,.22);border-radius:24px;position:relative;overflow:hidden}
.cta-section::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 80% at 50% 50%,rgba(91,76,245,.08),transparent);pointer-events:none}
.cta-section h2{font-size:clamp(26px,5vw,48px);font-weight:900;letter-spacing:-0.04em;margin-bottom:16px;position:relative}
.cta-section p{font-size:16.5px;color:var(--muted);margin-bottom:36px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.7;position:relative}

/* ══ Footer ══ */
footer{border-top:1px solid var(--border);padding:44px 5%;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
.footer-copy{font-size:13px;color:var(--muted)}
.footer-links{display:flex;gap:24px}
.footer-link{font-size:13px;color:var(--muted);text-decoration:none;transition:color .15s}
.footer-link:hover{color:var(--text)}
.footer-logo{display:flex;align-items:center;gap:8px;margin-bottom:8px}

/* ══ Animations ══ */
@keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
.fade-up{opacity:0;animation:fadeUp .65s cubic-bezier(.22,1,.36,1) forwards}
.delay-1{animation-delay:.12s}.delay-2{animation-delay:.22s}.delay-3{animation-delay:.34s}.delay-4{animation-delay:.46s}

/* ══ Live 3D Demo Scene ══ */
.demo-sec{padding:110px 5% 80px;overflow:hidden;position:relative;background:rgba(255,255,255,.012);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.demo-inner{max-width:1100px;margin:0 auto;text-align:center}
.demo-title{font-size:clamp(28px,4.5vw,48px);font-weight:900;letter-spacing:-0.04em;margin-bottom:12px}
.demo-sub{font-size:16px;color:var(--muted);margin:0 auto 64px;line-height:1.7;max-width:480px}

/* Scene container */
.scene-root{position:relative;width:100%;max-width:680px;height:640px;margin:0 auto;transform-style:preserve-3d;will-change:transform}
.scene-bg-orb{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none}
.s-orb-1{width:380px;height:380px;top:-40px;left:-60px;background:radial-gradient(circle,rgba(91,76,245,.26),transparent 65%)}
.s-orb-2{width:300px;height:300px;bottom:20px;right:-40px;background:radial-gradient(circle,rgba(139,92,246,.2),transparent 65%)}
.s-orb-3{width:180px;height:180px;top:38%;left:57%;background:radial-gradient(circle,rgba(6,182,212,.15),transparent 65%)}
.scene-grid-layer{position:absolute;inset:0;background-image:linear-gradient(rgba(91,76,245,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(91,76,245,.045) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse 72% 52% at 50% 50%,black 20%,transparent);-webkit-mask-image:radial-gradient(ellipse 72% 52% at 50% 50%,black 20%,transparent)}

/* Phone */
.phone-scene-wrap{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);filter:drop-shadow(0 50px 90px rgba(0,0,0,.75)) drop-shadow(0 0 50px rgba(91,76,245,.18))}
.phone-body{width:264px;background:linear-gradient(155deg,#1c1c2e,#0f0f1c 60%,#141428);border-radius:46px;padding:14px 14px 10px;border:1px solid rgba(255,255,255,.13);box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 -1px 0 rgba(0,0,0,.4),0 0 0 1px rgba(0,0,0,.6);position:relative}
.p-notch{width:106px;height:26px;background:#07070f;border-radius:0 0 18px 18px;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;gap:8px}
.p-notch-cam{width:9px;height:9px;border-radius:50%;background:#1a1a2e;border:1px solid rgba(255,255,255,.09)}
.p-notch-bar{width:44px;height:4px;background:rgba(255,255,255,.06);border-radius:99px}
.p-screen{background:#0a0a16;border-radius:34px;overflow:hidden;height:516px;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.04)}
.p-btn-r{position:absolute;right:-3px;background:linear-gradient(to right,#111,#1a1a2e);border-radius:0 2px 2px 0;width:3px}
.p-btn-r-1{top:90px;height:56px}.p-btn-r-2{top:156px;height:34px}
.p-btn-l{position:absolute;left:-3px;background:linear-gradient(to left,#111,#1a1a2e);border-radius:2px 0 0 2px;width:3px;top:108px;height:70px}
.p-home{width:90px;height:4px;background:rgba(255,255,255,.2);border-radius:99px;margin:8px auto 3px}
.p-shine{position:absolute;top:0;left:0;right:0;bottom:0;border-radius:46px;background:linear-gradient(145deg,rgba(255,255,255,.07) 0%,transparent 44%);pointer-events:none;z-index:20}

/* Messenger */
.ms-hd{background:linear-gradient(135deg,#1877f2,#0d6fe8);padding:11px 13px;display:flex;align-items:center;gap:9px;flex-shrink:0}
.ms-back-ic{color:rgba(255,255,255,.85);font-size:20px;font-weight:300;line-height:1}
.ms-av{width:32px;height:32px;border-radius:9px;background:#fff url('https://app.flamboyai.com/logo.png') no-repeat;background-size:auto 88%;background-position:12% center;border:2px solid rgba(255,255,255,.22);flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.3);overflow:hidden}
.ms-nm{font-size:13px;font-weight:700;color:#fff;line-height:1.2}.ms-ac{display:flex;align-items:center;gap:4px;font-size:10px;color:rgba(255,255,255,.7);margin-top:1px}
.ms-gdot{width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;animation:pulse 2s ease infinite;flex-shrink:0}
.ms-chat-area{flex:1;overflow:hidden;padding:10px 9px;display:flex;flex-direction:column;gap:5px;background:#0c0c1a}
.ms-bbl{max-width:80%;padding:8px 12px;border-radius:17px;font-size:11.5px;line-height:1.55;font-weight:500;animation:bubbleIn .32s cubic-bezier(.34,1.5,.64,1) both;opacity:0;font-family:'DM Sans','Noto Sans Bengali',sans-serif}
.ms-bbl.u{align-self:flex-end;background:linear-gradient(135deg,#1877f2,#0d6fe8);color:#fff;border-bottom-right-radius:3px}
.ms-bbl.b{align-self:flex-start;background:rgba(255,255,255,.1);color:rgba(235,235,255,.88);border:1px solid rgba(255,255,255,.07);border-bottom-left-radius:3px}
.ms-bbl.b.confirm{background:rgba(16,185,129,.13);border-color:rgba(16,185,129,.22);color:#6ee7b7}
.ms-typing-d{align-self:flex-start;padding:9px 14px;background:rgba(255,255,255,.1);border-radius:17px;border-bottom-left-radius:3px;display:flex;align-items:center;gap:4px;animation:bubbleIn .2s ease both;opacity:0}
.ms-typing-d span{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.4);animation:typingBounce 1s ease infinite;display:block}
.ms-typing-d span:nth-child(2){animation-delay:.16s}.ms-typing-d span:nth-child(3){animation-delay:.32s}
.ms-bar{padding:7px 9px;background:rgba(255,255,255,.025);border-top:1px solid rgba(255,255,255,.04);display:flex;align-items:center;gap:7px;flex-shrink:0}
.ms-inp-box{flex:1;background:rgba(255,255,255,.07);border-radius:20px;padding:7px 13px;font-size:11px;color:rgba(255,255,255,.25);border:1px solid rgba(255,255,255,.05)}
.ms-inp-real{flex:1;background:rgba(255,255,255,.07);border-radius:20px;padding:7px 13px;font-size:11px;color:#fff;border:1px solid rgba(255,255,255,.12);outline:none;font-family:'DM Sans','Noto Sans Bengali',sans-serif}
.ms-inp-real::placeholder{color:rgba(255,255,255,.3)}
.ms-inp-real:focus{border-color:rgba(24,119,242,.5);background:rgba(255,255,255,.1)}
.ms-send-ic{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#1877f2,#0d6fe8);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(24,119,242,.4);cursor:pointer;border:none}
.ms-send-ic:disabled{opacity:0.45;cursor:not-allowed}
.ms-chat-area{flex:1;overflow-y:auto;padding:10px 9px;display:flex;flex-direction:column;gap:5px;background:#0c0c1a;scrollbar-width:none}

/* Floating chips */
.sc-chip{position:absolute;background:rgba(9,9,21,.93);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:10px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);white-space:nowrap;animation:chipFloat 4s ease-in-out infinite}
.sc-ic{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.sc-lbl{font-size:10px;color:var(--muted);font-weight:600;margin-bottom:1px;line-height:1}
.sc-val{font-size:13px;font-weight:800;letter-spacing:-0.02em;line-height:1.2}
.chip-a{top:4%;right:-6%;color:#10b981;animation-delay:0s}.chip-a .sc-ic{background:rgba(16,185,129,.14);color:#10b981}
.chip-b{top:35%;left:-18%;color:#818cf8;animation-delay:1.3s}.chip-b .sc-ic{background:rgba(91,76,245,.14);color:#818cf8}
.chip-c{bottom:26%;right:-14%;color:#4ade80;border-radius:99px;padding:9px 16px;animation-delay:.7s;display:flex;gap:8px;align-items:center}
.chip-c-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 10px #4ade80;animation:pulse 2s ease infinite;flex-shrink:0}
.chip-d{bottom:6%;left:-12%;color:#f59e0b;animation-delay:2s}.chip-d .sc-ic{background:rgba(245,158,11,.14);color:#f59e0b}

@media(max-width:768px){.demo-sec{padding:60px 5% 48px}.scene-root{height:auto!important;min-height:500px;transform:none!important;padding:24px 0}.phone-scene-wrap{position:relative!important;top:auto!important;left:auto!important;transform:none!important;margin:0 auto;display:flex;justify-content:center;width:100%}.sc-chip{display:none}.phone-body{width:min(240px,80vw)}.p-screen{height:min(430px,60vh)}}
@media(max-width:400px){.phone-body{width:min(210px,88vw)}.p-screen{height:min(380px,58vh)}}

/* ══ Custom Cursor ══ */
@media(pointer:fine){
  body,a,button,.feature-card,.tcard,.step,.pricing-card,.stat,.mock-card{cursor:none!important}
}
#cur-dot{position:fixed;width:8px;height:8px;border-radius:50%;background:var(--accent);pointer-events:none;z-index:99999;transform:translate(-50%,-50%);box-shadow:0 0 10px var(--accent),0 0 22px rgba(91,76,245,.55);transition:width .15s,height .15s,background .15s,box-shadow .15s;opacity:0;will-change:left,top}
#cur-ring{position:fixed;width:38px;height:38px;border-radius:50%;border:1.5px solid rgba(91,76,245,.45);pointer-events:none;z-index:99998;transform:translate(-50%,-50%);transition:width .22s cubic-bezier(.22,1,.36,1),height .22s cubic-bezier(.22,1,.36,1),border-color .2s,opacity .3s;opacity:0;will-change:left,top}
#cur-trail{position:fixed;pointer-events:none;z-index:99990;top:0;left:0;width:100%;height:100%;overflow:hidden}
.trail-dot{position:absolute;border-radius:50%;background:var(--accent);pointer-events:none;transform:translate(-50%,-50%);animation:trailFade .5s ease forwards}
@keyframes trailFade{from{opacity:.5;width:6px;height:6px}to{opacity:0;width:2px;height:2px}}

/* ══ 3D card enhancements ══ */
.tcard{transform-style:preserve-3d;transition:transform .28s cubic-bezier(.22,1,.36,1),box-shadow .28s,border-color .28s}
.tcard:hover{box-shadow:0 20px 60px rgba(91,76,245,.18),0 0 0 1px rgba(91,76,245,.14);border-color:rgba(91,76,245,.25)}
.stat{transform-style:preserve-3d;transition:transform .25s cubic-bezier(.22,1,.36,1),background .2s}
.stat:hover{background:rgba(91,76,245,.07);transform:translateY(-4px) scale(1.04)}
.pricing-card{transform-style:preserve-3d;transition:transform .28s cubic-bezier(.22,1,.36,1),box-shadow .28s}
.step{transform-style:preserve-3d;transition:transform .22s cubic-bezier(.22,1,.36,1),background .2s}
.step:hover{transform:translateY(-3px) perspective(600px) rotateX(2deg);background:rgba(91,76,245,.05)}

/* ══ Magnetic button glow ══ */
.btn-primary,.btn-ghost,.nav-cta{position:relative;overflow:hidden}
.btn-primary::after,.nav-cta::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at var(--mx,50%) var(--my,50%),rgba(255,255,255,.18),transparent 65%);opacity:0;transition:opacity .2s;pointer-events:none}
.btn-primary:hover::after,.nav-cta:hover::after{opacity:1}

/* ══ Responsive ══ */
@media(max-width:768px){
  nav{top:8px;width:calc(100% - 24px);padding:0 14px}
  .nav-links .nav-link,.nav-login{display:none}
  .hero{padding:110px 5% 80px}
  .hero-img{margin-top:48px}
  .badge-tl,.badge-tr,.badge-bl{display:none}
  .mockup-content{grid-template-columns:1fr}
  .mock-sidebar{display:none}
  .hero-btns{flex-direction:column;align-items:center;gap:10px}
  .btn-primary,.btn-ghost{width:100%;max-width:320px;justify-content:center}
  .section{padding:72px 5%}
  .cta-section{padding:44px 24px;margin:0 16px 56px}
  footer{flex-direction:column;text-align:center}
  .footer-links{justify-content:center}
  .steps-grid{grid-template-columns:1fr}
  .step{border-right:none;border-bottom:1px solid var(--border)}
  .step:last-child{border-bottom:none}
  .trusted{gap:6px}
  #value .pricing-grid-2{grid-template-columns:1fr!important}
  .value-grid{grid-template-columns:1fr!important}
  .value-check-title{font-size:13px!important}
  .value-check-desc{font-size:11px!important}
  .value-check-icon{width:18px!important;height:18px!important;font-size:10px!important}
}
@media(max-width:640px){#pricing .pricing-grid-2{grid-template-columns:1fr!important}}
</style>
</head>
<body>
<div id="cur-dot"></div>
<div id="cur-ring"></div>
<div id="cur-trail"></div>

<!-- ══ Nav ══ -->
<nav>
  <div class="logo">
    <div class="logo-icon">C</div>
    <span class="logo-text">FlamboyAI</span>
  </div>
  <div class="nav-links">
    <a href="#features" class="nav-link">Features</a>
    <a href="#how-it-works" class="nav-link">How it works</a>
    <a href="#pricing" class="nav-link">Pricing</a>
    <a href="#contact" class="nav-link">Get Started</a>
    <a id="nav-login" href="#" class="nav-login">Login</a>
    <a id="nav-signup" href="#" class="nav-cta">শুরু করুন →</a>
  </div>
</nav>

<!-- ══ Hero ══ -->
<section class="hero">
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>

  <div class="hero-badge fade-up">
    <div class="hero-badge-dot"></div>
    বাংলাদেশের Facebook sellers এর পছন্দের platform
  </div>

  <h1 class="fade-up delay-1">
    Facebook এ Business করেন?<br/><span class="grad">বটকে কাজে লাগান — আপনি ঘুমান</span>
  </h1>

  <p class="hero-sub fade-up delay-2">
    Order নেওয়া, reply করা, courier booking — সব automatic।<br/>
    Courier, Accounting, CRM, Analytics — সব <strong style="color:#22d3ee">FREE</strong>।<br/>
    শুধু <strong style="color:#f1f5f9">৳৬৯৯/মাস</strong> + AI reply চার্জ।
  </p>

  <div class="hero-btns fade-up delay-3">
    <a id="hero-signup" href="#" class="btn-primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      ৭ দিন Free Trial শুরু করুন →
    </a>
    <a href="#pricing" class="btn-ghost">Pricing দেখুন ↓</a>
    <a href="https://wa.me/8801575897887" target="_blank" rel="noopener" class="btn-ghost">💬 WhatsApp করুন</a>
  </div>
  <p style="margin-top:14px;font-size:12.5px;color:rgba(148,163,184,0.6);animation:fadeUp .6s .45s ease both">
    🎁 ৭ দিন বিনামূল্যে ব্যবহার করুন — কোনো Credit Card লাগবে না
  </p>

  <!-- Dashboard mockup with floating badges -->
  <div style="position:relative;width:100%;max-width:960px;margin-top:72px">
    <!-- Floating badges -->
    <div class="float-badge badge-tl" style="color:#10b981">
      <div style="font-size:11px;opacity:.7;margin-bottom:2px">আজকের Revenue</div>
      <div style="font-size:18px;letter-spacing:-0.04em">৳ ৮৪,৩২০</div>
    </div>
    <div class="float-badge badge-tr" style="color:#a5b4fc">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:8px;height:8px;background:#4ade80;border-radius:50%;box-shadow:0 0 8px #4ade80"></div>
        <span style="font-size:12px">Bot Active</span>
      </div>
      <div style="font-size:11px;opacity:.6;margin-top:2px">১৪৭ messages today</div>
    </div>
    <div class="float-badge badge-bl">
      <div style="font-size:11px;opacity:.7;margin-bottom:2px">Courier Booked</div>
      <div style="font-size:16px;color:#f59e0b">23 parcel ✓</div>
    </div>

    <div class="hero-img fade-up delay-4" id="heroMockup">
      <div class="mockup-bar">
        <div class="dot" style="background:#ff5f57"></div>
        <div class="dot" style="background:#febc2e"></div>
        <div class="dot" style="background:#28c840"></div>
        <div style="flex:1;text-align:center;font-size:12px;opacity:.28;font-weight:500">FlamboyAI Dashboard</div>
        <div style="font-size:11px;opacity:.25">v17.1</div>
      </div>
      <div class="mockup-content">
        <div class="mock-sidebar">
          <div style="height:20px;border-radius:6px;background:rgba(255,255,255,.06);margin-bottom:8px;width:60%"></div>
          <div class="mock-nav active"></div>
          <div class="mock-nav" style="width:88%"></div>
          <div class="mock-nav" style="width:75%"></div>
          <div class="mock-nav" style="width:92%"></div>
          <div style="height:1px;background:rgba(255,255,255,.06);margin:10px 0"></div>
          <div style="height:10px;border-radius:4px;background:rgba(255,255,255,.03);width:50%;margin-bottom:6px"></div>
          <div class="mock-nav" style="width:82%"></div>
          <div class="mock-nav" style="width:70%"></div>
          <div class="mock-nav" style="width:90%"></div>
        </div>
        <div>
          <div class="mock-main">
            <div class="mock-card">
              <div class="mock-num" style="color:#10b981">৳৮৪,৩২০</div>
              <div class="mock-label">Revenue</div>
              <div class="mock-trend" style="color:#10b981">↑ 23%</div>
            </div>
            <div class="mock-card">
              <div class="mock-num" style="color:#818cf8">১৪৭</div>
              <div class="mock-label">Orders</div>
              <div class="mock-trend" style="color:#818cf8">↑ 18%</div>
            </div>
            <div class="mock-card">
              <div class="mock-num" style="color:#f59e0b">23</div>
              <div class="mock-label">Pending</div>
              <div class="mock-trend" style="color:rgba(245,158,11,.6)">→ same</div>
            </div>
          </div>
          <div class="mock-card" style="margin-top:12px;background:rgba(91,76,245,.06);border-color:rgba(91,76,245,.18)">
            <div style="font-size:10px;font-weight:700;opacity:.38;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Recent Orders</div>
            <div style="display:flex;flex-direction:column;gap:9px">
              <div style="display:flex;justify-content:space-between;font-size:12.5px;align-items:center"><span>Rahim Hossain</span><span style="padding:2px 8px;background:rgba(16,185,129,.12);color:#10b981;border-radius:6px;font-weight:700;font-size:11px">Confirmed</span><span style="color:var(--muted)">৳1,250</span></div>
              <div style="display:flex;justify-content:space-between;font-size:12.5px;align-items:center"><span>Karim Ahmed</span><span style="padding:2px 8px;background:rgba(245,158,11,.12);color:#f59e0b;border-radius:6px;font-weight:700;font-size:11px">Pending</span><span style="color:var(--muted)">৳850</span></div>
              <div style="display:flex;justify-content:space-between;font-size:12.5px;align-items:center"><span>Fatema Begum</span><span style="padding:2px 8px;background:rgba(16,185,129,.12);color:#10b981;border-radius:6px;font-weight:700;font-size:11px">Confirmed</span><span style="color:var(--muted)">৳2,100</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══ Trusted ══ -->
<div class="trusted fade-up">
  <span>বাংলাদেশের Facebook sellers এর trusted platform</span>
  <span style="opacity:.3">•</span>
  <strong>৯৯% order accuracy</strong>
  <span style="opacity:.3">•</span>
  <strong>৩x faster processing</strong>
  <span style="opacity:.3">•</span>
  <strong>২৪/৭ bot active</strong>
  <span style="opacity:.3">•</span>
  <strong>4 courier integrated</strong>
</div>

<!-- ══ Stats ══ -->
<div class="stats-bar" style="margin-top:40px">
  <div class="stat">
    <div class="stat-num" style="background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">৯৯%</div>
    <div class="stat-label">Order Accuracy</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#10b981">৩x</div>
    <div class="stat-label">Faster Processing</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#f59e0b">২৪/৭</div>
    <div class="stat-label">Bot Always Active</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#06b6d4">4+</div>
    <div class="stat-label">Courier Integrated</div>
  </div>
</div>

<!-- ══ FREE Features Highlight ══ -->
<section style="padding:80px 5%;background:rgba(99,102,241,0.04);border-top:1px solid rgba(99,102,241,0.15);border-bottom:1px solid rgba(99,102,241,0.15)" id="value">
  <div style="max-width:1000px;margin:0 auto">
    <div style="text-align:center;margin-bottom:44px">
      <div style="display:inline-block;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.3);border-radius:999px;padding:6px 20px;font-size:12.5px;font-weight:700;color:#22d3ee;margin-bottom:16px">💰 What's Included</div>
      <h2 style="font-size:clamp(26px,4.5vw,44px);font-weight:900;letter-spacing:-0.04em;line-height:1.1;margin-bottom:12px">৳৬৯৯/মাসে যা যা পাচ্ছেন —<br/><span style="color:#22d3ee">সব included, সব FREE</span></h2>
      <p style="font-size:16px;color:var(--muted);max-width:480px;margin:0 auto;line-height:1.7">Platform fee এর মধ্যেই সব major feature।<br/>শুধু AI reply ব্যবহার করলে সামান্য usage চার্জ।</p>
    </div>

    <div class="value-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">

      <!-- Left: Feature checklist -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:32px 28px">
        <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:20px">Platform Fee এ যা পাচ্ছেন</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Smart Bot — ২৪/৭ customer reply</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">Customer message করলে bot product info দেয়, order নেয়</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Order Management — নিজেই note করে</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">Order list, status tracking, confirm — সব dashboard এ</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Courier Booking — Pathao, Steadfast, RedX</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">এক জায়গা থেকে bulk booking, tracking, status</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Accounting — হিসাব-নিকাশ automatic</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">Revenue, expenses, returns, profit — সব auto sync</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Customer CRM — পুরোনো customer track</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">Order history, tags, best buyers, analytics</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Analytics — কোন product বেশি বিকাচ্ছে</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">Week vs last week growth, best products ranking</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Broadcast — সবাইকে একসাথে message</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">নতুন collection launch? একটা click এই সবাই জানবে</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Product Catalog — ছবি দেখলেই price বলবে</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">Public catalog page এ সব product — customer নিজেই দেখতে পারবে</div></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div class="value-check-icon" style="width:22px;height:22px;border-radius:50%;background:rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:12px">✅</div>
            <div><div class="value-check-title" style="font-weight:700;font-size:14px">Memo / Invoice Printing</div><div class="value-check-desc" style="font-size:12px;color:var(--muted);margin-top:2px">প্রতিটি order এর memo/invoice print করুন — custom design সহ</div></div>
          </div>
        </div>
      </div>

      <!-- Right: Cost breakdown + example -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- AI Usage (small extra charge) -->
        <div style="background:var(--surface);border:1px solid rgba(34,211,238,0.2);border-radius:18px;padding:28px">
          <div style="font-size:13px;font-weight:700;color:#22d3ee;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:16px">⚡ শুধু AI Reply এর ছোট charge</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)">
              <div style="font-size:13px;font-weight:600">💬 Text reply</div>
              <div style="font-size:15px;font-weight:900;color:#10b981">৳০.০৫</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)">
              <div style="font-size:13px;font-weight:600">🎙️ Voice note (STT)</div>
              <div style="font-size:15px;font-weight:900;color:#10b981">৳০.৫০</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)">
              <div style="font-size:13px;font-weight:600">🖼️ Customer image check</div>
              <div style="font-size:15px;font-weight:900;color:#10b981">৳১.২০</div>
            </div>
          </div>
        </div>

        <!-- Real example -->
        <div style="background:linear-gradient(135deg,rgba(16,185,129,0.10),rgba(34,211,238,0.06));border:1px solid rgba(16,185,129,0.25);border-radius:18px;padding:28px">
          <div style="font-size:13px;font-weight:700;color:#34d399;margin-bottom:6px">📊 Real Example</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:18px">মাসে ৫০০ text reply পাঠালে কত লাগবে?</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span style="color:var(--muted)">Platform Fee</span>
              <span style="font-weight:700">৳৬৯৯</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span style="color:var(--muted)">৫০০ AI reply × ৳০.০৫</span>
              <span style="font-weight:700">৳২৫</span>
            </div>
            <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0"></div>
            <div style="display:flex;justify-content:space-between">
              <span style="font-weight:800;font-size:15px">মোট/মাস</span>
              <span style="font-weight:900;font-size:20px;color:#34d399">৳৭২৪</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--muted);line-height:1.7">Courier, Accounting, CRM, Analytics — এগুলোর জন্য কোনো আলাদা চার্জ নেই।</div>
        </div>

        <!-- CTA -->
        <a id="value-signup" href="#" style="display:block;text-align:center;padding:15px;background:linear-gradient(135deg,var(--accent),var(--accent3));color:#fff;border-radius:12px;font-weight:800;font-size:15px;text-decoration:none;box-shadow:0 4px 20px rgba(99,102,241,0.4);transition:all .2s">🎁 ৭ দিন Free Trial শুরু করুন — Card লাগবে না →</a>
        <p style="text-align:center;margin-top:10px;font-size:12px;color:rgba(148,163,184,0.55)">Trial শেষে মাত্র ৳৬৯৯/মাস • যেকোনো সময় বাতিল করুন</p>
      </div>

    </div>
  </div>
</section>

<!-- ══ Live 3D Demo ══ -->
<section class="demo-sec" id="live-demo">
  <div class="demo-inner">
    <span class="section-label fade-up">Live Demo</span>
    <h2 class="demo-title fade-up">Bot-এর সাথে কথা বলুন</h2>
    <p class="demo-sub fade-up">দেখুন FlamboyAI bot কিভাবে কাজ করে। নিচের <span style="color:#6366f1;font-weight:700">chat bubble</span>-এ click করে সরাসরি AI-এর সাথে কথা বলুন।</p>

    <div class="scene-root" id="sceneRoot">
      <!-- BG orbs -->
      <div class="scene-bg-orb s-orb-1" id="sOrb1"></div>
      <div class="scene-bg-orb s-orb-2" id="sOrb2"></div>
      <div class="scene-bg-orb s-orb-3" id="sOrb3"></div>
      <!-- Depth grid -->
      <div class="scene-grid-layer" id="sceneGrid"></div>

      <!-- Phone -->
      <div class="phone-scene-wrap" id="phoneWrap">
        <div class="phone-body">
          <div class="p-notch"><div class="p-notch-cam"></div><div class="p-notch-bar"></div></div>
          <div class="p-screen">
            <!-- Messenger header -->
            <div class="ms-hd">
              <div class="ms-back-ic">‹</div>
              <div class="ms-av"></div>
              <div style="flex:1">
                <div class="ms-nm">FlamboyAI Bot</div>
                <div class="ms-ac"><span class="ms-gdot"></span> Active now</div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            </div>
            <!-- Chat area -->
            <div class="ms-chat-area" id="demoChat"></div>
            <!-- Input bar -->
            <div class="ms-bar">
              <div class="ms-inp-box">Type a message...</div>
              <div class="ms-send-ic" style="pointer-events:none;opacity:0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="m22 2-7 20-4-9-9-4Z"/></svg>
              </div>
            </div>
          </div>
          <div class="p-btn-r p-btn-r-1"></div>
          <div class="p-btn-r p-btn-r-2"></div>
          <div class="p-btn-l"></div>
          <div class="p-home"></div>
          <div class="p-shine"></div>
        </div>
      </div>

      <!-- Floating chips -->
      <div class="sc-chip chip-a" id="chipA">
        <div class="sc-ic">✓</div>
        <div><div class="sc-lbl">Order Confirmed</div><div class="sc-val">#CC2847</div></div>
      </div>
      <div class="sc-chip chip-b" id="chipB">
        <div class="sc-ic">৳</div>
        <div><div class="sc-lbl">Revenue Today</div><div class="sc-val">৳৮৪,৩২০</div></div>
      </div>
      <div class="sc-chip chip-c" id="chipC">
        <span class="chip-c-dot"></span><span style="font-size:12.5px;font-weight:700">Bot Active</span>
      </div>
      <div class="sc-chip chip-d" id="chipD">
        <div class="sc-ic">📦</div>
        <div><div class="sc-lbl">Pathao Booked</div><div class="sc-val">ETA 2 days</div></div>
      </div>
    </div>
  </div>
</section>

<!-- ══ Features ══ -->
<section class="section" id="features">
  <div style="max-width:1100px;margin:0 auto">
    <span class="section-label">Features</span>
    <h2 class="section-title">আপনার business এর জন্য<br>যা দরকার</h2>
    <p class="section-sub">Manual কাজ কমান। Bot দিয়ে বেশি order নিন। সব automation এক জায়গায়।</p>
    <div class="features-grid">

      <div class="feature-card" style="--fc-color:rgba(91,76,245,.2)">
        <div class="feature-icon-wrap" style="background:rgba(91,76,245,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="m8 21 4-4 4 4"/><path d="M12 17v4"/></svg>
        </div>
        <div class="feature-title">Smart Bot Automation</div>
        <div class="feature-desc">Customer message করলে bot product info দেবে, order নেবে, confirm করবে। ২৪/৭ কোনো break নেই।</div>
        <span class="feature-tag">Messenger API</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(6,182,212,.2)">
        <div class="feature-icon-wrap" style="background:rgba(6,182,212,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="m3 9 5-5 3 3 6-6 4 4"/></svg>
        </div>
        <div class="feature-title">OCR Product Detection</div>
        <div class="feature-desc">Screenshot থেকে product code detect। Multiple image-processing pass দিয়ে matching সবচেয়ে accurate।</div>
        <span class="feature-tag">AI-Powered</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(16,185,129,.2)">
        <div class="feature-icon-wrap" style="background:rgba(16,185,129,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </div>
        <div class="feature-title">Courier Integration</div>
        <div class="feature-desc">Pathao, Steadfast, RedX, Paperfly — এক জায়গা থেকে। Bulk booking, tracking, status update।</div>
        <span class="feature-tag">4 Couriers</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(245,158,11,.2)">
        <div class="feature-icon-wrap" style="background:rgba(245,158,11,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="feature-title">Full Accounting</div>
        <div class="feature-desc">Revenue, expenses, returns — automatic। Profit হিসাব, growth comparison, detailed report export।</div>
        <span class="feature-tag">Auto Sync</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(236,72,153,.2)">
        <div class="feature-icon-wrap" style="background:rgba(236,72,153,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="feature-title">Customer CRM</div>
        <div class="feature-desc">Order history, tags, notes। Top buyers ranking, best products insight, customer analytics।</div>
        <span class="feature-tag">Built-in CRM</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(139,92,246,.2)">
        <div class="feature-icon-wrap" style="background:rgba(139,92,246,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
        </div>
        <div class="feature-title">Broadcast & Follow-up</div>
        <div class="feature-desc">নতুন collection launch? Broadcast পাঠান। Follow-up ও delivery workflow centrally manage।</div>
        <span class="feature-tag">Smart Automation</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(251,146,60,.2)">
        <div class="feature-icon-wrap" style="background:rgba(251,146,60,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/></svg>
        </div>
        <div class="feature-title">Product Catalog</div>
        <div class="feature-desc">Public URL। Photo, demo video, price। Order করতে Messenger এ redirect। Zero extra cost।</div>
        <span class="feature-tag">Public Page</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(20,184,166,.2)">
        <div class="feature-icon-wrap" style="background:rgba(20,184,166,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
        </div>
        <div class="feature-title">Analytics Dashboard</div>
        <div class="feature-desc">Week vs last week growth। Best products ranking। Order streak। Animated, real-time data।</div>
        <span class="feature-tag">Live Data</span>
      </div>

      <div class="feature-card" style="--fc-color:rgba(99,102,241,.2)">
        <div class="feature-icon-wrap" style="background:rgba(99,102,241,.14)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div class="feature-title">Secure & Reliable</div>
        <div class="feature-desc">AES-256 encryption, webhook HMAC verification, rate limiting। Multi-tenant, production-grade।</div>
        <span class="feature-tag">Enterprise Security</span>
      </div>

    </div>
  </div>
</section>

<!-- ══ How it works ══ -->
<section class="section" id="how-it-works" style="background:rgba(255,255,255,.02);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
  <div style="max-width:1100px;margin:0 auto">
    <span class="section-label">How it works</span>
    <h2 class="section-title">৪ ধাপে শুরু করুন</h2>
    <p class="section-sub">Setup জটিল না। কয়েক মিনিটেই আপনার page automation ready।</p>
    <div class="steps-grid">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-title">Facebook Page Connect</div>
        <div class="step-desc">Page token দিয়ে page connect করুন। কয়েক মিনিটেই setup complete। Webhook auto-configure।</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-title">Products যোগ করুন</div>
        <div class="step-desc">Code, দাম, ছবি, demo video add করুন। Catalog automatically তৈরি। OCR training।</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-title">Bot Activate করুন</div>
        <div class="step-desc">Bot Knowledge set করুন — greeting, product info, order flow। এক click এ automation on।</div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-title">Order Flow চালু করুন</div>
        <div class="step-desc">Bot routine reply ও order capture করবে। Team confirm, courier book, accounting সব automatic।</div>
      </div>
    </div>
  </div>
</section>

<!-- ══ Testimonials ══ -->
<section class="section" id="testimonials">
  <div style="max-width:1100px;margin:0 auto">
    <span class="section-label">Testimonials</span>
    <h2 class="section-title">যারা ব্যবহার করছেন,<br>তারা কী বলেন</h2>
    <div class="testimonials-grid">

      <div class="tcard" style="border-left:3px solid rgba(99,102,241,0.5)">
        <div style="font-size:28px;color:rgba(99,102,241,0.4);margin-bottom:12px;line-height:1">"</div>
        <div class="tcard-text" style="font-style:normal;font-size:15px;line-height:1.75">আগে প্রতিদিন রাত ২টা পর্যন্ত manually order নিতাম। এখন bot সব করে, আমি শুধু confirm করি।</div>
        <div class="tcard-author" style="margin-top:18px">
          <div class="tcard-avatar">র</div>
          <div>
            <div class="tcard-name">রহিম এন্টারপ্রাইজ</div>
            <div class="tcard-sub">Fashion & Clothing, Dhaka</div>
          </div>
        </div>
      </div>

      <div class="tcard" style="border-left:3px solid rgba(34,211,238,0.5)">
        <div style="font-size:28px;color:rgba(34,211,238,0.4);margin-bottom:12px;line-height:1">"</div>
        <div class="tcard-text" style="font-style:normal;font-size:15px;line-height:1.75">Customer ছবি পাঠায়, bot নিজেই product বের করে reply দেয়। আমাকে কিছু করতে হয় না।</div>
        <div class="tcard-author" style="margin-top:18px">
          <div class="tcard-avatar" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">ক</div>
          <div>
            <div class="tcard-name">করিম ফ্যাশন হাউস</div>
            <div class="tcard-sub">Online Boutique, Chittagong</div>
          </div>
        </div>
      </div>

      <div class="tcard" style="border-left:3px solid rgba(16,185,129,0.5)">
        <div style="font-size:28px;color:rgba(16,185,129,0.4);margin-bottom:12px;line-height:1">"</div>
        <div class="tcard-text" style="font-style:normal;font-size:15px;line-height:1.75">Courier booking, accounting, order list — সব এক জায়গায়। আলাদা আলাদা site এ যেতে হয় না।</div>
        <div class="tcard-author" style="margin-top:18px">
          <div class="tcard-avatar" style="background:linear-gradient(135deg,#059669,#10b981)">ফ</div>
          <div>
            <div class="tcard-name">ফাতেমা কালেকশন</div>
            <div class="tcard-sub">Cosmetics & Beauty, Rajshahi</div>
          </div>
        </div>
      </div>

    </div>
  </div>
</section>

<!-- ══ Pricing ══ -->
<section class="section" id="pricing">
  <div style="max-width:860px;margin:0 auto;text-align:center">
    <span class="section-label">Pricing</span>
    <h2 class="section-title">সহজ, transparent pricing</h2>
    <p class="section-sub" style="margin:0 auto">Fixed monthly fee + শুধু actual AI usage এর charge। কোনো hidden cost নেই।</p>

    <div class="pricing-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:52px;text-align:left">

      <!-- Step 1: Base fee -->
      <div class="pricing-card featured" style="padding:32px">
        <div style="position:absolute;top:-60px;right:-60px;width:220px;height:220px;background:radial-gradient(circle,rgba(91,76,245,.18),transparent 70%);pointer-events:none"></div>
        <div class="badge-popular">① Monthly Platform Fee</div>
        <div class="pricing-price" style="margin-top:12px">৳৬৯৯<span style="font-size:17px;font-weight:500;color:var(--muted)">/মাস</span></div>
        <div class="pricing-period">প্রতি Facebook Page এর জন্য</div>
        <ul class="pricing-features">
          <li>AI Bot Automation — ২৪/৭ automatic reply</li>
          <li>Voice Message transcription — audio থেকে text</li>
          <li>Image recognition — customer photo থেকে product search</li>
          <li>Memo / Invoice generation + printing</li>
          <li>Voice Message transcription (Whisper AI)</li>
          <li>Image recognition — product search</li>
          <li>CRM, Orders, Broadcast, Follow-up</li>
          <li>Courier Integration (Pathao, Steadfast, RedX, Paperfly)</li>
          <li>Full Accounting + Product Catalog</li>
          <li>Memo / Invoice generation</li>
        </ul>
      </div>

      <!-- Step 2: Wallet -->
      <div class="pricing-card" style="padding:32px">
        <div class="badge-popular" style="background:rgba(16,185,129,.12);color:#34d399;border-color:rgba(16,185,129,.3)">② Prepaid AI Wallet</div>
        <div class="pricing-price" style="margin-top:12px;font-size:36px">Pay-as-<br>you-go</div>
        <div class="pricing-period" style="margin-bottom:24px">শুধু actual AI usage এর জন্য</div>

        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--border)">
            <div>
              <div style="font-size:13px;font-weight:600">💬 Text Message (AI reply)</div>
              <div style="font-size:11px;color:var(--muted)">AI Bot — প্রতি customer message</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:16px;font-weight:900;color:var(--green)">৳০.০৫</div>
              <div style="font-size:10px;color:var(--muted)">per message</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--border)">
            <div>
              <div style="font-size:13px;font-weight:600">🎙️ Voice Message (STT)</div>
              <div style="font-size:11px;color:var(--muted)">AI — audio থেকে text convert</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:16px;font-weight:900;color:var(--green)">৳০.৫০</div>
              <div style="font-size:10px;color:var(--muted)">per voice note</div>
            </div>
          </div>
          <!-- Image — two tier pricing -->
          <div style="border-radius:10px;border:1px solid rgba(91,76,245,.25);overflow:hidden">
            <div style="padding:8px 14px 6px;background:rgba(91,76,245,.08)">
              <div style="font-size:13px;font-weight:600">🖼️ Customer Image Drop</div>
              <div style="font-size:11px;color:var(--muted)">Local AI বা Vision API — product match</div>
            </div>
            <div style="display:flex;border-top:1px solid rgba(91,76,245,.15)">
              <div style="flex:1;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-right:1px solid rgba(91,76,245,.12)">
                <div>
                  <div style="font-size:11px;font-weight:600;color:#a5b4fc">Local AI</div>
                  <div style="font-size:10px;color:var(--muted)">~৮০% ক্ষেত্রে</div>
                </div>
                <div style="font-size:15px;font-weight:900;color:var(--green)">৳১.২০</div>
              </div>
              <div style="flex:1;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-size:11px;font-weight:600;color:#fbbf24">API Fallback</div>
                  <div style="font-size:10px;color:var(--muted)">ঝাপসা ছবি</div>
                </div>
                <div style="font-size:15px;font-weight:900;color:#f59e0b">৳১.৭০</div>
              </div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--border)">
            <div>
              <div style="font-size:13px;font-weight:600">📦 Product Auto-Analyze</div>
              <div style="font-size:11px;color:var(--muted)">Admin product upload — AI tag generation</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:16px;font-weight:900;color:var(--green)">৳১.৭০</div>
              <div style="font-size:10px;color:var(--muted)">per product</div>
            </div>
          </div>
        </div>

        <div style="font-size:12px;color:var(--muted);line-height:1.6">
          ✦ Dashboard থেকে bKash/Nagad-এ recharge করুন। Balance শেষ হলে AI বন্ধ — order নেওয়া, OCR, courier সব চলবে।
        </div>
      </div>

    </div>

    <!-- ── Real cost example ── -->
    <div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:16px;padding:22px 28px;margin-top:24px;margin-bottom:28px;text-align:left">
      <div style="font-weight:800;font-size:14px;color:#34d399;margin-bottom:4px">📊 Real Example — মাসে ৫০০ text reply হলে কত লাগবে?</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px">Courier, Accounting, CRM, Analytics — এগুলোর জন্য কোনো আলাদা চার্জ নেই</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Platform Fee</div>
          <div style="font-weight:800;font-size:16px">৳৬৯৯</div>
          <div style="font-size:11px;color:var(--muted)">fixed/মাস</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">৫০০ AI text reply</div>
          <div style="font-weight:800;font-size:16px">৳২৫</div>
          <div style="font-size:11px;color:var(--muted)">৫০০ × ৳০.০৫</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Courier + Accounting</div>
          <div style="font-weight:800;font-size:16px">৳০</div>
          <div style="font-size:11px;color:var(--muted)">সম্পূর্ণ FREE</div>
        </div>
        <div style="background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(34,211,238,.1));border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:#a5b4fc;margin-bottom:4px">মোট খরচ/মাস</div>
          <div style="font-weight:900;font-size:20px">৳৭২৪</div>
          <div style="font-size:11px;color:#a5b4fc">৬৯৯ + ২৫ মাত্র!</div>
        </div>
      </div>
    </div>

    <!-- ── CTA contact box ── -->
    <div style="margin:0 auto;max-width:560px;background:linear-gradient(135deg,rgba(91,76,245,.08),rgba(139,92,246,.05));border:1px solid rgba(91,76,245,.22);border-radius:16px;padding:22px 28px;display:flex;align-items:center;gap:18px;text-align:left;flex-wrap:wrap;justify-content:center">
      <div style="font-size:28px">💬</div>
      <div style="flex:1;min-width:200px">
        <div style="font-weight:800;font-size:14.5px;color:var(--text);margin-bottom:4px">শুরু করতে WhatsApp করুন</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6">৳৬৯৯ monthly fee + wallet recharge — bKash/Nagad-এ payment। ২৪ঘণ্টার মধ্যে activate।</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0">
        <a href="https://wa.me/8801575897887" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:7px;padding:11px 22px;background:var(--accent);color:#fff;border-radius:10px;font-weight:700;font-size:13.5px;text-decoration:none;white-space:nowrap;box-shadow:0 2px 12px rgba(91,76,245,.35);transition:all .15s">
          💚 WhatsApp করুন ✦
        </a>
        <a href="https://m.me/flamboyai" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:7px;padding:11px 22px;background:rgba(255,255,255,.06);color:var(--text);border:1px solid var(--border2);border-radius:10px;font-weight:700;font-size:13.5px;text-decoration:none;white-space:nowrap;transition:all .15s">
          💬 Messenger
        </a>
      </div>
    </div>
  </div>
</section>

<!-- ══ CTA ══ -->
<div class="cta-section" id="contact">
  <h2>৭ দিন বিনামূল্যে ব্যবহার করুন</h2>
  <p>Sign up করুন — কোনো Credit Card লাগবে না।<br/>Trial শেষে পছন্দ হলে payment করুন, না হলে চলে যান।</p>
  <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;position:relative">
    <a id="cta-signup" href="#" class="btn-primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      🎁 Free Trial শুরু করুন
    </a>
    <a href="https://wa.me/8801575897887" target="_blank" rel="noopener" class="btn-ghost">💬 WhatsApp এ জিজ্ঞেস করুন</a>
    <a id="cta-login" href="#" class="btn-ghost">Login করুন</a>
  </div>
  <p style="margin-top:12px;font-size:13px;opacity:.55;position:relative">৭ দিন free • Card লাগবে না • যেকোনো সময় বাতিল</p>
  <p style="margin-top:8px;font-size:13.5px;opacity:.6;position:relative">যোগাযোগ: <a href="mailto:info@flamboyai.com" style="color:#a5b4fc;text-decoration:none;font-weight:600">info@flamboyai.com</a></p>
</div>

<!-- ══ Footer ══ -->
<footer>
  <div>
    <div class="footer-logo">
      <div class="logo-icon" style="width:26px;height:26px;font-size:12px;border-radius:7px">C</div>
      <span style="font-size:14px;font-weight:800;letter-spacing:-0.03em">FlamboyAI</span>
    </div>
    <div class="footer-copy">© 2025 FlamboyAI. All rights reserved.</div>
  </div>
  <div class="footer-links">
    <a href="#features" class="footer-link">Features</a>
    <a href="#how-it-works" class="footer-link">How it works</a>
    <a href="#pricing" class="footer-link">Pricing</a>
    <a href="mailto:info@flamboyai.com" class="footer-link">Contact</a>
  </div>
</footer>

<script>
// ── Nav anchor smooth scroll (Robust JS version) ──
document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
  anchor.addEventListener('click', function(e) {
    var id = this.getAttribute('href').substring(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      var top = el.getBoundingClientRect().top + (window.pageYOffset || window.scrollY) - 80;
      try {
        window.scrollTo({ top: top, behavior: 'smooth' });
      } catch (err) {
        window.scrollTo(0, top); // completely fail-safe fallback for older iOS
      }
      try { history.pushState(null, null, '#' + id); } catch(e){}
    }
  });
});

// ── Dashboard URL ──
const DASHBOARD_URL = (function() {
  var h = window.location.hostname, proto = window.location.protocol, port = window.location.port;
  // On localhost, always use local URL regardless of meta tag
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') {
    if (port === '3000' || port === '5500') return proto + '//' + h + ':5173';
    return proto + '//' + window.location.host;
  }
  var meta = document.querySelector('meta[name="dashboard-url"]');
  if (meta) {
    var content = String(meta.getAttribute('content') || '').trim();
    if (content && content !== 'null' && content !== 'undefined' && content !== '/' && content !== '#') {
      if (/^https?:\/\//i.test(content)) return content.replace(/\/+$/, '');
      if (content[0] === '/') return window.location.origin + content.replace(/\/+$/, '');
    }
  }
  return proto + '//' + window.location.host;
})();

['nav-login','cta-login'].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) { el.href = DASHBOARD_URL + '/?mode=login'; el.target = '_top'; }
});
['nav-signup','cta-signup','hero-signup','value-signup'].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) { el.href = DASHBOARD_URL + '/?mode=signup'; el.target = '_top'; }
});

// ── Intersection observer for fade-up ──
var io = new IntersectionObserver(function(entries) {
  entries.forEach(function(e) {
    if (e.isIntersecting) { e.target.style.animation = 'fadeUp .65s cubic-bezier(.22,1,.36,1) forwards'; io.unobserve(e.target); }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-up:not(.hero-badge):not(.hero h1):not(.hero-sub):not(.hero-btns):not(.hero-img)').forEach(function(el) {
  el.style.opacity = '0';
  io.observe(el);
});

// ── Hero mockup 3D parallax ──
(function() {
  var mockup = document.getElementById('heroMockup');
  var orb1 = document.querySelector('.orb-1');
  var orb2 = document.querySelector('.orb-2');
  var orb3 = document.querySelector('.orb-3');
  var hero = document.querySelector('.hero');
  var tX=0,tY=0,cX=0,cY=0;
  var o1x=0,o1y=0,c1x=0,c1y=0;
  var o2x=0,o2y=0,c2x=0,c2y=0;

  function lerp(a,b,t){return a+(b-a)*t}

  function animate(){
    cX=lerp(cX,tX,.07); cY=lerp(cY,tY,.07);
    c1x=lerp(c1x,o1x,.05); c1y=lerp(c1y,o1y,.05);
    c2x=lerp(c2x,o2x,.04); c2y=lerp(c2y,o2y,.04);
    if(mockup) mockup.style.transform='perspective(1200px) rotateX('+(cY*0.008)+'deg) rotateY('+(-cX*0.008)+'deg) translateZ(0)';
    if(orb1) orb1.style.transform='translate('+c1x+'px,'+c1y+'px)';
    if(orb2) orb2.style.transform='translate('+c2x+'px,'+c2y+'px)';
    if(orb3) orb3.style.transform='translate('+(-c1x*.3)+'px,'+(-c1y*.3)+'px)';
    requestAnimationFrame(animate);
  }

  document.addEventListener('mousemove', function(e) {
    if (!hero) return;
    var r = hero.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    tX = (e.clientX - cx) * 0.04;
    tY = (e.clientY - cy) * 0.04;
    o1x = (e.clientX - cx) * 0.022;
    o1y = (e.clientY - cy) * 0.022;
    o2x = -(e.clientX - cx) * 0.016;
    o2y = -(e.clientY - cy) * 0.016;
  });

  animate();
})();

// ── Feature card 3D tilt ──
document.querySelectorAll('.feature-card').forEach(function(card) {
  card.addEventListener('mousemove', function(e) {
    var r = card.getBoundingClientRect();
    var cx = (e.clientX - r.left) / r.width - 0.5;
    var cy = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = 'translateY(-5px) scale(1.012) perspective(700px) rotateX('+(-cy*8)+'deg) rotateY('+(cx*8)+'deg)';
  });
  card.addEventListener('mouseleave', function() {
    card.style.transform = '';
  });
});

// ── Testimonial card 3D tilt ──
document.querySelectorAll('.tcard').forEach(function(card) {
  card.addEventListener('mousemove', function(e) {
    var r = card.getBoundingClientRect();
    var cx = (e.clientX - r.left) / r.width - 0.5;
    var cy = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = 'translateY(-6px) perspective(600px) rotateX('+(-cy*9)+'deg) rotateY('+(cx*9)+'deg) scale(1.02)';
  });
  card.addEventListener('mouseleave', function() {
    card.style.transform = '';
  });
});

// ── Pricing card 3D tilt ──
document.querySelectorAll('.pricing-card').forEach(function(card) {
  card.addEventListener('mousemove', function(e) {
    var r = card.getBoundingClientRect();
    var cx = (e.clientX - r.left) / r.width - 0.5;
    var cy = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = 'perspective(800px) rotateX('+(-cy*6)+'deg) rotateY('+(cx*6)+'deg) translateY(-4px)';
  });
  card.addEventListener('mouseleave', function() {
    card.style.transform = '';
  });
});

// ── Magnetic glow on buttons ──
document.querySelectorAll('.btn-primary,.nav-cta').forEach(function(btn) {
  btn.addEventListener('mousemove', function(e) {
    var r = btn.getBoundingClientRect();
    var x = ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%';
    var y = ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';
    btn.style.setProperty('--mx', x);
    btn.style.setProperty('--my', y);
  });
});

// ── Animated Demo Chat ──
(function() {
  var chat = document.getElementById('demoChat');
  if (!chat) return;

  var msgs = [
    {r:'b', t:'হ্যালো! 👋 আমি FlamboyAI AI bot। কিভাবে সাহায্য করতে পারি?'},
    {r:'u', t:'আপনার service কী?'},
    {r:'b', t:'FlamboyAI হলো Facebook Messenger automation। auto-reply, order management, courier booking সব automatically! 🚀'},
    {r:'u', t:'দাম কত?'},
    {r:'b', t:'মাত্র ৳৬৯৯/মাস। AI reply, order tracking, accounting — সব included! 💰'},
    {r:'u', t:'Trial আছে?'},
    {r:'b', t:'হ্যাঁ! ৭ দিনের free trial — কোনো credit card লাগবে না। ✅'},
  ];

  function addBbl(role, text) {
    var te = document.getElementById('demoTyping');
    if (te) te.remove();
    var el = document.createElement('div');
    el.className = 'ms-bbl ' + role;
    el.style.whiteSpace = 'pre-line';
    el.textContent = text;
    chat.appendChild(el);
    chat.scrollTop = 9999;
  }

  function showTyping() {
    if (!document.getElementById('demoTyping')) {
      var el = document.createElement('div');
      el.className = 'ms-typing-d'; el.id = 'demoTyping';
      el.innerHTML = '<span></span><span></span><span></span>';
      chat.appendChild(el);
      chat.scrollTop = 9999;
    }
  }

  function runDemo() {
    chat.innerHTML = '';
    var delay = 400;
    for (var i = 0; i < msgs.length; i++) {
      (function(m, d) {
        if (m.r === 'b') {
          setTimeout(showTyping, d);
          setTimeout(function() { addBbl('b', m.t); }, d + 900);
        } else {
          setTimeout(function() { addBbl('u', m.t); }, d);
        }
      })(msgs[i], delay);
      delay += msgs[i].r === 'b' ? 2800 : 1400;
    }
    setTimeout(runDemo, delay + 2500);
  }

  runDemo();
})();

// ── Live 3D Demo: scene parallax ──
(function() {
  var root = document.getElementById('sceneRoot');
  if (!root) return;
  var phone = document.getElementById('phoneWrap');
  var grid  = document.getElementById('sceneGrid');
  var orb1  = document.getElementById('sOrb1');
  var orb2  = document.getElementById('sOrb2');
  var orb3  = document.getElementById('sOrb3');
  var chips = [
    document.getElementById('chipA'),
    document.getElementById('chipB'),
    document.getElementById('chipC'),
    document.getElementById('chipD'),
  ];
  var depths = [1.0, 0.8, 1.3, 0.7]; // parallax depth multiplier per chip

  var mx=0,my=0, cx=0,cy=0;
  function lerp(a,b,t){return a+(b-a)*t}

  document.addEventListener('mousemove', function(e) {
    var r = root.getBoundingClientRect();
    if (e.clientY < r.top - 300 || e.clientY > r.bottom + 300) return;
    mx = (e.clientX / window.innerWidth  - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function tick() {
    cx = lerp(cx, mx, 0.055);
    cy = lerp(cy, my, 0.055);

    // Whole scene gentle tilt
    root.style.transform =
      'perspective(1100px) rotateY('+(cx*10)+'deg) rotateX('+(-cy*7)+'deg)';

    // Phone stays centered but tiny z-scale
    if (phone) phone.style.transform =
      'translate(-50%,-50%) translateZ(0px)';

    // Grid shifts opposite (depth illusion)
    if (grid) grid.style.transform =
      'translateX('+(-cx*7)+'px) translateY('+(-cy*5)+'px)';

    // Background orbs parallax at different depths
    if (orb1) orb1.style.transform='translate('+(cx*22)+'px,'+(cy*16)+'px)';
    if (orb2) orb2.style.transform='translate('+(-cx*16)+'px,'+(-cy*12)+'px)';
    if (orb3) orb3.style.transform='translate('+(cx*10)+'px,'+(cy*8)+'px)';

    // Chips: each pops at its own depth → strongest parallax
    chips.forEach(function(chip, i) {
      if (!chip) return;
      var d = depths[i];
      var tz = 30 + i*14;
      chip.style.transform =
        'translateX('+(cx*26*d)+'px) translateY('+(cy*18*d)+'px) translateZ('+tz+'px)';
    });

    requestAnimationFrame(tick);
  }
  tick();

  // Scroll-driven Y drift
  window.addEventListener('scroll', function() {
    var rect = root.getBoundingClientRect();
    var mid  = rect.top + rect.height/2 - window.innerHeight/2;
    var prog = mid / window.innerHeight;
    root.style.marginTop = (-prog * 40) + 'px';
  }, {passive:true});
})();

// ── Custom cursor ──
(function() {
  var isFine = window.matchMedia('(pointer:fine)').matches;
  if (!isFine) return;

  var dot = document.getElementById('cur-dot');
  var ring = document.getElementById('cur-ring');
  var trail = document.getElementById('cur-trail');
  var mx=window.innerWidth/2, my=window.innerHeight/2;
  var dx=mx, dy=my, rx=mx, ry=my;
  var trailTimer=0, trailIdx=0;

  function lerpC(a,b,t){return a+(b-a)*t}

  document.addEventListener('mousemove', function(e) {
    mx = e.clientX; my = e.clientY;
    dot.style.opacity = '1'; ring.style.opacity = '1';
    // trail
    trailTimer++;
    if (trailTimer % 3 === 0 && trail) {
      var p = document.createElement('div');
      p.className = 'trail-dot';
      p.style.left = mx + 'px'; p.style.top = my + 'px';
      p.style.width = '5px'; p.style.height = '5px';
      p.style.opacity = '0.4';
      trail.appendChild(p);
      trailIdx++;
      setTimeout(function() { if(p.parentNode) p.parentNode.removeChild(p); }, 500);
      // keep trail clean
      if (trail.children.length > 30) trail.removeChild(trail.children[0]);
    }
  });

  document.addEventListener('mouseleave', function() {
    dot.style.opacity = '0'; ring.style.opacity = '0';
  });

  // scale on interactive hover
  var interactors = 'a,button,.feature-card,.tcard,.step,.pricing-card,.stat,.mock-card,.nav-cta,.btn-primary,.btn-ghost';
  document.querySelectorAll(interactors).forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      dot.style.width = '14px'; dot.style.height = '14px';
      dot.style.background = '#a78bfa';
      dot.style.boxShadow = '0 0 16px #a78bfa, 0 0 32px rgba(167,139,250,.6)';
      ring.style.width = '58px'; ring.style.height = '58px';
      ring.style.borderColor = 'rgba(167,139,250,.7)';
    });
    el.addEventListener('mouseleave', function() {
      dot.style.width = ''; dot.style.height = '';
      dot.style.background = ''; dot.style.boxShadow = '';
      ring.style.width = ''; ring.style.height = '';
      ring.style.borderColor = '';
    });
  });

  function animCursor() {
    dx = lerpC(dx, mx, 0.22);
    dy = lerpC(dy, my, 0.22);
    rx = lerpC(rx, mx, 0.1);
    ry = lerpC(ry, my, 0.1);
    dot.style.left = dx + 'px'; dot.style.top = dy + 'px';
    ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
    requestAnimationFrame(animCursor);
  }
  animCursor();
})();
</script>

<!-- ── FlamboyAI Live Chat Widget ── -->
<style>
  #cc-bubble {
    position: fixed; bottom: 28px; right: 28px; z-index: 9999;
    width: 56px; height: 56px; border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #22d3ee);
    box-shadow: 0 4px 24px rgba(99,102,241,.5);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform .2s, box-shadow .2s;
  }
  #cc-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 32px rgba(99,102,241,.65); }
  #cc-bubble svg { width: 26px; height: 26px; fill: #fff; }
  #cc-panel {
    position: fixed; bottom: 96px; right: 28px; z-index: 9998;
    width: 340px; height: 520px;
    background: #0f1422; border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 16px 64px rgba(0,0,0,.7);
    display: flex; flex-direction: column; overflow: hidden;
    opacity: 0; transform: translateY(20px) scale(0.97);
    pointer-events: none;
    transition: opacity .25s, transform .25s;
  }
  #cc-panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: all; }
  #cc-header {
    background: linear-gradient(135deg, #1a1f38 0%, #161c2e 100%);
    padding: 12px 14px;
    display: flex; align-items: center; gap: 11px;
    border-bottom: 1px solid rgba(99,102,241,0.18); flex-shrink: 0;
    position: relative; overflow: hidden;
  }
  #cc-header::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, #6366f1, #818cf8, #22d3ee);
  }
  #cc-avatar {
    width: 42px; height: 42px; border-radius: 11px;
    background: #fff url('https://app.flamboyai.com/logo.png') no-repeat;
    background-size: auto 88%;
    background-position: 12% center;
    flex-shrink: 0;
    box-shadow: 0 2px 14px rgba(0,0,0,.3);
    overflow: hidden;
  }
  #cc-header-info { flex: 1; }
  #cc-header-name { font-weight: 800; font-size: 15px; color: #f1f5f9; }
  #cc-header-status { font-size: 11.5px; color: #10b981; display: flex; align-items: center; gap: 4px; margin-top: 1px; }
  #cc-header-status::before { content:''; width:7px; height:7px; border-radius:50%; background:#10b981; display:inline-block; }
  #cc-close { background: none; border: none; cursor: pointer; color: rgba(148,163,184,0.6); font-size: 20px; line-height: 1; padding: 4px; border-radius: 6px; transition: color .15s; }
  #cc-close:hover { color: #f1f5f9; }
  #cc-messages { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.1) transparent; }
  .cc-msg { display: flex; flex-direction: column; max-width: 80%; }
  .cc-msg.bot { align-self: flex-start; }
  .cc-msg.user { align-self: flex-end; }
  .cc-bubble-text { padding: 10px 14px; border-radius: 16px; font-size: 13.5px; line-height: 1.55; font-family: 'DM Sans', sans-serif; word-break: break-word; white-space: pre-wrap; }
  .cc-msg.bot .cc-bubble-text { background: #161c2e; color: #e2e8f0; border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.07); }
  .cc-msg.user .cc-bubble-text { background: #6366f1; color: #fff; border-bottom-right-radius: 4px; }
  #cc-typing { display: none; align-self: flex-start; }
  #cc-typing.show { display: flex; }
  #cc-typing .cc-bubble-text { background: #161c2e; border: 1px solid rgba(255,255,255,0.07); padding: 12px 16px; }
  .cc-dots { display: flex; gap: 4px; align-items: center; }
  .cc-dots span { width: 7px; height: 7px; border-radius: 50%; background: rgba(148,163,184,0.5); animation: ccBounce 1.2s infinite; }
  .cc-dots span:nth-child(2) { animation-delay: .2s; }
  .cc-dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes ccBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px);opacity:1} }
  #cc-footer { padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.08); background: #161c2e; display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
  #cc-input { flex: 1; background: #0f1422; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 9px 14px; color: #f1f5f9; font-size: 13.5px; font-family: 'DM Sans', sans-serif; resize: none; outline: none; max-height: 96px; min-height: 38px; line-height: 1.4; overflow-y: auto; scrollbar-width: none; transition: border-color .15s; }
  #cc-input:focus { border-color: rgba(99,102,241,.5); }
  #cc-input::placeholder { color: rgba(148,163,184,0.4); }
  #cc-send { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; background: #6366f1; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s, transform .1s; }
  #cc-send:hover { background: #4f46e5; }
  #cc-send:active { transform: scale(0.93); }
  #cc-send:disabled { background: rgba(99,102,241,.35); cursor: not-allowed; }
  #cc-send svg { width: 17px; height: 17px; fill: #fff; }
  @media (max-width: 768px) { #cc-bubble { bottom: 80px; right: 20px; } #cc-panel { bottom: 148px; right: 20px; } }
  @media (max-width: 400px) { #cc-bubble { bottom: 80px; right: 14px; } #cc-panel { width: calc(100vw - 28px); right: 14px; bottom: 148px; } }
</style>

<button id="cc-bubble" aria-label="Chat with us" title="Chat with FlamboyAI">
  <svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>
</button>

<div id="cc-panel" role="dialog" aria-label="FlamboyAI support chat">
  <div id="cc-header">
    <div id="cc-avatar"></div>
    <div id="cc-header-info">
      <div id="cc-header-name">FlamboyAI Bot</div>
      <div id="cc-header-status">Active now</div>
    </div>
    <button id="cc-close" aria-label="Close chat">✕</button>
  </div>
  <div id="cc-messages">
    <div class="cc-msg bot">
      <div class="cc-bubble-text">হ্যালো! 👋 আমি FlamboyAI-এর AI assistant। FlamboyAI সম্পর্কে যেকোনো প্রশ্ন করুন — features, pricing, কিভাবে শুরু করবেন সব বলব।</div>
    </div>
    <div id="cc-typing" class="cc-msg bot">
      <div class="cc-bubble-text"><div class="cc-dots"><span></span><span></span><span></span></div></div>
    </div>
  </div>
  <div id="cc-footer">
    <textarea id="cc-input" placeholder="Type a message..." rows="1"></textarea>
    <button id="cc-send" aria-label="Send">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>
</div>

<script>
(function() {
  var bubble=document.getElementById('cc-bubble'),panel=document.getElementById('cc-panel'),closeBtn=document.getElementById('cc-close'),messages=document.getElementById('cc-messages'),input=document.getElementById('cc-input'),sendBtn=document.getElementById('cc-send'),typing=document.getElementById('cc-typing');
  var history=[],busy=false;
  bubble.addEventListener('click',function(){var open=panel.classList.toggle('open');if(open){input.focus();scrollBottom();}});
  closeBtn.addEventListener('click',function(){panel.classList.remove('open');});
  input.addEventListener('input',function(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,96)+'px';});
  input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  sendBtn.addEventListener('click',send);
  function scrollBottom(){setTimeout(function(){messages.scrollTop=messages.scrollHeight;},30);}
  function appendMsg(role,text){
    if(typing.parentNode)messages.removeChild(typing);
    var wrap=document.createElement('div');wrap.className='cc-msg '+role;
    var bub=document.createElement('div');bub.className='cc-bubble-text';bub.textContent=text;
    wrap.appendChild(bub);messages.appendChild(wrap);messages.appendChild(typing);scrollBottom();
  }
  function setTyping(show){typing.classList.toggle('show',show);scrollBottom();}
  function setDisabled(val){busy=val;sendBtn.disabled=val;input.disabled=val;}
  function send(){
    var msg=input.value.trim();if(!msg||busy)return;
    input.value='';input.style.height='auto';
    appendMsg('user',msg);history.push({role:'user',content:msg});
    setDisabled(true);setTyping(true);
    fetch('https://api.flamboyai.com/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg,history:history.slice(-8)})
    }).then(function(r){return r.json();}).then(function(data){
      var reply=data&&data.reply?data.reply:'দুঃখিত, উত্তর পেতে সমস্যা হচ্ছে।';
      setTyping(false);appendMsg('bot',reply);
      history.push({role:'assistant',content:reply});
      if(history.length>20)history=history.slice(-20);
    }).catch(function(){
      setTyping(false);appendMsg('bot','দুঃখিত, সংযোগে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন।');
    }).finally(function(){setDisabled(false);input.focus();});
  }
})();
</script>
</body>
</html>
`;

export function LandingPage(_props: Props) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        background: '#06060a',
      }}
    >
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'radial-gradient(circle at top, rgba(79,70,229,0.22), transparent 38%), #06060a',
            color: '#f0f0f5',
            fontFamily: '"DM Sans","Noto Sans Bengali",system-ui,sans-serif',
            zIndex: 0,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em' }}>FlamboyAI</div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.6 }}>লোড হচ্ছে...</div>
          </div>
        </div>
      )}
      <iframe
        title="FlamboyAI Landing"
        srcDoc={LANDING_HTML}
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          minHeight: '100vh',
          border: 'none',
          display: 'block',
          background: '#06060a',
          position: 'relative',
          zIndex: 1,
          opacity: loaded ? 1 : 0.01,
          transition: 'opacity .18s ease',
        }}
      />
    </div>
  );
}
