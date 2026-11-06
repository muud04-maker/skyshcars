/*
  Which unit(s) to send photos of (pure + testable).

  Nov 7 live failure: the customer wrote "Yamaha Mt09", then "I asked you to send me the images",
  then "2016". Two MT-09 units matched, so no photo was sent. Rules:
  - a year in the latest message (then in earlier messages) picks the unit;
  - when the remaining units are the SAME model, photos of up to two of them may be sent;
  - different models stay ambiguous: never send photos of an unrelated vehicle.
*/
import { vehicleDisplayTitle } from '../display-title';

const YEAR = /\b(19[89]\d|20[0-3]\d)\b/g;

export function yearsIn(text: unknown): number[] {
  return [...String(text == null ? '' : text).matchAll(YEAR)].map((m) => Number(m[1]));
}

/** Keep the units whose year the customer mentioned (latest message first, then earlier ones). */
export function narrowByYear<T extends { model_year?: any }>(vehicles: T[], text: string, prior = ''): T[] {
  for (const source of [text, prior]) {
    const years = yearsIn(source);
    if (!years.length) continue;
    const hit = vehicles.filter((v) => years.includes(Number(v.model_year)));
    if (hit.length) return hit;
  }
  return vehicles;
}

const modelKey = (v: any) => vehicleDisplayTitle({ ...v, model_year: null, trim_name: null, stock_no: null })
  .toLowerCase().replace(/[^a-z0-9]/g, '');

/** All units are the same brand + model (only year / stock / price differ). */
export function sameModel(vehicles: any[]) {
  return vehicles.length > 0 && vehicles.every((v) => modelKey(v) === modelKey(vehicles[0]));
}

/**
 * The customer named a specific model, not just a brand ("Yamaha Mt09" vs "Yamaha"): true when the
 * brand-filtered list was narrowed to fewer, identical-model units.
 */
export function namedSpecificModel(brandUnits: any[], modelUnits: any[]) {
  return modelUnits.length > 0 && modelUnits.length < brandUnits.length && sameModel(modelUnits);
}

const compactOf = (s: unknown) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The model part of a unit's display title ("2018 Yamaha MT-09" -> "mt09"). */
function modelPart(v: any) {
  const title = vehicleDisplayTitle({ ...v, model_year: null, trim_name: null, stock_no: null });
  const brandWords = String(v?.brand || '').trim().split(/\s+/).filter(Boolean);
  const words = title.split(' ');
  // Drop the leading brand word(s) that are also the first title words.
  let i = 0;
  while (i < words.length && i < brandWords.length && words[i].toLowerCase() === brandWords[i].toLowerCase() && i < words.length - 1) i++;
  return compactOf(words.slice(i || 1).join(' '));
}

/**
 * Units whose MODEL the text names ("Yamaha Mt09" -> the MT-09s, not the R1). Returns the input
 * unchanged when no model is named, so a brand-only message keeps the full brand list.
 */
export function narrowToNamedModel<T>(units: T[], text: string): T[] {
  const q = compactOf(text);
  const words = new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!q) return units;
  const hit = units.filter((u: any) => {
    const m = modelPart(u);
    if (!m) return false;
    return m.length >= 3 ? q.includes(m) : words.has(m);
  });
  return hit.length ? hit : units;
}
