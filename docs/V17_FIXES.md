# Sky Cars V17 fixes

- Preserves the existing MySQL inventory and automatically ensures the user-supplied last 50 vehicles exist as additional stock.
- Public inventory and admin inventory both use the same MySQL source.
- Removed visible “Reference image” badges from catalogue cards.
- Missing-photo fallback is unique per vehicle/stock number instead of repeating the same few images.
- Admin Vehicle Photos includes one-click licensed model-photo lookup from Wikimedia Commons, up to 3 photos per vehicle. Model photos are identification references; exact supplier/admin photos take priority.
- Vehicle detail pages support multi-photo galleries and explain when model photos are being used.
- DeepSeek context now reads up to 200 recent messages across all conversation rows for the same customer, including human replies, and customer memory summarizes up to 300 messages.
- Supplier sync can use an authorized JSON feed or an authorized supplier website. Supplier price receives the configured markup (default $1,000) and imports enter review before publication. Supplier identity remains admin-only.
