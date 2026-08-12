# FlamboyAI — Production Deployment Guide

## Architecture

```
flamboyai.com        →  VPS Nginx  (Static landing page)
app.flamboyai.com    →  VPS Nginx  (React dashboard dist/)
api.flamboyai.com    →  VPS Nginx  (NestJS backend, reverse proxy to PM2)
```

---

## 1. VPS Setup (Ubuntu 22.04)

### Install Node.js 20 + PM2 + Nginx

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib
```

### Create PostgreSQL database

```bash
sudo -u postgres psql
```

```sql
CREATE USER FlamboyAI WITH PASSWORD 'StrongPassHere';
CREATE DATABASE flamboyai OWNER FlamboyAI;
GRANT ALL PRIVILEGES ON DATABASE flamboyai TO FlamboyAI;
\q
```

---

## 2. Backend Deployment

### Clone and configure

```bash
cd /var/www
git clone https://github.com/your-repo/flamboyai.git
cd flamboyai/backend

# Create .env from template
cp .env.example .env
nano .env   # Fill in all real values
```

**Required .env values for production:**

```env
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://FlamboyAI:StrongPassHere@localhost:5432/flamboyai"
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=YourSecurePassword123!
AUTH_ADMIN_EMAIL=admin@flamboyai.com
FB_TOKEN_ENCRYPTION_KEY=<64-char hex from: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
FB_WEBHOOK_SECRET=<your Facebook App Secret>
FB_OAUTH_STATE_SECRET=<another random secret>
FB_APP_ID=<your Facebook App ID>
FB_APP_SECRET=<same as FB_WEBHOOK_SECRET>
FB_REDIRECT_URI=https://api.flamboyai.com/facebook/callback
CORS_ORIGINS=https://flamboyai.com,https://www.flamboyai.com
LANDING_PAGE_URL=https://flamboyai.com
STORAGE_PUBLIC_URL=https://api.flamboyai.com/storage
GMAIL_USER=otp@flamboyai.com
GMAIL_APP_PASSWORD=<Gmail App Password>
```

### First-time database setup

```bash
# Install all deps (including devDependencies for the build step)
npm install

# Initialize database schema (FIRST TIME ONLY)
bash scripts/db-init.sh

# Build the app
npm run build

# Create logs directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # Follow the command it prints to enable auto-start
```

### Subsequent deployments

```bash
cd /var/www/flamboyai/backend
git pull
bash scripts/deploy.sh
```

The deploy script does:
1. `npm ci --omit=dev` — clean install (production only)
2. `npx prisma generate` — regenerate Prisma client
3. `npx prisma migrate deploy` — apply any new migrations
4. NestJS build
5. `pm2 reload` — zero-downtime restart

---

## 3. Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/flamboyai
```

```nginx
server {
    listen 80;
    server_name api.flamboyai.com;

    # Required for Facebook webhook HMAC verification
    # Passes raw body to NestJS — do NOT enable buffering here
    location /webhook {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_request_buffering off;   # IMPORTANT: raw body must reach NestJS intact
    }

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 10M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/flamboyai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Add SSL with Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.flamboyai.com
# Certbot auto-renews — check with: sudo certbot renew --dry-run
```

---

## 4. Dashboard Deployment (VPS)

```bash
cd /var/www/flamboyai/dashboard
git pull origin main
npm install
npm run build    # outputs to dist/
```

Nginx serves the `dist/` directory for `app.flamboyai.com`.
The `.env` on the server should have:
```
VITE_API_BASE=https://api.flamboyai.com
```

## 4b. Landing Page Deployment (VPS)

```bash
cd /var/www/flamboyai/landing
git pull origin main
# No build step — static HTML served by Nginx
```

**DNS records (all point to VPS IP):**
```
A     flamboyai.com        →  187.127.157.248
A     app.flamboyai.com    →  187.127.157.248
A     api.flamboyai.com    →  187.127.157.248
```

---

## 5. Local Development with PostgreSQL

### Option A: Docker (recommended)

```bash
docker run -d \
  --name FlamboyAI-pg \
  -e POSTGRES_USER=FlamboyAI \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=flamboyai_dev \
  -p 5432:5432 \
  postgres:16-alpine
```

Set in `backend/.env`:
```env
DATABASE_URL="postgresql://FlamboyAI:devpass@localhost:5432/flamboyai_dev"
NODE_ENV=development
```

Then:
```bash
cd backend
npx prisma db push    # create schema
npm run start:dev
```

### Option B: Local PostgreSQL

```bash
sudo -u postgres createuser --interactive FlamboyAI
sudo -u postgres createdb flamboyai_dev
```

---

## 6. Schema Changes (Future)

When you update `prisma/schema.prisma`:

**Local dev:**
```bash
npx prisma db push         # apply change immediately (no migration file)
# or for proper migration tracking:
npx prisma migrate dev --name describe_what_changed
```

**Production:**
```bash
# If you used migrate dev locally:
npx prisma migrate deploy  # already in deploy.sh

# If you used db push locally:
npx prisma db push         # push schema directly
```

---

## 7. Useful Commands

```bash
# PM2
pm2 status                  # check process status
pm2 logs flamboyai         # tail logs
pm2 logs flamboyai --lines 100  # last 100 lines
pm2 reload flamboyai       # zero-downtime reload
pm2 restart flamboyai      # hard restart

# Database
npx prisma studio           # visual DB browser (on VPS, use SSH tunnel)
npx prisma migrate status   # check migration status

# Health check
curl https://api.flamboyai.com/health
```

---

## 8. Important Notes

| Topic | Detail |
|-------|--------|
| **Webhook raw body** | Facebook HMAC verification requires raw body. NestJS handles this — Nginx must NOT re-buffer with `proxy_request_buffering off` on `/webhook`. |
| **Trust proxy** | NestJS has `app.set('trust proxy', 1)` — required for correct client IP detection behind Nginx. Rate limiting won't work without this. |
| **FB_TOKEN_ENCRYPTION_KEY** | If this key changes, all stored Facebook tokens become unreadable. Never rotate this without re-encrypting stored tokens. |
| **CORS** | Set `CORS_ORIGINS=https://flamboyai.com,https://www.flamboyai.com` — omitting this allows all origins (dev only). |
| **Storage** | Uploaded images/files are stored in `backend/storage/`. Back this up or mount a persistent volume on DigitalOcean. |
| **Old SQLite migrations** | Existing migrations in `prisma/migrations/` were generated for SQLite. They cannot be applied to PostgreSQL. Use `scripts/db-init.sh` (runs `prisma db push`) for first-time setup. |
