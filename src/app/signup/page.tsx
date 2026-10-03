import {redirect} from 'next/navigation';
import AuthPanel,{AccountsUnavailable} from '../../components/AuthPanel';
import {customerSession} from '../../lib/session';
import {customerAccountsEnabled} from '../../lib/auth-providers';
export const dynamic='force-dynamic';
export default async function SignupPage({searchParams}:{searchParams:Promise<{error?:string}>}){
  if(!customerAccountsEnabled())return <main className="wrap authPage"><AccountsUnavailable/></main>;
  const sp=await searchParams;
  const session=await customerSession();if(session?.user)redirect('/account');
  return <main className="wrap authPage"><AuthPanel mode="signup" title="Create your Sky Cars account" subtitle="Save vehicles, request quotes faster and keep your details in one place." error={sp.error}/></main>
}
