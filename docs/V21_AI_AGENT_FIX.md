# Sky Cars V21 — AI Agent Reliability Fix

V21 fixes the production behavior seen in the WhatsApp/admin screenshots:

- Every AI-mode text message gets a reply even if DeepSeek temporarily fails: verified database fallback replies are used.
- Explicit requests about earlier chat are answered from the real stored transcript rather than model guesswork.
- Conversation history now sends a clear real transcript to the model in addition to the normal chat history.
- Voice notes can be downloaded from Meta, transcribed, stored, and answered automatically when Media AI credentials are configured.
- Uncaptioned customer images can be downloaded, visually described, stored as text context, and answered automatically when Media AI credentials are configured.
- If media analysis is unavailable/fails, the conversation safely switches to human review instead of pretending it understood the media.
- `/admin/agent-health` records inbound events, AI replies, failures, transcription, image analysis and handoffs.
- Delivery/read status webhooks update stored outbound status where Meta sends matching IDs.
- Secure `/api/bridge/whatsapp-group` endpoint accepts supplier-group listings from the included WhatsApp Web bridge.
- `/admin/imports` shows WhatsApp-group drafts and allows approve/reject. Approved drafts create a pending-verification vehicle; imported photos remain pending review.
- Duplicate group message IDs are ignored by the bridge-import service.

## Voice/photo setup
Text AI still uses `DEEPSEEK_API_KEY`.
For voice transcription and uncaptained image understanding configure one of:
- `OPENAI_API_KEY`
- `MEDIA_AI_API_KEY`

Optional overrides:
- `MEDIA_AI_BASE_URL`
- `MEDIA_AI_TRANSCRIPTION_MODEL`
- `MEDIA_AI_VISION_MODEL`

Without a media-AI key, text replies still work; voice/uncaptioned-image messages are handed to a human.

## WhatsApp group inventory
Meta's Cloud API does not send normal WhatsApp-group messages to the business webhook. The included `tools/whatsapp-group-bridge` is therefore a separate authenticated bridge. It must stay running on an always-on PC/VPS and uses the same `WHATSAPP_SERVICE_SECRET` as Hostinger.
