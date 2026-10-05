/*
  Staff / AI cooperation helpers (Part 6, pure + testable).

  When staff reply from the WhatsApp phone/desktop app, Meta can deliver the message back to us
  (message_echoes / smb_message_echoes). We store it as a [STAFF] message and pause the AI so it
  never talks over a human. After the pause expires the AI may return if the customer is waiting.
*/

export type EchoMsg = { from?: any; to?: any };

const digits = (v: any) => String(v == null ? '' : v).replace(/\D/g, '');

/** True when the webhook message is our own outgoing message (a staff echo), not a customer message. */
export function isStaffEcho(msg: EchoMsg, ownNumbers: (string | number)[] = []) {
  const from = digits(msg?.from);
  if (!from) return false;
  return ownNumbers.map(digits).filter(Boolean).includes(from);
}

/** Has the staff pause expired (or was there never one)? */
export function pauseExpired(until: number | null | undefined, now: number) {
  if (!until) return true;
  return Number(until) <= Number(now);
}

/** Default staff pause in minutes (the Admin setting is validated to 1..1440). */
export const DEFAULT_STAFF_PAUSE_MINUTES = 15;
