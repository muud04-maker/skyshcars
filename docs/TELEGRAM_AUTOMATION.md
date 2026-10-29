# Telegram Inventory Automation (V36)

## Required Hostinger environment names

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_SOURCE_CHAT_ID=
# Optional; the HTTPS route is derived from NEXT_PUBLIC_SITE_URL when omitted.
TELEGRAM_WEBHOOK_URL=
```

The secret in `TELEGRAM_WEBHOOK_SECRET` is also sent to Telegram as `secret_token`. Telegram returns it
in `X-Telegram-Bot-Api-Secret-Token` on each delivery. The webhook rejects missing or mismatched values.

## Processing

Webhook: `POST /api/integrations/telegram/webhook`

The webhook validates the secret and exact source chat, stores `update_id` idempotently, stores the
chat/message/media IDs and acknowledges. Processing runs in `after()`; no cron or VPS is involved.
Albums wait for a four-second quiet period and are combined by `media_group_id`. Edits become a new
reviewable import linked to the prior Telegram vehicle, so published data is never overwritten silently.

Actual photo bytes are downloaded through Telegram `getFile`, fingerprinted, and stored in the existing
`media_blobs`/vehicle-media system. V35 inventory identity matching compares against website inventory,
sold/hidden records, both message sources, and image fingerprints.

## Automatic publication gate

A Telegram listing is auto-approved only when:

- its identity result is a confidently new vehicle;
- make, model, year and category are present;
- the source price is explicitly USD and has no markup added;
- at least one original photo was saved;
- extraction confidence meets the configured threshold;
- the post does not say sold, reserved, unavailable or out of stock.

Everything else enters Inventory Review. Approved Telegram vehicles become Available/Sell Now and are
added to the customer AI catalog immediately. Facebook publication uses the existing V35 publication
locks, records and timeout reconciliation.

## WhatsApp group delivery

The target `120363429404519527@g.us` is retained as the intended group. The current integration has a
read-only WhatsApp Web reader and an individual-customer Cloud API connection. Neither is an authorized
sender for that existing `@g.us` group, so V36 records the channel as disabled and does not imitate group
delivery through individual customer messages.

A supported WhatsApp Groups API connection (or another authorized group sender migrated and verified
against that exact group) is required before group delivery can be enabled.

## Admin

Open **Admin -> Automation & Publishing -> Telegram Automation** to:

- see environment/connection/webhook/source-group/bot-admin status;
- register the webhook;
- enable or disable automatic publication;
- inspect imports, duplicates, photos, Facebook history, failed jobs and retry state;
- retry the durable queue;
- run a non-publishing preflight against one selected Available sample vehicle.
