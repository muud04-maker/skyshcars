# V19 FINAL
- Vehicle photos are stored in MySQL (`media_blobs`) and served from `/media/<name>`; they survive redeploys.
- Admin photo ordering (arrows), cover, approve/reject, delete. Removed the auto-fill model-photo button.
- Public `/api/vehicles` no longer returns `source`, `specs`, `legacy_id`.
- Supplier sync: honest user agent, keeps sold/hidden/reserved status, markup 0 respected, zero-result/blocked feeds reported as failures, SKY- stock numbers, existing supplier items keep their stock number.
- Webhook verification fails closed: set WHATSAPP_APP_SECRET (or META_APP_SECRET). ALLOW_UNSIGNED_WEBHOOKS=true is a temporary override.
- `tools/photo-pack/` = optional 248-vehicle internet model-photo downloader (representative photos only, NOT exact stock units).
