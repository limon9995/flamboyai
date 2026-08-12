#!/bin/bash
# One-time production hardening for the FlamboyAI VPS.
# Run as root on the server:  bash /var/www/flamboyai/backend/scripts/vps-setup-production.sh
set -e

echo "── 1/4 Daily backup script ──────────────────────────────────"
mkdir -p /root/backups
# Encryption passphrase for off-site (Telegram) copies — created once.
# SAVE THIS SOMEWHERE SAFE: without it the Telegram backups cannot be opened.
if [ ! -f /root/.backup-pass ]; then
  openssl rand -base64 24 > /root/.backup-pass
  chmod 600 /root/.backup-pass
fi
cat > /root/backup-FlamboyAI.sh << 'EOF'
#!/bin/bash
# Daily FlamboyAI backup: PostgreSQL DB + file storage. Keeps last 7 days locally.
# Also sends an AES-256-encrypted copy to the admin Telegram bot (off-site).
set -e
STAMP=$(date +%F)
DIR=/root/backups/$STAMP
mkdir -p "$DIR"
sudo -u postgres pg_dump flamboyai_dev | gzip > "$DIR/flamboyai-db-$STAMP.sql.gz"
tar czf "$DIR/FlamboyAI-storage-$STAMP.tar.gz" -C /var/www/flamboyai/backend storage data 2>/dev/null || true
find /root/backups -maxdepth 1 -type d -name "20*" -mtime +7 -exec rm -rf {} \;
echo "$(date -Is) backup OK -> $DIR ($(du -sh "$DIR" | cut -f1))" >> /root/backups/backup.log

# ── Off-site copy: encrypt, then send to admin Telegram bot ──
# Token/chatId come from the app's admin settings (storage/settings/api-keys.json).
# Decrypt later with:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/.backup-pass -in FILE.enc -out FILE
KEYS=/var/www/flamboyai/backend/storage/settings/api-keys.json
TOKEN=$(python3 -c "import json;print(json.load(open('$KEYS')).get('telegramBotToken',''))" 2>/dev/null || true)
CHATID=$(python3 -c "import json;print(json.load(open('$KEYS')).get('telegramChatId',''))" 2>/dev/null || true)
if [ -n "$TOKEN" ] && [ -n "$CHATID" ] && [ -f /root/.backup-pass ]; then
  SENT=0
  for f in "$DIR"/*"$STAMP"*.gz; do
    [ -e "$f" ] || continue
    openssl enc -aes-256-cbc -pbkdf2 -pass file:/root/.backup-pass -in "$f" -out "$f.enc"
    if curl -s -F chat_id="$CHATID" -F document=@"$f.enc" \
        -F caption="🐱 FlamboyAI backup $STAMP — $(basename "$f").enc (AES-256 encrypted)" \
        "https://api.telegram.org/bot$TOKEN/sendDocument" | grep -q '"ok":true'; then
      SENT=$((SENT+1))
    else
      echo "$(date -Is) telegram send FAILED: $f" >> /root/backups/backup.log
    fi
    rm -f "$f.enc"
  done
  echo "$(date -Is) telegram sent $SENT file(s)" >> /root/backups/backup.log
fi
EOF
chmod 700 /root/backup-FlamboyAI.sh
bash /root/backup-FlamboyAI.sh
echo "Test backup done:"; ls -lh "/root/backups/$(date +%F)/"
tail -2 /root/backups/backup.log
echo ""
echo "⚠️  IMPORTANT: copy the encryption passphrase below into a password manager."
echo "    Without it, the Telegram backup copies CANNOT be decrypted:"
echo "    $(cat /root/.backup-pass)"

echo "── 2/4 Cron: backup every night 21:00 UTC (3 AM Bangladesh) ─"
( crontab -l 2>/dev/null | grep -v backup-FlamboyAI.sh ; echo "0 21 * * * /root/backup-FlamboyAI.sh" ) | crontab -
crontab -l

echo "── 3/4 Log rotation for PM2 + app logs ─────────────────────"
cat > /etc/logrotate.d/pm2-apps << 'EOF'
/root/.pm2/logs/*.log /var/www/flamboyai/backend/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    copytruncate
}
EOF
logrotate -d /etc/logrotate.d/pm2-apps 2>&1 | tail -2

echo "── 4/4 PM2 survives reboot ──────────────────────────────────"
pm2 startup systemd -u root --hp /root | tail -1 | bash - 2>/dev/null || true
pm2 save

echo ""
echo "✅ Done: nightly backups (7-day retention), logrotate, PM2 reboot persistence."
