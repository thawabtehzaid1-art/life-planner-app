#!/usr/bin/env bash
# Align voice assistant, Phase 1 -- VPS setup.
#
# Run this ONCE, as root (or with sudo), on a fresh Hetzner CX33
# (4 vCPU / 8GB RAM, ~EUR8.49/mo, Ubuntu 22.04/24.04 image) after you've
# provisioned it. Installs Ollama, pulls the model this app's
# voice-command Edge Function is configured to call, and puts a minimal
# nginx reverse proxy in front of it that checks a shared secret --
# Ollama itself has no auth of its own and only listens on localhost, so
# nothing is reachable from the internet without that secret.
#
# Usage: VOICE_VPS_SECRET='pick-a-long-random-string' ./voice-vps-setup.sh
#
# After this finishes, set two Supabase secrets (see the bottom of this
# file for the exact commands) and the app is live.

set -euo pipefail

if [ -z "${VOICE_VPS_SECRET:-}" ]; then
  echo "Set VOICE_VPS_SECRET first, e.g.:"
  echo "  VOICE_VPS_SECRET=\$(openssl rand -hex 32) ./voice-vps-setup.sh"
  exit 1
fi

echo "==> Installing Ollama"
curl -fsSL https://ollama.com/install.sh | sh
# Ollama's installer already enables+starts a systemd service bound to
# 127.0.0.1:11434 by default -- deliberately NOT changed to 0.0.0.0 here,
# so it's unreachable from outside this box no matter what nginx does.

echo "==> Pulling the model (qwen2.5:3b -- matches OLLAMA_MODEL in"
echo "    supabase/functions/voice-command/index.ts; change both together"
echo "    if you ever swap models)"
ollama pull qwen2.5:3b

echo "==> Installing nginx as the auth-checking reverse proxy"
apt-get update -y
apt-get install -y nginx

cat > /etc/nginx/sites-available/voice-command <<NGINX
server {
    listen 80;
    server_name _;

    location / {
        if (\$http_authorization != "Bearer ${VOICE_VPS_SECRET}") {
            return 401;
        }
        proxy_pass http://127.0.0.1:11434;
        proxy_set_header Host \$host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/voice-command /etc/nginx/sites-enabled/voice-command
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

cat <<EOF

==> Done. Ollama + nginx are running.

This is plain HTTP so far -- fine for a quick first test, but the
VOICE_VPS_SECRET travels in plaintext until you add TLS. Two ways to add it,
pick one:

  A) Point a subdomain's DNS A record at this VPS's IP, then:
       apt-get install -y certbot python3-certbot-nginx
       certbot --nginx -d voice.yourdomain.com
     (certbot rewrites the nginx config above to add TLS + redirect
     automatically -- re-run 'nginx -t' after if you edited anything else)

  B) No domain wanted: put this behind a Cloudflare Tunnel instead
     (cloudflared) -- gives you a stable HTTPS URL with no open inbound
     port on the VPS at all, no DNS/cert steps here.

Once you have a URL (http://<ip> for a first test, or the https:// one
once A/B above is done), set these two Supabase secrets:

  supabase secrets set VOICE_VPS_URL=https://voice.yourdomain.com
  supabase secrets set VOICE_VPS_SECRET=${VOICE_VPS_SECRET}

...then deploy the function:

  supabase functions deploy voice-command

Sanity check from your own machine:
  curl -s http://<vps-ip>/api/generate \\
    -H "Authorization: Bearer ${VOICE_VPS_SECRET}" \\
    -H "Content-Type: application/json" \\
    -d '{"model":"qwen2.5:3b","prompt":"mark meditation done","system":"Reply with only: mark meditation done","stream":false}'
EOF
