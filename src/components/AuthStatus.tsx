import { signOut } from '../auth';
import { customerSession } from '../lib/session';
import { customerAccountsEnabled } from '../lib/auth-providers';

export default async function AuthStatus(){
  if(!customerAccountsEnabled()) return null; // accounts switched off: no login links
  const session = await customerSession();
  if(!session?.user){
    return <div className="accountChip"><a href="/login">Login</a><a className="solid" href="/signup">Sign up</a></div>;
  }
  return <div className="accountChip loggedIn">{session.user.image?<img src={session.user.image} alt=""/>:<span className="avatarFallback">{(session.user.name||session.user.email||'U').slice(0,1).toUpperCase()}</span>}<a href="/account">{session.user.name||'My account'}</a><form action={async()=>{'use server'; await signOut({redirectTo:'/'})}}><button type="submit">Logout</button></form></div>;
}
