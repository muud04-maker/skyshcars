# Sky Cars Group Reader on Ubuntu

The Group Reader must run on a separate always-on Ubuntu VPS. The website host does not keep
`whatsapp-web.js` browser sessions.

## One-time installation

Run as root from a downloaded or cloned copy of this folder:

```bash
sudo bash vps/install-ubuntu.sh
sudo editor /etc/skycars-group-reader.env
```

Set these values without committing or pasting them into chat:

```dotenv
SKY_CARS_URL=https://skyshcars.com
WHATSAPP_SERVICE_SECRET=<same value as the website>
BRIDGE_ID=hostinger-vps
STATE_DIR=/var/lib/skycars-group-reader
QR_BIND_HOST=127.0.0.1
QR_PORT=3199
QR_ADMIN_TOKEN=<new long random value>
```

Start and inspect the service:

```bash
sudo systemctl restart skycars-group-reader
sudo systemctl status skycars-group-reader
sudo journalctl -u skycars-group-reader -f
```

## Private QR workflow

From the administrator's computer, open an SSH tunnel:

```bash
ssh -N -L 3199:127.0.0.1:3199 <vps-user>@<vps-address>
```

Then open this URL locally:

```text
http://127.0.0.1:3199/?token=<QR_ADMIN_TOKEN>
```

Scan the displayed code on the phone that is a member of **Sky cars motorcycles**:
WhatsApp -> Settings -> Linked devices -> Link a device.

The service binds the QR page to loopback only. Do not add a public proxy, firewall rule or DNS
record for port 3199. The page refreshes every 15 seconds and displays the live reader state.

## Persistent state

- WhatsApp session: `/var/lib/skycars-group-reader/session`
- Durable retry outbox: `/var/lib/skycars-group-reader/outbox`
- Recovered message groups: `/var/lib/skycars-group-reader/pending.json`

The directory is owned by the unprivileged `skycars-reader` service account and survives service
restarts, application updates and VPS reboots. A new QR scan is needed only when WhatsApp invalidates
the linked device.

## Exact group ID

After login, the worker reports the visible groups to the authenticated website discovery endpoint.
The website pins an authorized display name only when exactly one matching WhatsApp group exists.
After that, messages must match both the configured entry and its pinned WhatsApp group ID.

## Operational checks

```bash
sudo systemctl is-enabled skycars-group-reader
sudo systemctl is-active skycars-group-reader
sudo journalctl -u skycars-group-reader --since "15 minutes ago"
sudo find /var/lib/skycars-group-reader -maxdepth 2 -type f -printf '%p %s bytes\n'
```

The reader is read-only and never sends a WhatsApp message. It uses an unofficial WhatsApp Web
client, so the reading account must be a dedicated account, should not be used for customer
conversations, and remains subject to WhatsApp's linked-device and automation policies.
