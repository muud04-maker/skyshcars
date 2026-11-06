# Sky Cars – Nov 7 repair (AI sales chat, WhatsApp desk, homepage)

Base: `skyshcars-main` as supplied on Nov 7. Checks: `npm run check:ai` 532/532 pass, `npx tsc --noEmit` passes, `npm run build` passes (Google Fonts mocked only because the build machine had no internet).

## 1. AI replies – root causes found and fixed

| Live failure | Root cause in code | Fix |
|---|---|---|
| "Hello do you have pick up" → "Let me confirm that for you." | `sales-compose.ts` threw away DeepSeek's whole reply and sent the hold line whenever no car **name** matched (66 holds in the Nov 6 data, incl. "Where are you located?"). Also `"pick up"` (two words) was not recognised as a body type, and "pick" counted as a model name. | Reply is now held only when it is empty or quotes a $ amount found in no verified source (`ai-rules/answer-guard.ts`). "pick up / pick-up / double cab" = pickup; pickups also found by model names (Hilux, Fengjun, Poer…). No pickup in stock → honest "none listed, we can source one" + sourcing task. |
| "Yamaha Mt09" → list incl. R1, no photos; "send me the images" + "2016" → nothing sent | Brand-only filter; when 2+ units matched, the photo planner returned nothing. A stale stored "current car" also beat the vehicle the customer just named. | Named model narrows the list (`ai-rules/photo-pick.ts`); photos of up to 2 units of the **same** model are sent straight away, each captioned with stock + price; a year ("2016") picks the unit; last customer messages beat an old current car. Different models still never get photos. |
| "2018 Yamaha MT-09 Yamaha MT-09" | Inventory answers used a naive `year+brand+model` join. | Uses the existing `vehicleDisplayTitle()` everywhere in the AI path. |
| AI does not answer like staff | No use of the thousands of real staff answers. | **Staff playbook** (`ai-rules/staff-playbook.ts`, `lib/staff-playbook.ts`): for each message, the most similar past customer questions from other chats + the staff answer are given to DeepSeek as references. Broadcast/promo texts (same text in 5+ chats) and photo labels are excluded; prices/vehicles from examples may not be copied. 404 Q&A pairs found in the Nov 6 data; "Where are you located?" now answers "We are located in Guangzhou China". Cached 15 min. |

## 2. WhatsApp desk (`/admin/whatsapp`)
- Opens full-screen; "Exit full", "Chats" (hide list) and "Details" (hide customer panel) buttons; layout remembered per browser.
- One scrollbar per panel; the page itself never scrolls (old box had `resize: vertical; overflow: auto`).
- **Send vehicle** opens a search panel: type brand / model / year / stock / price ("yamaha 2016"), Cars / Motorcycles / Available-only filters, thumbnail, price, stock, then *Send photos*, *Insert details* or *Set current*.
- **Customer panel** = one editable place: name, country, language, notes for the AI, and "What the AI remembers" (brand, model, year, budget, destination, port, buying stage, staff guidance…). Staff edits are saved as `source='admin'` in `customer_facts` (history kept) and used on the next AI reply. Sections collapse.
- Secondary actions moved into the "..." menu (opens downwards now).
- Phones: no big page title, only the essential buttons.

## 3. Homepage (Amazon-style, real data only)
Department selector in the search bar, trust strip (real photos / USD prices / export / WhatsApp), four collection cards with 2×2 real photos (Motorcycles, Cars & SUVs, Electric & hybrid, Under $5,000 – a card only appears with 2+ real units), then Featured Vehicles as a Motorcycles row and a Cars row (swipeable on phones). Shipping and reviews sections unchanged (no invented reviews).

## 4. Needs manual test on production
- A real WhatsApp customer asking "Yamaha MT-09" → two photo sets arrive (needs Meta token).
- DeepSeek wording with the staff references (needs the API key).
- Save a customer detail in the desk, then confirm the next AI reply uses it.

## 5. Still open (not code)
- Photo understanding and voice-note transcription need a provider (DeepSeek chat is text-only).
- `skycars_ai_fix_2026-11-06.sql` (duplicate listings, ad referral mappings, harmful approved lessons) is still unexecuted; review before running.
- Motorcycle shipping range in Business Policy ($300–500) differs from what staff quote (~$600).
- Stock 879 (2018 Yamaha MT-09) is saved as category "car".
