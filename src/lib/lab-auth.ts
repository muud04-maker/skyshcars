import {cookies} from 'next/headers';
import {createHash,createHmac,timingSafeEqual} from 'crypto';
type LabSession={email:string;exp:number};
function ownerEmail(){return String(process.env.LAB_OWNER_EMAIL||process.env.ADMIN_EMAIL||'').trim().toLowerCase()}
function ownerPassword(){return String(process.env.LAB_OWNER_PASSWORD||process.env.ADMIN_PASSWORD||'')}
function secret(){return createHash('sha256').update(`sky-lab:${ownerPassword()}:${process.env.DB_PASSWORD||''}`).digest()}
function sign(s:string){return createHmac('sha256',secret()).update(s).digest('base64url')}
function eq(a:string,b:string){try{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}catch{return false}}
export function makeLabSession(email:string){const body=Buffer.from(JSON.stringify({email,exp:Date.now()+12*60*60*1000})).toString('base64url');return `v1.${body}.${sign(body)}`}
export function readLabSessionValue(v:string):LabSession|null{try{const [ver,b,s]=String(v||'').split('.');if(ver!=='v1'||!b||!s||!eq(sign(b),s))return null;const p=JSON.parse(Buffer.from(b,'base64url').toString());if(!p?.email||p.email!==ownerEmail()||Date.now()>Number(p.exp||0))return null;return p}catch{return null}}
export async function getLabSession(){const c=await cookies();return readLabSessionValue(c.get('sky_lab')?.value||'')}
export async function isLabOwner(){return !!(await getLabSession())}
export async function verifyLabOwner(email:string,password:string){const e=String(email||'').trim().toLowerCase();const p=String(password||'');const oe=ownerEmail(),op=ownerPassword();return !!oe&&!!op&&eq(e,oe)&&eq(p,op)}
