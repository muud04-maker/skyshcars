import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

function safe(v: string) {
  return String(v || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export async function GET(_: Request, ctx: { params: Promise<{ stock: string; file: string }> }) {
  const { stock, file } = await ctx.params;
  const stockSafe = safe(stock);
  const fileSafe = path.basename(file);
  const full = path.join(process.cwd(), 'tools', 'photo-pack', 'photos', stockSafe, fileSafe);
  if (!fs.existsSync(full)) return new NextResponse('Not found', { status: 404 });
  const ext = path.extname(fileSafe).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const buf = fs.readFileSync(full);
  return new NextResponse(buf, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
