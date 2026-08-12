#!/bin/bash
# ============================================================
#  FlamboyAI — Backend Deploy Script
#  Run on VPS after pulling latest code:
#    cd /var/www/flamboyai/backend
#    bash scripts/deploy.sh
# ============================================================

set -e  # Stop on first error

echo "========================================"
echo "  FlamboyAI — Deploy $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# 1. Stop PM2 process to free up memory
echo "Stopping PM2 flamboyai process to free up memory..."
pm2 stop flamboyai || true

# 2. Install ALL dependencies (including devDeps needed for build)
echo "[1/6] Installing all dependencies..."
npm install

# 3. Generate Prisma client
echo "[2/6] Generating Prisma client..."
npx prisma generate

# 4. Sync schema to database (db push — safe for PostgreSQL with no migration history)
echo "[3/6] Syncing database schema..."
npx prisma db push --accept-data-loss

# 5. Build the NestJS app
echo "[4/6] Building application..."
node --max-old-space-size=800 ./node_modules/@nestjs/cli/bin/nest.js build

# 6. Remove devDependencies after build to save memory
echo "[5/6] Pruning dev dependencies..."
npm prune --omit=dev

# 6. Restart PM2
echo "[6/6] Restarting PM2..."
mkdir -p logs
pm2 reload ecosystem.config.js --env production || pm2 start ecosystem.config.js --env production

echo ""
echo "✅ Deploy complete!"
echo "   Logs: pm2 logs flamboyai"
echo "   Status: pm2 status"
