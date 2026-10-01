
import fs from "node:fs";
import path from "node:path";

const inv = JSON.parse(fs.readFileSync("./inventory_248.json","utf8"));
let ok = 0, bad = [];
for (const v of inv) {
  const p = path.join("./photos", String(v.stock_no).replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,80), "manifest.json");
  if (!fs.existsSync(p)) { bad.push([v.stock_no,0]); continue; }
  const m = JSON.parse(fs.readFileSync(p,"utf8"));
  const n = (m.photos || []).length;
  if (n >= 5) ok++; else bad.push([v.stock_no,n]);
}
console.log(`Vehicles with >=5 photos: ${ok}/${inv.length}`);
if (bad.length) {
  console.log("Need manual/authorized photos:");
  for (const [id,n] of bad) console.log(`${id}: ${n}/5`);
  process.exitCode = 2;
}
