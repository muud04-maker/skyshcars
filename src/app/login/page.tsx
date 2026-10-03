import {redirect} from 'next/navigation';
import AuthPanel from '../../components/AuthPanel';
import {auth} from '../../auth';
import {safeNext} from '../../lib/customer-auth';
export const dynamic='force-dynamic';
export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string;callbackUrl?:string;next?:string}>}){
  const sp=await searchParams;const next=safeNext(sp.next||sp.callbackUrl);
  const session=await auth();if(session?.user)redirect(next);
  return <main className="wrap authPage"><AuthPanel mode="login" title="Login to My Sky Cars" subtitle="Welcome back. Log in to see your saved vehicles and account." next={next} error={sp.error}/></main>
}
