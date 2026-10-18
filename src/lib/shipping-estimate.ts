/*
  Shipping display precedence, kept pure so the website and tests agree:
    1. A valid destination-specific quotation (not yet stored in this repository).
    2. An approved, clearly-labelled route reference from the owner's guide.
    3. The general business-policy range.
  The guide in data/shipping_reference.json is car freight. It must never be presented as a
  motorcycle rate. Route references above the general car guidance are retained but flagged.
*/

export type ShippingRate = {
  country: string;
  gateway: string;
  city: string;
  min_usd: number;
  max_usd: number;
  note?: string;
};

export type ShippingRanges = {
  car_min: number;
  car_max: number;
  motorcycle_min: number;
  motorcycle_max: number;
};

export type ShippingChoice = {
  kind: 'route' | 'policy';
  category: 'car' | 'motorcycle';
  label: string;
  min: number;
  max: number;
  rangeText: string;
  note: string;
  aboveGeneralGuidance: boolean;
  generalGuidance: string;
};

export const DEFAULT_SHIPPING_RANGES: ShippingRanges = {
  car_min: 1200,
  car_max: 2000,
  motorcycle_min: 300,
  motorcycle_max: 500,
};

export const usd = (value: number) => '$' + Number(value).toLocaleString('en-US');
export const shippingRangeText = (min: number, max: number) => `${usd(min)}\u2013${usd(max)}`;
export const generalShippingGuidance = (ranges: ShippingRanges = DEFAULT_SHIPPING_RANGES) =>
  `Cars ${shippingRangeText(ranges.car_min, ranges.car_max)}; motorcycles ${shippingRangeText(ranges.motorcycle_min, ranges.motorcycle_max)}.`;

export function shippingChoice(opts: {
  category?: string | null;
  route?: ShippingRate | null;
  ranges?: ShippingRanges;
} = {}): ShippingChoice {
  const category = String(opts.category || '').toLowerCase() === 'motorcycle' ? 'motorcycle' : 'car';
  const ranges = opts.ranges || DEFAULT_SHIPPING_RANGES;
  const generalGuidance = generalShippingGuidance(ranges);

  if (category === 'motorcycle') {
    return {
      kind: 'policy',
      category,
      label: 'General motorcycle guidance',
      min: ranges.motorcycle_min,
      max: ranges.motorcycle_max,
      rangeText: shippingRangeText(ranges.motorcycle_min, ranges.motorcycle_max),
      note: 'Motorcycle freight is quoted per unit. The car route references in this guide do not apply.',
      aboveGeneralGuidance: false,
      generalGuidance,
    };
  }

  if (opts.route) {
    const min = Number(opts.route.min_usd);
    const max = Number(opts.route.max_usd);
    const above = min > ranges.car_max;
    return {
      kind: 'route',
      category,
      label: 'Owner-supplied car route reference',
      min,
      max,
      rangeText: shippingRangeText(min, max),
      note: opts.route.note?.trim()
        ? opts.route.note.trim()
        : `Reference for ${opts.route.gateway} \u2192 ${opts.route.city}. Final freight depends on the exact vehicle, sailing and destination charges.`,
      aboveGeneralGuidance: above,
      generalGuidance,
    };
  }

  return {
    kind: 'policy',
    category,
    label: 'General car guidance',
    min: ranges.car_min,
    max: ranges.car_max,
    rangeText: shippingRangeText(ranges.car_min, ranges.car_max),
    note: 'General guidance only. A destination-specific route reference or confirmed quotation takes precedence.',
    aboveGeneralGuidance: false,
    generalGuidance,
  };
}
