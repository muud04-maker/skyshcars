import NextAuth,{CredentialsSignin} from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Facebook from 'next-auth/providers/facebook';
import Credentials from 'next-auth/providers/credentials';
import {db,dbConfigured} from './lib/db';
import {googleCredentials} from './lib/auth-providers';
import {customerIdForGoogle,normEmail,upsertGoogleAccount,verifyPasswordLogin} from './lib/customer-auth';
import {clientIp,rateLimit} from './lib/ratelimit';

class RateLimited extends CredentialsSignin{code='rate_limited'}
const SHORT_SESSION_MS=24*60*60*1000; // sessions without "remember me"

const providers=[] as any[];
providers.push(Credentials({
  id:'credentials',
  credentials:{email:{},password:{},remember:{}},
  async authorize(c:any,request:Request){
    const email=normEmail(c?.email),password=String(c?.password||'').slice(0,128);
    if(!email||!password)return null;
    const ip=clientIp(request);
    if(!rateLimit('customer-login-ip:'+ip,20,15*60*1000).ok||!rateLimit('customer-login-email:'+email,8,15*60*1000).ok)throw new RateLimited();
    const found=await verifyPasswordLogin(email,password);
    if(!found)return null;
    return {id:String(found.customerId),email,name:found.name,remember:c?.remember==='1'} as any;
  },
}));
const google=googleCredentials();
if(google)providers.push(Google({clientId:google.clientId,clientSecret:google.clientSecret}));
if(process.env.AUTH_FACEBOOK_ID&&process.env.AUTH_FACEBOOK_SECRET)providers.push(Facebook({clientId:process.env.AUTH_FACEBOOK_ID,clientSecret:process.env.AUTH_FACEBOOK_SECRET}));
if(process.env.AUTH_GITHUB_ID&&process.env.AUTH_GITHUB_SECRET)providers.push(GitHub({clientId:process.env.AUTH_GITHUB_ID,clientSecret:process.env.AUTH_GITHUB_SECRET}));

export const {handlers,auth,signIn,signOut}=NextAuth({
  secret:process.env.AUTH_SECRET,trustHost:true,session:{strategy:'jwt',maxAge:30*24*60*60},providers,pages:{signIn:'/login',error:'/login'},
  // Session cookie is httpOnly + SameSite=Lax by default; force Secure (and the __Secure- prefix) in production.
  useSecureCookies:process.env.NODE_ENV==='production',
  callbacks:{
    async signIn({user,account,profile}:any){
      if(account?.provider==='credentials')return true;
      if(account?.provider==='google'){
        if(!dbConfigured())return false;
        try{
          const id=await upsertGoogleAccount({sub:String(account.providerAccountId||''),email:normEmail(profile?.email||user?.email),emailVerified:profile?.email_verified===true,name:String(profile?.name||user?.name||'').trim().slice(0,120)});
          return !!id;
        }catch(e){console.error('CUSTOMER_GOOGLE_SIGNIN',e);return false}
      }
      const email=String(user?.email||'').trim().toLowerCase();
      if(email&&dbConfigured())try{
        const [found]:any=await db().execute('SELECT id FROM customers WHERE LOWER(email)=? ORDER BY id LIMIT 1',[email]);
        if(found?.length)await db().execute('UPDATE customers SET full_name=COALESCE(NULLIF(?,\'\'),full_name),updated_at=NOW() WHERE id=?',[String(user?.name||'').trim(),found[0].id]);
        else await db().execute('INSERT INTO customers(full_name,email,notes) VALUES(?,?,?)',[String(user?.name||'').trim()||null,email,`Customer account created via ${String(account?.provider||'social login')}`]);
      }catch(e){console.error('CUSTOMER_SOCIAL_ACCOUNT_SYNC',e)}
      return true;
    },
    async jwt({token,user,account,profile}:any){
      if(profile?.picture&&!token.picture)token.picture=profile.picture;
      if(account){
        token.loginAt=Date.now();
        if(account.provider==='credentials'){token.cid=String(user?.id||'');token.remember=!!user?.remember}
        else if(account.provider==='google'){const id=await customerIdForGoogle(String(account.providerAccountId||''));if(!id)return null;token.cid=String(id);token.remember=true}
      }
      if(token.remember===false&&Date.now()-Number(token.loginAt||0)>SHORT_SESSION_MS)return null;
      return token;
    },
    async session({session,token}:any){if(session?.user&&token?.sub){session.user.id=token.cid||token.sub;if(token.picture)session.user.image=token.picture as string}return session},
  },
});
