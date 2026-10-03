import {auth} from '../auth';
import {customerAccountsEnabled} from './auth-providers';
/** The signed-in customer session, or null when accounts are switched off or the session cannot be read. Never throws. */
export async function customerSession(){
  if(!customerAccountsEnabled())return null;
  try{const s:any=await auth();return s?.user?s:null}catch{return null}
}
