/*
  Inventory questions (pure + testable).

  "Do you have cars?", "Gaari ma haysa?", "What cars do you have?", "Any Toyota?",
  "Do you have motorcycles?", "SUV?", "cars under $7000" must be answered from the AI Catalog -
  never with the "Let me confirm that for you." hold. Counts and cars always come from the rows the
  caller passes in (AI-enabled + Available, following the catalog mode); nothing is invented here.
*/

export type InvKind = 'exists' | 'list' | 'brand' | 'category' | 'budget' | 'filter';
export type InventoryIntent = {
  kind: InvKind; brand?: string; category?: string; bodyType?: string;
  maxPrice?: number; transmission?: string; fuel?: string;
};
export type InvCar = { brand?: any; model?: any; trim_name?: any; category?: any; price_usd?: any; transmission?: any; fuel_type?: any; model_year?: any; created_at?: any; [k: string]: any };

export const COMMON_BRANDS = [
  'Toyota', 'Honda', 'Nissan', 'Mazda', 'Suzuki', 'Mitsubishi', 'Hyundai', 'Kia', 'Isuzu', 'Ford',
  'BMW', 'Mercedes', 'Lexus', 'Volkswagen', 'Audi', 'Volvo', 'Chevrolet', 'Peugeot', 'Renault',
  'BYD', 'Chery', 'Geely', 'Haval', 'Changan', 'JAC', 'Dongfeng', 'Foton', 'Sinotruk', 'Howo',
  'Shacman', 'Yamaha', 'Kawasaki', 'Bajaj', 'TVS', 'Land Rover', 'Subaru', 'Skoda',
];

// NB: \b does not work for Arabic/CJK script, so non-Latin alternatives are matched without it.
const WANT_VEHICLE = /(?:\b(?:cars?|vehicles?|automobiles?|inventory|stock|gaari|gaadiid|baabuur\w*)\b)|(?:\u0633\u064a\u0627\u0631\u0627\u062a|\u0645\u0631\u0643\u0628\u0627\u062a|\u8f66|\u6c7d\u8f66)/i;
const WANT_MOTO = /(?:\b(?:motorcycles?|motorbikes?|bikes?|moto|baaskiil)\b)|(?:\u062f\u0631\u0627\u062c\u0627\u062a|\u6469\u6258\u8f66)/i;
const EXISTENCE = /(?:\b(?:do you (?:have|sell|got)|have you got|any|is there|are there|ma haysa|ma haysaan|ma jiraa)\b)|(?:\u0647\u0644 \u0644\u062f\u064a\u0643|\u6709\u6ca1\u6709|\u6709\u5417|\u6709\u8f66\u5417)/i;
const LISTING = /(?:\b(?:what|which|show|list|tell me|maxaad)\b)|(?:\u0645\u0627\u0630\u0627|\u4ec0\u4e48)/i;
const NOT_INVENTORY = /\b(ship|shipping|deliver|delivery|freight|port|destination|track|tracking|quote|document|invoice|customs)\b/i;
const BODY_TYPES: [RegExp, string][] = [
  [/\b(suvs?)\b/i, 'suv'], [/\b(sedans?|saloon)\b/i, 'sedan'], [/\b(pickups?)\b/i, 'pickup'],
  [/\b(vans?)\b/i, 'van'], [/\b(buses|bus)\b/i, 'bus'], [/\b(trucks?)\b/i, 'truck'],
];
const TRANSMISSION = /\b(automatic|manual)\b/i;
const FUEL = /\b(petrol|diesel|hybrid|electric|ev|gasoline)\b/i;
const PRICE = /(?:\b(?:under|below|less than|max|maximum|up to|around|budget of)\b[^\d]{0,8})(\d[\d,\.]*)\s*(k\b)?|(\d[\d,\.]*)\s*(k\b)?\s*(?:max|maximum|budget)/i;

function findBrand(t: string, known: string[]) {
  const all = [...known, ...COMMON_BRANDS];
  for (const b of all) {
    const brand = String(b || '').trim();
    if (brand.length < 2) continue;
    if (new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) return brand;
  }
  return null;
}

/** Which inventory question is this (or null when it is not an inventory question at all)? */
export function inventoryIntent(text: string, knownBrands: string[] = []): InventoryIntent | null {
  const t = String(text || '').trim();
  if (!t) return null;
  if (NOT_INVENTORY.test(t)) return null; // shipping / tracking / documents keep their own path
  const brand = findBrand(t, knownBrands);
  const moto = WANT_MOTO.test(t);
  const wantsVehicle = moto || WANT_VEHICLE.test(t);
  const body = BODY_TYPES.find(([re]) => re.test(t));
  const price = PRICE.exec(t);
  const maxPrice = price ? Number(String(price[1] || price[3] || '').replace(/,/g, '')) * ((price[2] || price[4]) ? 1000 : 1) : undefined;
  const transmission = TRANSMISSION.exec(t)?.[1]?.toLowerCase();
  const fuel = FUEL.exec(t)?.[1]?.toLowerCase();

  if (brand) return { kind: 'brand', brand };
  if (maxPrice && Number.isFinite(maxPrice)) return { kind: 'budget', maxPrice };
  if (body) return { kind: 'category', bodyType: body[1] };
  if (moto) return { kind: 'category', category: 'motorcycle' };
  if (wantsVehicle) return { kind: EXISTENCE.test(t) && !LISTING.test(t) ? 'exists' : 'list' };
  if (transmission) return { kind: 'filter', transmission };
  if (fuel) return { kind: 'filter', fuel };
  return null;
}

const has = (v: any, needle?: string) => !!needle && String(v || '').toLowerCase().includes(needle.toLowerCase());

/** Filter the AI-catalog rows for this intent (newest first). Never adds rows that were not passed in. */
export function filterInventory(cars: InvCar[], intent: InventoryIntent): InvCar[] {
  const out = (cars || []).filter((c) => {
    if (intent.brand && !has(c.brand, intent.brand)) return false;
    if (intent.category === 'motorcycle' && String(c.category || '') !== 'motorcycle') return false;
    if (intent.bodyType) {
      const hay = `${c.trim_name || ''} ${c.model || ''}`.toLowerCase();
      if (!hay.includes(intent.bodyType)) return false;
    }
    if (intent.maxPrice != null && !(Number(c.price_usd) > 0 && Number(c.price_usd) <= intent.maxPrice)) return false;
    if (intent.transmission && !has(c.transmission, intent.transmission)) return false;
    if (intent.fuel && !has(c.fuel_type, intent.fuel)) return false;
    return true;
  });
  const time = (v: any) => { const x = v?.created_at ? Date.parse(String(v.created_at).replace(' ', 'T')) : 0; return Number.isFinite(x) ? x : 0; };
  return out.sort((a, b) => (time(b) - time(a)) || (Number(b.model_year || 0) - Number(a.model_year || 0)));
}

export function carTitle(c: InvCar) {
  return [c.model_year, c.brand, c.model].filter(Boolean).join(' ') || 'Vehicle';
}
const money = (v: any) => (v?.price_usd ? '$' + Number(v.price_usd).toLocaleString('en-US') : '');

const T = {
  zero: {
    en: "We don't have any vehicles enabled in our sales inventory right now. Let me check with our team.",
    so: 'Hadda gaari ku jira inventory-ga iibka ma jiro. Kooxdayada ayaan ka hubinayaa.',
    ar: '\u0644\u0627 \u064a\u0648\u062c\u062f \u0644\u062f\u064a\u0646\u0627 \u0623\u064a \u0633\u064a\u0627\u0631\u0627\u062a \u0645\u0641\u0639\u0651\u0644\u0629 \u0641\u064a \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0622\u0646. \u0633\u0623\u062a\u0623\u0643\u062f \u0645\u0639 \u0641\u0631\u064a\u0642\u0646\u0627.',
    zh: '\u76ee\u524d\u6211\u4eec\u7684\u9500\u552e\u5e93\u5b58\u91cc\u6ca1\u6709\u53ef\u552e\u8f66\u8f86\u3002\u6211\u548c\u56e2\u961f\u786e\u8ba4\u4e00\u4e0b\u3002',
  },
  exists: {
    en: (n: number, noun: string) => `Yes, we have ${n} ${noun} available. Are you looking for a specific brand or budget?`,
    so: (n: number, noun: string) => `Haa, waxaan haynaa ${n} ${noun} oo diyaar ah. Nooc ama miisaaniyad gaar ah ma raadineysaa?`,
    ar: (n: number, noun: string) => `\u0646\u0639\u0645\u060c \u0644\u062f\u064a\u0646\u0627 ${n} ${noun} \u0645\u062a\u0648\u0641\u0631\u0629 \u0627\u0644\u0622\u0646. \u0647\u0644 \u062a\u0628\u062d\u062b \u0639\u0646 \u0645\u0627\u0631\u0643\u0629 \u0623\u0648 \u0645\u064a\u0632\u0627\u0646\u064a\u0629 \u0645\u0639\u064a\u0646\u0629\u061f`,
    zh: (n: number, noun: string) => `\u662f\u7684\uff0c\u6211\u4eec\u73b0\u5728\u6709 ${n} ${noun} \u53ef\u4f9b\u9009\u62e9\u3002\u60a8\u6709\u504f\u597d\u7684\u54c1\u724c\u6216\u9884\u7b97\u5417\uff1f`,
  },
  brandYes: {
    en: (n: number, brand: string, noun: string) => `Yes, we have ${n} ${brand} ${noun} available. I can show you the newest ones.`,
    so: (n: number, brand: string, noun: string) => `Haa, waxaan haynaa ${n} ${brand} ${noun} oo diyaar ah. Kuwa ugu cusub ayaan kuu soo bandhigi karaa.`,
    ar: (n: number, brand: string, noun: string) => `\u0646\u0639\u0645\u060c \u0644\u062f\u064a\u0646\u0627 ${n} ${brand} \u0645\u062a\u0648\u0641\u0631\u0629. \u064a\u0645\u0643\u0646\u0646\u064a \u0623\u0646 \u0623\u0631\u064a\u0643 \u0623\u062d\u062f\u062b\u0647\u0627.`,
    zh: (n: number, brand: string, noun: string) => `\u662f\u7684\uff0c\u6211\u4eec\u6709 ${n} \u53f0 ${brand} ${noun} \u53ef\u4f9b\u9009\u62e9\uff0c\u53ef\u4ee5\u7ed9\u60a8\u770b\u6700\u65b0\u7684\u3002`,
  },
  brandNo: {
    en: (brand: string) => `We don't currently have a ${brand} in our sales inventory. I can help you check another brand.`,
    so: (brand: string) => `Hadda ${brand} kama jiro inventory-ga iibka. Waxaan kaa caawin karaa nooc kale.`,
    ar: (brand: string) => `\u0644\u0627 \u064a\u0648\u062c\u062f ${brand} \u062d\u0627\u0644\u064a\u0627\u064b \u0641\u064a \u0645\u062e\u0632\u0648\u0646\u0646\u0627. \u064a\u0645\u0643\u0646\u0646\u064a \u0645\u0633\u0627\u0639\u062f\u062a\u0643 \u0628\u0645\u0627\u0631\u0643\u0629 \u0623\u062e\u0631\u0649.`,
    zh: (brand: string) => `\u76ee\u524d\u9500\u552e\u5e93\u5b58\u91cc\u6ca1\u6709 ${brand}\uff0c\u6211\u53ef\u4ee5\u5e2e\u60a8\u770b\u770b\u5176\u4ed6\u54c1\u724c\u3002`,
  },
  matching: {
    en: (n: number, noun: string) => `Yes, we have ${n} matching ${noun}. Here are the newest:`,
    so: (n: number, noun: string) => `Haa, waxaan haynaa ${n} ${noun} oo u dhigma. Kuwa ugu cusub:`,
    ar: (n: number, noun: string) => `\u0646\u0639\u0645\u060c \u0644\u062f\u064a\u0646\u0627 ${n} \u0645\u062a\u0648\u0641\u0631\u0629. \u0623\u062d\u062f\u062b\u0647\u0627:`,
    zh: (n: number, noun: string) => `\u662f\u7684\uff0c\u6709 ${n} \u53f0\u7b26\u5408\u6761\u4ef6\uff0c\u4ee5\u4e0b\u662f\u6700\u65b0\u7684\uff1a`,
  },
  listTail: {
    en: 'Tell me your budget or preferred brand and I will narrow it down.',
    so: 'Ii sheeg miisaaniyadaada ama nooca aad rabto, waan kuu soo gaabinayaa.',
    ar: '\u0623\u062e\u0628\u0631\u0646\u064a \u0628\u0645\u064a\u0632\u0627\u0646\u064a\u062a\u0643 \u0623\u0648 \u0627\u0644\u0645\u0627\u0631\u0643\u0629 \u0627\u0644\u062a\u064a \u062a\u0641\u0636\u0644\u0647\u0627 \u0648\u0633\u0623\u0636\u064a\u0642 \u0627\u0644\u062e\u064a\u0627\u0631\u0627\u062a.',
    zh: '\u544a\u8bc9\u6211\u60a8\u7684\u9884\u7b97\u6216\u559c\u6b22\u7684\u54c1\u724c\uff0c\u6211\u5e2e\u60a8\u7f29\u5c0f\u8303\u56f4\u3002',
  },
};
type L = 'en' | 'so' | 'ar' | 'zh';
const pick = (lang: string) => (['en', 'so', 'ar', 'zh'].includes(String(lang)) ? String(lang) as L : 'en');

/**
 * Build the short grounded answer for an inventory question.
 * `totalAi` = how many vehicles the AI may sell at all (used for the honest zero-inventory case).
 */
export function inventoryAnswer(intent: InventoryIntent, cars: InvCar[], lang: string, opts: { totalAi?: number } = {}) {
  const L = pick(lang);
  const totalAi = opts.totalAi == null ? cars.length : Number(opts.totalAi);
  if (!totalAi) return { text: T.zero[L], needsStaff: true };            // nothing enabled: honest, ask staff
  const n = cars.length;
  const noun = intent.category === 'motorcycle' ? 'motorcycles' : 'vehicles';
  if (intent.kind === 'brand' && !n) return { text: T.brandNo[L](String(intent.brand)), needsStaff: false };
  if (!n) return { text: T.exists[L](totalAi, 'vehicles'), needsStaff: false }; // can't narrow it: general answer
  if (intent.kind === 'exists' && n === totalAi) return { text: T.exists[L](n, noun), needsStaff: false };
  const lines = cars.slice(0, 3).map((c) => `- ${carTitle(c)}${money(c) ? ` - ${money(c)}` : ''}`);
  const head = intent.kind === 'brand' ? T.brandYes[L](n, String(intent.brand), noun) : T.matching[L](n, noun);
  return { text: `${head}\n${lines.join('\n')}\n${T.listTail[L]}`, needsStaff: false };
}
