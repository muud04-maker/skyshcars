import {redirect} from 'next/navigation';
import AuthPanel,{AccountsUnavailable} from '../../components/AuthPanel';
import {customerSession} from '../../lib/session';
import {customerAccountsEnabled} from '../../lib/auth-providers';
import {safeNext} from '../../lib/customer-auth';

export const dynamic='force-dynamic';
export const metadata={title:'Login | My Sky Cars',description:'Log in to your Sky Cars account to see saved vehicles and account details.'};

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string;callbackUrl?:string;next?:string}>}){
  if(!customerAccountsEnabled())return <main className="wrap authPage theme-auth"><AccountsUnavailable/></main>;
  const sp=await searchParams;
  const next=safeNext(sp.next||sp.callbackUrl);
  const session=await customerSession();
  if(session?.user)redirect(next);
  return <main className="wrap authPage theme-auth"><AuthPanel mode="login" title="Login to My Sky Cars" subtitle="Welcome back. Log in to see your saved vehicles and account." next={next} error={sp.error}/></main>;
}
