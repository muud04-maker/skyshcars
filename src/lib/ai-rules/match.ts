/*
  Strict vehicle matching (pure: no DB, no network, fully testable offline).
  Built for Facebook/ad referral headlines and for customer messages.

  Rules:
  - A match needs brand and/or model evidence, or an exact stock number.
  - Generic words (hybrid, SUV, automatic, petrol, LHD, ...) NEVER create a match on their own.
  - Year is a filter, never a match on its own.
  - Never force a wrong match: when several cars are equally likely we return a short candidate list.
*/

export type VehicleLite = {
  id: number; stock_no?: string | null; brand?: string | null; model?: string | null;
  trim_name?: string | null; model_year?: number | null; category?: string | null;
};
export type MatchResult = { kind: 'one' | 'candidates' | 'none'; vehicle?: VehicleLite; list?: VehicleLite[]; reason: string };

const GENERIC_WORDS = new Set([
  'hybrid', 'suv', 'petrol', 'gasoline', 'gas', 'diesel', 'electric', 'ev', 'automatic', 'auto', 'manual',
  'sedan', 'saloon', 'hatchback', 'coupe', 'convertible', 'wagon', 'estate', 'van', 'truck', 'pickup', 'bus',
  'car', 'cars', 'vehicle', 'vehicles', 'unit', 'stock', 'price', 'cost', 'photo', 'photos', 'picture',
  'pictures', 'pic', 'pics', 'video', 'info', 'information', 'details', 'available', 'availability', 'new',
  'used', 'clean', 'cheap', 'budget', 'mileage', 'km', 'kms', 'year', 'model', 'brand', 'color', 'colour',
  'white', 'black', 'silver', 'grey', 'gray', 'red', 'blue', 'green', 'brown', 'left', 'right', 'hand',
  'drive', 'lhd', 'rhd', 'seats', 'seater', 'sunroof', 'engine', 'transmission', 'fuel', 'and', 'the',
  'for', 'with', 'please', 'send', 'show', 'share', 'give', 'want', 'need', 'looking', 'this', 'that',
  'both', 'ok', 'okay', 'yes', 'no', 'hello', 'hi', 'hey', 'good', 'more', 'about', 'any', 'have', 'you',
  // question / function words: never brand or model evidence on their own
  'how', 'much', 'many', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'it', 'do', 'does',
  'did', 'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'my', 'our', 'your',
  'me', 'us', 'we', 'they', 'them', 'he', 'she', 'him', 'her', 'his', 'who', 'whose', 'what', 'when',
  'where', 'which', 'why', 'there', 'here', 'if', 'then', 'than', 'so', 'too', 'also', 'just', 'now',
  'still', 'really', 'very', 'sir', 'madam', 'bro', 'brother', 'sister', 'friend', 'get', 'tell', 'know',
  'let', 'see', 'look', 'like', 'help',
]);

export function normalize(s: unknown) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const compact = (s: unknown) => normalize(s).replace(/ /g, '');
const tokens = (s: unknown) => normalize(s).split(' ').filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when the query contains the given phrase as whole words. */
function hasPhrase(q: string, phrase: string) {
  if (!phrase) return false;
  return new RegExp(`\\b${escapeRe(phrase)}\\b`).test(q);
}
const meaningful = (t: string) => t.length >= 3 && !GENERIC_WORDS.has(t) && !/^\d+$/.test(t);

/*
  Category separation. A motorcycle referral must never resolve to a car just because the brand
  matches ("Honda CBR1000" -> "Honda XR-V"). Motorcycle words win when a text mentions both, because
  our own page name ("Sky Cars & Motorcycles") appears in ad copy.
*/
export const MOTORCYCLE_RE = /\b(motorcycles?|motorbikes?|bikes?|scooters?|mopeds?|atvs?|moto|quad)\b/i;
export const CAR_RE = /\b(cars?|suvs?|sedans?|saloon|hatchback|coupe|pickup|vans?|trucks?|automobiles?|jeep)\b/i;

/** The vehicle category a text is talking about (null when it does not say). */
export function categoryHint(text: unknown): 'motorcycle' | 'car' | null {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return null;
  if (MOTORCYCLE_RE.test(t)) return 'motorcycle';
  if (CAR_RE.test(t)) return 'car';
  return null;
}

/** Tokens of the query that no candidate explains: the evidence that we did not find what was named. */
export function unexplainedTokens(query: unknown, list: VehicleLite[] = []) {
  const q = normalize(query);
  if (!q) return [] as string[];
  const haystack = list.map((v) => `${normalize(v.brand)} ${normalize(v.model)} ${normalize(v.trim_name)}`).join(' ');
  const hayCompact = compact(haystack);
  const out: string[] = [];
  for (const t of tokens(q)) {
    if (!meaningful(t)) continue;
    if (new RegExp(`\\b${escapeRe(t)}\\b`).test(haystack)) continue;
    if (t.length >= 4 && hayCompact.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** The whole text is generic filler ("hybrid suv", "send photos") with no brand/model evidence. */
export function isGenericOnly(text: unknown) {
  const q = normalize(text);
  if (!q) return true;
  const stocks = q.match(/sc[\s-]?0*\d{1,6}/g) || [];
  if (stocks.length) return false;
  return !tokens(q).some(meaningful);
}

function stockDigits(v: unknown) {
  const d = String(v == null ? '' : v).toLowerCase().replace(/[^0-9]/g, '').replace(/^0+/, '');
  return d ? 'sc' + d : '';
}
function yearIn(q: string) {
  const m = q.match(/(?:19[89]\d|20[0-4]\d)/);
  return m ? Number(m[0]) : null;
}

/**
 * Match one query against a list of vehicles. Returns exactly one confident car, or a short
 * candidate list, or nothing. Never invents a match.
 */
export function matchVehicles(query: unknown, list: VehicleLite[] = []): MatchResult {
  const q = normalize(query);
  if (!q) return { kind: 'none', reason: 'empty_query' };
  if (!list.length) return { kind: 'none', reason: 'empty_inventory' };

  // 1. Exact stock number ("SC-10234", "sc 10234").
  const stockQuery = Array.from(new Set((q.match(/sc[\s-]?0*\d{1,6}/g) || []).map(stockDigits).filter(Boolean)));
  if (stockQuery.length) {
    const hit = list.filter((v) => v.stock_no && stockQuery.includes(stockDigits(v.stock_no)));
    if (hit.length === 1) return { kind: 'one', vehicle: hit[0], reason: 'stock_number' };
    if (hit.length > 1) return { kind: 'candidates', list: hit.slice(0, 6), reason: 'stock_number' };
  }

  const qCompact = compact(q);
  const qTokens = new Set(tokens(q));
  const year = yearIn(q);
  const wantCategory = categoryHint(q);

  const scored = list.map((v) => {
    const brand = normalize(v.brand);
    const model = normalize(v.model);
    const trim = normalize(v.trim_name);

    const phrase = (text: string) => !!text && hasPhrase(q, text);
    const tokenPart = (text: string) => tokens(text).some((t) => meaningful(t) && qTokens.has(t));
    const compactPart = (text: string) => { const c = compact(text); return c.length >= 3 && meaningful(c) && qCompact.includes(c); };

    const brandHit = phrase(brand) || tokenPart(brand);
    const modelHit = phrase(model) || tokenPart(model) || compactPart(model);
    const trimHit = phrase(trim) || compactPart(trim);
    const knownCategory = v.category === 'car' || v.category === 'motorcycle' ? String(v.category) : null;
    return { v, brandHit, modelHit, trimHit, knownCategory, score: (brandHit ? 1 : 0) + (modelHit ? 2 : 0) + (trimHit ? 2 : 0) };
  });

  let pool = scored.filter((s) => s.brandHit || s.modelHit);
  if (!pool.length) return { kind: 'none', reason: 'no_brand_or_model' };

  // A stated category is a hard filter: a motorcycle query can never fall back to a car of the
  // same brand (the "Honda CBR1000 -> Honda XR-V" failure).
  if (wantCategory) {
    const same = pool.filter((s) => s.knownCategory === wantCategory);
    const unknown = pool.filter((s) => !s.knownCategory);
    const chosen = same.length ? same : unknown;
    if (!chosen.length) return { kind: 'none', reason: 'category_mismatch' };
    pool = chosen;
  }

  if (year) {
    const exactYear = pool.filter((s) => Number(s.v.model_year) === year);
    // A stated year narrows the field; if nothing matches it we stay honest and offer candidates.
    if (exactYear.length) pool = exactYear;
  }

  // Evidence rule: brand-only evidence may never be forced into a single vehicle when the query
  // names something we do not have. "Honda CBR1000" must not resolve to the only Honda (XR-V).
  const strong = (s: { modelHit: boolean; trimHit: boolean }) => s.modelHit || s.trimHit;
  const unexplained = unexplainedTokens(q, list);
  if (pool.length === 1) {
    if (!strong(pool[0]) && unexplained.length) return { kind: 'none', reason: 'brand_only_insufficient' };
    return { kind: 'one', vehicle: pool[0].v, reason: 'brand_or_model' };
  }

  const max = Math.max(...pool.map((s) => s.score));
  const best = pool.filter((s) => s.score === max);
  if (best.length === 1) {
    if (!strong(best[0]) && unexplained.length) return { kind: 'candidates', list: best.map((s) => s.v), reason: 'brand_only_insufficient' };
    return { kind: 'one', vehicle: best[0].v, reason: 'best_match' };
  }
  return { kind: 'candidates', list: pool.slice(0, 6).map((s) => s.v), reason: 'ambiguous' };
}

/** Cheap helper for the reply engine: a short human list of candidate cars ("2019 Toyota Harrier (SC-1)"). */
export function describeVehicle(v: VehicleLite | null | undefined) {
  if (!v) return '';
  return [v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ') || String(v.stock_no || `#${v.id}`);
}
