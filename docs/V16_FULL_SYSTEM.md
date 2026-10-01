# Sky Cars V16

## Included
- DeepSeek sales assistant reads up to 80 recent messages and persistent customer memory.
- Human replies remain in history and are used as style/decision examples after Return to Assistant.
- Customer memory summary is refreshed from conversation history and survives human takeover.
- WhatsApp can send up to 3 approved real vehicle photos for a matched vehicle.
- Public vehicle detail pages show a gallery of up to 12 approved photos with full-size links.
- Homepage/catalog search and brand navigation improved.
- Admin Inventory Review includes one-click import for the supplied last 50 vehicles and exact final USD prices.
- Private supplier manager supports supplier website, authorized JSON feed, permission confirmation and default $1000 markup.
- Supplier sync queues vehicles into Inventory Review; it does not auto-publish.
- Supplier identity and base price remain admin-only.

## Photo rule
Real supplier/admin-approved photos have priority. V16 does not copy random Google images. For authorized partners, use their approved feed/photos or upload verified photos in Admin > Vehicle Photos.

## Last 50 vehicles
Open Admin > Inventory Review and click **Import 50 vehicles** once after deployment. The operation is idempotent.

## HongGuanMa
Admin > Private Suppliers is prefilled for HongGuanMa when adding a supplier. Set the authorized JSON/API feed URL provided by the owner and keep the default markup at $1000.
