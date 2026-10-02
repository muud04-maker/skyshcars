import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Facebook from 'next-auth/providers/facebook';
import {db,dbConfigured} from './lib/db';

const providers=[] as any[];
if(process.env.AUTH_GOOGLE_ID&&process.env.AUTH_GOOGLE_SECRET)providers.push(Google({clientId:process.env.AUTH_GOOGLE_ID,clientSecret:process.env.AUTH_GOOGLE_SECRET}));
if(process.env.AUTH_FACEBOOK_ID&&process.env.AUTH_FACEBOOK_SECRET)providers.push(Facebook({clientId:process.env.AUTH_FACEBOOK_ID,clientSecret:process.env.AUTH_FACEBOOK_SECRET}));
if(process.env.AUTH_GITHUB_ID&&process.env.AUTH_GITHUB_SECRET)providers.push(GitHub({clientId:process.env.AUTH_GITHUB_ID,clientSecret:process.env.AUTH_GITHUB_SECRET}));

export const {handlers,auth,signIn,signOut}=NextAuth({
  secret:process.env.AUTH_SECRET,trustHost:true,session:{strategy:'jwt'},providers,pages:{signIn:'/login'},
  callbacks:{
    async signIn({user,account}:any){
      const email=String(user?.email||'').trim().toLowerCase();
      if(email&&dbConfigured())try{
        const [found]:any=await db().execute('SELECT id FROM customers WHERE LOWER(email)=? ORDER BY id LIMIT 1',[email]);
        if(found?.length)await db().execute('UPDATE customers SET full_name=COALESCE(NULLIF(?,\'\'),full_name),updated_at=NOW() WHERE id=?',[String(user?.name||'').trim(),found[0].id]);
        else await db().execute('INSERT INTO customers(full_name,email,notes) VALUES(?,?,?)',[String(user?.name||'').trim()||null,email,`Customer account created via ${String(account?.provider||'social login')}`]);
      }catch(e){console.error('CUSTOMER_SOCIAL_ACCOUNT_SYNC',e)}
      return true;
    },
    async jwt({token,profile}:any){if(profile?.picture&&!token.picture)token.picture=profile.picture;return token},
    async session({session,token}:any){if(session?.user&&token?.sub){session.user.id=token.sub;if(token.picture)session.user.image=token.picture as string}return session},
  },
});
