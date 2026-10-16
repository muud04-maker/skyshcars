# Customer context, memory, history and approved AI learning

This document covers the continuation work: the AI knowing who the customer is, remembering what they
said, keeping one complete history, and improving only from lessons a human approves.

## 1. Normal AI reply timing (about one minute)

A customer message schedules ONE reply 60 seconds after the latest message:

- a newer message pushes the deadline forward (rapid messages merge into one answer),
- the deadline lives in MySQL (conversation_state.pending_ai_reply_at), so restarts and parallel
  webhooks are safe,
- a staff reply before the deadline cancels it (clearAiReply),
- TAKE OVER blocks the AI completely; AI and BOTH use the same one-minute queue,
- AI Reply Now stays an explicit immediate override.

The webhook sets the durable deadline and only wakes the worker after the delay has passed; the
reliable processor is the once-a-minute cron (see docs/AI_REPLY_CRON.md).

Expected delay: about 62 s when the server process is still alive, otherwise the next cron tick
(60-120 s). The old 4-second fast path is gone.

Inbox labels: "AI reply in 58s", then "AI reply queued", then "AI sending...", plus
"AI reply failed - retrying" and "AI reply failed - needs staff".

## 2. Customer context (what the AI knows per message)

src/lib/customer-context.ts assembles everything from stable identifiers (customers.id):

| Area | Source |
|---|---|
| Customer: name, phone/PSID, channels, language, country, first/last contact, counts, assigned staff, notes | customers, conversations, messages |
| Vehicle interest: referral vehicle, current vehicle, stock, category, price, exact photos | chat_referrals, conversation_state, vehicles |
| Preferences: category, brand, model, budget, body, fuel, transmission, steering, colour, destination | customer_facts |
| Sales history: quotes, vehicles discussed, referrals, shipping | quote_requests, chat_referrals |
| Conversation history: customer, AI and staff messages on every channel | messages |
| Summary | customer_memory.summary (reused, no duplicate table) |

The reply engine assembles context in ONE fixed order (src/lib/ai-rules/context-pack.ts):
latest turn, referral, current vehicle, recent history, memory/preferences, catalog facts,
business knowledge, shipping/quote facts, approved lessons.

## 3. Customer memory (customer_facts)

Structured, per-customer facts taken from the customer's own words, never from AI assumptions:

```
customer_facts        (customer_id, fact_key, fact_value, source, source_message_id, confidence, active)
customer_fact_events  (customer_id, fact_key, old_value, new_value, action, source, changed_by, changed_at)
```

- one row per (customer_id, fact_key); a new value supersedes the old one and the change is logged,
- source is customer_message / staff / admin / ai_summary / referral; confidence 0-1,
- editable and deletable by admin on the Customer History page (delete deactivates, history kept),
- passwords, cards and bank details are refused (looksSensitive), and the raw message is never
  copied into memory: only the extracted value plus a short evidence string.

## 4. Full history in one place

customerTimeline(customerId) merges, per customer and never across customers: messages (WhatsApp,
Messenger and website), AI and staff replies, referral events, current-vehicle and mode/system
events, memory changes, staff notes and quotes. Newest first, capped and indexed. Nothing is ever
deleted; compaction only limits what is sent to the model.

/admin/customer-history shows the searchable customer list (name, phone, Messenger id, vehicle,
stock number; filters: channel, vehicle type, handled by AI/staff, date range, needs reply) and, on
tap, the Customer 360: profile, current interest, preferences, chat history, sales history, AI memory
(edit/delete) and private staff notes. Phone flow: list, then history, then "Back to customers".

## 5. Approved AI learning

```
ai_learning_events (conversation_id, customer_id, message_id, question, ai_reply, correction,
                    event_type, reason, lesson, applies_to, payload, status, created_by,
                    reviewed_by, reviewed_at, applied_at, applied_ref)
status: pending | approved | rejected | applied
```

How a lesson is created:

- thumbs down on an AI reply in the inbox: reason plus optional corrected answer, status pending,
- "Use this as correction" on a staff reply: question, bad AI answer and correct staff answer,
  status pending,
- a saved referral correction: event type referral_correction, status pending,
- thumbs up: a good_reply example (already approved, used as a style example).

How a lesson is used (only ever after a human decision):

| Action | Effect |
|---|---|
| Approve | the lesson becomes usable context (approved) |
| Reject | ignored forever (rejected); can be reopened |
| Apply | permanent form: referral_correction becomes a saved referral mapping, business_rule becomes a global knowledge entry, everything else becomes prompt context |

The AI never trains itself and never changes behaviour from a single correction.

/admin/ai-learning lists the cards (question, AI reply, correction, reason, status) with
Approve / Reject / Edit / Apply: cards on a phone, no wide tables. Thumbs up/down live on AI messages
in the inbox transcript, and "Use this as correction" on staff messages.

## 6. Global knowledge versus customer memory (kept separate)

- Global (every customer): ai_knowledge - shipping, payment and service policies, business rules.
  Only an applied business_rule lesson adds an entry, and approved global lessons are added to the
  prompt note as "APPROVED LESSONS".
- Private (customer_facts, staff_notes, customer_memory): one customer only, never promoted to global
  knowledge, never shown publicly, and the prompt is told not to ask for stored preferences again.

## 7. Privacy

- both new pages and every new API are admin-only (isAdmin page guard, adminDenied() in the APIs),
- no public route reads customer_facts, customer_memory, staff_notes, ai_learning_events or message
  bodies,
- all queries are parameterised and scoped by customer_id / conversation_id,
- staff notes stay private; deleted notes are soft deleted (row kept, hidden),
- indexes: customer_facts(customer_id,active), customer_fact_events(customer_id,changed_at),
  ai_learning_events(status,created_at) / (customer_id,created_at) / (event_type,status),
  staff_notes(customer_id,active,created_at).

## 8. Database (additive only)

New tables: customer_facts, customer_fact_events, ai_learning_events, staff_notes.
New column: customers.assigned_staff (guarded ALTER TABLE ADD COLUMN).
Reused: customer_memory, ai_knowledge, messages, conversations, customers, chat_referrals,
conversation_state, quote_requests, ai_agent_events.
Nothing is dropped, truncated or rewritten; every statement is CREATE TABLE IF NOT EXISTS or a
guarded ADD COLUMN.

## 9. Tests

```
npm run check:ai     # 323 offline checks (includes 25-referral-category and 26-mobile-inbox)
npx tsc --noEmit
npm run build
```

27-customer-context.test.cjs covers memory, isolation, context order, compaction, the summary and
privacy; 28-ai-learning.test.cjs covers the learning workflow, approval states and the phone pages.

## 10. All-history stream and TXT exports (continuation)

`/admin/all-history` is one chronological stream across EVERY customer and channel: inbound messages,
AI replies, staff replies, referrals, quotes, staff notes, memory changes and AI learning events.
Filters: date range, channel, who (customer / AI / staff / system), event type, customer id, vehicle or
stock text, car/motorcycle, Facebook-leads-only, and newest/oldest sorting. The list pages with a
keyset cursor ("Load more"), so nothing is cut off.

`Download All History (.txt)` uses the SAME filters and streams one single text file:

```
SKY CARS - ALL HISTORY EXPORT
Generated: ... / Filters: ... / Matching events: N
[YYYY-MM-DD HH:mm:ss] [CHANNEL] [CUSTOMER] [ROLE]
Vehicle: 2011 Honda CBR1000 (motorcycle)
Stock: SC-859
Message: ...
<blank line>
```

It walks the history in batches of 500 (`EXPORT_BATCH`), oldest first, and stops at a safety cap
(`ALL_HISTORY_EXPORT_MAX`, default 200000) with an explicit `*** TRUNCATED AT ... ***` line - it never
stops silently. `/api/admin/ai-learning/export` does the same for the learning log (one .txt with
question, AI answer, human correction, reason, lesson, type, status, applies_to, applied_ref and the
vehicle/referral context). Both endpoints are admin-only and write an audit-log entry.

## 11. Daily human sales patterns (`daily_ai_sales_patterns`)

`src/lib/sales-patterns.ts` counts what really happened each day (no model call, fully deterministic):
vehicles discussed, what staff recommended or sent, Facebook referral mappings, common questions,
common human answers, shipping and pricing answers, AI corrections, vehicles staff switched the chat
to, and destinations/ports. Stored one row per (day, type, key) with sample_count and a confidence
that is capped at 0.9 - weak by design.

Run it daily (or on demand):

```
0 1 * * * curl -s "https://skyshcars.com/api/cron/daily-patterns?secret=$AUTOMATION_CRON_SECRET" > /dev/null
```

`/admin/ai-learning` shows "Today's Human Sales Patterns" (top vehicles, motorcycles, cars, referral
vehicles, questions, human answers, AI corrections) plus suggested lessons. A suggestion becomes a
PENDING lesson only when the admin presses the button, and it still needs Approve + Apply: patterns
never turn into rules by themselves, and never into global business knowledge.

In the reply prompt they appear as the LAST, lowest-priority step, labelled
"LOW-PRIORITY HINTS ... never let them override an exact referral, stock number, price, category or the
admin's correction".

## 12. Human shadow learning

Whenever a person answers (inbox reply, or a reply typed in the WhatsApp app) the system compares the
customer question, the last AI reply, the human reply, the current vehicle and the referral, and
records a PENDING learning candidate when they materially differ (wrong vehicle, wrong price, wrong
language, wrong shipping answer, unnecessary hold, better sales reply, missing information). The same
human message is never reviewed twice, and payment/password text is never stored.

Inside the same chat the human answer is immediately usable context: it is kept as the customer's
`last_human_guidance` fact and passed to the prompt as
"OUR TEAM ALREADY TOLD THIS CUSTOMER ... follow it, do not contradict it". For other customers nothing
is generalised automatically. Every current-vehicle change is logged with its source in
`conversation_vehicle_events`, so a human switch (previous AI vehicle -> human selection) is recorded
too.

## 13. Facebook lead resolution priority

1. saved admin referral correction, 2. exact publish/referral id or stock, 3. exact current
conversation vehicle, 4. exact recent human selection in that conversation, 5. exact model/year/
category evidence, 6. same-day human pattern (weak, only when nothing exact matched),
7. catalog matching, 8. one short clarification. Steps 3 and 4 are only accepted when the ad text
really names that model/stock and the category agrees, so they can never override steps 1-2. A
motorcycle lead can never resolve to a car, and brand-only evidence never becomes a single match.

## 14. New tables (additive only)

`daily_ai_sales_patterns`, `conversation_vehicle_events`. Both use `CREATE TABLE IF NOT EXISTS` with
their own indexes; no DROP, TRUNCATE or destructive migration anywhere.
