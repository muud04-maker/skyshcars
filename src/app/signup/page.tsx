import {redirect} from 'next/navigation';
import AuthPanel,{AccountsUnavailable} from '../../components/AuthPanel';
import {customerSession} from '../../lib/session';
import {customerAccountsEnabled} from '../../lib/auth-providers';

export const dynamic='force-dynamic';
export const metadata={title:'Create an Account | My Sky Cars',description:'Create your Sky Cars account to save vehicles, request quotes faster and keep your details in one place.'};

export default async function SignupPage({searchParams}:{searchParams:Promise<{error?:string}>}){
  if(!customerAccountsEnabled())return <main className="wrap authPage theme-auth"><AccountsUnavailable/></main>;
  const sp=await searchParams;
  const session=await customerSession();
  if(session?.user)redirect('/account');
  return <main className="wrap authPage theme-auth"><AuthPanel mode="signup" title="Create your Sky Cars account" subtitle="Save vehicles, request quotes faster and keep your details in one place." error={sp.error}/></main>;
}
