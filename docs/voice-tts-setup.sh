#!/usr/bin/env bash
# Align voice assistant, Phase 3 -- voice answer-back (TTS) VPS setup.
#
# Run this ONCE, as root (or with sudo), on the SAME VPS that already runs
# Ollama + nginx from docs/voice-vps-setup.sh -- this is additive, not a
# replacement. Installs Piper (self-hosted, CPU-only, no pay-per-use
# provider -- same constraint as Ollama), a tiny Python HTTP wrapper around
# it (Piper itself is a CLI, not a server), and appends a second nginx
# location block (/tts) alongside the existing /api/generate one, gated by
# the SAME shared secret already set up for Ollama.
#
# Usage: VOICE_VPS_SECRET='the same secret you used for voice-vps-setup.sh' ./voice-tts-setup.sh
#
# After this finishes: supabase functions deploy voice-speak
# (no new Supabase secrets needed -- voice-speak reuses VOICE_VPS_URL and
# VOICE_VPS_SECRET, since it's the same VPS and same nginx auth gate.)

set -euo pipefail

if [ -z "${VOICE_VPS_SECRET:-}" ]; then
  echo "Set VOICE_VPS_SECRET first -- must match what voice-vps-setup.sh used,"
  echo "since this appends to the same nginx auth-checking server block:"
  echo "  VOICE_VPS_SECRET='...' ./voice-tts-setup.sh"
  exit 1
fi

echo "==> Installing Piper (fetching the latest Linux x86_64 release)"
apt-get update -y
apt-get install -y jq python3 wget

PIPER_URL=$(curl -fsSL https://api.github.com/repos/rhasspy/piper/releases/latest \
  | jq -r '.assets[] | select(.name == "piper_linux_x86_64.tar.gz") | .browser_download_url')
if [ -z "$PIPER_URL" ]; then
  echo "Couldn't find a piper_linux_x86_64.tar.gz asset on the latest release."
  echo "Check https://github.com/rhasspy/piper/releases manually and adjust this script."
  exit 1
fi
mkdir -p /opt/piper
wget -qO /tmp/piper.tar.gz "$PIPER_URL"
tar -xzf /tmp/piper.tar.gz -C /opt/piper --strip-components=1
rm -f /tmp/piper.tar.gz

echo "==> Downloading the English voice model (en_US-lessac-medium)"
# Matches quickCapture.js's applyWeight/applyExpense/applyHabit/applyTask
# status text, which is hardcoded English regardless of the transcript's
# language -- see the Phase 3 planning session's audit for why an Arabic
# voice would currently have nothing Arabic to actually speak. Swap/add a
# model here later if that status text ever gets localized.
wget -qO /opt/piper/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget -qO /opt/piper/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

echo "==> Installing the HTTP wrapper (Piper has no server mode of its own)"
mkdir -p /opt/piper-server
cat > /opt/piper-server/server.py <<'PYEOF'
#!/usr/bin/env python3
# Minimal HTTP shim around the piper CLI binary. POST /tts {"text": "..."}
# -> WAV bytes on 127.0.0.1:5002 only (nginx is the only thing that talks
# to this; it is never exposed directly to the internet, same principle as
# Ollama in voice-vps-setup.sh).
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PIPER_BIN = "/opt/piper/piper"
MODEL = "/opt/piper/en_US-lessac-medium.onnx"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/tts":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            text = (body.get("text") or "").strip()
        except Exception:
            text = ""
        if not text:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Missing 'text'")
            return
        proc = subprocess.run(
            [PIPER_BIN, "--model", MODEL, "--output_file", "-"],
            input=text.encode("utf-8"),
            capture_output=True,
        )
        if proc.returncode != 0 or not proc.stdout:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(proc.stderr[:2000])
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(proc.stdout)))
        self.end_headers()
        self.wfile.write(proc.stdout)

    def log_message(self, fmt, *args):
        pass  # systemd journal already captures what matters via stderr


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 5002), Handler).serve_forever()
PYEOF
chmod +x /opt/piper-server/server.py

echo "==> Installing the wrapper as a systemd service (auto-restarts, same"
echo "    pattern you already switched cloudflared to)"
cat > /etc/systemd/system/piper-server.service <<'UNITEOF'
[Unit]
Description=Piper TTS HTTP wrapper
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/piper-server/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable --now piper-server

echo "==> Appending the /tts location to the existing nginx server block"
NGINX_CONF="/etc/nginx/sites-available/voice-command"
if [ ! -f "$NGINX_CONF" ]; then
  echo "Expected $NGINX_CONF to already exist from voice-vps-setup.sh -- not found."
  exit 1
fi
if grep -q "location /tts" "$NGINX_CONF"; then
  echo "location /tts already present in $NGINX_CONF -- leaving it as-is."
else
  # Insert the new location block right before the server block's closing
  # brace, so it sits alongside the existing "location /" (Ollama) block
  # inside the same server { ... }, sharing the same listen/server_name and
  # the same shared-secret check pattern (own literal copy, not a shared
  # variable, since nginx's `if` can't easily be factored across locations).
  python3 - "$NGINX_CONF" "$VOICE_VPS_SECRET" <<'PYEOF'
import sys
path, secret = sys.argv[1], sys.argv[2]
with open(path) as f:
    conf = f.read()
block = f'''
    location /tts {{
        if ($http_authorization != "Bearer {secret}") {{
            return 401;
        }}
        proxy_pass http://127.0.0.1:5002;
        proxy_set_header Host localhost;
    }}
'''
idx = conf.rstrip().rfind("}")
conf = conf[:idx] + block + conf[idx:]
with open(path, "w") as f:
    f.write(conf)
PYEOF
fi
nginx -t
systemctl reload nginx

cat <<EOF

==> Done. Piper is running behind nginx at /tts, same VPS, same secret.

Sanity check from your own machine:
  curl -s https://<your-tunnel-url>/tts \\
    -H "Authorization: Bearer $VOICE_VPS_SECRET" \\
    -H "Content-Type: application/json" \\
    -d '{"text":"Logged 78.0 kilograms."}' \\
    -o /tmp/test.wav
  (then play /tmp/test.wav, or check its size/header, to confirm it's real audio)

No new Supabase secrets needed -- voice-speak (see
supabase/functions/voice-speak/index.ts) reuses VOICE_VPS_URL and
VOICE_VPS_SECRET, since it's the same VPS behind the same nginx gate.
Just deploy it:

  supabase functions deploy voice-speak
EOF
