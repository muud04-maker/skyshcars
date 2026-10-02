SKY CARS MASTER INVENTORY + 5 PHOTO PACKAGE

WHAT IS ALREADY INSIDE
- data/sky_cars_inventory_248.json
  The 248 real Sky Cars records currently available in the project data (198 original + 50 later additions).
- Full tools to collect the current HongGuanMa catalogue page-by-page and download each vehicle's own supplier gallery.
- A 5-photo downloader for the existing Sky Cars cars using Wikimedia Commons/Openverse licensed/public images.
- Motorcycle validation pipeline requiring real make/model/data and at least 5 real photos.
- A validator that fails any listing with fewer than 5 photos.

IMPORTANT TRUTH ABOUT THE PHOTOS
- Existing Sky Cars records do not currently contain 5 exact stock-unit photos for every vehicle.
  The included Sky Cars downloader therefore uses representative public/licensed model photos and labels them as representative.
- HongGuanMa photos are exact supplier-listing photos when the supplier page provides them.
- This package does NOT invent motorcycle inventory. Add real motorcycle records only.
- If a real HGM listing exposes fewer than 5 usable gallery photos, it is flagged instead of fabricating extra stock photos.

ONE COMMAND (Windows PowerShell)
  powershell -ExecutionPolicy Bypass -File .\BUILD_FULL_CATALOG.ps1

OUTPUT
- output/hgm_catalog_full.json
- output/hgm_missing_under_5_photos.json
- output/sky_cars_missing_photos.json
- output/motorcycles_validated.json (if data/motorcycles.json exists)
- output/photo_validation_report.json
- photos/sky_cars/<STOCK_NO>/
- photos/hgm/<HGM_ID>/
- photos/motorcycles/<STOCK_NO>/ (when you add them)

REQUIREMENTS
- Node.js 18+ with internet access.
- Supplier website must be reachable and allow the requested public pages/images.
- Respect supplier permissions/terms and image rights.

WHY THE HGM PHOTOS ARE NOT PRE-DOWNLOADED IN THIS ZIP
This ChatGPT execution environment cannot directly resolve/download hongguanma.com assets. The collector is included so you can run it from your Windows/Hostinger/VPS environment where the supplier site is reachable. It saves the full live catalogue and galleries locally.
