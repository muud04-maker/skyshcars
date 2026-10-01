# Sky Cars V18 Final System

## Inventory
- Original MySQL inventory remains intact.
- The 50 user-supplied vehicles are automatically and idempotently added with V16-001 ... V16-050 stock numbers.
- Public catalogue shows active available, reserved and pending-verification inventory. Pending items are labelled "Check availability".
- Brand filtering is partial/normalized (e.g. Volkswagen matches FAW-Volkswagen and SAIC Volkswagen).

## Photos
- Old generated/demo/reference media rows are removed automatically; real admin/supplier photos are preserved.
- Public cards never show a "Reference image" badge.
- Exact admin/supplier stock photos are always preferred.
- When exact photos are missing, the site resolves model-specific photos from Wikimedia Commons; each detail page gets three different model photos when available.
- If no suitable public model photo exists, a clean stock-specific fallback illustration is used without pretending it is an exact unit photo.

## HongGuanMa private supplier
- HongGuanMa is preconfigured internally with https://hongguanma.com/ and a $1,000 USD markup.
- Supplier identity, supplier base price and source URL are never exposed by public vehicle pages/APIs.
- Admin > Private Suppliers has "Scan to Review" and "Import + Publish".
- Website sync crawls the authorized supplier pages, extracts listing title, USD price, detail URL and image URLs, follows detail pages, and can attach up to 12 supplier stock photos per imported vehicle.
- Imported supplier public price = supplier USD price + $1,000 by default.

## WhatsApp / DeepSeek
- DeepSeek reads customer-wide history across conversations, including human staff replies.
- Persistent customer memory is generated from up to 300 past messages.
- Human takeover does not erase history.
- The assistant can send up to three exact approved stock photos. If exact photos are missing it may send model photos and explicitly says to confirm the exact unit.

## Deployment
Use DEPLOY_NOW.ps1 from the v4 directory. It runs npm install and a production build before commit/push.
