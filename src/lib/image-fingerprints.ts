import { createHash } from 'crypto';

export type ImageFingerprint = {
  sha256: string;
  perceptual_hash: string | null;
  width: number | null;
  height: number | null;
};

/**
 * Difference hash (dHash): resize to 9x8 grayscale and record horizontal brightness changes.
 * It tolerates resizing/recompression while exact SHA-256 remains the proof of identical bytes.
 */
export async function fingerprintImage(data: Buffer): Promise<ImageFingerprint> {
  const sha256 = createHash('sha256').update(data).digest('hex');
  try {
    const sharp = (await import('sharp')).default;
    const { data: pixels, info } = await sharp(data, { failOn: 'none' })
      .rotate()
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? '1' : '0';
    }
    const perceptual_hash = BigInt('0b' + bits).toString(16).padStart(16, '0');
    const metadata = await sharp(data, { failOn: 'none' }).metadata();
    return {
      sha256,
      perceptual_hash,
      width: Number(metadata.width || info.width) || null,
      height: Number(metadata.height || info.height) || null,
    };
  } catch {
    return { sha256, perceptual_hash: null, width: null, height: null };
  }
}

export function hashDistance(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || !/^[a-f0-9]{16}$/i.test(a) || !/^[a-f0-9]{16}$/i.test(b)) return 64;
  let value = BigInt('0x' + a) ^ BigInt('0x' + b);
  let distance = 0;
  while (value) {
    distance += Number(value & BigInt(1));
    value >>= BigInt(1);
  }
  return distance;
}
