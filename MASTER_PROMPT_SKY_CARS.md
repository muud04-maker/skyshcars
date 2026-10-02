# MASTER PROMPT — SKY CARS & MOTORCYCLES

You are taking over an ACTIVE production project called **Sky Cars & Motorcycles**.

## Production facts
- Domain: `https://skyshcars.com`
- Stack: Next.js 16.x + TypeScript + MySQL + Hostinger + GitHub
- Hostinger build MUST remain `next build --webpack`.
- Main branch: `main`.
- The live site and database already exist. **Do not start over.**
- MySQL is the single source of truth.

## Current V26 catalogue upgrade
- HongGuanMa is an authorized private supplier source.
- The current public supplier catalogue reports about **535 vehicles across 34 pages**; V26 must discover the live count rather than hard-code the inventory as permanent truth.
- `/admin/suppliers` contains a full page-by-page importer. Each supplier detail page is parsed separately so each vehicle receives only its own gallery images.
- Supplier identity/base price/source URL remain private. Public price uses the configured Sky Cars markup.
- Public catalogues use brand/body/steering/fuel/price/year/mileage/status filters and sorting.
- The old 42 `motorcycle` rows with blank brand/model and no real motorcycle media are invalid legacy data; they must stay hidden from public pages until real motorcycle inventory is added.
- Do not use random Wikimedia/model photos as exact stock photos.

## Working rules
1. Inspect the actual source before claiming a feature exists.
2. Do not claim something is fixed until TypeScript check AND production build pass.
3. Preserve working production features while upgrading.
4. Never fabricate vehicles, prices, shipping routes, tracking events, customers, or inspection data.
5. Never hard-code secrets or ask me to paste secrets into chat. Secrets stay in Hostinger environment variables.
6. Bundle changes and give me a complete ZIP plus ONE deployment command.
7. If a deployment fails, fix the real error and regenerate the ZIP before calling it final.
8. Keep the UI simple enough for a nontechnical owner to manage from Admin.

# 1. INVENTORY — MUST BE COMPLETE

The database already contains the original Sky Cars inventory (about 198 records). Preserve all of it.

There is also a file containing **50 additional vehicles** supplied by me. Import them as additional stock, not replacements. The system should therefore support the original inventory plus these 50, subject to duplicates/status rules.

Requirements:
- Never delete the original inventory during upgrades.
- One vehicle = one stable stock number.
- Available, reserved, sold, pending verification, hidden statuses must be supported.
- Brand filtering must actually work across names such as Volkswagen, FAW-Volkswagen, SAIC-Volkswagen, Toyota, BYD, BMW, etc.
- `/vehicles`, `/cars`, `/motorcycles`, homepage featured stock, Admin counts, and AI search must all query the same MySQL inventory.
- Search by brand/model/stock number.
- Cars and motorcycles must not disappear because of a front-end filter bug.

# 2. VEHICLE PHOTOS — REAL AND UNIQUE

Public listings must prioritize:
1. exact real stock photos uploaded by Sky Cars;
2. exact real photos imported from an authorized supplier feed/site;
3. licensed model-specific images only as a fallback.

Rules:
- Do not reuse the same generic vehicle image for unrelated cars.
- Do not show visible labels such as `AI image`, `Reference image`, or similar on public cards.
- Do not pretend a generic/model image is the exact stock vehicle.
- Each vehicle detail page should support at least 3 photos when available.
- Add gallery thumbnails, main-image switching, larger image viewing, and mobile support.
- Admin must support upload, cover image, ordering, deletion, and review status.
- Supplier-imported images must remain linked to the correct supplier vehicle.

# 3. AUTHORIZED PRIVATE SUPPLIERS

I work with suppliers whose vehicles I am allowed to sell. One example is HongGuanMa (`https://hongguanma.com/`).

Build a private supplier system:
- Supplier identity, source URLs, base price, contact details, and internal IDs are PRIVATE ADMIN DATA.
- Public customers see only Sky Cars branding, Sky Cars stock number, final price, photos, specs, quote/shipping options.
- Import only where I have permission or an authorized feed/site relationship.
- Prefer API/JSON/CSV/XML/feed where available; authorized website parsing can be used as a fallback.
- Do not bypass authentication, CAPTCHAs, paywalls, access controls, or anti-bot restrictions.
- Imported supplier vehicles first go through review unless explicitly configured for approved direct publishing.
- Default supplier markup: **supplier USD price + $1,000**.
- Keep original supplier price privately for margin calculations.
- Update existing imported stock instead of creating duplicates when the supplier item already exists.
- Import the supplier's actual listing photos when authorized and technically available.
- Record sync status/errors in Admin.

# 4. PUBLIC WEBSITE DESIGN

Keep Sky Cars branding but improve the experience using modern export-car marketplace patterns:
- premium dark navy / clean white / Sky Cars yellow accents;
- strong header with search;
- browse by brand;
- Cars, Motorcycles, Vehicle Sourcing, Shipping/Export Support;
- recent arrivals / featured inventory;
- real vehicle cards with price/year/mileage/fuel/transmission;
- clear `View details`, `Get quote`, and WhatsApp actions;
- good spacing, responsive layout, readable typography;
- vehicle detail pages with 3+ image gallery where available;
- shipping, destinations, tracking, quote and customer-account functionality retained.

Do not clone another company's branding, logo, or proprietary text. Use their public site only as UX inspiration where appropriate.

# 5. WHATSAPP + DEEPSEEK SALES ASSISTANT

Use DeepSeek for text reasoning. The assistant represents **Sky Cars**, not a named human.

Behavior:
- It should speak naturally as `we`, `our team`, `Sky Cars`.
- Do not unnecessarily announce that it is AI.
- If directly asked whether it is automated/AI, answer truthfully.
- AI replies first by default.
- Admin can switch each conversation between `ai`, `human`, `paused`.
- Human takeover must immediately stop automated replies.
- Returning to AI must preserve the entire history, including human messages.

Before every AI reply, include:
- current customer message;
- substantial recent conversation history;
- relevant older conversation summary/history for the same phone/customer;
- customer profile and admin notes;
- previously discussed vehicles;
- previous quotes and destination where relevant;
- relevant human staff replies;
- relevant business knowledge from Admin;
- real inventory/tool results from MySQL.

The assistant must understand follow-ups such as:
- `send it`
- `the white one`
- `how much?`
- `can you ship it to Somalia?`
without restarting the conversation.

The AI must NEVER invent inventory or prices. It should query controlled tools such as:
- `search_inventory`
- `get_vehicle`
- `get_shipping_options`
- `create_lead`
- `create_quote_request`
- `get_tracking`

# 6. WHATSAPP MEDIA

Text:
- save full text in MySQL;
- DeepSeek may reply.

Photos:
- download authorized WhatsApp/Meta media;
- store/display the real photo in Admin;
- save any caption as real text;
- pass caption + conversation context to DeepSeek;
- if there is no caption and no image-understanding service configured, do not pretend to see the image; mark for human review.

Voice notes:
- download and make playable in Admin;
- without a transcription service, do not fabricate a transcript;
- mark for human review.

AI should be able to send real matching vehicle photos from Sky Cars inventory when customers request pictures.

# 7. CUSTOMER MEMORY / CRM

For every customer store useful business context such as:
- phone / WhatsApp ID;
- name;
- country;
- language;
- destination port/country;
- preferred makes/models;
- budget;
- vehicles discussed;
- quotes;
- sales notes;
- conversation summary;
- latest intent;
- last discussed vehicle.

Admin must be able to edit notes/memory. AI should use this context on future messages.

# 8. ADMIN CONTROL CENTER

The protected Admin should manage:
- dashboard;
- vehicles;
- vehicle photos/media;
- inventory review/imports;
- customers;
- leads;
- quotes;
- shipments;
- tracking events;
- documents;
- countries;
- ports;
- routes;
- rates;
- WhatsApp inbox;
- AI/Human/Paused controls;
- customer memory/notes;
- sales knowledge/training rules;
- private suppliers and supplier sync;
- social publishing;
- business settings;
- admin users and roles;
- audit logs;
- system/developer diagnostics.

Additional admins need their own email/password with hashed passwords and roles.

# 9. FACEBOOK / SOCIAL PUBLISHING

When a new approved vehicle is published, the system may prepare or publish a post to configured Facebook Page/eligible WhatsApp flows using only verified data and real approved photos.

- No fake prices/specs.
- Do not publish generic/model fallback images as exact stock photos.
- Admin must be able to enable/disable automation.
- Record publish success/failure.

# 10. SECURITY

- Secrets server-side only.
- Secure admin sessions/cookies.
- Password hashing.
- RBAC.
- Input validation.
- Rate limiting where appropriate.
- Webhook verification.
- Audit logs.
- Never expose `.env`, DB credentials, Meta token, DeepSeek key, private supplier fields, or internal notes to the browser/public API.
- Public tracking uses opaque references, never sequential DB IDs.

# 11. ENVIRONMENT VARIABLES

Existing/common names may include:
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `DEEPSEEK_API_KEY`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- optional Meta/Facebook variables when configured.

Support legacy aliases if already used, but standardize new code on the WHATSAPP_* names.

# 12. RELEASE CHECKLIST — REQUIRED BEFORE CALLING A ZIP FINAL

Run ALL of these:
1. `npm install`
2. `npx tsc --noEmit`
3. `npm run build`
4. verify build uses `next build --webpack`
5. scan unresolved relative imports
6. scan for accidentally committed secrets
7. verify original inventory is not deleted
8. verify extra-50 seed file contains exactly 50 unique stock records
9. verify `/vehicles` returns stock
10. verify brand filters with at least Toyota, Volkswagen, BMW, BYD
11. verify `/cars`
12. verify `/motorcycles`
13. verify `/admin`
14. verify `/admin/whatsapp`
15. verify human takeover / return to AI persistence
16. verify photo upload and gallery
17. verify supplier import does not expose supplier identity publicly
18. verify markup math is supplier price + $1,000 by default
19. verify no public `Reference image` / `AI image` badges
20. verify no false claim of successful supplier/photo import when remote site blocks access.

Only after these checks pass should you say the package is ready.

# OUTPUT EXPECTATION

Do not give me another architecture essay. Inspect/fix the source, run checks, and provide:
- complete updated ZIP;
- one deployment command;
- exact required environment-variable names only;
- concise list of what was actually tested;
- any remaining limitation stated plainly.

## V27 FINAL architecture

V27 adds a separate Automation layer and owner-only Private Development Lab without changing Sky Cars' primary purpose: vehicle sales and export support.

Automation rules live in Admin and must be observable through campaigns/events. WhatsApp group inventory is accepted only from group names/IDs authorized in Admin. Group posts become inventory-review drafts before approval. Marketing messages must not use ordinary customer conversations as an unrestricted broadcast list; V27 requires customer marketing opt-in and an active WhatsApp conversation window for freeform proactive updates.

The private development environment is `lab.skyshcars.com`. It uses a separate `sky_lab` owner-only session and is noindex/noarchive. The public Sky Cars AI, vehicle search, customer memory, Facebook/WhatsApp sales assistant and public APIs must never query `lab_apps` or any future Lab application data. Experimental apps must not be allowed to modify Sky Cars sales data unless a future integration is explicitly designed and approved.
