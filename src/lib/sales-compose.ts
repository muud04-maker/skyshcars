/*
  Builds the reply text for a customer burst (no sending). Used by the sales engine and the admin
  "Test the AI" box. Parts 3-5 extend this: referral, strict matching, context, slots.
*/
import { salesReply, AI_MODEL, allowedVehicleNames } from './ai';
import { planPhotos } from './whatsapp-photos';
import { aiCarById, loadAiCars } from './ai-catalog';
import { alternativeLines, alternatives, carTitle, clarifyVehicle, vehicleDetails, vehicleIntent } from './ai-rules/vehicle-answer';
import { detectLanguage } from './ai-rules/welcome';
import { shouldHold } from './ai-rules/hold';
import { isQuestion, isRequest } from './intent';
import { history } from './conversations';
import { getState, saveSlots } from './conversation-state';
import { isHardcodedLang, languageName, type LangCode } from './ai-rules/language';
import { detectCustomerLanguage, saveDetectedLanguage } from './language-detect';
import { filterInventory, inventoryAnswer, inventoryIntent } from './ai-rules/inventory-intent';
import { buyingSignal, needsHumanNow, signalNextStep, signalStaffReason } from './ai-rules/buying-signal';
import { flagForStaff } from './conversation-state';
import { createTask } from './staff-tasks';
import { DEFAULT_POLICY, getBusinessPolicy, policyNote } from './business-policy';

/** Recent customer wording (for language inheritance when the latest message is short/ambiguous). */
async function recentCustomerText(conversationId?: number) {
  if (!conversationId) return '';
  try {
    const past = await history(conversationId, 12);
    return past.filter((m: any) => String(m.sender) === 'customer').slice(-5).map((m: any) => String(m.body || '')).join(' ');
  } catch { return ''; }
}

/** Explicit admin-set preferred language (authoritative when the latest message is ambiguous). */
async function preferredLanguageOf(conversationId?: number) {
  if (!conversationId) return null;
  try {
    const { one } = await import('./db');
    const r = await one<any>('SELECT c.preferred_language FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id WHERE co.id=? LIMIT 1', [conversationId]);
    return r?.preferred_language || null;
  } catch { return null; }
}

/**
 * Brief items 50/78: stocks this customer already declined. Stored as an admin-set customer fact
 * (customer-scoped, never global) and used to filter alternatives so a rejected option never comes back.
 */
async function rejectedStocksFor(conversationId?: number): Promise<string[]> {
  if (!conversationId) return [];
  try {
    const { one } = await import('./db');
    const r = await one<any>(`SELECT f.fact_value FROM customer_facts f
      JOIN conversations c ON c.customer_id=f.customer_id
      WHERE c.id=? AND f.fact_key='rejected_vehicles' AND f.active=1 LIMIT 1`, [conversationId]);
    return String(r?.fact_value || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  } catch { return []; }
}
import type { ComposeIn, ComposeOut } from './ai-rules/engine-core';

export function welcomeNote(i: { welcomeDue: boolean }) {
  return i.welcomeDue
    ? 'The system automatically adds our website and WhatsApp group invitation after your answer. Do NOT include any website or group link yourself.'
    : 'The welcome (website + WhatsApp group invitation) was already sent to this customer earlier. Do NOT send our website or group link again unless the customer explicitly asks for it.';
}

const money = (n: any) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? '$' + v.toLocaleString('en-US') : ''; };

/** Part 3: what the AI knows and must say when the customer tapped a Facebook ad/post. */
export function referralNote(i: ComposeIn) {
  if (!i.referral) return '';
  const v: any = i.referralVehicle;
  if (!v) return ' The customer arrived by tapping a Facebook ad/post, but that exact post could not be matched to our stock. Say so honestly in one short line, then ask which vehicle they are looking for. Never invent what the post said.';
  const title = [v.model_year, v.brand, v.model, v.trim_name].filter(Boolean).join(' ') || `stock ${v.stock_no || ''}`;
  const status = String(v.status || '').toLowerCase();
  // The exact unit is known but is not for sale right now (sold / reserved / hidden).
  if (i.referralAiEnabled === false && status && status !== 'available') {
    return ` The customer tapped the Facebook post for ${title}${v.stock_no ? ` (our stock ${v.stock_no})` : ''}, but that car is NOT available for sale right now. Say briefly that it is not available right now, do NOT quote a price and do NOT offer photos of it, then offer one or two alternatives we can sell.`;
  }
  /*
    The exact unit is available but not enabled for AI quoting. Use only the fields we really have
    (name / year / stock) and say the team will confirm the price and photos - never invent them.
  */
  if (i.referralAiEnabled === false) {
    return ` The customer tapped our Facebook post for exactly this unit: ${title}${v.stock_no ? `, stock ${v.stock_no}` : ''}. It is available. Use ONLY its name, year and stock number from the data - do NOT state or invent a price, mileage, engine or transmission, and do NOT promise photos. Say briefly that our team will confirm the current price and real photos for them, then offer the next step. Do NOT ask which vehicle they mean.`;
  }
  const bits = [money(v.price_usd) && `price ${money(v.price_usd)}`, v.transmission, v.fuel_type, v.steering,
    v.mileage_km ? `${Number(v.mileage_km).toLocaleString('en-US')} km` : null].filter(Boolean).join(', ');
  return ` The customer tapped our Facebook post for exactly this car: ${title}${v.stock_no ? `, stock ${v.stock_no}` : ''}${bits ? ` (${bits})` : ''}, ${Number(v.exact_photo_count || 0)} exact photo(s) on file. Answer with its name, year, price and the key specs above, then ask ONLY for the destination. Do NOT ask which vehicle they mean.`;
}

export async function composeReply(i: ComposeIn & { dryRun?: boolean }): Promise<ComposeOut> {
  const hasMedia = (i.burst || []).some(b => ['image', 'audio', 'video', 'document'].includes(String(b.message_type)));
  const text = i.words || 'The customer sent a photo/voice note/document without words. Reply briefly and ask what they are looking for.';
  /*
    Sky Cars business policy (brief sections 2-4): team voice, short replies, answer-first, the official
    shipping ranges and the third-party payment procedure. Loaded per reply from admin settings so staff
    can change it without a code change - never hardcoded in the prompt.
  */
  const policy = await getBusinessPolicy().catch(() => DEFAULT_POLICY);
  const policyText = policyNote(policy);
  /*
    Brief item 6: detect buying signals and hand the moment to a human with ONE relevant next step.
    This only uses existing, verified stores (a staff flag + an event) - it never creates an order,
    a payment record or a fake "reserved" claim, and it never invents terms.
  */
  const signal = buyingSignal(i.words);
  const signalNote = signal ? signalNextStep(signal) : '';
  if (signal && i.conversationId) {
    if (needsHumanNow(signal)) {
      await flagForStaff(Number(i.conversationId), signalStaffReason(signal)).catch(() => {});
    }
    /*
      Brief items 57/58/96-98/104-105: turn real requests into a queued task a human can finish and
      mark done. Deduplicated per chat (one open request per type), never created for a greeting.
    */
    try {
      const cid = Number(i.conversationId);
      if (signal === 'ready_to_buy' || signal === 'payment') {
        await createTask({ type: 'serious_buyer', conversationId: cid, priority: 1, reason: signalStaffReason(signal) });
      } else if (signal === 'shipping' && /\b(to|in)\s+[A-Za-z]/.test(String(i.words || ''))) {
        await createTask({ type: 'freight', conversationId: cid, priority: 3, reason: 'customer asked for shipping to a destination - confirm the freight rate' });
      }
    } catch { /* tasks must never break a reply */ }
  }
  // Customer language: latest message -> explicit admin preference -> recent conversation -> English.
  const recent = await recentCustomerText(i.conversationId);
  const preferred = await preferredLanguageOf(i.conversationId);
  const lang: LangCode = await detectCustomerLanguage({ conversationId: i.conversationId, latest: i.words, recent, preferred });
  // Remember the detected language additively (no schema change) so the inbox can show it.
  if (i.conversationId && !preferred) await saveDetectedLanguage(i.conversationId, lang);
  const photoPlan = i.dryRun ? null : await planPhotos(text, i.conversationId).catch(() => null);
  // Part 4: media we cannot read never causes silence - ask a short, honest clarification.
  const mediaNote = (!i.words && hasMedia) ? await mediaClarificationNote() : '';
  let vehicleFactNote = '';
  // Vehicle context (referral -> current car -> matched record). "more info on this" / "price?" must
  // be answered from the real record - never with a hold. Alternatives are real AI-catalog rows only.
  if (i.words && !photoPlan) {
    try {
      const vIntent = vehicleIntent(i.words);
      if (vIntent && vIntent !== 'photos' && vIntent !== 'shipping') {
        const st: any = await getState(i.conversationId).catch(() => null);
        const currentId = Number(st?.current_vehicle_id || 0);
        const cats: any[] = await loadAiCars(300).catch(() => []);
        const knownBrands = [...new Set(cats.map((c: any) => String(c.brand || '')).filter(Boolean))];
        const named = inventoryIntent(i.words, knownBrands);
        const current: any = i.referralVehicle || (currentId ? await aiCarById(currentId).catch(() => null) : null);
        const namesAnother = !!(named?.brand && current && String(current.brand || '').toLowerCase() !== String(named.brand).toLowerCase());
        if (current && !namesAnother) {
          const alts = alternatives(cats, current, { limit: 3, excludeStocks: await rejectedStocksFor(i.conversationId) });
          const lines = vIntent === 'alternatives'
            ? (alternativeLines(alts, lang) || vehicleDetails(current, lang, { maxLines: 4 }))
            : `${vehicleDetails(current, lang, { maxLines: vIntent === 'price' ? 4 : 9 })}${alts.length ? `\n\n${alternativeLines(alts, lang)}` : ''}`;
          const allowed = [carTitle(current), ...alts.map((c: any) => carTitle(c))];
          if (isHardcodedLang(lang)) {
            return { text: lines, lang, model: AI_MODEL, vehicleId: Number(current.id) || null, photoPlan, allowedNames: allowed, needsStaff: null };
          }
          // Other languages: hand the model exactly these facts (it must not invent or translate identifiers).
          vehicleFactNote = ` The customer asked about the vehicle this conversation is about. Use ONLY these real fields (skip blanks, never invent): ${vehicleDetails(current, 'en', { maxLines: 9 }).split('\n').slice(1).join(' | ')}${alts.length ? `. Real alternatives: ${alts.map((c: any) => `${carTitle(c)}${Number(c.price_usd) > 0 ? ` $${Number(c.price_usd).toLocaleString()}` : ''}`).join('; ')}` : ''}. Answer in ${languageName(lang)} in a short sales style and offer the next step.`;
        } else if (!current) {
          // Nothing to resolve from: ONE concise clarification, not a vague hold.
          if (isHardcodedLang(lang)) return { text: clarifyVehicle(lang), lang, model: AI_MODEL, vehicleId: null, photoPlan, allowedNames: [], needsStaff: null };
          vehicleFactNote = ` The customer asked about a vehicle but we cannot tell which one. Ask ONE short question in ${languageName(lang)}: name the model or send the stock number.`;
        }
      }
    } catch { /* fall through to the normal path */ }
  }
  // Inventory questions ("Do you have cars?", "Gaari ma haysa?", "Any Toyota?", "SUV?", "cars under
  // $7000") are answered from the AI Catalog - never with the hold line. The count and the cars come
  // from the catalog rows, so nothing can be invented.
  if (i.words && !photoPlan) {
    try {
      const cars: any[] = await loadAiCars(300);
      const inv = inventoryIntent(i.words, [...new Set(cars.map((c: any) => String(c.brand || '')).filter(Boolean))]);
      if (inv) {
        const matched = filterInventory(cars as any, inv);
        /*
          Brief items 58/73: a named brand/model we do not stock is a SOURCING request, not an
          availability answer. Queue it once per chat so a human can source it and mark it done.
        */
        if (!matched.length && inv.kind === 'brand' && inv.brand) {
          await createTask({ type: 'sourcing', conversationId: Number(i.conversationId) || null, priority: 4, reason: `customer asked for ${inv.brand} - not in the current AI catalogue` }).catch(() => {});
        }
        const names = (matched.length ? matched : cars).slice(0, 8).map((v: any) => [v.model_year, v.brand, v.model].filter(Boolean).join(' '));
        if (isHardcodedLang(lang)) {
          const ans = inventoryAnswer(inv, matched, lang, { totalAi: cars.length });
          return { text: ans.text, lang, model: AI_MODEL, vehicleId: null, photoPlan, allowedNames: names, needsStaff: ans.needsStaff ? 'No AI inventory enabled' : null };
        }
        // Any other language: let the model phrase the SAME facts in the customer's language.
        const show = (matched.length ? matched : cars).slice(0, 3).map((v: any) => `${[v.model_year, v.brand, v.model].filter(Boolean).join(' ')}${v.price_usd ? ` - $${Number(v.price_usd).toLocaleString()}` : ''}`);
        const factNote = ` The customer asked about our inventory. Use ONLY these facts: ${matched.length || cars.length} vehicles match, ${cars.length} vehicles are enabled in total. Options: ${show.join('; ') || 'none'}. Answer in ${languageName(lang)} in 1-2 short sentences and do not invent vehicles, prices or counts.${matched.length ? '' : ' If nothing matches, say so honestly and offer another brand.'}${signalNote ? ` ${signalNote}` : ''} ${policyText}`;
        const phrased = await salesReply(text, i.conversationId, photoPlan, { note: welcomeNote(i) + referralNote(i) + factNote + ` Reply in ${languageName(lang)}.` });
        return { text: String(phrased || ''), lang, model: AI_MODEL, vehicleId: null, photoPlan, allowedNames: names, needsStaff: (!cars.length) ? 'No AI inventory enabled' : null };
      }
    } catch { /* any lookup problem falls through to the normal (or hold) path */ }
  }
  const reply = await salesReply(text, i.conversationId, photoPlan, { note: welcomeNote(i) + referralNote(i) + mediaNote + vehicleFactNote + (signalNote ? ` ${signalNote}` : '') + ` ${policyText}` + ` Reply in ${languageName(lang)}. Always answer in the customer's own language (the language of their latest message); for a very short "ok"/"yes"/emoji message keep the language already used in this conversation. Never translate stock numbers, prices or URLs.` });
  // Part 9: the cars this reply is allowed to remember (used by the invented-history guard).
  const allowedNames = await allowedVehicleNames(text, i.conversationId, i.referralVehicle ? [i.referralVehicle] : []).catch(() => []);
  // No verified answer for a real question/request: hold, flag for the owner, and wait instead of guessing.
  const wantsAnswer = !!i.words && (isQuestion(i.words) || isRequest(i.words));
  const needsStaff = shouldHold({ grounded: allowedNames.length > 0, question: isQuestion(i.words || ''), request: isRequest(i.words || '') }) && wantsAnswer
    ? 'No verified answer in the database for this request - confirm before replying'
    : null;
  return { text: String(reply || ''), lang, model: AI_MODEL, vehicleId: photoPlan?.vehicleId || null, photoPlan, allowedNames, needsStaff };
}

/** Part 4: the customer sent a photo/voice note/document we cannot see or hear ourselves. */
async function mediaClarificationNote() {
  try {
    const cars = (await loadAiCars(6)).slice(0, 6).map(v => [v.model_year, v.brand, v.model].filter(Boolean).join(' ')).filter(Boolean);
    return ` The customer sent a photo/voice note/document that you cannot see or hear. Never claim to see it. Reply in one short line, and if it helps ask which of these they mean: ${cars.length ? cars.join(', ') : 'our available cars'}. A colleague will also take a look.`;
  } catch {
    return ' The customer sent a photo/voice note/document that you cannot see or hear. Never claim to see it. Reply in one short line, ask a brief clarifying question, and say a colleague will also take a look.';
  }
}
