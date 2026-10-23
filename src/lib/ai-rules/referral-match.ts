/*
  Facebook / Messenger referral resolution (pure: no DB, no network, fully testable).

  A tapped ad/post is the strongest evidence we ever get: the customer came from ONE specific
  vehicle. This module turns the referral text (headline / ad title / body / URL) into either that
  exact vehicle, a short candidate list, or nothing - it never guesses a different vehicle.

  Failure it fixes: a "Motorcycle Honda CBR1000 / 1000cc / $4,364" ad resolved to a Honda XR-V car
  because the AI catalog held a Honda and the matcher accepted brand-only evidence.

  Rules
    1. An exact stock number or referral/post id always wins.
    2. Model evidence (or an exact stock) is required for a single confident answer.
    3. Category is a hard filter: motorcycle referrals never resolve to cars and vice versa.
       When the text mentions both ("Sky Cars & Motorcycles"), a motorcycle word wins.
    4. Year narrows the field; price is only a tiebreaker (never a match on its own).
    5. Several equally good candidates => return them, and the reply asks ONE short question.
*/
import { categoryHint, isGenericOnly, normalize, unexplainedTokens } from './match';

export type ReferralVehicle = {
  id: any; stock_no?: any; brand?: any; model?: any; trim_name?: any; model_year?: any;
  category?: any; price_usd?: any; ai_enabled?: any;
};
export type ReferralHint = {
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  category?: string | null;
};
export type ReferralDecision =
  | { kind: 'one'; vehicle: ReferralVehicle; reason: string }
  | { kind: 'candidates'; list: ReferralVehicle[]; reason: string }
  | { kind: 'none'; reason: string };

const compact = (s: unknown) => normalize(s).replace(/ /g, '');
const tokens = (s: unknown) => normalize(s).split(' ').filter(Boolean);

/** Motorcycle-specific words that are model evidence even though they are not a brand. */
const MOTO_MODEL_WORDS = /\b(cbr|cbr\d+|ninja|gsxr|gsx-r|r6|r1|mt-?09|z1000|cb400|cb\d+|cbf|xt\d+|crf|klx|hayabusa|harley|sportster|scrambler)\b/i;

/** A price written in the ad ("$4,364", "4,364 USD", "USD 4,364"). */
export function referralPrice(text: unknown): number | null {
  const t = String(text == null ? '' : text);
  const m = /\$\s*([0-9][0-9,]{2,})/i.exec(t)
    || /\busd\s*\$?\s*([0-9][0-9,]{2,})/i.exec(t)
    || /([0-9][0-9,]{2,})\s*(?:usd|\$)/i.exec(t);
  const raw = m ? (m[1] || '') : '';
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A stock number written in the ad ("SC-859", "stock 859", "SC 10234"). */
export function referralStock(text: unknown): string | null {
  const t = String(text == null ? '' : text);
  const m = /\bsc[\s-]?0*(\d{1,6})\b|\bstock\s*(?:no\.?|number)?\s*[:#]?\s*0*(\d{1,6})\b/i.exec(t);
  const digits = m ? String(m[1] || m[2] || '').replace(/^0+/, '') : '';
  return digits ? 'SC' + digits.padStart(5, '0') : null;
}

function stockKey(v: unknown) {
  const d = String(v == null ? '' : v).toLowerCase().replace(/[^0-9]/g, '').replace(/^0+/, '');
  return d ? 'SC' + d.padStart(5, '0') : '';
}

/** True when this candidate really carries the model the ad named. */
function modelEvidence(query: string, v: ReferralVehicle) {
  const q = normalize(query);
  const qc = compact(q);
  const qTokens = new Set(tokens(q));
  const model = normalize(v.model);
  const trim = normalize(v.trim_name);
  const brand = normalize(v.brand);
  const brandTokens = new Set(tokens(brand));
  if (!model && !trim) return false;
  for (const text of [model, trim]) {
    if (!text) continue;
    if (new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return true;
    const c = compact(text);
    if (c.length >= 3 && qc.includes(c)) return true;
    // Do not let the brand word inside a model ("Chevrolet Sail") become model evidence:
    // otherwise a Sail ad can pull in every Chevrolet in stock.
    if (tokens(text).some((t) => t.length >= 3 && qTokens.has(t) && !brandTokens.has(t))) return true;
  }
  return false;
}

/** Preserve the model/year the ad really names when several exact units remain possible. */
export function referralHintFromCandidates(list: ReferralVehicle[] = []): ReferralHint | null {
  if (!list.length) return null;
  const same = (field: keyof ReferralVehicle) => {
    const values = new Set(list.map((v) => normalize(v[field])).filter(Boolean));
    return values.size === 1 ? [...values][0] : null;
  };
  const brandKey = same('brand');
  const brandTokens = new Set(list.flatMap((v) => tokens(v.brand)));
  const modelTokenSets = list.map((v) => new Set(tokens(v.model).filter((t) => !brandTokens.has(t))));
  const commonModelTokens = [...modelTokenSets[0] || []].filter((t) => modelTokenSets.every((set) => set.has(t)));
  let modelKey = same('model');
  let exemplar = list[0];
  if (!modelKey && commonModelTokens.length) {
    const ranked = [...list].sort((a, b) => tokens(b.model).length - tokens(a.model).length);
    exemplar = ranked[0];
    modelKey = normalize(exemplar.model);
  }
  const yearKey = same('model_year');
  const categoryKey = same('category');
  return {
    brand: brandKey ? String(exemplar.brand || '') || null : null,
    model: modelKey ? String(exemplar.model || '') || null : null,
    year: yearKey ? Number(exemplar.model_year) || null : null,
    category: categoryKey ? String(exemplar.category || '') || null : null,
  };
}

function brandEvidence(query: string, v: ReferralVehicle) {
  const q = normalize(query);
  const brand = normalize(v.brand);
  if (!brand) return false;
  return tokens(brand).some((t) => t.length >= 2 && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q));
}

function categoryOf(v: ReferralVehicle) {
  const c = String(v.category || '').toLowerCase();
  return c === 'car' || c === 'motorcycle' ? c : null;
}

/**
 * Rank the sellable inventory against one referral.
 * `hint` may carry a known category / price / stock extracted earlier (from the ad metadata).
 */
export function rankReferralCandidates(
  text: unknown,
  list: ReferralVehicle[] = [],
  hint: { category?: string | null; price?: number | null; stock?: string | null } = {},
): ReferralDecision {
  const query = String(text == null ? '' : text).trim();
  const stock = stockKey(hint.stock || '') || referralStock(query);
  const price = Number(hint.price) > 0 ? Number(hint.price) : referralPrice(query);
  const wantCategory = hint.category === 'car' || hint.category === 'motorcycle' ? hint.category : categoryHint(query);

  if (!list.length) return { kind: 'none', reason: 'empty_inventory' };

  // 1. Exact stock / referral id wins - nothing else may override it.
  if (stock) {
    const exact = list.filter((v) => stockKey(v.stock_no) === stock);
    if (exact.length === 1) return { kind: 'one', vehicle: exact[0], reason: 'stock_number' };
    if (exact.length > 1) return { kind: 'candidates', list: exact.slice(0, 6), reason: 'stock_number' };
  }

  let pool = list.filter((v) => modelEvidence(query, v) || brandEvidence(query, v));
  if (!pool.length) return { kind: 'none', reason: 'no_brand_or_model' };

  // 3. Category is a hard filter (a motorcycle ad can never resolve to a car).
  if (wantCategory) {
    const same = pool.filter((v) => categoryOf(v) === wantCategory);
    const unknown = pool.filter((v) => !categoryOf(v));
    const chosen = same.length ? same : unknown;
    if (!chosen.length) return { kind: 'none', reason: 'category_mismatch' };
    pool = chosen;
  }

  // 2. Model evidence is required for a confident single answer.
  const strong = pool.filter((v) => modelEvidence(query, v));
  if (strong.length) {
    // Hidden safety net: when the ad names a motorcycle model word we did not match, do not guess.
    pool = strong;
  } else {
    if (!isGenericOnly(query) && unexplainedTokens(query, pool as any).length) return { kind: 'none', reason: 'brand_only_insufficient' };
    if (pool.length > 1) return { kind: 'candidates', list: pool.slice(0, 6), reason: 'brand_only' };
    if (MOTO_MODEL_WORDS.test(query) && categoryOf(pool[0]) !== 'motorcycle') return { kind: 'none', reason: 'brand_only_insufficient' };
    return { kind: 'one', vehicle: pool[0], reason: 'brand_only' };
  }

  // 4. Year narrows the field.
  const yearMatch = /(?:19[89]\d|20[0-4]\d)/.exec(query);
  if (yearMatch) {
    const year = Number(yearMatch[0]);
    const exactYear = pool.filter((v) => Number(v.model_year) === year);
    if (exactYear.length) pool = exactYear;
  }

  if (pool.length === 1) return { kind: 'one', vehicle: pool[0], reason: 'model' };

  // 5. Price is a tiebreaker only, and only between units that already carry the model.
  const priceOf = (v: ReferralVehicle) => Number(v.price_usd) > 0 ? Number(v.price_usd) : null;
  if (price) {
    const exactPrice = pool.filter((v) => priceOf(v) === price);
    if (exactPrice.length === 1) return { kind: 'one', vehicle: exactPrice[0], reason: 'model_price' };
    if (exactPrice.length > 1) pool = exactPrice;
    else {
      const tolerance = Math.max(500, price * 0.08);
      const close = pool.filter((v) => { const p = priceOf(v); return p != null && Math.abs(p - price) <= tolerance; });
      if (close.length === 1) return { kind: 'one', vehicle: close[0], reason: 'model_price' };
      if (close.length > 1) pool = close;
    }
  }
  const newest = [...pool].sort((a, b) => Number(b.model_year || 0) - Number(a.model_year || 0));
  return { kind: 'candidates', list: newest.slice(0, 6), reason: 'ambiguous' };
}

/** Short human description of a referral decision (admin + diagnostics, never invented data). */
export function describeReferralVehicle(v: ReferralVehicle | null | undefined) {
  if (!v) return 'unmatched';
  const title = [v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ');
  return `${v.stock_no ? `Stock ${v.stock_no} - ` : ''}${title || `vehicle #${v.id}`}`;
}

/**
 * True when the ad/post text does not actually mention the model we resolved it to.
 * The admin drawer uses this to warn about a wrong automatic match (e.g. a CBR1000 ad resolved to
 * a Honda XR-V) so the owner can correct it in one tap.
 */
export function referralLooksMismatched(
  text: unknown,
  v: { model?: any; trim_name?: any; brand?: any } | null | undefined,
): boolean {
  if (!v) return true;
  const q = normalize(text);
  if (!q) return false;                       // nothing to compare: no warning, never a guess
  const qc = compact(q);
  for (const field of [v.model, v.trim_name]) {
    const name = normalize(field);
    if (!name) continue;
    if (tokens(name).some((t) => t.length >= 3 && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q))) return false;
    const c = compact(name);
    if (c.length >= 3 && qc.includes(c)) return false;
  }
  return true;
}
