# WhatsApp Media Handling — DeepSeek Only

This V13 build uses DeepSeek only for AI replies.

- Text messages are stored in MySQL and sent to DeepSeek with grounded database facts.
- Photos are stored with their Meta media ID and shown securely inside the admin inbox through the protected media proxy.
- If a photo has a customer caption, only the caption is passed to DeepSeek. DeepSeek is explicitly told it cannot see the image, so it must not invent visual details.
- A photo without a caption is marked for human review and the conversation switches to Human mode.
- Voice notes are stored with their Meta media ID and are playable in the admin inbox. No transcription is attempted. The conversation switches to Human mode for review.
- Videos without captions and documents also go to Human mode.
- Meta access tokens never reach browser JavaScript.

Required AI variable:

DEEPSEEK_API_KEY

Required WhatsApp Cloud API variables:

WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID

No Gemini key is used or required.
