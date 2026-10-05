# AI sales fixes — progress (branch claude-dev4)

Resume rule: parts are done in order 1→9. Each part = one commit. `npm run check:ai` runs the offline tests.

| Part | Status | Wired into live flow | Tested offline | Needs manual test |
|---|---|---|---|---|
| 1 AI Catalog | DONE | ai_enabled column + one-time migration (72 h); catalog filter in AI search, stock lookup, inventory summary, photo selection (via search), Messenger (via salesReply); disabled car named → "not available right now"; empty catalog → honest message + staff flag; checkbox in vehicle form + Group Reader approval; admin page /admin/ai-catalog | catalog SQL (01-catalog) | migration on the live DB; toggles |
| 2 Welcome once | NOT STARTED | | | |
| 3 Referral | NOT STARTED | | | |
| 4 Strict matching + photos | NOT STARTED | | | |
| 5 Reply quality, one reply | NOT STARTED | | | |
| 6 Staff + AI | NOT STARTED | | | |
| 7 Live chat page | NOT STARTED | | | |
| 8 Website | NOT STARTED | | | |
| 9 Readiness, test box, tests | NOT STARTED | | | |
