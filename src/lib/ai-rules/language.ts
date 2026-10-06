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

export type LangCode = 'en' | 'so' | 'ar' | 'zh';

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
const isChinese = (t: string) => /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]/.test(t);

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
  if (isArabic(t)) return 'ar';
  if (isChinese(t)) return 'zh';
  const latin = cleaned(t).toLowerCase();
  if (!latin) return null;
  // One distinctive Somali word is enough.
  for (const w of SOMALI_STRONG) if (new RegExp(`\\b${w}`, 'i').test(latin)) return 'so';
  if (isShortAmbiguous(t)) return null;
  for (const w of ENGLISH_STRONG) if (new RegExp(`\\b${w}\\b`, 'i').test(latin)) return 'en';
  // Latin text with no clear evidence: only judge English when there is enough of it.
  const words = latin.split(/\s+/).filter(Boolean).length;
  return words >= 3 ? 'en' : null;
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

export function languageName(code: LangCode) {
  return code === 'so' ? 'Somali' : code === 'ar' ? 'Arabic' : code === 'zh' ? 'Chinese' : 'English';
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
