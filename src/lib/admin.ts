import {cookies} from 'next/headers';
import {createHash,createHmac,randomBytes,scryptSync,timingSafeEqual} from 'crypto';
import {one} from './db';

type AdminSession={id:number;email:string;role:'owner'|'admin'|'staff';exp:number};

function legacySecretMaterial(){return `sky-admin:${String(process.env.ADMIN_EMAIL||'').trim().toLowerCase()}:${String(process.env.ADMIN_PASSWORD||'')}`}
export function token(){return createHash('sha256').update(legacySecretMaterial()).digest('hex')}
function sessionKey(){return createHash('sha256').update(`sky-session:${process.env.ADMIN_PASSWORD||''}:${process.env.DB_PASSWORD||''}`).digest()}
function sign(value:string){return createHmac('sha256',sessionKey()).update(value).digest('base64url')}
function safeEq(a:string,b:string){try{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}catch{return false}}

export function hashPassword(password:string){
 const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,salt,64).toString('hex');
 return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password:string,stored:string){
 try{const [kind,salt,hash]=String(stored||'').split('$');if(kind!=='scrypt'||!salt||!hash)return false;const actual=scryptSync(password,salt,64).toString('hex');return safeEq(actual,hash)}catch{return false}
}
export function makeAdminSession(admin:{id:number;email:string;role:'owner'|'admin'|'staff'}){
 const payload:AdminSession={...admin,exp:Date.now()+12*60*60*1000};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return `v2.${body}.${sign(body)}`;
}
export function readAdminSessionValue(value:string):AdminSession|null{
 try{if(!value.startsWith('v2.'))return null;const [,body,sig]=value.split('.');if(!body||!sig||!safeEq(sign(body),sig))return null;const p=JSON.parse(Buffer.from(body,'base64url').toString()) as AdminSession;if(!p?.email||!p?.role||!p?.exp||Date.now()>p.exp)return null;return p}catch{return null}
}
export async function getAdminSession():Promise<AdminSession|null>{
 const c=await cookies();const value=c.get('sky_admin')?.value||'';
 const modern=readAdminSessionValue(value);if(modern){
  try{const row=await one<any>('SELECT id,email,role,is_active FROM admins WHERE id=? LIMIT 1',[modern.id]);if(row&&row.is_active&&String(row.email).toLowerCase()===modern.email.toLowerCase())return {...modern,role:row.role}}
  catch{return modern}
 }
 const legacy=token();if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD&&safeEq(value,legacy))return {id:0,email:String(process.env.ADMIN_EMAIL).trim().toLowerCase(),role:'owner',exp:Date.now()+60_000};
 return null;
}
export async function isAdmin(){return !!(await getAdminSession())}
export async function canManageAdmins(){const s=await getAdminSession();return !!s&&(s.role==='owner'||s.role==='admin')}
