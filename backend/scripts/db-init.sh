#!/bin/bash
# ============================================================
#  FlamboyAI — First-Time Database Setup
#  Use this ONCE on a fresh PostgreSQL database.
#  For subsequent deploys, use deploy.sh (which runs migrate deploy).
# ============================================================

set -e

echo "========================================"
echo "  FlamboyAI — DB Init (First Time)"
echo "========================================"

# Confirm DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set. Create .env first."
  exit 1
fi

echo "DATABASE_URL: ${DATABASE_URL:0:40}..."

# Push schema directly to PostgreSQL (no migration history needed for fresh DB)
echo "[1/2] Pushing Prisma schema to PostgreSQL..."
npx prisma db push

echo "[2/2] Generating Prisma client..."
npx prisma generate

echo ""
echo "✅ Database initialized!"
echo "   Tables created from Prisma schema."
echo "   Future updates: run  npx prisma migrate deploy"
