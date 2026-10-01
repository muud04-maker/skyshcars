export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
export const WA_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '8615778025441').replace(/\D/g, '');
export const waLink = (text?: string) => `https://wa.me/${WA_NUMBER}${text ? '?text=' + encodeURIComponent(text) : ''}`;
