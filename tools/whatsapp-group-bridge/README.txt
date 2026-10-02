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
