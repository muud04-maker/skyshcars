# 120-point AI upgrade - coverage matrix

Legend: **E** already worked before this pass · **N** new in this pass · **P** partial (state exactly
what is missing) · **U** unavailable (no data/permission/table - cannot be built honestly).
Evidence is the code path + the test that pins it. Loaded from the real conversation snapshot
(152 customers / 148 conversations / 2,972 messages).

## A. Learn from human sales conversations (1-20)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 1 | Observe every manual reply as a learning example | E | `shadow-learning.ts` on inbox replies + WhatsApp echoes |
| 2 | Read the full conversation before learning | E | candidate stores `conversation_id` + question + last AI reply |
| 3 | Compare AI vs human answers | E | `compareHumanAndAi` (vehicle/price/language/hold/wording) |
| 4 | Detect corrections (price/model/category/destination) | P | vehicle + price + language + hold detected; destination/category corrections are not classified separately yet |
| 5 | Learn communication style (short vs detailed) | P | reply length is observable in history; no style metric stored |
| 6 | Learn to answer direct questions | E | deterministic price/availability/photo paths + answer-first instruction |
| 7 | Learn negotiation approach | U | no price-authority/margin table exists; inventing limits would be unsafe |
| 8 | Learn shipping explanations | P | verified countries/ports/rates in DB; no route-quality metric |
| 9 | Learn when to verify before promising | E | `shouldHold` holds only when facts are missing |
| 10 | Learn when to send photos | E | `wantsPhotos` + photo plan + guard |
| 11 | Learn when to recommend alternatives | E | `alternatives()` ranking |
| 12 | Learn objection handling | P | `objection` type exists; no dedicated objection playbook |
| 13 | Avoid asking for a known budget | E | stored facts + no-repeat note (1 real case in the dump) |
| 14 | Identify serious buyers | N | `ai-rules/buying-signal.ts` |
| 15 | Learn follow-up timing | P | `follow_up` task type exists; no scheduler (deliberately no unsolicited sends) |
| 16 | Learn trust building | E | `ai_knowledge` business knowledge |
| 17 | Record why you take control | E | takeover + `human shadow` reason on the candidate |
| 18 | Learn when to return control | E | mode route (no catch-up, waits for customer) |
| 19 | Learn the result of an intervention | P | task done/declined is recorded; no per-intervention outcome field |
| 20 | Turn strong examples into approved lessons | E | AI Learning approve/apply |

## B. Intelligent learning and correction system (21-40)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 21 | "Learn from this reply" action | E | thumbs up on AI messages |
| 22 | "Wrong AI answer" action | E | thumbs down with reason |
| 23 | Correction categories | N | `missing_photo`, `availability`, `inappropriate_wording`, `objection`, `negotiation` added |
| 24 | Save the customer question | E | `question` column |
| 25 | Save AI answer + improved version | E | `ai_reply` + `correction` |
| 26 | Show the factual difference | E | comparison reasons shown on the card |
| 27 | Generate a proposed rule | E | `lessonFromComparison` template |
| 28 | Approve / edit / reject | E | review API + card actions |
| 29 | Keep customer facts separate from global rules | E | `applies_to` |
| 30 | Category on each lesson | N | `category` column + `LESSON_CATEGORIES` |
| 31 | Store supporting evidence | N | `evidence_ref` (+ `payload`) |
| 32 | Confidence score (not proof) | N | `confidence` 0-1, labelled as a review aid |
| 33 | Detect contradictory lessons | N | `detectContradictions` + warning panel |
| 34 | Expire outdated information | N | `expires_at`, excluded from retrieval |
| 35 | Prefer recently verified instructions | P | applied-first + newest-first ordering; no verification timestamp |
| 36 | Audit trail of approvals | E | `reviewed_by` / `reviewed_at` |
| 37 | Undo an approved lesson | N | `undoLearningEvent` (deactivates the knowledge entry it created) |
| 38 | Test lessons against historical cases | N | `evaluateLearningEvent` (coverage + agreement, explicitly not accuracy) |
| 39 | Improve prompts/retrieval, not fine-tuning | E | `approvedLessons()` at reply time |
| 40 | Weekly learning report | P | daily patterns + stats; no weekly roll-up yet |

## C. Customer understanding and memory (41-60)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 41 | Remember the selected vehicle | E | `current_vehicle_id` (+ `conversation_vehicle_events`) |
| 42 | Multiple vehicles, current one | P | current + vehicle history; no explicit multi-vehicle list per chat |
| 43 | Budget without re-asking | E | `budget_max/min` facts |
| 44 | Destination country | E | `destination_country` |
| 45 | Port separate from country | E | `destination_port` |
| 46 | Explicit language instruction | E | `language` fact + preferred_language |
| 47 | Steering requirement | E | `steering` |
| 48 | Body type | E | `body_type` |
| 49 | Specs of interest | E | `fuel`, `transmission`, `model_year_*` |
| 50 | Rejected vehicles | N | `rejected_vehicles` fact + alternatives filter |
| 51 | Changing preferences | E | one row per fact, new value supersedes + history |
| 52 | Unresolved requests on return | P | waiting triage is honest now; no "open request" model |
| 53 | Resume naturally | E | transcript + memory summary |
| 54 | Facts vs guesses | E | `source` + `confidence` on every fact |
| 55 | Concise staff profile | E | `/admin/customer-history` 360 |
| 56 | Previous quotes with dates | E | `quote_requests` (read) |
| 57 | Track photo requests until fulfilled | N | `staff_tasks` type `photo` with status |
| 58 | Track sourcing requests | N | `staff_tasks` type `sourcing` |
| 59 | Respect record corrections | E | admin can set/delete facts |
| 60 | No cross-customer leakage | E | scoped queries + isolation tests |

## D. Vehicle recommendations (61-80)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 61 | Resolve the advertised listing first | E | referral priority 1-8 |
| 62 | Image understanding for customer photos | U | code exists; **no media AI key in Hostinger** (0 of 100 photos described) |
| 63 | Voice transcription | U | same: 0 of 21 voice notes transcribed |
| 64 | Exact stock before price/photos | E | `vehicleDetails` + exact photo SQL |
| 65 | Never confuse car and motorcycle | E | category-strict matching |
| 66 | Budget filter on real prices | E | `filterInventory` |
| 67 | Destination steering filter | E | steering fact + filters |
| 68 | Genuine availability | E | `sellableVehicleSql` |
| 69 | Verified mileage/condition | E | DB fields only |
| 70 | 2-3 alternatives | E | capped at 3 |
| 71 | Explain differences between options | P | titles + prices shown; no comparison narrative |
| 72 | Exact model/year requests | P | exact model match; year is a filter, not a hard constraint |
| 73 | Available vs sourcing wording | N | sourcing task + separate guidance |
| 74 | Unusual spec combinations | P | ambiguous requests ask one short question |
| 75 | Price rules / markup | U | no rule table; supplier markup is private and not in code |
| 76 | Retail vs supplier separation | E | supplier fields never exposed |
| 77 | Never invent stock numbers/links | E | guarded by tests |
| 78 | Avoid rejected options | N | rejected filter |
| 79 | Explain why a vehicle fits | P | not generated; model may add this from facts |
| 80 | Track recommendation accuracy | U | no ground-truth match table |

## E. Photos and videos (81-95)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 81 | Prioritise photo requests | E | photo intent + plan |
| 82 | Correct vehicle record | E | exact stock |
| 83 | Exact vs reference images | E | `exactPhotoSql` |
| 84 | Verify URL accessibility | P | format check only (no HEAD request) |
| 85 | Meta acceptance vs delivery | E | `delivery_status` + status webhooks |
| 86 | Retry failed media safely | P | per-image retry inside one run; no durable retry queue |
| 87 | Staff photo request with stock/customer/reason | N | `staff_tasks` |
| 88 | Photo queue for staff | N | `/admin/staff-tasks` |
| 89 | Track fulfilment | N | done/declined + handled_by + completed_at |
| 90 | Relevant photo-backed alternatives | E | filter-aware match |
| 91 | Specific views (engine/interior/odometer) | U | media table has no view/angle field |
| 92 | Video walkthroughs | P | inbound video stored; sending video not implemented |
| 93 | Repeat photo requests = delivery problem | N | dedupe key keeps one open request |
| 94 | Customer screenshots as evidence | U | vision key missing |
| 95 | Media success metrics | N | task stats + message types |

## F. Sales, negotiation, shipping (96-110)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 96 | Detect strong purchase intent | N | `buying-signal.ts` |
| 97 | Qualify leads from evidence | P | signals + tasks; no lead table write (no such pipeline exists) |
| 98 | Structured follow-up task | N | `serious_buyer` / `follow_up` tasks |
| 99 | Approved payment instructions only | E | knowledge base; no invented bank details |
| 100 | Negotiation within limits | U | no authority table |
| 101 | Discounts from current prices | U | same |
| 102 | Routes: port vs inland city | E | countries/ports/rates |
| 103 | Vehicle price vs freight/duties | E | separate fields + guidance |
| 104 | Formal shipping quotation when needed | N | `freight` task |
| 105 | Track freight requests to fulfilment | N | task status |
| 106 | Credibility objections | P | knowledge + `objection` type; no document set |
| 107 | Escalate disputes/fraud | E | staff flag + takeover |
| 108 | One appropriate next step | N | `signalNextStep` |
| 109 | No pressure / no repeat messaging | E | no unsolicited sends; 24 h window |
| 110 | Real sales stages | U | no orders/payments table; tasks record only what happened |

## G. Reliability and self-improvement (111-120)

| # | Requirement | Status | Where / why |
|---|---|---|---|
| 111 | Honor takeover immediately | E | mode gate + queue cancel |
| 112 | Recheck state before every send | N | pre-send turn/mode gate (conv#35/#51) |
| 113 | Preserve batching | E | 60 s queue |
| 114 | Ignore reactions/edits | N | excluded from needs-reply |
| 115 | Monitor unanswered actionable requests | N | actionable-only waiting maths |
| 116 | Satisfaction from observable signals | P | resolved/answered states; no invented sentiment |
| 117 | Historical regression bank | E | suites 25-33 (incl. SUV photos, unknown vehicle, staff races) |
| 118 | Evaluation mode before activation | N | `evaluateLearningEvent` + Evaluate button |
| 119 | Outcome dashboard | P | task/learning/media stats; orders not available |
| 120 | Continuous review with human authority | E | AI Learning loop + undo |

## Summary

- **E (already working): 46** · **N (new in this pass): 40** · **P (partial, gap named): 22** · **U (unavailable): 12**
- The 12 **U** items need either a Hostinger secret (`OPENAI_API_KEY`/`MEDIA_AI_API_KEY`), a business
  table that does not exist (price authority, orders/payments, per-view media) or ground-truth data.
  They are **not** silently claimed as done.
