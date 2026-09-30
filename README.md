# Sky Cars & Motorcycles Complete V2
Includes the Next.js marketplace, vehicle details, shipping/destinations, quote/tracking foundations, account/admin foundations, existing inventory, PostgreSQL/Supabase schema, and a WhatsApp Web + DeepSeek service preserving AI-first / human-takeover behavior.

## Verify locally
npm install
npm run check
npm run build
npm run start

Test WhatsApp separately with required environment variables:
npm run whatsapp

## Production rule
Do not replace the currently working skyshcars.com deployment until `npm run build` succeeds. Add secrets in Hostinger Environment variables, never GitHub.

## WhatsApp Hostinger test
The reader uses whatsapp-web.js, LocalAuth and headless Chromium/Puppeteer. Hostinger supports persistent server-side Node apps, but this specific Chromium/session behavior must be verified on the actual managed environment before moving the live WhatsApp session. If it is unsupported, keep the website live and change only the WhatsApp transport.

## Data rule
Do not silently correct source inventory. Incomplete/ambiguous records require admin review. Reference shipping information is not a confirmed freight quote.


## V3 full-scope additions
See `docs/COMPLETE_SYSTEM_SCOPE.md`. Broad public, customer, admin, shipping, tracking, WhatsApp and database modules are included now so they can be refined later without redesigning the whole project.


## V4
Adds full Africa market data with LHD/right-driving prioritization, vehicle photo placeholder/gallery foundation, separated WhatsApp service dependencies, unified channel types, Facebook/Meta webhook foundation, and database fields for channel + AI/human takeover. See `docs/CHANNEL_INTEGRATION.md`.
