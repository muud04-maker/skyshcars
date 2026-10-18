/*
  Presentation-only vehicle titles. Inventory rows keep their raw brand/model values; this module
  removes the duplicate words that suppliers often include in the model field ("Kawasaki Z1000 ABS
  Kawasaki Z1000 ABS", "Dongfeng Nissan Nissan Sunshine") without deleting meaningful trims.
*/

const clean = (value: unknown) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const words = (value: string) => value ? value.split(' ') : [];

function sameWords(a: string[], b: string[]) {
  return a.length === b.length && a.every((word, i) => word.toLowerCase() === b[i].toLowerCase());
}

/** Collapse an immediately repeated word or phrase: "Range Rover Range Rover" -> "Range Rover". */
export function collapseRepeatedPhrases(value: string) {
  let tokens = words(clean(value));
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    for (let size = Math.floor(tokens.length / 2); size >= 1; size--) {
      for (let i = 0; i + size * 2 <= tokens.length; i++) {
        const left = tokens.slice(i, i + size);
        const right = tokens.slice(i + size, i + size * 2);
        if (sameWords(left, right)) {
          tokens = [...tokens.slice(0, i + size), ...tokens.slice(i + size * 2)];
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return tokens.join(' ');
}

function startsWithWords(value: string, prefix: string) {
  const v = words(value);
  const p = words(prefix);
  return p.length > 0 && v.length >= p.length && sameWords(v.slice(0, p.length), p);
}

function dropLeading(value: string, prefix: string) {
  if (!prefix || !startsWithWords(value, prefix)) return value;
  return clean(words(value).slice(words(prefix).length).join(' '));
}

function dropWordSequence(value: string, phrase: string) {
  if (!phrase) return value;
  const tokens = words(value);
  const target = words(phrase);
  if (target.length === 0) return value;
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    if (i + target.length <= tokens.length && sameWords(tokens.slice(i, i + target.length), target)) {
      i += target.length;
    } else {
      out.push(tokens[i++]);
    }
  }
  return clean(out.join(' '));
}

/**
 * Canonical display title. Raw data is never changed. Examples:
 *   2015 / Kawasaki / "Z1000 ABS Kawasaki Z1000 ABS" -> 2015 Kawasaki Z1000 ABS
 *   2016 / GAC / "Trumpchi GS4"                     -> 2016 GAC Trumpchi GS4
 *   2016 / Land Rover / "Range Rover"               -> 2016 Land Rover Range Rover
 */
export function vehicleDisplayTitle(v: any) {
  const year = clean(v?.model_year);
  const brand = clean(v?.brand);
  let model = clean(v?.model);

  // A model field should not repeat its own brand. Remove the full brand phrase wherever it appears,
  // then remove a leading trailing word of a multi-word brand ("Dongfeng Nissan" + "Nissan Sunshine").
  model = dropWordSequence(model, brand);
  model = dropLeading(model, brand);
  if (brand.includes(' ')) {
    const brandWords = words(brand);
    for (let size = brandWords.length - 1; size >= 1; size--) {
      const suffix = brandWords.slice(-size).join(' ');
      if (startsWithWords(model, suffix)) {
        model = dropLeading(model, suffix);
        break;
      }
    }
  }

  model = collapseRepeatedPhrases(model);

  const title = collapseRepeatedPhrases([year, brand, model].filter(Boolean).join(' '));
  return title || clean(v?.stock_no) || 'Vehicle';
}
