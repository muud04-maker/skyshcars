import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';
import { isGroupRecipient } from './intent';

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v26.0'}`;

function cleanToken(v?: string) {
  if (!v) return '';
  // Protect against accidentally pasting `PHONE_NUMBER_ID=...` after the token in Hostinger.
  return String(v).trim().split(/\s+PHONE_NUMBER_ID\s*=|\s+WHATSAPP_PHONE_NUMBER_ID\s*=/i)[0].trim();
}
function tokenCandidates() {
  return [...new Set([cleanToken(process.env.WHATSAPP_ACCESS_TOKEN), cleanToken(process.env.WHATSAPP_TOKEN)].filter(Boolean))];
}
function idCandidates() {
  return [...new Set([process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.PHONE_NUMBER_ID]
    .map(v => String(v || '').trim().replace(/\D/g, ''))
    .filter(Boolean))];
}
function verifyToken() {
  return String(process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || '').trim();
}

/*
  Webhook signature (X-Hub-Signature-256) policy:
   - No WHATSAPP_APP_SECRET            → 'compatibility': accepted (REQUIRE_WHATSAPP_SIGNATURE is ignored, so a missing
                                         secret can never switch WhatsApp off). The route also checks the payload type.
   - Secret set, REQUIRE not 'true'    → 'monitor': signature is checked; mismatches are logged but still accepted.
   - Secret set, REQUIRE = 'true'      → 'secure': requests with a bad or missing signature are rejected.
  REQUIRE_WHATSAPP_SIGNATURE is off by default.
*/
function signatureSecrets() {
  return [process.env.WHATSAPP_APP_SECRET, process.env.META_APP_SECRET].map(x => String(x || '').trim()).filter(Boolean);
}
export type SignatureMode = 'compatibility' | 'monitor' | 'secure';
export function whatsappSignatureMode(): SignatureMode {
  if (!String(process.env.WHATSAPP_APP_SECRET || '').trim()) return 'compatibility';
  return process.env.REQUIRE_WHATSAPP_SIGNATURE === 'true' ? 'secure' : 'monitor';
}

/** valid: true/false when a secret is available to check against, null when there is nothing to check with. */
export function checkSignature(raw: string, header: string | null): { accept: boolean; valid: boolean | null; mode: SignatureMode } {
  const mode = whatsappSignatureMode();
  const secrets = signatureSecrets();
  let valid: boolean | null = null;
  if (secrets.length) {
    valid = false;
    if (header) for (const secret of secrets) {
      const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
      try { if (header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))) { valid = true; break; } } catch { /* try next */ }
    }
  }
  return { accept: mode === 'secure' ? valid === true : true, valid, mode };
}

export function signatureOk(raw: string, header: string | null) { return checkSignature(raw, header).accept; }

export function whatsappVerifyToken() { return verifyToken(); }
export function whatsappConfigured() { return tokenCandidates().length > 0 && idCandidates().length > 0; }
export function whatsappConfigSummary() {
  return {
    configured: whatsappConfigured(),
    accessTokenNamesPresent: {
      WHATSAPP_ACCESS_TOKEN: !!cleanToken(process.env.WHATSAPP_ACCESS_TOKEN),
      WHATSAPP_TOKEN: !!cleanToken(process.env.WHATSAPP_TOKEN),
    },
    phoneNumberIdNamesPresent: {
      WHATSAPP_PHONE_NUMBER_ID: !!String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
      PHONE_NUMBER_ID: !!String(process.env.PHONE_NUMBER_ID || '').trim(),
    },
    verifyTokenPresent: !!verifyToken(),
    appSecretPresent: !!String(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '').trim(),
    signatureMode: whatsappSignatureMode(),
  };
}

async function withMetaCredentials<T>(fn: (token: string, phoneId: string) => Promise<T>): Promise<T> {
  const tokens = tokenCandidates();
  const ids = idCandidates();
  if (!tokens.length) throw new Error('WhatsApp sending needs setup (see Readiness)');
  if (!ids.length) throw new Error('WhatsApp sending needs setup (see Readiness)');
  const errors: string[] = [];
  for (const phoneId of ids) {
    for (const token of tokens) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { return await fn(token, phoneId); }
        catch (e: any) {
          const status = Number(e?.response?.status || 0);
          const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
          errors.push(`phone=${phoneId.slice(-6)} attempt=${attempt} status=${status || 'network'} ${msg}`);
          // 401/403 means this token/ID combination is invalid; try another configured alias immediately.
          if (status === 401 || status === 403 || status === 400) break;
          // Retry transient network / rate-limit / server failures once.
          if (!(status === 429 || status >= 500 || status === 0) || attempt === 2) break;
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }
  }
  throw new Error('WhatsApp send failed with all configured credentials: ' + errors.slice(-6).join(' | '));
}

export async function downloadWhatsAppMedia(mediaId: string) {
  const tokens = tokenCandidates();
  if (!tokens.length) throw new Error('WhatsApp media download needs setup (see Readiness)');
  let last: any = null;
  for (const token of tokens) {
    const auth = { Authorization: `Bearer ${token}` };
    try {
      const meta = await axios.get(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: auth, timeout: 20000 });
      const url = meta.data?.url;
      if (!url) throw new Error('Meta media URL missing');
      const media = await axios.get(url, { headers: auth, responseType: 'arraybuffer', timeout: 30000, maxContentLength: 25 * 1024 * 1024 });
      return {
        data: Buffer.from(media.data),
        mimeType: String(meta.data?.mime_type || media.headers?.['content-type'] || 'application/octet-stream').split(';')[0],
        sha256: meta.data?.sha256 || null,
        fileSize: Number(meta.data?.file_size || 0) || null,
      };
    } catch (e) { last = e; }
  }
  throw last || new Error('WhatsApp media download failed');
}

/** The assistant only ever writes to one person's phone number, never to a WhatsApp group. */
function assertIndividual(to: string) {
  if (isGroupRecipient(to)) throw new Error('Refusing to send: recipient is not an individual phone number (groups are never messaged)');
}

export async function sendWhatsApp(to: string, body: string) {
  assertIndividual(to);
  return withMetaCredentials(async (token, phoneId) => {
    const r = await axios.post(`${GRAPH}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: body.slice(0, 4000) } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data?.messages?.[0]?.id || null;
  });
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string) {
  assertIndividual(to);
  return withMetaCredentials(async (token, phoneId) => {
    const r = await axios.post(`${GRAPH}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image', image: { link: imageUrl, ...(caption ? { caption: caption.slice(0, 1000) } : {}) } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data?.messages?.[0]?.id || null;
  });
}

/** Live read-only check of the WhatsApp Cloud API number (sends nothing). */
export async function checkWhatsAppNumber() {
  if (!whatsappConfigured()) return { ok: false, error: 'WhatsApp Cloud API is not configured.' };
  try {
    const d = await withMetaCredentials(async (token, phoneId) => {
      const r = await axios.get(`${GRAPH}/${phoneId}`, { params: { fields: 'display_phone_number,verified_name,quality_rating' }, headers: { Authorization: `Bearer ${token}` }, timeout: 12000 });
      return r.data || {};
    });
    return { ok: true, number: d.display_phone_number || null, name: d.verified_name || null, quality: d.quality_rating || null };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}
