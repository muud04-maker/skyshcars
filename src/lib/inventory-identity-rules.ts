/*
  Pure identity rules for supplier posts.

  Similar specifications are evidence, never proof. Only an exact strong reference can confirm
  that a post belongs to an existing vehicle. Two genuinely different units of the same make,
  model and year therefore stay separate and/or enter Inventory Review.
*/

export type IdentitySpec = {
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  trim_name?: string | null;
  model_year?: number | string | null;
  mileage_km?: number | string | null;
  price_usd?: number | string | null;
  engine?: string | null;
  transmission?: string | null;
  fuel_type?: string | null;
  color?: string | null;
  vin?: string | null;
  stock_no?: string | null;
  supplier_reference?: string | null;
  image_hashes?: string[];
  perceptual_hashes?: string[];
  existing_vehicle_id?: number | string | null;
};

export type IdentityCandidate = IdentitySpec & { id: number };

export type IdentityDecision = {
  kind: 'confirmed' | 'possible' | 'new';
  confidence: number;
  selected_vehicle_id: number | null;
  reasons: string[];
  candidates: Array<{ vehicle_id: number; confidence: number; reasons: string[] }>;
};

export function normalizeIdentityText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** VIN/stock/supplier references ignore presentation punctuation but never fuzzy-match. */
export function normalizeReference(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeVin(value: unknown) {
  const vin = normalizeReference(value);
  return vin.length === 17 ? vin : '';
}

export function normalizeMileageKm(value: unknown, unit: unknown = 'km') {
  const raw = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0];
  const number = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(number) || number < 0) return null;
  const u = normalizeIdentityText(unit);
  if (/^(mi|mile|miles|mileage mi)$/.test(u)) return Math.round(number * 1.609344);
  if (/^(km|kilometre|kilometres|kilometer|kilometers)$/.test(u)) return Math.round(number);
  return null;
}

export function normalizePrice(value: unknown, currency: unknown) {
  const text = String(value ?? '').replace(/,/g, '');
  const raw = text.match(/\d+(?:\.\d+)?/)?.[0];
  const number = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(number) || number < 0) return { value: null as number | null, currency: null as string | null };
  const c = String(currency ?? '').trim().toUpperCase();
  const detected = /\bUSD\b|\$/.test(c + ' ' + text) ? 'USD'
    : /\bCNY\b|\bRMB\b|¥/.test(c + ' ' + text) ? 'CNY'
    : /\bAED\b/.test(c + ' ' + text) ? 'AED'
    : /\bKES\b|\bKSH\b/.test(c + ' ' + text) ? 'KES'
    : c && /^[A-Z]{3}$/.test(c) ? c : null;
  return { value: number, currency: detected };
}

const year = (value: unknown) => {
  const number = Number(String(value ?? '').match(/(?:19|20)\d{2}/)?.[0]);
  return Number.isInteger(number) ? number : null;
};
const price = (value: unknown) => {
  const number = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
};
const mileage = (value: unknown) => {
  const number = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
};

function compareSpecs(proposed: IdentitySpec, candidate: IdentityCandidate) {
  const reasons: string[] = [];
  let score = 0;
  let strong = false;

  const pBrand = normalizeIdentityText(proposed.brand);
  const cBrand = normalizeIdentityText(candidate.brand);
  const pModel = normalizeIdentityText(proposed.model);
  const cModel = normalizeIdentityText(candidate.model);
  const pYear = year(proposed.model_year);
  const cYear = year(candidate.model_year);

  if (proposed.existing_vehicle_id && Number(proposed.existing_vehicle_id) === Number(candidate.id)) {
    score = 1;
    strong = true;
    reasons.push('staff/import vehicle id');
  }

  const pVin = normalizeVin(proposed.vin);
  const cVin = normalizeVin(candidate.vin);
  if (pVin && cVin && pVin === cVin) {
    score = Math.max(score, 1);
    strong = true;
    reasons.push('exact VIN');
  }

  const pStock = normalizeReference(proposed.stock_no);
  const cStock = normalizeReference(candidate.stock_no);
  if (pStock && cStock && pStock === cStock) {
    score = Math.max(score, 1);
    strong = true;
    reasons.push('exact stock number');
  }

  const pSupplier = normalizeReference(proposed.supplier_reference);
  const cSupplier = normalizeReference(candidate.supplier_reference);
  if (pSupplier && cSupplier && pSupplier === cSupplier) {
    score = Math.max(score, 0.98);
    strong = true;
    reasons.push('exact supplier reference');
  }

  if (pBrand && cBrand && pBrand === cBrand) { score += 0.16; reasons.push('same make'); }
  if (pModel && cModel && pModel === cModel) { score += 0.2; reasons.push('same model'); }
  if (pYear && cYear && pYear === cYear) { score += 0.14; reasons.push('same year'); }
  if (normalizeIdentityText(proposed.category) && normalizeIdentityText(proposed.category) === normalizeIdentityText(candidate.category)) {
    score += 0.05;
    reasons.push('same category');
  }
  const trim = normalizeIdentityText(proposed.trim_name);
  if (trim && trim === normalizeIdentityText(candidate.trim_name)) { score += 0.05; reasons.push('same trim'); }
  const engine = normalizeIdentityText(proposed.engine);
  if (engine && engine === normalizeIdentityText(candidate.engine)) { score += 0.06; reasons.push('same engine'); }
  const transmission = normalizeIdentityText(proposed.transmission);
  if (transmission && transmission === normalizeIdentityText(candidate.transmission)) { score += 0.04; reasons.push('same transmission'); }
  const fuel = normalizeIdentityText(proposed.fuel_type);
  if (fuel && fuel === normalizeIdentityText(candidate.fuel_type)) { score += 0.03; reasons.push('same fuel'); }
  const color = normalizeIdentityText(proposed.color);
  if (color && color === normalizeIdentityText(candidate.color)) { score += 0.03; reasons.push('same color'); }

  const pMileage = mileage(proposed.mileage_km);
  const cMileage = mileage(candidate.mileage_km);
  if (pMileage !== null && cMileage !== null && pMileage === cMileage) { score += 0.06; reasons.push('same mileage'); }
  const pPrice = price(proposed.price_usd);
  const cPrice = price(candidate.price_usd);
  if (pPrice !== null && cPrice !== null && pPrice === cPrice) { score += 0.04; reasons.push('same price'); }

  const hashes = new Set((proposed.image_hashes || []).map(normalizeReference).filter(Boolean));
  const imageMatch = (candidate.image_hashes || []).some((hash) => hashes.has(normalizeReference(hash)));
  if (imageMatch) {
    score += 0.24;
    reasons.push('exact image fingerprint');
  }
  const proposedHashes = (proposed.perceptual_hashes || []).filter((hash) => /^[a-f0-9]{16}$/i.test(String(hash)));
  const candidateHashes = (candidate.perceptual_hashes || []).filter((hash) => /^[a-f0-9]{16}$/i.test(String(hash)));
  const perceptualMatch = proposedHashes.some((left) => candidateHashes.some((right) => {
    let value = BigInt('0x' + left) ^ BigInt('0x' + right);
    let distance = 0;
    while (value) { distance += Number(value & BigInt(1)); value >>= BigInt(1); }
    return distance <= 6;
  }));
  if (perceptualMatch) {
    score += 0.14;
    reasons.push('similar image fingerprint');
  }

  return { score: Math.min(1, score), strong, reasons, imageMatch, perceptualMatch };
}

export function decideVehicleIdentity(proposed: IdentitySpec, candidates: IdentityCandidate[]): IdentityDecision {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, result: compareSpecs(proposed, candidate) }))
    .map(({ candidate, result }) => ({
      vehicle_id: Number(candidate.id),
      confidence: result.score,
      reasons: result.reasons,
      strong: result.strong,
      imageMatch: result.imageMatch,
      perceptualMatch: result.perceptualMatch,
    }))
    .filter((candidate) => candidate.strong || candidate.imageMatch || candidate.perceptualMatch || candidate.confidence >= 0.35)
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.confidence - a.confidence);

  const output = ranked.map(({ strong: _strong, imageMatch: _imageMatch, perceptualMatch: _perceptualMatch, ...candidate }) => candidate);
  const strongCandidates = ranked.filter((candidate) => candidate.strong);
  const confirmed = strongCandidates[0];
  if (confirmed && strongCandidates.length === 1) {
    return {
      kind: 'confirmed',
      confidence: confirmed.confidence,
      selected_vehicle_id: confirmed.vehicle_id,
      reasons: confirmed.reasons,
      candidates: output,
    };
  }
  if(strongCandidates.length>1){
    return {
      kind:'possible',
      confidence:strongCandidates[0].confidence,
      selected_vehicle_id:strongCandidates[0].vehicle_id,
      reasons:['multiple vehicles share a strong reference'],
      candidates:output,
    };
  }
  if (ranked.length) {
    return {
      kind: 'possible',
      confidence: ranked[0].confidence,
      selected_vehicle_id: ranked[0].vehicle_id,
      reasons: ranked[0].reasons,
      candidates: output,
    };
  }
  return { kind: 'new', confidence: 0, selected_vehicle_id: null, reasons: [], candidates: [] };
}

export function identityShape(spec: IdentitySpec) {
  return {
    category: normalizeIdentityText(spec.category),
    brand: normalizeIdentityText(spec.brand),
    model: normalizeIdentityText(spec.model),
    model_year: year(spec.model_year),
    mileage_km: mileage(spec.mileage_km),
    price_usd: price(spec.price_usd),
    engine: normalizeIdentityText(spec.engine),
    transmission: normalizeIdentityText(spec.transmission),
    fuel_type: normalizeIdentityText(spec.fuel_type),
    color: normalizeIdentityText(spec.color),
    vin: normalizeVin(spec.vin),
    stock_no: normalizeReference(spec.stock_no),
    supplier_reference: normalizeReference(spec.supplier_reference),
  };
}
