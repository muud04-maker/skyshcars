# Run the Sky Cars Group Reader on a VPS

The Group Reader is a small program that reads your authorized WhatsApp supplier groups and sends them to your website. It **never sends** any WhatsApp message.

This guide puts it on a rented Linux server (a VPS) so it runs 24/7 without your computer. You need about 30 minutes and your phone with the Sky Cars WhatsApp account.

---

## What you need

- **A VPS** running **Ubuntu 22.04 or 24.04**. At least 2 GB of memory and 20 GB of disk. Hostinger "KVM 1" or similar is enough.
- **The VPS address (IP) and root password.** Your VPS provider shows these in its panel.
- **The bridge secret.** This is the value of `WHATSAPP_SERVICE_SECRET` in Hostinger's website settings. Copy it somewhere safe for a moment.
- **The phone** that has the Sky Cars WhatsApp account that is a member of the supplier groups.

---

## Step 1: Connect to the VPS

On Windows, open **PowerShell** and type (replace the address with yours):

```
ssh root@123.45.67.89
```

Type `yes` if asked, then the root password. (The password does not show while you type. That is normal.)

You are now "inside" the VPS. Every command below is typed there.

## Step 2: Install Docker (one time)

Copy and paste this line, press Enter, and wait until it finishes (2 to 3 minutes):

```
curl -fsSL https://get.docker.com | sh
```

## Step 3: Put the Group Reader files on the VPS

The VPS needs the folder `tools/whatsapp-group-bridge` from the Sky Cars project.

**Option A, with Git (easiest if the project is on GitHub):**

```
apt-get install -y git
git clone https://github.com/YOUR-ACCOUNT/YOUR-REPO.git skycars
cd skycars/tools/whatsapp-group-bridge
```

If the repository is private, GitHub asks for your user name and a **personal access token** as the password.

**Option B, upload the folder:** use a program like **WinSCP** or **FileZilla**. Connect with the same IP, user `root` and password. Upload the `whatsapp-group-bridge` folder to `/root/`. Then type:

```
cd /root/whatsapp-group-bridge
```

## Step 4: Add the settings

Create the settings file:

```
cp .env.example .env
nano .env
```

A simple editor opens. Fill in:

```
SKY_CARS_URL=https://skyshcars.com
WHATSAPP_SERVICE_SECRET=paste-the-same-secret-as-on-the-website
BRIDGE_ID=vps
```

Save with **Ctrl+O**, then **Enter**. Exit with **Ctrl+X**.

## Step 5: Start it

```
docker compose up -d --build
```

The first start takes a few minutes, because it downloads the browser that WhatsApp Web needs.

## Step 6: Scan the QR code (one time only)

Show the logs:

```
docker compose logs -f
```

After a short wait you will see **WHATSAPP LOGIN NEEDED** and a square QR code made of characters.

On the phone, open WhatsApp and go to **Settings → Linked devices → Link a device**. Scan the QR code on the screen.

- If the QR is cut off, make the PowerShell window bigger or zoom out with **Ctrl + minus**, then wait for the next QR.
- When it works, you see **WhatsApp login accepted** and then **READY**.

Press **Ctrl+C** to stop watching the logs. The Group Reader keeps running.

## Step 7: Check it in Admin

Open **https://skyshcars.com/admin/group-reader**. The bridge status should say **● ONLINE** within a minute.

You can now close PowerShell and turn off your computer. The VPS keeps the Group Reader running. It also starts again by itself after a crash or after the VPS reboots.

If the old Group Reader still runs on your Windows PC, stop it. Two readers on the same WhatsApp account will fight each other.

---

## Everyday commands

Connect with `ssh root@your-ip`, go into the folder (`cd skycars/tools/whatsapp-group-bridge`), then:

| What | Command |
|---|---|
| See live logs | `docker compose logs -f --tail 100` |
| Is it running? | `docker compose ps` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` |
| Update after a new version | `git pull && docker compose up -d --build` |

## Log in again with a new QR

Do this if Admin says **WHATSAPP LOGIN FAILED**, or if you removed the linked device from the phone:

```
docker compose down
rm -rf session
docker compose up -d
docker compose logs -f
```

Then scan the new QR as in Step 6.

## Troubleshooting

- **Logs say WHATSAPP_SERVICE_SECRET is empty.** Fix the `.env` file (Step 4), then run `docker compose up -d`.
- **Logs say "Could not load authorized groups … HTTP 401".** The secret in `.env` is not exactly the same as on the website. Check both for spaces.
- **Admin says OFFLINE.** Run `docker compose ps`. If it is not "running", run `docker compose up -d` and look at the logs.
- **A group is not read.** Check that the exact group name is added and enabled in Admin → Group Reader, and that the WhatsApp account is a member of the group.

---

## Alternative without Docker (pm2)

Use this only if you cannot use Docker.

```
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs chromium-browser || apt-get install -y nodejs chromium
npm install -g pm2
npm install --omit=dev
mkdir -p logs
pm2 start ecosystem.config.js
pm2 logs sky-group-reader      # scan the QR here, then Ctrl+C
pm2 save && pm2 startup        # start again after a reboot (run the command it prints)
```

If Chromium fails to start, add the line `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (or `/usr/bin/chromium`) to `.env`, then run `pm2 restart sky-group-reader`.
