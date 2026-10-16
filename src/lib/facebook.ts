/*
  Facebook Page token handling and live status.
  Token sources, in order:
   1. META_PAGE_ACCESS_TOKEN — a Page token. A Page token generated from a long-lived user token never expires (recommended).
   2. META_USER_ACCESS_TOKEN (+ META_APP_ID + META_APP_SECRET) — a user token; it is exchanged for a long-lived
      user token and the Page token is derived from it at runtime (kept in memory only, never stored or shown).
*/
import axios from 'axios';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || process.env.WHATSAPP_GRAPH_VERSION || 'v26.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUIRED_SCOPES = ['pages_manage_posts', 'pages_read_engagement'];

export const fbPageId = () => String(process.env.META_PAGE_ID || '').trim();
const appId = () => String(process.env.META_APP_ID || '').trim();
const appSecret = () => String(process.env.META_APP_SECRET || '').trim();

let derived: { token: string; at: number } | null = null;
const DERIVED_TTL_MS = 60 * 60 * 1000;

export type TokenSource = 'page_token' | 'user_token' | 'none';
export function fbTokenSource(): TokenSource {
  if (String(process.env.META_PAGE_ACCESS_TOKEN || '').trim()) return 'page_token';
  if (String(process.env.META_USER_ACCESS_TOKEN || '').trim()) return 'user_token';
  return 'none';
}
export function facebookConfigured() { return !!fbPageId() && fbTokenSource() !== 'none'; }

/** Returns a Page access token or throws an Error with a plain-English reason. */
export async function resolvePageToken(): Promise<string> {
  const pageToken = String(process.env.META_PAGE_ACCESS_TOKEN || '').trim();
  if (pageToken) return pageToken;
  const userToken = String(process.env.META_USER_ACCESS_TOKEN || '').trim();
  if (!userToken || !fbPageId()) throw new Error('Facebook Page is not connected yet.');
  if (derived && Date.now() - derived.at < DERIVED_TTL_MS) return derived.token;
  let longUser = userToken;
  if (appId() && appSecret()) {
    try {
      const x = await axios.get(`${GRAPH}/oauth/access_token`, { params: { grant_type: 'fb_exchange_token', client_id: appId(), client_secret: appSecret(), fb_exchange_token: userToken }, timeout: 15000 });
      if (x.data?.access_token) longUser = x.data.access_token;
    } catch (e: any) { console.error('FB_TOKEN_EXCHANGE', e?.response?.data || e?.message); }
  }
  const r = await axios.get(`${GRAPH}/${encodeURIComponent(fbPageId())}`, { params: { fields: 'access_token', access_token: longUser }, timeout: 15000 });
  const token = r.data?.access_token;
  if (!token) throw new Error('Could not get a Page token from the user token. The user must be an admin of the Page.');
  derived = { token, at: Date.now() };
  return token;
}

export function graphError(e: any) {
  const d = e?.response?.data?.error;
  return d ? `${d.message || 'Graph API error'}${d.code ? ` (code ${d.code}${d.error_subcode ? '/' + d.error_subcode : ''})` : ''}` : (e?.message || String(e));
}

/**
 * Send ONE text message to a Messenger user through the Page.
 * Used by both the AI reply engine and the admin inbox, so staff can answer Facebook customers
 * exactly like WhatsApp ones. Returns the Meta message id.
 */
export async function sendMessenger(externalUserId: string, text: string): Promise<string | null> {
  const to = String(externalUserId || '').trim();
  const body = String(text || '').trim();
  if (!to) throw new Error('This conversation has no Messenger recipient id.');
  if (!body) throw new Error('Message is empty.');
  if (!facebookConfigured()) throw new Error('Messenger sending needs setup (see Readiness). Add META_PAGE_ID and META_PAGE_ACCESS_TOKEN.');
  const token = await resolvePageToken();
  const r = await axios.post(`${GRAPH}/me/messages`,
    { recipient: { id: to }, messaging_type: 'RESPONSE', message: { text: body.slice(0, 2000) } },
    { params: { access_token: token }, timeout: 20000 });
  return r.data?.message_id || null;
}

export type FacebookStatus = {
  configured: boolean; connected: boolean; tokenSource: TokenSource;
  id?: string; name?: string; category?: string; link?: string;
  tokenType?: string | null; expiresAt?: string | null; neverExpires?: boolean | null; daysLeft?: number | null;
  scopes?: string[] | null; missingScopes?: string[] | null; debugAvailable: boolean;
  error?: string; warnings: string[];
};

/** Live check: reads the Page with the token and, when META_APP_ID is set, inspects expiry and permissions. */
export async function facebookStatus(): Promise<FacebookStatus> {
  const s: FacebookStatus = { configured: facebookConfigured(), connected: false, tokenSource: fbTokenSource(), debugAvailable: !!(appId() && appSecret()), warnings: [] };
  if (!s.configured) { s.error = 'Facebook Page is not connected yet.'; return s; }
  let token = '';
  try { token = await resolvePageToken(); } catch (e: any) { s.error = graphError(e); return s; }
  try {
    const r = await axios.get(`${GRAPH}/${encodeURIComponent(fbPageId())}`, { params: { fields: 'id,name,category,link', access_token: token }, timeout: 15000 });
    const d = r.data || {};
    s.connected = String(d.id) === fbPageId(); s.id = d.id; s.name = d.name || ''; s.category = d.category || ''; s.link = d.link || '';
    if (!s.connected) s.error = 'The token works but belongs to a different Facebook Page than the one set up.';
  } catch (e: any) { s.error = graphError(e); return s; }
  if (s.debugAvailable) {
    try {
      const r = await axios.get(`${GRAPH}/debug_token`, { params: { input_token: token, access_token: `${appId()}|${appSecret()}` }, timeout: 15000 });
      const d = r.data?.data || {};
      s.tokenType = d.type || null;
      const exp = Number(d.expires_at || 0);
      s.neverExpires = exp === 0;
      s.expiresAt = exp ? new Date(exp * 1000).toISOString() : null;
      s.daysLeft = exp ? Math.floor((exp * 1000 - Date.now()) / 86400000) : null;
      s.scopes = Array.isArray(d.scopes) ? d.scopes : null;
      s.missingScopes = s.scopes ? REQUIRED_SCOPES.filter(x => !s.scopes!.includes(x)) : null;
      if (d.is_valid === false) { s.connected = false; s.error = 'Facebook says this token is no longer valid.'; }
      if (s.daysLeft !== null && s.daysLeft !== undefined && s.daysLeft < 14) s.warnings.push(`Token expires in ${s.daysLeft} day(s). Replace it with a long-lived Page token.`);
      if (s.missingScopes?.length) s.warnings.push(`Token is missing permission(s): ${s.missingScopes.join(', ')}. Posting will fail.`);
    } catch (e: any) { s.warnings.push('Could not read token details: ' + graphError(e)); }
  } else {
    s.warnings.push('Token expiry and permissions are not checked yet — see Readiness.');
  }
  return s;
}
