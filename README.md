# Sky Cars V31.1 — Final All-in-One Sell-Now Package

This is the consolidated package to deploy if V31 was not used.

Included: marketplace UI, real/representative photo handling rules, 248-vehicle inventory tooling, customer login/signup and social OAuth support, quote selectors and shipping references, admin vehicle updates, shipments, WhatsApp AI, Group Reader, supplier import, Facebook social publishing, automation, campaigns, readiness dashboard, motorcycles workflow, and private Lab routes.

Start with `V31_1_FINAL_READ_FIRST.txt`.

Deploy with:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```

Do not hard-code Meta tokens or other secrets in the repository. Keep them in Hostinger Environment Variables.

For the private Lab, `/lab` is implemented in the app. `lab.skyshcars.com` still requires Hostinger to bind that hostname to the same Node.js application and provide SSL/proxy routing; a plain static subdomain folder is not enough for a Next.js route.
