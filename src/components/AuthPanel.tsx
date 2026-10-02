import { signIn } from '../auth';
import { getEnabledAuthProviders } from '../lib/auth-providers';

export default function AuthPanel({ title='Welcome to My Sky Cars', subtitle='Sign in or create your account using Google or another provider. No password is required.' }:{title?:string;subtitle?:string}) {
  const providers = getEnabledAuthProviders();
  return <section className="authPanel"><h1>{title}</h1><p>{subtitle}</p><div className="authButtons">{providers.length ? providers.map((p)=><form key={p.id} action={async()=>{'use server'; await signIn(p.id,{redirectTo:'/account'})}}><button className={`authBtn ${p.brand}`} type="submit">{p.label}</button></form>) : <div className="authEmpty"><strong>Sign-in providers are not configured yet.</strong><p>Add Google, GitHub, or Facebook app keys in <code>.env</code> to activate one-click login.</p></div>}</div><div className="authMeta"><span>✔ Passwordless social login</span><span>✔ Saved vehicles and account access</span><span>✔ Secure account session</span></div></section>
}
