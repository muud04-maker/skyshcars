# Sky Cars V15

## Sales assistant
- DeepSeek remains the only AI provider.
- Uses up to 40 recent messages so follow-up questions keep context.
- Reads customer name, country, preferred language and internal notes when available.
- Reads admin-managed Sales Knowledge on every reply.
- Does not volunteer that replies are automated; it never impersonates a named human and answers truthfully if directly asked.
- Vehicle/pricing/shipping/tracking claims remain grounded in MySQL.
- WhatsApp can send only approved real vehicle photos from vehicle_media. Reference/test images are never sent as exact stock photos.

## Sales Knowledge
Use `/admin/knowledge` to teach real business rules and reusable answers. This is controlled knowledge, not uncontrolled self-training.

## Private supplier network
Use `/admin/suppliers` to register private partners. A partner can send JSON inventory to:
`POST /api/supplier/feed/{slug}`
with header `x-sky-cars-secret: <SUPPLIER_FEED_SECRET>`.

Incoming partner vehicles are staged in `inventory_import_items` with `pending` review. Nothing is published automatically and public pages do not reveal the supplier name.

Only use supplier feeds/websites where Sky Cars has permission from the owner/operator. Prefer an API, CSV/JSON feed, webhook, or approved export rather than scraping.

## Storefront images
- Real approved listing photos are always preferred.
- Listings without real photos use varied reference images on the website only.
- The old “AI demo image” wording is removed; fallback imagery is marked “Reference image”.
- Social/WhatsApp auto-publishing uses only approved real vehicle photos.
