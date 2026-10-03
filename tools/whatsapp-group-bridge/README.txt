SKY CARS V27 GROUP READER

Purpose
- Reads ONLY WhatsApp groups authorized in Sky Cars Admin -> Group Reader.
- Sends listing text and images to Inventory Review.
- It does not publish vehicles by itself.

Setup
1. Copy .env.example to .env.
2. Set SKY_CARS_URL=https://skyshcars.com
3. Set WHATSAPP_SERVICE_SECRET to the SAME value used in Hostinger.
4. npm install
5. Run: node server.js
6. Scan the QR once.
7. Keep this bridge running on an always-on PC or VPS.

Admin
https://skyshcars.com/admin/group-reader

The bridge refreshes its authorized group list every 60 seconds and sends a heartbeat to Admin.

V32 update (Phase 3)
- After pulling this version, restart the bridge (stop it, then run RUN_GROUP_READER.ps1 again). No new QR scan is needed.
- Photos and caption sent by one supplier within 20 seconds are uploaded as ONE post; the website also merges
  a caption or photos sent up to 3 minutes apart into the same Pending vehicle.
- Failed uploads are retried up to 3 times; the website ignores duplicates.
- Heartbeat is sent every minute from start-up with the real state: starting, qr_required, online,
  disconnected or auth_failed. Admin -> Group Reader shows it.
