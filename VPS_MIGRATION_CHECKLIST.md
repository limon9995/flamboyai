# VPS Migration Checklist — lessons from the 2026-08-14 migration

This documents what actually happened moving FlamboyAI from `187.127.206.80` (Ubuntu, alias `flamboyai-vps`) to `187.127.214.75` (Kali, alias `new-vps`) — what should have been saved beforehand, what broke, and what had to change. Use this as a checklist next time the server changes.

---

## 1. Before you start — things to pull off the OLD server while it's still alive

**We lost this step last time** — the old server went unreachable mid-migration and never came back, so the new server started with an empty database and several blank secrets. Do this FIRST, before touching DNS or anything else:

- [ ] **Full database dump**: `pg_dump -U <user> -h localhost <db> -F c -f backup.dump` — copy it off the server (`scp`), not just onto its own disk.
- [ ] **The real `backend/.env`** — copy the whole file off the server. It contains values that don't exist anywhere else:
  - `FB_TOKEN_ENCRYPTION_KEY` — **critical**. All stored Facebook/WhatsApp tokens in the DB are AES-256-GCM encrypted with this exact key. If the new server generates a different key, every encrypted token in a migrated database becomes permanently undecryptable. Must be copied byte-for-byte, never regenerated.
  - `FB_WEBHOOK_SECRET`, `FB_OAUTH_STATE_SECRET`, `GOOGLE_OAUTH_STATE_SECRET` — signing secrets; regenerating them invalidates in-flight OAuth flows and signed URLs (e.g. admin page-approve links).
  - `DEFAULT_VERIFY_TOKEN` / `PLATFORM_VERIFY_TOKEN` — webhook verify tokens already registered with Meta.
  - All the API keys: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FB_APP_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`. None of these are recoverable from code — only from the live server, the provider's dashboard, or the user's own records.
- [ ] **`storage/` directory** — uploaded images, logos, any local files the app serves at `/storage`.
- [ ] Note the exact **Node.js version** running (`node -v`) — install the same one on the new box. (Was `v20.20.2`.)
- [ ] Note the **PM2 process list** (`pm2 status`) if anything besides the main app runs on the box.

If you can't reach the old server anymore, you're stuck with a fresh/empty DB and blank secrets until it comes back — this is what happened this time.

---

## 2. Fresh-install gotchas that aren't obvious from `DEPLOYMENT.md`

- **`prisma migrate deploy` does not work on this project.** The very first migration (`20260316101331_init`) still contains leftover SQLite syntax (`AUTOINCREMENT`) that's invalid on Postgres — a relic from before the project switched datasources. Running `migrate deploy` on a clean database fails immediately. Use `npx prisma db push --skip-generate` instead — it builds the schema directly from `schema.prisma` (correct, Postgres-targeted) and ignores the broken migration history entirely.
- **The backend refuses to boot with `DEFAULT_VERIFY_TOKEN` set in production.** A startup `EnvValidator` rejects it outright (`❌ DEFAULT_VERIFY_TOKEN must be unset in production`). This is newer/stricter than what the old server was actually running, so a copied-over `.env` from the old box will crash-loop until that line is deleted. `PLATFORM_VERIFY_TOKEN` is the production-safe replacement.
- **`DASHBOARD_URL` is not documented and is easy to leave unset.** If it's missing, `AuthService.getFrontendBaseUrl()` falls back to `LANDING_PAGE_URL` — which sends Google/Facebook OAuth login callbacks to the **marketing site** (`flamboyai.com`) instead of the **dashboard app** (`app.flamboyai.com`). Symptom: user logs in with Google, gets bounced to the plain landing page instead of the dashboard, with no error shown. Must be set explicitly: `DASHBOARD_URL=https://app.flamboyai.com`.
- **Two half-finished features can crash the whole app on first boot** if you deploy the full local working tree instead of just the files you meant to change (this repo tends to have a large uncommitted backlog — see `CLAUDE.md`'s deploy notes). This time: `PartnerModule` was missing `AuthModule` in its imports (crashed `AuthGuard`), and new `User`/`AgentEarning`/`AgentPayout` columns/tables existed in `schema.prisma` but had no matching migration at all. Fix: `npx prisma migrate diff --from-url <DATABASE_URL> --to-schema-datamodel prisma/schema.prisma --script` — generates the exact missing SQL in one shot instead of finding gaps one crash at a time.
- **Redis is required** (`REDIS_URL`, used by the message queue worker) but isn't mentioned in `DEPLOYMENT.md`'s install steps — `apt-get install redis-server` needs adding.
- **Google OAuth callback redirect URI is registered per-credential in Google Cloud Console.** A Google OAuth client made for a *different* project (wrong `redirect_uris`) will look like it works (valid client ID/secret) but silently fail at the consent-redirect step. Create/verify the OAuth client is scoped to this project with `https://api.flamboyai.com/auth/google/callback` in its authorized redirect URIs.
- **Meta App Secret is never exposed via any API** (confirmed via the Meta Developer Tools MCP — `basic_settings`, `advanced_settings`, `security` all omit it). It only exists in the Meta App Dashboard → Settings → Basic → "Show". Nothing automated can fetch it; budget for the user to copy it manually every time.

---

## 3. What has to change because the app/domain identity is the same but the IP moved

The Meta app (`flamboyai`, id `1620190043007073`) and the domains (`flamboyai.com` / `app.` / `api.`) don't change — only the IP behind them does. Still, a few things need touching:

- [ ] **DNS A records** for `flamboyai.com`, `www`, `app`, `api` → new IP. (Done via Cloudflare, "DNS only" / grey-cloud mode — no proxy — which keeps SSL termination simple, entirely on the VPS.)
- [ ] **SSL certificates** — the old box's Let's Encrypt certs don't transfer. Re-issue on the new box once DNS has propagated: `certbot --nginx -d flamboyai.com -d www.flamboyai.com -d app.flamboyai.com -d api.flamboyai.com --redirect`.
- [ ] **Meta's webhook delivery can lag behind a DNS cutover even after DNS itself has propagated everywhere else.** The *verification* check (`GET /webhook?hub.challenge=...`) succeeded immediately, but real message delivery (`POST /webhook`) silently went nowhere for several minutes afterward — Meta's delivery workers appear to cache the resolved IP separately from whatever their on-demand verification path uses. Forcing an unsubscribe + resubscribe (`devtools_webhook_manage` action `unsubscribe` then `subscribe`, or the Meta App Dashboard's Webhooks page → Unsubscribe/re-verify) triggers a fresh verification handshake and seems to help, but delivery can still take a few minutes to actually resume. Don't assume the bot is broken if a first test message doesn't get a reply within a few seconds right after cutover — verify the *page-level* subscription is real first (see below), then just wait and retry.
- [ ] **Per-page Facebook subscription is separate from the app-level one and doesn't need touching** — it's tied to the Page's own access token via `POST /{page-id}/subscribed_apps`, which the app calls automatically on page connect/reconnect. Verify it directly if debugging: `GET /{page-id}/subscribed_apps?access_token=<page_token>` — should list the app with `subscribed_fields` including `messages`.
- [ ] SSH: generate/reuse a keypair, copy the public key to the new box's `~/.ssh/authorized_keys`, add a `Host` alias to the local `~/.ssh/config`. (`sshpass` didn't work non-interactively in this environment — `can't open /dev/tty` — Python's `paramiko` was the reliable fallback for the first password-based connection.)

---

## 4. Quick debugging order, if "the bot isn't replying" after a migration

1. `curl https://api.flamboyai.com/health` — confirm the backend is up at all.
2. Check `pm2 status` / `logs/err.log` on the new box for crash loops.
3. Confirm the specific Page is connected and `automationOn`/`smartBotOn` are true, `subscriptionStatus` is `ACTIVE` (query the `Page` table).
4. Confirm the app-level Meta webhook subscription is `enabled: true` for the right `callback_url` (`devtools_webhook_list` → `list_subscriptions`).
5. Confirm the *page-level* subscription is real (Graph API `/{page-id}/subscribed_apps` — see above), not just assumed from a log line.
6. Tail `/var/log/nginx/access.log` and the backend's `out.log` while sending a real test message — if nothing shows up in nginx's access log at all, the request isn't reaching the box (DNS/delivery-lag issue, not an app bug). If it shows up but the app doesn't log a matching `[Webhook]` line, it's an app-side parsing/routing issue instead.
