import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'crypto';
import {db,one} from '../../../../lib/db';
import {clientIp,rateLimit,tooMany} from '../../../../lib/ratelimit';
import {hashPassword,makeAdminSession,verifyPassword} from '../../../../lib/admin';
function same(a:string,b:string){try{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}catch{return false}}
async function setSession(admin:{id:number;email:string;role:'owner'|'admin'|'staff'}){const r=NextResponse.json({ok:true,role:admin.role});r.cookies.set('sky_admin',makeAdminSession(admin),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:60*60*12});return r}
export async function POST(req:Request){
 const ip=clientIp(req);const rl=rateLimit('login-ip:'+ip,10,15*60*1000);if(!rl.ok)return tooMany(rl.retryAfter);
 const b=await req.json().catch(()=>({}));const email=String(b.email||'').trim().toLowerCase().slice(0,190);const rl2=rateLimit('login-email:'+email,6,15*60*1000);if(!rl2.ok)return tooMany(rl2.retryAfter);const password=String(b.password||'');if(!email||!password)return NextResponse.json({error:'Email and password are required'},{status:400});
 const configuredEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();const configuredPassword=String(process.env.ADMIN_PASSWORD||'');
 if(configuredEmail&&configuredPassword&&same(email,configuredEmail)&&same(password,configuredPassword)){
  let owner=await one<any>('SELECT id,email,role,is_active FROM admins WHERE email=? LIMIT 1',[configuredEmail]).catch(()=>null);
  if(!owner){const [x]:any=await db().execute("INSERT INTO admins(email,password_hash,role,is_active) VALUES(?,?,'owner',1)",[configuredEmail,hashPassword(configuredPassword)]);owner={id:x.insertId,email:configuredEmail,role:'owner',is_active:1}}
  else if(owner.role!=='owner'||!owner.is_active){await db().execute("UPDATE admins SET role='owner',is_active=1 WHERE id=?",[owner.id]);owner.role='owner';owner.is_active=1}
  return setSession({id:Number(owner.id),email:configuredEmail,role:'owner'});
 }
 const admin=await one<any>('SELECT id,email,password_hash,role,is_active FROM admins WHERE email=? LIMIT 1',[email]).catch(()=>null);
 if(!admin||!admin.is_active||!admin.password_hash||!verifyPassword(password,admin.password_hash))return NextResponse.json({error:'Invalid email or password'},{status:401});
 return setSession({id:Number(admin.id),email:String(admin.email),role:admin.role});
}
