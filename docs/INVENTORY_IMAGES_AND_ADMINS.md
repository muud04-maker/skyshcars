# Inventory photos and admin users

## Vehicle images
- Public inventory uses the approved `vehicle_media` cover image when one exists.
- If a listing has no approved real photo, the public site uses a clearly labelled illustrative placeholder based on the category (car, motorcycle, other).
- Admin > Vehicle Photos supports direct multi-file upload (JPG, PNG, WEBP, GIF), up to 12 files at once and 10 MB per file.
- Uploaded images are approved admin media and can be set as cover or deleted.
- Real uploaded photos always replace the placeholder automatically through the existing `vehicle_media` query.
- Runtime uploads are stored under `public/uploads/vehicles`. Before relying on this for long-term production storage, confirm Hostinger preserves this directory across Git deployments. If it does not, migrate this endpoint to persistent object/file storage without changing the database media model.

## Admin users
- The environment `ADMIN_EMAIL` + `ADMIN_PASSWORD` remains the owner/bootstrap login.
- On first successful owner login, the owner is ensured in the `admins` table.
- Admin > Admin Users can create additional owner/admin/staff accounts.
- Each additional account has its own email and password.
- Passwords are stored with Node scrypt + unique random salt. Plain passwords are never stored or returned.
- Extra admin login is validated from MySQL and receives a signed httpOnly session cookie.
- Owners/admins can create and edit admin users. Staff cannot manage admin accounts.
