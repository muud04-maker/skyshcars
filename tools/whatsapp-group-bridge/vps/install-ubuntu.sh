#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root: sudo bash install-ubuntu.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl chromium fonts-liberation rsync

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id skycars-reader >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin skycars-reader
fi

install -d -o root -g root -m 0755 /opt/skycars-group-reader/app
install -d -o skycars-reader -g skycars-reader -m 0700 /var/lib/skycars-group-reader

rsync -a --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude .state \
  --exclude logs \
  "${SOURCE_DIR}/" /opt/skycars-group-reader/app/

ln -sfn /opt/skycars-group-reader/app /opt/skycars-group-reader/current
chown -R root:root /opt/skycars-group-reader/app
find /opt/skycars-group-reader/app -type d -exec chmod 0755 {} +
find /opt/skycars-group-reader/app -type f -exec chmod 0644 {} +

npm ci --omit=dev --no-audit --no-fund --prefix /opt/skycars-group-reader/app
chown -R root:root /opt/skycars-group-reader/app

if [[ ! -f /etc/skycars-group-reader.env ]]; then
  install -m 0600 -o root -g root "${SOURCE_DIR}/.env.example" /etc/skycars-group-reader.env
  echo "Created /etc/skycars-group-reader.env. Fill in the real service secret and local QR token." >&2
fi

install -m 0644 -o root -g root "${SCRIPT_DIR}/skycars-group-reader.service" /etc/systemd/system/skycars-group-reader.service
install -m 0644 -o root -g root "${SCRIPT_DIR}/skycars-group-reader-scheduled.service" /etc/systemd/system/skycars-group-reader-scheduled.service
install -m 0644 -o root -g root "${SCRIPT_DIR}/skycars-group-reader.timer" /etc/systemd/system/skycars-group-reader.timer
systemctl daemon-reload
if [[ "${HOURLY_READER:-0}" == "1" ]]; then
  systemctl disable --now skycars-group-reader.service 2>/dev/null || true
  systemctl enable --now skycars-group-reader.timer
  echo "Enabled the hourly 10-minute reader timer."
else
  systemctl enable skycars-group-reader.service
  echo "Enabled the persistent reader service."
fi

echo "Installed. Complete /etc/skycars-group-reader.env, then run:"
echo "  Persistent: systemctl restart skycars-group-reader"
echo "  Hourly 10 minutes: sudo HOURLY_READER=1 bash vps/install-ubuntu.sh"
echo "  Logs: journalctl -u skycars-group-reader -f"
