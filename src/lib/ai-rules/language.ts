/*
  Customer-language detection (pure + testable).

  Priority (per the spec):
    1. the latest customer message
    2. explicit admin-set preferred language (only when the latest message is ambiguous)
    3. the recent conversation language
    4. English as the safe default

  Short/ambiguous messages ("ok", "yes", "hi", an emoji) intentionally return null so the caller
  INHERITS the conversation language instead of switching.
*/

/** ISO-style code (e.g. en, so, ar, zh, fr, sw ...). Any language is allowed. */
export type LangCode = string;
/** Languages with fast hardcoded strings (hold + welcome). Anything else uses the model + cache. */
export const HARDCODED_LANGS = ['en', 'so', 'ar', 'zh'];
export const isHardcodedLang = (code?: string | null) => HARDCODED_LANGS.includes(String(code || ''));

/** Distinctive Somali words - one is enough to identify Somali (fixes "Gaari ma haysa"). */
const SOMALI_STRONG = [
  'gaari', 'gaadh', 'gaadhi', 'baabuur', 'haysa', 'hayaa', 'haysaa', 'haysataan', 'haysan',
  'rabaa', 'raadin', 'raadineysaa', 'doonayaa', 'sawir', 'sawiro', 'sawirada', 'soo dir',
  'imisa', 'qiimo', 'qiimaha', 'meeqa', 'dalka', 'deked', 'lacag', 'iibsan', 'walaal',
  'mahadsanid', 'sidee', 'xagee', 'goorma', 'salaan', 'nabad', 'fadlan', 'waxaan', 'waxaad',
  'tahay', 'yahay', 'jiraa', 'jirtaa', 'noocee', 'firi', 'raac',
];
/** Common English words (only used after the Somali/Arabic/Chinese checks). */
const ENGLISH_STRONG = [
  'the', 'this', 'that', 'you', 'your', 'have', 'has', 'is', 'are', 'do', 'does', 'can', 'want',
  'need', 'looking', 'car', 'cars', 'vehicle', 'price', 'cost', 'available', 'ship', 'shipping',
  'deliver', 'delivery', 'how', 'what', 'where', 'when', 'much', 'many', 'please', 'thanks',
  'thank', 'good', 'send', 'photo', 'photos', 'picture', 'pictures', 'video', 'info', 'details',
  'stock', 'number', 'automatic', 'manual', 'diesel', 'petrol', 'hybrid', 'budget', 'country',
  'mileage', 'engine', 'quote', 'tracking', 'hello', 'hi', 'hey',
];
/** Pure acknowledgement / greeting words that must INHERIT the conversation language. */
const AMBIGUOUS = new Set([
  'ok', 'okay', 'okey', 'k', 'kk', 'alright', 'fine', 'good', 'great', 'nice', 'cool', 'sure',
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'hi', 'hello', 'hey', 'hii', 'helo', 'salam',
  'salaam', 'asc', 'haa', 'maya', 'salaan', 'nabad', 'mahadsanid', 'shukran', 'thanks', 'thank',
  'thankyou', 'thx', 'ty', 'bye', 'welcome', '\u0645\u0631\u062d\u0628\u0627', '\u0633\u0644\u0627\u0645',
  '\u0634\u0643\u0631\u0627', '\u0646\u0639\u0645', '\u4f60\u597d', '\u8c22\u8c22',
]);

const isArabic = (t: string) => /[\u0600-\u06FF]/.test(t);
const isCjk = (t: string) => /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF]/.test(t);
const isHangul = (t: string) => /[\uAC00-\uD7AF]/.test(t);
const isCyrillic = (t: string) => /[\u0400-\u04FF]/.test(t);
const isDevanagari = (t: string) => /[\u0900-\u097F]/.test(t);
const isThai = (t: string) => /[\u0E00-\u0E7F]/.test(t);
const isHebrew = (t: string) => /[\u0590-\u05FF]/.test(t);
const isGreek = (t: string) => /[\u0370-\u03FF]/.test(t);

/** Script-only detection: reliable, no dictionaries. Returns null for Latin/unknown scripts. */
export function detectScriptCode(text: string): string | null {
  const t = String(text || '');
  if (!t) return null;
  if (isArabic(t)) return 'ar';       // Arabic script (also used by Urdu/Persian; the classifier can refine)
  if (isCjk(t)) return 'zh';
  if (isHangul(t)) return 'ko';
  if (isCyrillic(t)) return 'ru';
  if (isDevanagari(t)) return 'hi';
  if (isThai(t)) return 'th';
  if (isHebrew(t)) return 'he';
  if (isGreek(t)) return 'el';
  return null;
}

function cleaned(t: string) {
  return String(t || '').replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** True for greetings / thanks / "ok" / emoji-only: too short to change language. */
export function isShortAmbiguous(text: string) {
  const c = cleaned(text);
  if (!c) return true;
  const words = c.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.length <= 3 && words.every((w) => AMBIGUOUS.has(w))) return true;
  const letters = c.replace(/[^\p{L}]/gu, '');
  return letters.length === 0;
}

/** Detect one clear language, or null when the text is too short/unclear to decide. */
export function detectLanguageCode(text: string): LangCode | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const script = detectScriptCode(t);
  if (script) return script;
  const latin = cleaned(t).toLowerCase();
  if (!latin) return null;
  // One distinctive Somali word is enough.
  for (const w of SOMALI_STRONG) if (new RegExp(`\\b${w}`, 'i').test(latin)) return 'so';
  if (isShortAmbiguous(t)) return null;
  for (const w of ENGLISH_STRONG) if (new RegExp(`\\b${w}\\b`, 'i').test(latin)) return 'en';
  // Latin text with no clear marker: do NOT guess English - Level 3 (the model classifier) decides.
  return null;
}

const PREFERRED_MAP: Record<string, LangCode> = {
  so: 'so', somali: 'so', 'somali (so)': 'so',
  ar: 'ar', arabic: 'ar', 'arabic (ar)': 'ar',
  zh: 'zh', chinese: 'zh', mandarin: 'zh', '\u4e2d\u6587': 'zh', '\u4e2d\u56fd\u8bed': 'zh',
  en: 'en', english: 'en',
};

/** Admin-set preferred language (free text) -> code, or null when we cannot map it. */
export function preferredToCode(preferred?: string | null): LangCode | null {
  const p = String(preferred || '').trim().toLowerCase();
  return p ? PREFERRED_MAP[p] || null : null;
}

const NAMES: Record<string, string> = {
  en: 'English', so: 'Somali', ar: 'Arabic', zh: 'Chinese', fr: 'French', sw: 'Swahili', es: 'Spanish',
  pt: 'Portuguese', ru: 'Russian', de: 'German', it: 'Italian', tr: 'Turkish', am: 'Amharic', om: 'Oromo',
  ha: 'Hausa', id: 'Indonesian', hi: 'Hindi', ur: 'Urdu', fa: 'Persian', ko: 'Korean', th: 'Thai',
  he: 'Hebrew', el: 'Greek', nl: 'Dutch', pl: 'Polish', vi: 'Vietnamese', bn: 'Bengali', yo: 'Yoruba',
  ig: 'Igbo', zu: 'Zulu', rw: 'Kinyarwanda', ti: 'Tigrinya', aa: 'Afar', ku: 'Kurdish', ps: 'Pashto',
};

export function languageName(code?: string | null) {
  const c = String(code || 'en').toLowerCase();
  return NAMES[c] || (c ? c.toUpperCase() : 'English');
}

/** Apply the priority: latest message -> explicit admin preference -> recent conversation -> English. */
export function resolveLanguage(input: { latest?: string | null; recent?: string | null; preferred?: string | null }): LangCode {
  const latest = detectLanguageCode(String(input.latest || ''));
  if (latest) return latest;
  const pref = preferredToCode(input.preferred);
  if (pref) return pref;
  const recent = detectLanguageCode(String(input.recent || ''));
  if (recent) return recent;
  return 'en';
}

/**
 * Level 3: text that is Latin (or another script we already recognised) but whose language we cannot
 * decide locally. Returns the raw text when a model classifier would help, otherwise null.
 */
export function needsModelClassification(text: string) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (detectScriptCode(t)) return false;      // script already answered it
  if (isShortAmbiguous(t)) return false;      // inherit instead
  if (detectLanguageCode(t)) return false;    // Somali/English decided locally
  const words = t.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean).length;
  return words >= 2;                          // enough text to be worth a tiny classifier call
}

/** Parse the tiny classifier JSON. Returns null unless a usable code + confidence came back. */
export function parseClassifierResult(raw: string): { code: string; name?: string; confidence: number } | null {
  const s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    const code = String(j?.language_code || j?.code || '').trim().toLowerCase();
    const confidence = Number(j?.confidence);
    if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)) return null;
    if (!Number.isFinite(confidence) || confidence < 0.5) return null;
    return { code, name: j?.language_name ? String(j.language_name) : undefined, confidence };
  } catch { return null; }
}
