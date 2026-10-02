# Sky Cars V29 Marketplace

V29 extends the existing production Sky Cars architecture into a larger vehicle marketplace while preserving the working inventory, supplier import, WhatsApp AI, Group Reader, admin, automation, tracking and private Lab systems.

## Marketplace additions

- Marketplace discovery homepage and navigation
- Existing advanced inventory search/filtering preserved
- Save/favorite vehicles in the browser
- Recently viewed vehicles
- Compare up to four vehicles
- Similar-vehicle recommendations on detail pages
- Expanded My Sky Cars shopping workspace
- China→Africa shipping reference estimator
- 95 supplied reference routes covering 54 African markets
- Destination route table and gateway/city reference
- Vehicle + reference-shipping estimate on detail pages
- Responsive marketplace presentation

## Shipping policy

The shipping data in `data/shipping_reference.json` is planning/reference information supplied by the project owner. It is not a live carrier quotation. Final route, freight, inland transport, port, documentation, insurance, customs and destination charges must be confirmed through Sky Cars before payment.

## Inventory and photos

V29 preserves the V28 real-inventory rules. It does not fabricate inventory or motorcycle data, does not restore invalid legacy motorcycle listings, does not expose supplier identity/cost, and does not use random internet/model photos as exact stock-unit photos.

## Production stack

- Next.js 16.x + TypeScript
- MySQL
- Hostinger
- GitHub `main`
- Production: `https://skyshcars.com`
- Private Lab target: `https://lab.skyshcars.com`
- Required build: `next build --webpack`

## Deployment

Run on the Windows deployment machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_NOW.ps1
```

The deployment script performs package validation, `npm install`, TypeScript validation and the production Webpack build before it commits or pushes anything.

Read `V29_READ_THIS_FIRST.txt` before deployment.
