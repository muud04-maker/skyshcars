/*
  Customer accounts (Phase 1): email + password and Google sign-in.
  Every account is linked to one row in `customers`, so it shows on the admin Customers page.
  Passwords are hashed with scrypt (random salt per password, parameters stored with the hash).
*/
import {randomBytes,scrypt,timingSafeEqual} from 'crypto';
import {db,dbConfigured,one} from './db';
import {clean,looksEmail} from './ratelimit';

let schemaReady:Promise<void>|null=null;
export function ensureCustomerAuthSchema(){
  if(!schemaReady)schemaReady=db().execute(`CREATE TABLE IF NOT EXISTS customer_accounts(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT UNSIGNED NOT NULL,
    email VARCHAR(191) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_sub VARCHAR(191) NULL,
    signup_method ENUM('password','google') NOT NULL,
    last_login_at DATETIME NULL,
    last_login_method VARCHAR(20) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_customer_account_email(email),
    UNIQUE KEY uq_customer_account_google(google_sub),
    UNIQUE KEY uq_customer_account_customer(customer_id),
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(()=>undefined).catch(e=>{schemaReady=null;throw e});
  return schemaReady;
}

// --- Password hashing (scrypt, N=2^15, r=8, p=1 → ~32 MB per hash) ---
const SCRYPT_N=32768,SCRYPT_R=8,SCRYPT_P=1,KEYLEN=64;
function scryptAsync(password:string,salt:Buffer,N:number,r:number,p:number){
  return new Promise<Buffer>((resolve,reject)=>scrypt(password.normalize('NFKC'),salt,KEYLEN,{N,r,p,maxmem:256*N*r},(e,key)=>e?reject(e):resolve(key)));
}
export async function hashCustomerPassword(password:string){
  const salt=randomBytes(16);
  const key=await scryptAsync(password,salt,SCRYPT_N,SCRYPT_R,SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyCustomerPassword(password:string,stored:string){
  try{
    const [kind,n,r,p,salt,hash]=String(stored||'').split('$');
    const N=Number(n),R=Number(r),P=Number(p);
    if(kind!=='scrypt'||!salt||!hash||!(N>=16384&&N<=131072)||!(R>=1&&R<=16)||!(P>=1&&P<=4))return false;
    const expected=Buffer.from(hash,'base64url');
    const actual=await scryptAsync(password,Buffer.from(salt,'base64url'),N,R,P);
    return expected.length===actual.length&&timingSafeEqual(expected,actual);
  }catch{return false}
}
// Used when the email has no password account, so response time does not reveal which emails exist.
let dummyHash:Promise<string>|null=null;
async function burnPasswordCheck(password:string){if(!dummyHash)dummyHash=hashCustomerPassword(randomBytes(12).toString('hex'));await verifyCustomerPassword(password,await dummyHash)}

// --- Validation ---
export const normEmail=(v:unknown)=>clean(v,190).toLowerCase();
export type SignupInput={fullName:string;email:string;password:string;confirm:string;country:string;phone:string};
export function validateSignup(b:SignupInput){
  const errors:Partial<Record<keyof SignupInput,string>>={};
  if(b.fullName.length<2)errors.fullName='Please enter your full name.';
  if(!looksEmail(b.email))errors.email='Please enter a valid email address.';
  if(b.password.length<8)errors.password='Use at least 8 characters.';
  else if(b.password.length>128)errors.password='Use 128 characters or fewer.';
  else if(!/[A-Za-z]/.test(b.password)||!/[0-9]/.test(b.password))errors.password='Include at least one letter and one number.';
  if(!errors.password&&b.confirm!==b.password)errors.confirm='Passwords do not match.';
  if(b.country.length<2)errors.country='Please choose your country.';
  if(b.phone&&!/^[+0-9()\s-]{6,32}$/.test(b.phone))errors.phone='Please enter a valid phone number, or leave it empty.';
  return errors;
}

// --- Accounts ---
export async function createPasswordAccount(b:SignupInput):Promise<{ok:true;customerId:number}|{ok:false;reason:'exists'}>{
  await ensureCustomerAuthSchema();
  const existing=await one<any>('SELECT id FROM customer_accounts WHERE email=? LIMIT 1',[b.email]);
  if(existing)return {ok:false,reason:'exists'};
  const passwordHash=await hashCustomerPassword(b.password);
  const cx=await db().getConnection();
  try{
    await cx.beginTransaction();
    const [r]:any=await cx.execute('INSERT INTO customers(full_name,email,phone,country,notes) VALUES(?,?,?,?,?)',[b.fullName,b.email,b.phone||null,b.country,'Customer account created via email signup']);
    await cx.execute(`INSERT INTO customer_accounts(customer_id,email,password_hash,signup_method) VALUES(?,?,?,'password')`,[r.insertId,b.email,passwordHash]);
    await cx.commit();
    return {ok:true,customerId:Number(r.insertId)};
  }catch(e:any){
    await cx.rollback();
    if(e?.code==='ER_DUP_ENTRY')return {ok:false,reason:'exists'};
    throw e;
  }finally{cx.release()}
}

export async function verifyPasswordLogin(email:string,password:string){
  if(!dbConfigured())return null;
  await ensureCustomerAuthSchema();
  const a=await one<any>('SELECT a.customer_id,a.password_hash,c.full_name FROM customer_accounts a JOIN customers c ON c.id=a.customer_id WHERE a.email=? LIMIT 1',[email]);
  if(!a?.password_hash){await burnPasswordCheck(password);return null}
  if(!(await verifyCustomerPassword(password,a.password_hash)))return null;
  await db().execute(`UPDATE customer_accounts SET last_login_at=NOW(),last_login_method='password' WHERE customer_id=?`,[a.customer_id]);
  return {customerId:Number(a.customer_id),name:a.full_name||null};
}

/**
 * Finds or creates the customer for a Google sign-in. Links to an existing account with the same email
 * only when Google says the email is verified. Returns null when the sign-in must be refused.
 */
export async function upsertGoogleAccount(p:{sub:string;email:string;emailVerified:boolean;name:string}):Promise<number|null>{
  if(!p.sub||!p.email)return null;
  await ensureCustomerAuthSchema();
  const bySub=await one<any>('SELECT customer_id FROM customer_accounts WHERE google_sub=? LIMIT 1',[p.sub]);
  if(bySub){await db().execute(`UPDATE customer_accounts SET last_login_at=NOW(),last_login_method='google' WHERE customer_id=?`,[bySub.customer_id]);return Number(bySub.customer_id)}
  if(!p.emailVerified)return null;
  const byEmail=await one<any>('SELECT customer_id,google_sub FROM customer_accounts WHERE email=? LIMIT 1',[p.email]);
  if(byEmail){
    if(byEmail.google_sub)return null; // email already linked to a different Google account
    await db().execute(`UPDATE customer_accounts SET google_sub=?,last_login_at=NOW(),last_login_method='google' WHERE customer_id=?`,[p.sub,byEmail.customer_id]);
    await db().execute('UPDATE customers SET full_name=COALESCE(full_name,NULLIF(?,\'\')) WHERE id=?',[p.name,byEmail.customer_id]);
    return Number(byEmail.customer_id);
  }
  const cx=await db().getConnection();
  try{
    await cx.beginTransaction();
    // Reuse a customer record created earlier (e.g. by an older social login or a quote) with this verified email and no account yet.
    const [found]:any=await cx.execute('SELECT c.id FROM customers c LEFT JOIN customer_accounts a ON a.customer_id=c.id WHERE LOWER(c.email)=? AND a.id IS NULL ORDER BY c.id LIMIT 1',[p.email]);
    let customerId=found?.[0]?.id;
    if(customerId)await cx.execute('UPDATE customers SET full_name=COALESCE(full_name,NULLIF(?,\'\')),updated_at=NOW() WHERE id=?',[p.name,customerId]);
    else{const [r]:any=await cx.execute('INSERT INTO customers(full_name,email,notes) VALUES(?,?,?)',[p.name||null,p.email,'Customer account created via Google sign-in']);customerId=r.insertId}
    await cx.execute(`INSERT INTO customer_accounts(customer_id,email,google_sub,signup_method,last_login_at,last_login_method) VALUES(?,?,?,'google',NOW(),'google')`,[customerId,p.email,p.sub]);
    await cx.commit();
    return Number(customerId);
  }catch(e:any){
    await cx.rollback();
    if(e?.code==='ER_DUP_ENTRY'){const again=await one<any>('SELECT customer_id FROM customer_accounts WHERE google_sub=? LIMIT 1',[p.sub]);return again?Number(again.customer_id):null}
    throw e;
  }finally{cx.release()}
}

export async function customerIdForGoogle(sub:string){
  const r=await one<any>('SELECT customer_id FROM customer_accounts WHERE google_sub=? LIMIT 1',[sub]);
  return r?Number(r.customer_id):null;
}

/** Only allow same-site relative redirects after login. */
export function safeNext(v:unknown){const s=String(v??'');return s.startsWith('/')&&!s.startsWith('//')&&!s.startsWith('/\\')?s.slice(0,300):'/account'}
