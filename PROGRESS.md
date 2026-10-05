# AI sales fixes - progress (branch claude-dev4)

Resume rule: parts are done in order 1 -> 9. Each part = one commit.
Offline tests: `npm run check:ai` (compiles src/lib/ai-rules with tsconfig.check.json, then runs scripts/check-ai/*.test.cjs).

Last verified on this branch: `npx tsc --noEmit` PASS | `npm run build` PASS (next build --webpack) | `npm run check:ai` PASS (13 tests).

| Part | Status | Wired into the live flow | Tested offline | Needs manual live test |
|---|---|---|---|---|
| 1 AI Catalog | DONE | vehicles.ai_enabled + one-time 72h migration; catalog filter in AI search, stock lookup, inventory summary and photo selection; disabled car named -> "not available right now"; empty catalog -> honest message + staff flag; checkbox in the vehicle form and Group Reader approval; admin page /admin/ai-catalog; business_settings.ai_catalog_mode selected/all | catalog SQL (01-catalog) | migration on the live DB; the toggles |
| 2 Welcome once | DONE | welcome_log with a unique key per customer, claimed atomically BEFORE sending and released if delivery fails; backfill so existing customers never receive it; first reply carries the answer + website + WhatsApp-group invite in ONE message (EN/AR/SO); settings in business_settings `whatsapp_welcome`, editable at /admin/settings; after the welcome, the site root and chat.whatsapp.com links are stripped from AI replies unless the customer asks (staff messages are never filtered). Uses the ONE reply engine, so the welcome also counts as the only reply for that burst. | 02-welcome (11 tests: first message, later message, webhook retry, parallel workers, existing customer, ad-click, failed send + retry, link filter, disabled setting) | first-contact delivery on real WhatsApp; backfill against the live DB; Admin Settings save |
| 3 Referral | NOT STARTED | `message.referral` is captured in the webhook but `onReferral()` is an empty stub and there is no `chat_referrals` table yet (the engine only reads it, guarded by try/catch). | | |
| 4 Strict matching + photos | NOT STARTED | Shared keyword rules live in intent.ts, but strict brand/model matching, per-chat CURRENT CAR and exact-photo selection are not rebuilt yet. | | |
| 5 Reply quality, one reply | PARTIAL | The one-reply engine is live: per-chat lock, ~3s burst merge, answered marker written BEFORE send, reply rule (no reply to pure thanks/ok/emoji/greetings), never into a group, one burst = one reply. The last-25-messages labelling, slot tracking and "answer first, one question" shaping are not finished. | burst merge / retry / parallel covered by 02-welcome | real WhatsApp sequences, incl. the "two replies a minute apart" bug |
| 6 Staff + AI | PARTIAL | business_settings `staff_ai_pause` (default 15 min) plus pause/resume state and a Settings field exist, and the engine stays quiet on a paused chat. Staff message-echo capture (`smb_message_echoes`), the "AI paused for 12:34" badge, Sold / Not available quick actions and any admin visibility of needs_staff / ai_paused_until / lock_until are NOT done. | | staff echo events from the phone app |
| 7 Real-time admin inbox | NOT STARTED | Inbox indexes exist; the page is still the old 3-second polling desk. No delta polling endpoint, statuses, referral card or media rendering. | | |
| 8 Website + admin sales flow | NOT STARTED | | | |
| 9 Readiness, AI test box, tests | NOT STARTED | `/api/admin/ai-settings` exists; no dry-run "Test the AI" box and no live readiness metrics yet. | | |

## Shared reply engine (foundation shared by parts 2/4/5/6)

- `src/lib/ai-rules/engine-core.ts` - the ONE production reply path. It has no DB and no network: everything arrives through injected `deps`, which is why it can be tested offline.
- `src/lib/sales-engine.ts` - wires the real MySQL/Meta dependencies into the engine.
- Triggers that use it: WhatsApp webhook, Messenger webhook, return-to-AI catch-up, Admin "AI reply now", and the engine's own post-reply re-check.

## Not committed code / repo hygiene

- `Microsoft/` (a PowerShell ModuleAnalysisCache folder) and `.claude/` are now in .gitignore; they are local tool artifacts, not application code.
- PROGRESS.md is the source of truth for what is wired vs. what only exists.
