# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DF Bot is a multi-tenant SaaS platform for Facebook commerce automation targeting Bengali-speaking e-commerce entrepreneurs. It automates order handling, product detection via OCR, courier integration, and accounting for Facebook page owners.

## Repository Structure

```
df-bot-v17.1/
├── backend/       # NestJS API server (port 3000)
├── dashboard/     # React 19 admin dashboard (port 5173 in dev)
└── landing/       # Static marketing page (no build step)
```

## Commands

### Backend

```bash
cd backend
npm run start:dev       # Development with watch mode
npm run start:prod      # Production (requires prior build)
npm run build           # Prisma generate + TypeScript compile → dist/
npm run lint            # ESLint with auto-fix
npm run test            # Jest unit tests
npm run test:watch      # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # End-to-end tests
npx prisma generate     # Regenerate Prisma client after schema changes
npx prisma migrate deploy  # Apply pending migrations
npx prisma studio       # Visual DB browser
```

### Dashboard

```bash
cd dashboard
npm run dev             # Vite dev server (port 5173)
npm run build           # tsc + Vite production build
npm run lint            # ESLint check
npm run preview         # Preview production build
```

## Key Environment Variables

**Backend** (`.env`):
- `DATABASE_URL` — SQLite (`file:./storage/dev.db`) or PostgreSQL
- `FB_TOKEN_ENCRYPTION_KEY` — 32+ hex chars, used for AES-256 encryption of Facebook tokens
- `FB_WEBHOOK_SECRET` — Meta App Secret for HMAC webhook verification
- `DEFAULT_VERIFY_TOKEN` — Webhook verification token
- `AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD` — Bootstraps the admin account
- `CORS_ORIGINS` — Comma-separated allowed origins (omit for open CORS)
- `PORT` — Defaults to 3000

**Dashboard** (`.env`):
- `VITE_API_BASE` — Backend URL, defaults to `http://localhost:3000`

## Backend Architecture

NestJS with one module per domain. Each module follows the Service-Controller-Module pattern with Prisma for data access.

**Core modules and their responsibilities:**

| Module | Responsibility |
|--------|---------------|
| `auth` | Login, signup, sessions (token-based with expiry) |
| `webhook` | Facebook Messenger webhook entry point |
| `bot` | Intent detection, reply template execution |
| `bot-knowledge` | Bot training data / knowledge base |
| `conversation-context` | Per-conversation state management |
| `messenger` | Facebook Send API wrapper |
| `orders` | Order lifecycle management |
| `products` | Product catalog CRUD |
| `ocr` / `ocr-queue` | Image-to-text for product detection, job queue |
| `courier` | Integrations: Pathao, Steadfast, RedX, Paperfly |
| `accounting` | Revenue, expenses, profit calculations |
| `crm` | Customer records and history |
| `broadcast` | Bulk Messenger campaigns |
| `followup` | Automated follow-up sequences |
| `catalog` | Public-facing product catalog |
| `billing` | Subscription and payment management |
| `page` | Per-page Facebook configuration and settings |
| `facebook` | OAuth flow for connecting Facebook pages |
| `print` / `memo` | Invoice/memo generation and printing |
| `scheduler` | Cron-style automated tasks |
| `admin` | Admin panel backend |
| `common` | Shared utilities: AES-256 encryption, validation helpers |
| `prisma` | Singleton Prisma client |

**Security layers:**
- Rate limiting: 200 req/min globally; 10 attempts/5 min on auth endpoints
- AES-256 encryption for all stored Facebook access tokens (`EncryptionService` in `common`)
- HMAC-SHA256 verification for all incoming Facebook webhooks
- Guard-based RBAC (`client` vs `admin` roles)
- Environment variable validation at startup (crashes early if required vars missing)

**Notable `main.ts` configuration:**
- Body size limit: 1MB (except raw body preserved for webhook HMAC verification)
- Static files served from `/storage` at the `/storage` route
- PM2 process manager config in `ecosystem.config.js` (max 400MB memory, fork mode)

## Dashboard Architecture

React 19 with TypeScript, using screen-based navigation (no router library). The `App.tsx` top-level component manages which screen is shown.

**State management:** Custom hooks only — no Redux/Zustand:
- `useAuth()` — authentication state, login/logout, password change
- `useApi()` — fetch wrapper that injects the auth token
- `useToast()` — toast notification system

**Theme:** Context-based dark/light mode persisted to `localStorage`.

**HTTP:** Native `fetch` API throughout (no Axios or similar).

Pages live in `src/pages/`. Shared UI primitives (inputs, modals, alerts, themed wrappers) are in `src/components/ui.tsx`.

## Database

Prisma ORM. SQLite for development (`./storage/dev.db`), PostgreSQL-compatible for production.

After any schema change in `backend/prisma/schema.prisma`:
1. Create a migration: `npx prisma migrate dev --name <description>`
2. Regenerate client: `npm run prisma:generate`

## Production Deployment (VPS — all services)

**Server:** `root@187.127.206.80` (Ubuntu). SSH key-based access is set up — connect with the alias `ssh flamboyai-vps` (defined in `~/.ssh/config` on the dev machine, `IdentityFile ~/.ssh/id_ed25519`). No password needed.

**IMPORTANT — deployment does NOT use git.** The local working copy's git remote (`github.com/limon9995/chatcatpro.git`) is not the trusted source of truth for this project, so `git pull` on the server is no longer the deploy method. Deploy by **rsyncing files directly from the local working copy to the VPS**, then building/restarting on the server. Always exclude `node_modules`, `dist`, `.env`, and any server-side data/log directories from the sync so you don't clobber production secrets or state.

**Architecture (all on single VPS):**
```
flamboyai.com        →  Nginx serves /var/www/flamboyai/landing/
app.flamboyai.com    →  Nginx serves /var/www/flamboyai/dashboard/dist/
api.flamboyai.com    →  Nginx reverse-proxies to PM2 (NestJS, port 3000)
```

**Deploy backend:**
```bash
rsync -avz --delete \
  --exclude node_modules --exclude dist --exclude .env \
  --exclude storage --exclude logs --exclude "*.db" \
  backend/ flamboyai-vps:/var/www/flamboyai/backend/
ssh flamboyai-vps "cd /var/www/flamboyai/backend && npm ci && npx prisma generate && npx prisma migrate deploy && npm run build && pm2 reload flamboyai"
```

**Deploy dashboard:**
```bash
rsync -avz --delete \
  --exclude node_modules --exclude dist --exclude .env \
  dashboard/ flamboyai-vps:/var/www/flamboyai/dashboard/
ssh flamboyai-vps "cd /var/www/flamboyai/dashboard && npm install && npm run build"   # output to dist/, Nginx serves it
```

**Deploy landing page:**
```bash
rsync -avz --delete landing/ flamboyai-vps:/var/www/flamboyai/landing/
# No build step — static HTML, Nginx serves directly
```

**Useful PM2 commands:**
```bash
ssh flamboyai-vps pm2 status          # check all processes
ssh flamboyai-vps pm2 logs flamboyai  # tail backend logs
ssh flamboyai-vps pm2 reload flamboyai # zero-downtime restart
```

**Before any full deploy:** back up the current live directories on the server first (e.g. `cp -r /var/www/flamboyai/backend /var/www/flamboyai/backend.bak-$(date +%s)`) so a broken deploy can be rolled back quickly — especially since this working copy has had substantial uncommitted backend/dashboard changes that were never verified against production.

> **Note:** There is NO Vercel or external hosting. Everything runs on the VPS.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
