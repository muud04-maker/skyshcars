import { signIn } from '../auth';
import { getEnabledAuthProviders } from '../lib/auth-providers';
import { LoginForm, SignupForm } from './CustomerAuthForms';
import shipping from '../../data/shipping_reference.json';

const countries = Array.from(new Set((shipping as any[]).map(x => String(x.country)))).sort();

// Friendly text for Auth.js error codes (?error=...) - never exposes configuration details.
function errorMessage(code?: string) {
  if (!code) return undefined;
  if (code === 'AccessDenied') return 'We could not sign you in with that account. If you already have an account, log in with your email and password.';
  if (code === 'CredentialsSignin') return 'Email or password is incorrect.';
  return 'Sign-in did not complete. Please try again.';
}

/** Shown when customer accounts are switched off. Neutral wording only - no setup details for customers. */
export function AccountsUnavailable() {
  return <section className="authPanel"><span className="eyebrow">MY SKY CARS</span><h1>My Sky Cars</h1><p>Customer accounts are not available right now. You can still browse vehicles, save favourites on this device and request a quote.</p><div className="accountLoginCta"><a className="btn" href="/vehicles">Browse vehicles</a><a className="btn alt" href="/quote">Request a quote</a></div></section>;
}

export default function AuthPanel({ mode, title, subtitle, next = '/account', error }: { mode: 'login' | 'signup'; title: string; subtitle: string; next?: string; error?: string }) {
  const providers = getEnabledAuthProviders();
  return <section className="authPanel"><span className="eyebrow">MY SKY CARS</span><h1>{title}</h1><p>{subtitle}</p>
    {providers.length > 0 && <><div className="authButtons">{providers.map((p) => <form key={p.id} action={async () => { 'use server'; await signIn(p.id, { redirectTo: next }) }}><button className={`authBtn ${p.brand}`} type="submit">{p.label}</button></form>)}</div><div className="authDivider"><span>or use your email</span></div></>}
    {mode === 'login' ? <LoginForm next={next} initialError={errorMessage(error)} /> : <>{error && <div className="authAlert" role="alert">{errorMessage(error)}</div>}<SignupForm countries={countries} /></>}
    <p className="authSwitch">{mode === 'login' ? <>New to Sky Cars? <a href="/signup">Create an account</a></> : <>Already have an account? <a href="/login">Log in</a></>}</p>
    <div className="authMeta"><span>✓ Saved vehicles and account access</span><span>✓ Secure account session</span></div></section>
}
