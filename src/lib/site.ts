export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
export const WA_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '8615778025441').replace(/\D/g, '');
export const waLink = (text?: string) => `https://wa.me/${WA_NUMBER}${text ? '?text=' + encodeURIComponent(text) : ''}`;

/**
 * The pre-filled WhatsApp enquiry for one vehicle. Always contains the stock number AND the
 * vehicle name so the sales team (and the AI) know exactly which car the customer means.
 * Example: "Hello Sky Cars, I am interested in SC00129 - 2014 Chevrolet Trax."
 */
export function vehicleEnquiryMessage(stockNo?: string | null, title?: string | null, url?: string | null) {
  const s = String(stockNo || '').trim();
  const t = String(title || '').trim();
  const base = `Hello Sky Cars, I am interested in ${[s, t].filter(Boolean).join(' \u2014 ')}.`;
  return url ? `${base} ${url}` : base;
}
