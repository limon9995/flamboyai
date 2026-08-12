# WhatsApp Automation — Setup Guide

এই guide-এ দুইটা অংশ:
- **Part A** — একবারের জন্য যা করতে হবে (Meta App ready করা)
- **Part B** — নিজের নম্বর দিয়ে automation চালু করা
- **Part C** — client-এর নম্বর দিয়ে automation চালু করা (নতুন zero-touch flow)

সবগুলোতেই মূল কথা একটাই: **সব WhatsApp Business Account (WABA) — নিজের হোক বা client-এর — agency-র একটাই Meta Business Portfolio-র ভেতরে থাকবে।** এতে Meta App Review / Live mode লাগে না (Standard Access-ই যথেষ্ট), শুধু owner-verification-এর জন্য একটা OTP লাগে যেটা number-এর মালিক (আপনি বা client) দিয়ে দিলেই হয়ে যায়।

---

## Part A — একবারের জন্য (আগেই না করা থাকলে করুন)

1. **business.facebook.com**-এ গিয়ে login করুন — যে Facebook profile দিয়ে Page automation-এর জন্য moderator access management করেন, সেটাই ব্যবহার করুন।
2. যদি এখনো কোনো Business Portfolio (Business Manager account) না থাকে, একটা তৈরি করুন (agency-র নামে, যেমন "FlamboyAI" বা আপনার agency-র নাম)।
3. **Meta App**: আমাদের existing App (`FB_APP_ID = 856374517446840`, যেটা Facebook Messenger-এর জন্য ব্যবহার হচ্ছে) — এতেই WhatsApp product যোগ করতে পারবেন। developers.facebook.com → My Apps → এই App → বাম sidebar-এ "Add Product" → **WhatsApp** → Set Up।
   - (চাইলে আলাদা একটা App-ও বানাতে পারেন, কিন্তু একই App ব্যবহার করলে setup সহজ হয়।)
4. **Webhook — এটা শুধু একবার করতে হবে, তারপর প্রতিটা নতুন number automatic এর আওতায় চলে আসবে:**
   - ⚠️ **গুরুত্বপূর্ণ ক্রম**: এই ধাপটা আগে করা যাবে না — আমাদের backend webhook verify করে শুধু তখনই যদি সেই token কোনো ইতিমধ্যে-connected (waEnabled=true) number-এর সাথে match করে। তাই **প্রথমে Part B-এর ধাপ 1-6 করে অন্তত একটা নম্বর (আপনার নিজের) dashboard-এ save + enable করে ফেলুন**, তারপর এই webhook ধাপে ফিরে আসুন।
   - App → WhatsApp → Configuration → Webhook
   - Callback URL: `https://api.flamboyai.com/wa-webhook`
   - Verify Token: dashboard-এ Part B ধাপ 6-এ যে verify token generate করেছিলেন, **ঠিক সেটাই** এখানে বসান
   - "Verify and Save" click করুন — এবার সফল হবে
   - তারপর "Webhook fields" list-এ **`messages`** row খুঁজে বের করে তার পাশে **Subscribe** ON করুন (এটাই আসল, `account_alerts` লাগবে না)
   - এই ধাপ একবার হয়ে গেলে ভবিষ্যতের প্রতিটা নতুন (client) number এই screen-এ আর ফিরে আসতে হবে না — automatic কাজ করবে।
5. **Business Verification** (recommended, না করলেও ২টা নম্বর পর্যন্ত চলবে): business.facebook.com → Business Settings → Security Center → Start Verification → trade license/NID জমা দিন। এটা এক-কালীন কাজ, Meta App Review-এর মতো কঠিন না — শুধু KYC documents জমা দেওয়া। এটা করা থাকলে ২টার বেশি number agency-র Business Portfolio-তে রাখতে পারবেন (client বাড়লে দরকার হবে)।

---

## Part B — নিজের নম্বর দিয়ে automation চালু করা

যেহেতু এটা আপনার নিজের নম্বর, পুরো flow-টা নিজেই করে ফেলতে পারবেন — কোনো request/approval লাগবে না।

1. **business.facebook.com** → Business Settings → Accounts → **WhatsApp Accounts** → Add → "Create a WhatsApp Business Account" → নাম দিন (যেমন "FlamboyAI - Main")
2. WABA-র ভেতরে **Add phone number** → আপনার নম্বরটা দিন → SMS বা Call-এ OTP আসবে → verify করুন (নম্বরটা আপনার নিজের বলে OTP-টা আপনিই পাবেন)
3. এই WABA-টাকে App-এর সাথে connect করুন: App Dashboard → WhatsApp → Configuration → "Add phone number" বা "Link a WhatsApp Business Account" থেকে Part A-তে বানানো App-এর সাথে এই WABA select করুন। (এটা করলে webhook automatic এই number-এর জন্যও কাজ করবে — নতুন করে webhook বসাতে হবে না)
4. **System User Token generate করুন:**
   - Business Settings → Users → System Users → Add → নাম দিন, Role: Admin
   - এই System User-এ click করুন → "Add Assets" → WhatsApp Accounts → আপনার WABA select করুন → Full Control ON করুন
   - "Generate New Token" → App select করুন → permission: `whatsapp_business_messaging`, `whatsapp_business_management` → Generate → token কপি করুন (এটা permanent, শুধু একবারই দেখাবে, সেভ করে রাখুন)
5. **Phone Number ID কপি করুন:** App → WhatsApp → API Setup → "From" section-এ Phone Number ID দেখাবে
6. **Dashboard-এ যোগ করুন:**
   - app.flamboyai.com-তে নিজের account দিয়ে login করুন → Settings → WhatsApp Connection
   - "নিজে setup করতে চান? (Advanced)" এর নিচে "Manual token entry দেখান" click করুন
   - Phone Number ID, Access Token paste করুন, Webhook Verify Token "🔀 Generate" দিয়ে বানিয়ে নিন
   - Save করুন, তারপর toggle ON করুন
7. **Test করুন:** নিজের WhatsApp number থেকে ওই business number-এ "hi" লিখে message পাঠান — bot reply দিলে কাজ শেষ।

---

## Part C — Client-এর নম্বর দিয়ে automation চালু করা (নতুন zero-touch flow)

এখানে client-কে **শুধু নম্বরটা দিতে হবে আর একটা OTP call receive করতে হবে** — বাকি সব আপনি করবেন।

### Client-এর করণীয় (এইটুকুই):
1. app.flamboyai.com-তে login করে **Settings → WhatsApp Connection**-এ যাবে
2. "✨ WhatsApp Automation চালু করতে চান?" card-এ তার WhatsApp Business নম্বর দিয়ে "📲 Request পাঠান" click করবে
3. এরপর অপেক্ষা করবে — Telegram-এ আপনার কাছে notification চলে যাবে

### আপনার (admin) করণীয়:
1. Telegram notification পাওয়ার পর **Admin Panel → WhatsApp Requests** ট্যাবে যান, pending request দেখতে পাবেন (client-এর নাম, page, ফোন নম্বর দেখাবে)
2. Part B-এর ধাপ 1-5 ঠিক একইভাবে করুন, কিন্তু **client-এর নম্বর দিয়ে**:
   - নতুন WABA বানান (client-এর নামে/business-এর নামে, যেমন "Client Shop Name")
   - সেই নম্বর যোগ করুন → **OTP verification-এর জন্য client-কে ফোন করে বলুন OTP code-টা জানাতে** (নম্বরটা তার, তাই OTP সে-ই পাবে)
   - WABA-টাকে Part A-এর App-এর সাথে link করুন (যেহেতু webhook আগেই বসানো আছে, নতুন করে কিছু করতে হবে না)
   - System User দিয়ে token generate করুন (Part B ধাপ 4)
   - Phone Number ID কপি করুন (Part B ধাপ 5)
3. **Admin Panel → WhatsApp Requests**-এ ফিরে এসে সেই request-এর ঘরে:
   - Phone Number ID paste করুন
   - System User Token paste করুন
   - Webhook Verify Token খালি রাখলেও চলবে (auto-generate হয়ে যাবে)
   - "✅ Connect করুন" click করুন
4. Backend automatic client-এর Page-এ WhatsApp চালু করে দেবে (token encrypt হয়ে সেভ হবে, `waEnabled = true`)
5. Client-কে জানিয়ে দিন যে চালু হয়ে গেছে — client নিজে dashboard-এ Settings → WhatsApp Connection-এ গেলেই "connected" status দেখতে পাবে

### একটা নম্বরের জন্য মোটামুটি সময় লাগবে:
- আপনার কাজ (Meta-তে setup + token generate): ৫-১০ মিনিট
- Client-এর কাজ: request পাঠানো (৩০ সেকেন্ড) + একটা OTP call receive করা (১ মিনিট)

---

## গুরুত্বপূর্ণ নোট

- **App Review লাগবে না** — যতক্ষণ সব WABA আপনার একই Business Portfolio-র ভেতরে থাকবে, ততক্ষণ Standard Access দিয়েই কাজ চলবে।
- **২টা number-এর limit**: Business Verification (Part A ধাপ 5) না করা থাকলে একটা Business Portfolio-তে সর্বোচ্চ ২টা phone number রাখা যায়। ৩য় client থেকেই verification লাগবে — এটা এক-কালীন কাজ, বেশি সময় লাগে না।
- **Token কখনো হারাবেন না** — System User Token শুধু generate করার সময় একবারই দেখায়, পরে আর দেখা যায় না। হারিয়ে ফেললে নতুন token generate করে আবার Admin Panel থেকে paste করতে হবে (`finalize` আবার করা যায় শুধু request pending অবস্থায়; connected হয়ে গেলে token বদলাতে Settings → WhatsApp Connection-এর Advanced entry ব্যবহার করতে হবে)।
- **AI reply, OCR payment screenshot, voice message বোঝা** — এগুলো সব already চালু আছে WhatsApp-এ (Facebook-এর মতোই), শুধু page-এর SmartBot toggle ON থাকতে হবে।
