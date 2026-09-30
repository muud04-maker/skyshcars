Sky Cars V8.1 hotfix

Fixes:
- Removes unsupported custom export requireAdmin from src/app/admin/layout.tsx.
- Keeps /admin/login publicly reachable.
- Protected admin pages continue to enforce isAdmin() themselves.
- Protected admin API routes continue to use adminDenied().
- DEPLOY_NOW.ps1 now stops immediately if npm install or npm run build fails.
- A failed TypeScript/build can no longer be committed/pushed by this script.

Deploy from this v4 folder:
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
