# AI reply queue — Hostinger cron setup

The AI no longer answers instantly. Every customer message schedules ONE AI reply
**60 seconds after the latest customer message** (a newer message resets the deadline, and a staff
reply cancels it). The deadline is stored in MySQL (`conversation_state.pending_ai_reply_at`), so
restarts and parallel webhooks are safe.

This is the normal path for AI and BOTH mode (the 4-second fast path was removed on purpose): the
delay lets rapid messages merge into one answer and gives the owner a window to step in first.
TAKE OVER sends nothing at all, and **AI Reply Now** stays an explicit immediate override.

The webhook only wakes the worker after the delay has passed (a best-effort accelerator); this cron
remains the reliable processor. Expect roughly 62 s when the server process is still running, or the
next cron tick otherwise (60-120 s).

Inbox labels while a reply is queued: `AI reply in 58s`, `AI reply queued`, `AI sending...`,
`AI reply failed - retrying`, `AI reply failed - needs staff`.

## Endpoint

```
GET https://skyshcars.com/api/cron/ai-replies
Authorization: Bearer <AUTOMATION_CRON_SECRET>
# or:  https://skyshcars.com/api/cron/ai-replies?secret=<AUTOMATION_CRON_SECRET>
```

It processes every chat whose deadline has passed, re-checks the cancel rules (staff replied,
HUMAN mode, paused, archived, nothing to answer), then sends at most one reply per chat.

## Hostinger cron

In hPanel → Advanced → **Cron Jobs**, add a job that runs **every minute**:

```
* * * * * curl -s "https://skyshcars.com/api/cron/ai-replies?secret=YOUR_AUTOMATION_CRON_SECRET" > /dev/null
```

Notes:

- `AUTOMATION_CRON_SECRET` must already exist in the Hostinger environment variables (the same value
  used by `/api/cron/automation`). Never put the secret in the repository.
- The existing `/api/cron/automation` job also processes the queue, so if that one already runs every
  minute you can keep only that one. A dedicated job is recommended so a Hostinger hiccup in the
  campaign job cannot delay customer replies.
- Timing is "about 60 seconds": expect roughly 60–75 seconds depending on when the cron fires.
- If the job is missing or failing, the AI simply does not reply until a chat is touched again —
  `/admin/whatsapp` shows "AI reply in 42s" / "AI reply queued" for pending chats, and staff can press
  **AI Reply Now** to answer immediately or **Cancel AI reply** to stop the queued answer.
