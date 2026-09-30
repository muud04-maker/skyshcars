# Website + WhatsApp + Facebook integration

## Target flow
Website / WhatsApp / Facebook -> normalized conversation -> central database -> AI controller -> inventory/shipping tools -> reply.

## Conversation modes
- ai: AI may answer using approved database information.
- human: incoming messages are stored but AI does not answer.
- paused: no automated response.

## WhatsApp
The existing whatsapp-web.js reader is kept as a separate service. It must be tested for persistent Chromium/LocalAuth support in the final hosting environment. Secrets stay in environment variables.

## Facebook
`/api/facebook/webhook` contains the Meta webhook verification/event foundation. Complete connection requires a Meta app, Facebook Page, permissions/tokens, signature verification, database persistence and outbound Send API implementation. Do not put tokens in source control.

## Vehicle photos
Only actual stock photos should be attached to a stock item. The generic placeholder is intentionally non-vehicle-specific. Admin/group-ingested photos should be reviewed before publication.

## Africa markets
All sovereign African states are represented. Right-driving/LHD-compatible markets are prioritized. A listed country/port is not a promise of active service. Route/import eligibility, freight price and transit are confirmed per quote.
