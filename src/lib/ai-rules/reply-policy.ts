/*
  Reply rule (pure). Decides whether the AI answers a customer "burst" (messages since our last answer).
  - Never into a group.
  - Always: the customer's first message ever, any ad/post click, any photo/voice note/video/document.
  - A question or a request, or a short answer to a question we asked ("Both", "Ok", a name).
  - Never: pure thanks / ok / emoji / greeting (when it is not the first message and we did not ask).
*/
import { isAckOnly, isAffirmation, isGroupRecipient, needsReply } from '../intent';

export type BurstMsg = { type: string; words: string; referral?: boolean };
export type ReplyDecision = { reply: boolean; reason: string };

export function weAskedQuestion(lastOutbound?: string | null) {
  return /[?؟]\s*[\p{Extended_Pictographic}\s]*$/u.test(String(lastOutbound || '').trim());
}

export function decideReply(input: { burst: BurstMsg[]; firstContact: boolean; lastOutbound?: string | null; recipient?: string }): ReplyDecision {
  if (input.recipient && isGroupRecipient(input.recipient)) return { reply: false, reason: 'group' };
  const burst = input.burst || [];
  if (!burst.length) return { reply: false, reason: 'nothing_new' };
  if (input.firstContact) return { reply: true, reason: 'first_message' };
  if (burst.some(m => m.referral)) return { reply: true, reason: 'ad_click' };
  if (burst.some(m => ['image', 'audio', 'video', 'document'].includes(m.type))) return { reply: true, reason: 'media' };
  const words = burst.map(m => String(m.words || '').trim()).filter(Boolean).join('\n');
  if (!words) return { reply: false, reason: 'empty' };
  const asked = weAskedQuestion(input.lastOutbound);
  // A short answer to our question is an answer, even a single name ("Ogulu") or "Both"/"Ok".
  if (asked && (!isAckOnly(words) || isAffirmation(words))) return { reply: true, reason: 'answer_to_our_question' };
  if (needsReply(words, input.lastOutbound)) return { reply: true, reason: 'question_or_request' };
  return { reply: false, reason: 'ack_only' };
}

/** The customer's own words from a stored message body (captions, transcripts); media placeholders give "". */
export function wordsFromStored(type: string, body: string) {
  const b = String(body || '');
  if (/^PHOTO\n(Image received\.|Visual description:[\s\S]*)$/.test(b)) return '';
  if (/^VOICE NOTE\nTranscription pending\.$/.test(b)) return '';
  if (/^VIDEO\nNo caption supplied/.test(b)) return '';
  if (/^\[Customer sent a document/.test(b) || /^\[Unsupported message/.test(b)) return '';
  return b.replace(/^(PHOTO|VIDEO)\nCaption: /, '').replace(/^VOICE NOTE\nTranscript: /, '').trim();
}
