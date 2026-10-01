SKY CARS — 248 VEHICLE INTERNET PHOTO PACK

CONTENTS
- inventory_248.json : 198 original Sky Cars records + the 50 additional vehicles supplied later.
- download_5_photos.mjs : downloads at least 5 distinct internet model photos per vehicle where available.
- check_photo_counts.mjs : checks which vehicles have 5 photos.
- photos/ : created after running the downloader.

WHY 248, NOT 250
The supplied data contains 198 original vehicles + 50 additional vehicles = 248 real records.
No two extra vehicles were invented.

PHOTO SOURCES
The downloader searches Wikimedia Commons first and Openverse as a fallback so the images are from
public/Creative-Commons-type internet sources rather than random Google hotlinks.

IMPORTANT
These are representative model photos found from the internet. They are NOT proof that a photo depicts
the exact physical stock unit. For an exact stock listing, replace them with the seller/supplier's
authorized photos.

RUN (Windows PowerShell)
1. Extract this ZIP.
2. Open PowerShell in this folder.
3. Run:
   node .\download_5_photos.mjs

4. When it finishes, run:
   node .\check_photo_counts.mjs

Each vehicle's 5 images are stored in:
photos\<STOCK_NO>\

A manifest.json in each folder records the image URL, source page, license, artist, and search query.
