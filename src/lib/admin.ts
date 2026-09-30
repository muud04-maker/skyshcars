import {cookies} from 'next/headers';import {createHash,timingSafeEqual} from 'crypto';
export function token(){return createHash('sha256').update('sky-admin:'+String(process.env.ADMIN_PASSWORD||'')).digest('hex')}
export async function isAdmin(){const c=await cookies();const a=c.get('sky_admin')?.value||'',b=token();try{return !!process.env.ADMIN_PASSWORD&&timingSafeEqual(Buffer.from(a),Buffer.from(b))}catch{return false}}
