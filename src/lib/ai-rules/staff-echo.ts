/*
  Staff echo parsing (pure + testable).

  When staff reply from the WhatsApp phone/desktop app Meta echoes the message back. The old code
  only looked at m.text.body and otherwise stored the literal "[staff message]" - that is the live
  bug where the real staff text was lost. This parser understands every shape Meta sends and always
  produces a readable body.
*/

export type EchoType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'button' | 'interactive' | 'sticker' | 'location' | 'contacts' | 'reaction' | 'other';
export type ParsedEcho = { type: EchoType; body: string; hasText: boolean; mediaId: string | null };

const clean = (v: any) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function typeOf(m: any): EchoType {
  const declared = clean(m?.type).toLowerCase();
  if (declared) return declared as EchoType;
  for (const t of ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'reaction']) if (m?.[t]) return t as EchoType;
  if (m?.interactive) return 'interactive';
  if (m?.button) return 'button';
  if (m?.text) return 'text';
  return 'other';
}

/** Everything Meta might use for the real text/caption/title of an echo. */
function candidateText(m: any) {
  return clean(m?.text?.body) || clean(m?.body) || clean(m?.message?.text?.body) || clean(m?.caption)
    || clean(m?.button?.text) || clean(m?.button?.payload)
    || clean(m?.interactive?.button_reply?.title) || clean(m?.interactive?.list_reply?.title)
    || clean(m?.reaction?.emoji) || '';
}

export function parseStaffEcho(m: any): ParsedEcho {
  const type = typeOf(m);
  const text = candidateText(m);
  switch (type) {
    case 'text': return { type, body: text || '[Staff sent a message]', hasText: !!text, mediaId: null };
    case 'image': { const c = clean(m?.image?.caption) || text; return { type, body: c || '[Staff sent a photo]', hasText: !!c, mediaId: clean(m?.image?.id) || null }; }
    case 'video': { const c = clean(m?.video?.caption) || text; return { type, body: c || '[Staff sent a video]', hasText: !!c, mediaId: clean(m?.video?.id) || null }; }
    case 'audio': return { type, body: '[Staff sent a voice note]', hasText: false, mediaId: clean(m?.audio?.id) || null };
    case 'document': { const name = clean(m?.document?.filename); return { type, body: name ? `[Staff sent document: ${name}]` : '[Staff sent a document]', hasText: !!name, mediaId: clean(m?.document?.id) || null }; }
    case 'button': return { type, body: text || '[Staff sent a button reply]', hasText: !!text, mediaId: null };
    case 'interactive': return { type, body: text || '[Staff sent an interactive reply]', hasText: !!text, mediaId: null };
    case 'sticker': return { type, body: '[Staff sent a sticker]', hasText: false, mediaId: clean(m?.sticker?.id) || null };
    case 'location': return { type, body: '[Staff shared a location]', hasText: false, mediaId: null };
    case 'contacts': return { type, body: '[Staff shared a contact]', hasText: false, mediaId: null };
    case 'reaction': return { type, body: text ? `[Staff reacted ${text}]` : '[Staff reacted to a message]', hasText: false, mediaId: null };
    default: return { type: 'other', body: `[Staff sent a ${clean(type) || 'message'}]`, hasText: false, mediaId: null };
  }
}

/** True when a stored body is one of our placeholders (so real text can replace it). */
export function isPlaceholderBody(body?: string | null) {
  const t = clean(body).toLowerCase();
  if (!t) return true;
  return t === '[staff message]' || /^\[staff (sent|shared|reacted)/.test(t);
}

/** messages.message_type is an ENUM('text','image','video','audio','document','other'). */
export function mapMessageType(type: EchoType): 'text' | 'image' | 'video' | 'audio' | 'document' | 'other' {
  if (type === 'image' || type === 'video' || type === 'audio' || type === 'document') return type;
  if (type === 'text') return 'text';
  return 'other';
}

/** Waiting = the newest relevant customer message is newer than the newest AI/staff outbound message. */
export function computeWaiting(inboundIds: number[] = [], outboundIds: number[] = []) {
  const inbound = inboundIds.length ? Math.max(...inboundIds.map(Number)) : 0;
  const outbound = outboundIds.length ? Math.max(...outboundIds.map(Number)) : 0;
  return inbound > outbound;
}
