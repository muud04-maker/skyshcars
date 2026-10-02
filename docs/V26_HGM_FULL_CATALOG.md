# Sky Cars V26 — Full Supplier Catalog + Verified Motorcycles

## What changed
- Adds a dedicated HongGuanMa full-catalog importer that works page-by-page to avoid one long server request.
- Reads every public `/vehicles?page=N` listing page, opens each vehicle detail page, and imports that vehicle's own gallery images.
- Uses supplier vehicle IDs for stable de-duplication.
- Keeps supplier identity, supplier price, and source URL private in admin-only tables.
- Public price uses the configured Sky Cars markup; price-zero supplier listings become `Price on request` rather than fake $1,000 listings.
- Adds marketplace filters: brand, body type, steering, fuel, price, year, mileage, stock status, search, and sorting.
- Replaces the blue catalog background with a neutral marketplace layout.
- Removes random Wikimedia/model-photo fallbacks from public vehicle cards and detail pages.
- Hides the 42 legacy motorcycle rows that had blank make/model and no real motorcycle photos. Real motorcycle listings remain supported through the normal admin inventory/media tools.

## Import all HGM stock
After deployment, sign in and open `/admin/suppliers`. Use **Import all supplier vehicles + photos**. The browser sends one page request at a time and shows progress. Completed pages stay saved if a later page fails.

The importer uses only publicly accessible supplier inventory and should only be used where Sky Cars has permission to republish the supplier's inventory/photos.
