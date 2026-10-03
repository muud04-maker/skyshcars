import {redirect} from 'next/navigation';
import AuthPanel from '../../components/AuthPanel';
import {auth} from '../../auth';
export const dynamic='force-dynamic';
export default async function SignupPage({searchParams}:{searchParams:Promise<{error?:string}>}){
  const sp=await searchParams;
  const session=await auth();if(session?.user)redirect('/account');
  return <main className="wrap authPage"><AuthPanel mode="signup" title="Create your Sky Cars account" subtitle="Save vehicles, request quotes faster and keep your details in one place." error={sp.error}/></main>
}
