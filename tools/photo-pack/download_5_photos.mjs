
import fs from "node:fs";
import path from "node:path";

const inventory = JSON.parse(fs.readFileSync("./inventory_248.json", "utf8"));
const ROOT = path.resolve("./photos");
fs.mkdirSync(ROOT, { recursive: true });

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const safe = s => String(s).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);

async function commonsSearch(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "25");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|mime|size|extmetadata");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const r = await fetch(url, { headers: { "User-Agent": "SkyCarsInventoryPhotoFetcher/1.0" }});
  if (!r.ok) return [];
  const data = await r.json();
  return Object.values(data?.query?.pages || {})
    .map(p => {
      const ii = p.imageinfo?.[0];
      const meta = ii?.extmetadata || {};
      return ii ? {
        url: ii.url,
        width: ii.width || 0,
        height: ii.height || 0,
        mime: ii.mime || "",
        source_page: ii.descriptionurl || "",
        license: meta.LicenseShortName?.value || "",
        artist: meta.Artist?.value || "",
        title: p.title || ""
      } : null;
    })
    .filter(Boolean)
    .filter(x => /^image\//.test(x.mime) && x.width >= 600 && x.height >= 400);
}

async function openverseSearch(query) {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", "20");
  const r = await fetch(url, { headers: { "User-Agent": "SkyCarsInventoryPhotoFetcher/1.0" }});
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.results || []).map(x => ({
    url: x.url,
    width: x.width || 0,
    height: x.height || 0,
    mime: x.filetype ? `image/${x.filetype}` : "image/jpeg",
    source_page: x.foreign_landing_url || "",
    license: x.license || "",
    artist: x.creator || "",
    title: x.title || ""
  })).filter(x => x.url && x.width >= 600 && x.height >= 400);
}

function extensionFrom(url, mime) {
  const u = url.toLowerCase().split("?")[0];
  for (const ext of [".jpg",".jpeg",".png",".webp"]) if (u.endsWith(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  return ".jpg";
}

async function download(url, file) {
  const r = await fetch(url, { headers: { "User-Agent": "SkyCarsInventoryPhotoFetcher/1.0" }});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 15000) throw new Error("image too small");
  fs.writeFileSync(file, buf);
}

for (let idx=0; idx<inventory.length; idx++) {
  const v = inventory[idx];
  const folder = path.join(ROOT, safe(v.stock_no));
  fs.mkdirSync(folder, { recursive: true });

  const manifest = [];
  const seen = new Set();

  for (const q of v.photo_search_queries || []) {
    if (manifest.length >= 5) break;

    let found = [];
    try { found = await commonsSearch(q); } catch {}
    if (found.length < 5) {
      try { found.push(...await openverseSearch(q)); } catch {}
    }

    for (const img of found) {
      if (manifest.length >= 5) break;
      if (!img.url || seen.has(img.url)) continue;
      seen.add(img.url);

      const n = String(manifest.length + 1).padStart(2, "0");
      const ext = extensionFrom(img.url, img.mime || "");
      const file = path.join(folder, `${n}${ext}`);

      try {
        await download(img.url, file);
        manifest.push({
          file: path.relative(".", file).replaceAll("\\","/"),
          image_url: img.url,
          source_page: img.source_page,
          license: img.license,
          artist: img.artist,
          title: img.title,
          query: q
        });
      } catch {}
      await delay(180);
    }
    await delay(250);
  }

  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
    stock_no: v.stock_no,
    display_title: v.display_title,
    note: "Representative model images from licensed/public internet sources. Do not claim they depict the exact stock unit unless independently verified.",
    photos: manifest
  }, null, 2));

  console.log(`${idx+1}/${inventory.length} ${v.stock_no}: ${manifest.length}/5 photos`);
}

console.log("Finished. Review any vehicle with fewer than 5 downloaded photos.");
