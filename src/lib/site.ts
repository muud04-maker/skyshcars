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

/** Full canonical public URL for a vehicle (absolute HTTPS, no user-supplied redirect). */
export function canonicalVehicleUrl(id: string | number) {
  return `${SITE_URL}/vehicles/${encodeURIComponent(String(id))}`;
}

/** Vehicle title used in messages/metadata, de-duplicated ("2016 GAC Trumpchi GS4"). */
export function vehicleTitle(v: any) {
  const raw = [v?.model_year, v?.brand, v?.model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return raw || String(v?.stock_no || 'Vehicle');
}

/**
 * The pre-filled customer message for the "Send This Vehicle to WhatsApp" button (brief section 2/3).
 * Different wording for Available and Sold; only real fields; the last listed price is labelled as such
 * for a sold unit and is never presented as a current offer. The customer still has to tap Send in
 * WhatsApp - nothing here claims a message was delivered.
 */
export function vehicleWhatsAppMessage(v: any, url?: string | null) {
  const title = vehicleTitle(v);
  const stock = String(v?.stock_no || '').trim();
  const price = Number(v?.price_usd) > 0 ? '$' + Number(v.price_usd).toLocaleString('en-US') : '';
  const link = String(url || '').trim() || (v?.id ? canonicalVehicleUrl(v.id) : '');
  const sold = String(v?.status || '').toLowerCase() === 'sold';
  const lines: string[] = [];
  if (sold) {
    lines.push('Hello Sky Cars, I saw this vehicle on your website.');
    lines.push('');
    lines.push(`Vehicle: ${title}`);
    if (stock) lines.push(`Stock number: ${stock}`);
    lines.push('Status: SOLD');
    if (price) lines.push(`Last listed price: ${price}`);
    if (link) lines.push(`Vehicle link: ${link}`);
    lines.push('');
    lines.push('We are interested in finding a similar vehicle. Can you help?');
  } else {
    lines.push("Hello Sky Cars, I'm interested in this vehicle.");
    lines.push('');
    lines.push(`Vehicle: ${title}`);
    if (stock) lines.push(`Stock number: ${stock}`);
    if (price) lines.push(`Listed price: ${price}`);
    lines.push('Status: Available');
    if (link) lines.push('');
    if (link) lines.push(`Vehicle link: ${link}`);
    lines.push('');
    lines.push('Please send us more information about this exact vehicle.');
  }
  return lines.join('\n');
}

/** Ready-to-open click-to-chat link for one vehicle (encodeURIComponent inside waLink). */
export function vehicleWhatsAppLink(v: any, url?: string | null) {
  return waLink(vehicleWhatsAppMessage(v, url));
}

/** OG/social description: sold stock is named as sold, never as an offer. */
export function vehicleOgDescription(v: any) {
  const title = vehicleTitle(v);
  const stock = String(v?.stock_no || '').trim();
  const price = Number(v?.price_usd) > 0 ? `$${Number(v.price_usd).toLocaleString('en-US')}` : '';
  const sold = String(v?.status || '').toLowerCase() === 'sold';
  if (sold) return `${title}${stock ? ` (stock ${stock})` : ''} - marked SOLD${price ? `. Last listed price ${price}` : ''}. Ask Sky Cars for a similar available vehicle.`;
  return `${title}${stock ? ` (stock ${stock})` : ''}${price ? ` - ${price}` : ''}. Available from Sky Cars with export support.`;
}

/**
 * SEO/Open Graph metadata for a vehicle page (brief section 4/8). The image is the vehicle's own
 * VERIFIED stock photo (never a representative/model image, never a supplier URL), made absolute over
 * HTTPS. A sold unit is titled and described as sold. Pure + testable.
 */
export function vehicleSeoMetadata(v: any, opts: { exactImage?: string | null } = {}) {
  const title = vehicleTitle(v);
  const stock = String(v?.stock_no || '').trim();
  const sold = String(v?.status || '').toLowerCase() === 'sold';
  const url = v?.id ? canonicalVehicleUrl(v.id) : SITE_URL;
  const raw = String(opts.exactImage || v?.exact_cover_url || '').trim();
  // Only our own absolute host or a site-relative media path is allowed: a supplier URL must never
  // become public metadata (brief section 4).
  const ours = raw && (/^https?:\/\//i.test(raw) ? raw.toLowerCase().startsWith(SITE_URL.toLowerCase() + '/') || raw.toLowerCase() === SITE_URL.toLowerCase() : true);
  const image = ours ? (/^https?:\/\//i.test(raw) ? raw : `${SITE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`) : '';
  const price = Number(v?.price_usd) > 0 ? `$${Number(v.price_usd).toLocaleString('en-US')}` : '';
  const description = sold
    ? `${title}${stock ? ` (stock ${stock})` : ''} - marked SOLD${price ? `. Last listed price ${price}` : ''}. Ask Sky Cars for a similar available vehicle.`
    : `${title}${stock ? ` (stock ${stock})` : ''}${price ? ` - ${price}` : ''}. Available from Sky Cars with export support from China.`;
  return {
    title: `${title}${sold ? ' - SOLD' : ''} | Sky Cars`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title}${sold ? ' - SOLD' : ''} | Sky Cars`,
      description, url, type: 'website' as const,
      images: image ? [{ url: image, alt: title }] : undefined,
    },
  };
}
