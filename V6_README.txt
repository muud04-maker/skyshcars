SKY CARS V6 QUICK UPGRADE
=========================
Changes included:
- Public homepage no longer exposes "198 Imported inventory records".
- Public homepage no longer exposes "AI + Human" workflow.
- Customer-facing cards now use marketplace/quote language.
- Light-blue site/page background treatment.
- Quote page redesigned with two-column responsive form.
- Destination country is now a dropdown using the existing Africa market dataset.
- Destination port/gateway is disabled until a country is selected.
- Port options automatically change with selected country.
- Landlocked markets show a gateway/onward-transport notice.
- Added 40HC shipping option.
- Existing Hostinger/MySQL/admin/AI code is preserved.

DEPLOY
1. Extract this ZIP.
2. Open PowerShell in the extracted folder.
3. Run:
   powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
4. The script copies the upgrade into your existing Git repo, runs npm install,
   runs the required Next.js Webpack production build, commits, and pushes main.
5. Hostinger auto-deployment then starts.

DO NOT put passwords/API keys in the source or GitHub.
Keep DB/DeepSeek/Meta secrets in Hostinger Environment Variables.
