# Sky Cars V14 — AI Vehicle Images + Social Auto-Post

## WhatsApp AI vehicle images
When a WhatsApp customer asks about a matching vehicle, the AI sends its text reply and then one matching vehicle image from the website.

- Approved real vehicle media is always preferred.
- If a real image is missing, the current test/demo website image may be sent only with a clear `Reference image — verified vehicle photo pending` label.
- The vehicle link, stock number and price (when present) are included in the image caption.

## Facebook auto-post
`/admin/social` can automatically post a vehicle when it first becomes `available`.

Hostinger variables needed:
- `META_PAGE_ID`
- `META_PAGE_ACCESS_TOKEN`

The Page access token must have the permissions needed to publish to the selected Facebook Page.

## WhatsApp auto-share
WhatsApp does not provide a general Cloud API method for posting to WhatsApp Status. V14 instead supports automatic sharing of a newly available vehicle to existing customer conversations that:

- are WhatsApp conversations,
- are currently in AI mode, and
- had a customer interaction within the last 24 hours.

This avoids pretending that Cloud API can publish a WhatsApp Status. Broader outbound marketing should use approved Meta message templates and customer opt-in.

## Admin controls
Open `/admin/social` to:
- enable/disable Facebook auto-post,
- enable/disable WhatsApp active-chat auto-share,
- enable/disable reference images,
- manually publish an available vehicle to Facebook, WhatsApp, or both,
- review recent publishing activity.
