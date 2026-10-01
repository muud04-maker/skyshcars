import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';

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

/** Verifies Meta's X-Hub-Signature-256 header. */
export function whatsappSignatureMode() {
  const secrets = [process.env.WHATSAPP_APP_SECRET, process.env.META_APP_SECRET]
    .map(x => String(x || '').trim()).filter(Boolean);
  if (secrets.length) return 'secure';
  if (process.env.REQUIRE_WHATSAPP_SIGNATURE === 'true') return 'blocked_missing_secret';
  return 'compatibility';
}

export function signatureOk(raw: string, header: string | null) {
  const secrets = [process.env.WHATSAPP_APP_SECRET, process.env.META_APP_SECRET]
    .map(x => String(x || '').trim()).filter(Boolean);
  if (!secrets.length) {
    if (process.env.REQUIRE_WHATSAPP_SIGNATURE === 'true') {
      console.error('Webhook rejected: app secret missing and REQUIRE_WHATSAPP_SIGNATURE=true.');
      return false;
    }
    // Compatibility mode keeps the existing production integration working when the
    // Meta app secret has not yet been added to Hostinger. The webhook route also
    // validates that the payload is a WhatsApp Business Account event. Add
    // WHATSAPP_APP_SECRET as soon as possible to switch automatically to secure mode.
    console.warn('WHATSAPP WEBHOOK COMPATIBILITY MODE: app secret missing; signature verification is not enforced.');
    return true;
  }
  if (!header) return false;
  for (const secret of secrets) {
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    try {
      if (header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return true;
    } catch { /* try next */ }
  }
  return false;
}

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
  if (!tokens.length) throw new Error('WhatsApp access token missing (set WHATSAPP_ACCESS_TOKEN or WHATSAPP_TOKEN)');
  if (!ids.length) throw new Error('WhatsApp phone number ID missing (set WHATSAPP_PHONE_NUMBER_ID or PHONE_NUMBER_ID)');
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
  if (!tokens.length) throw new Error('WhatsApp access token missing');
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

export async function sendWhatsApp(to: string, body: string) {
  return withMetaCredentials(async (token, phoneId) => {
    const r = await axios.post(`${GRAPH}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: body.slice(0, 4000) } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data?.messages?.[0]?.id || null;
  });
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string) {
  return withMetaCredentials(async (token, phoneId) => {
    const r = await axios.post(`${GRAPH}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image', image: { link: imageUrl, ...(caption ? { caption: caption.slice(0, 1000) } : {}) } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data?.messages?.[0]?.id || null;
  });
}
