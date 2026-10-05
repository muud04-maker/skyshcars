/*
  Lightweight intent rules shared by the Group log, listing detection and the WhatsApp reply rule.
  Deterministic on purpose: no AI call decides whether a message is a question or a listing.
*/

const QUESTION_START = /^(how|what|whats|what's|when|where|who|which|why|is|are|do|does|did|can|could|will|would|should|any|anyone|have you|got)\b/i;
const QUESTION_ANY = /\b(how much|price\s*\?|what('?s| is) the price|is (it|this|that) (still )?available|still available|do you have|have you got|any (one|body) (has|have|selling)|where (is|are|can)|when (will|can|does)|how (long|many|do|can))\b/i;
// Somali / Arabic common question words (customers and group members in our markets).
const QUESTION_LOCAL = /\b(imisa|meeqa|maxaa|xagee|goorma|ma (haysaa|haysataan|jiraa)|kam|بكم|كم|هل|متى|أين|وين)\b/i;

export function isQuestion(text: string) {
  const t = String(text || '').trim();
  if (!t) return false;
  return /[?؟]/.test(t) || QUESTION_START.test(t) || QUESTION_ANY.test(t) || QUESTION_LOCAL.test(t);
}

const REQUEST = /\b(send|show|share|give|want|wanna|need|looking for|interested|buy|purchase|order|book|reserve|quote|price|cost|ship|shipping|deliver|track|tracking|photo|photos|picture|pictures|pics?|video|details|info|information|available|availability|budget|offer|discount|pay|payment|call me|contact me|tell me|let me know|help)\b/i;
const REQUEST_LOCAL = /\b(rabaa|doonayaa|ii soo dir|sawir|qiimo|qiimaha|i sii|أريد|ابغى|ارسل|صور|سعر)\b/i;
const VEHICLE_HINT = /\b(SC\s?-?\d{1,6}|toyota|honda|nissan|mazda|suzuki|mitsubishi|hyundai|kia|isuzu|yamaha|kawasaki|bajaj|tvs|ford|bmw|mercedes|lexus|land ?cruiser|hilux|prado|corolla|vitz|probox|noah|voxy|harrier|rav4|byd|chery|geely|haval|changan|jac|dongfeng|foton|sinotruk|howo|shacman)\b/i;

/** The customer asked something or asked for something (vehicle names count as a request). */
export function isRequest(text: string) {
  const t = String(text || '').trim();
  return REQUEST.test(t) || REQUEST_LOCAL.test(t) || VEHICLE_HINT.test(t);
}

const ACK_WORDS = new Set(('ok okay okey k kk oky okk alright fine good great nice cool sure noted done received got it thanks thank thankyou thx ty tnx ' +
  'appreciated welcome yes yeah yep yup no nope hi hello hey hii helo salam salaam asc assalamu alaikum aleykum alaykum wcs wacalaykum waalaykum ' +
  'mahadsanid mahadsantahay haa hagaag waayahay shukran شكرا تمام اوكي مرحبا السلام عليكم سلام نعم you your u very much so lot bro brother sir dear good morning evening afternoon night day').split(' '));

/** Only thanks / ok / greetings / emojis / punctuation: no reply needed. */
export function isAckOnly(text: string) {
  const t = String(text || '').trim();
  if (!t) return true;
  const stripped = t.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\p{P}\p{S}\s]/gu, '');
  if (!stripped) return true; // emojis / punctuation only
  const words = t.toLowerCase().replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length <= 8 && words.every(w => ACK_WORDS.has(w));
}

/** Words that say "yes, go ahead" to something we just offered. */
export function isAffirmation(text: string) {
  return /^\s*(yes|yeah|yep|yup|sure|ok|okay|please|yes please|go ahead|haa|haa fadlan|نعم)\b[\s.!]*$/i.test(String(text || ''));
}

const PRICE = /(\$|usd|us\$|rmb|cny|¥|aed|ksh|kes|etb|birr|fob|cif|price|qiimo)\s*[:=\-]?\s*\d|\d[\d,.]*\s*(\$|usd|k\b|rmb|cny|万|aed|dollars?)/i;
const MAKE_MODEL = new RegExp(VEHICLE_HINT.source + '|\\b(19[89]\\d|20[0-3]\\d)\\s+[a-z]{3,}', 'i');

/**
 * A group message is a vehicle listing when it has photos (and is not just a question about them),
 * or names a make/model together with a price. Ordinary chat and questions are never listings.
 */
export function looksLikeListing(text: string, photoCount: number) {
  const t = String(text || '').trim();
  const question = isQuestion(t);
  // Photos with a question are a listing only if they also carry make/model and a price (a supplier caption).
  if (photoCount > 0) return !question || (MAKE_MODEL.test(t) && PRICE.test(t));
  if (!t || question || isAckOnly(t)) return false;
  return MAKE_MODEL.test(t) && PRICE.test(t);
}
