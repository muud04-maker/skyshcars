export type AuthProviderMeta={id:string;label:string;brand:string};
const allProviders:AuthProviderMeta[]=[
  {id:'google',label:'Continue with Google',brand:'google'},
  {id:'facebook',label:'Continue with Facebook',brand:'facebook'},
  {id:'github',label:'Continue with GitHub',brand:'github'},
];
/** Google keys: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (preferred) or the older AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET. */
export function googleCredentials(){
  const clientId=process.env.GOOGLE_CLIENT_ID||process.env.AUTH_GOOGLE_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET||process.env.AUTH_GOOGLE_SECRET;
  return clientId&&clientSecret?{clientId,clientSecret}:null;
}
export function getEnabledAuthProviders(){return allProviders.filter(p=>{
  if(!customerAccountsEnabled())return false;
  if(p.id==='google')return !!googleCredentials();
  if(p.id==='facebook')return !!process.env.AUTH_FACEBOOK_ID&&!!process.env.AUTH_FACEBOOK_SECRET;
  if(p.id==='github')return !!process.env.AUTH_GITHUB_ID&&!!process.env.AUTH_GITHUB_SECRET;
  return false;
})}

/** Customer accounts run only when sessions can be signed and accounts stored; otherwise they switch off quietly. */
export function customerAccountsEnabled(){
  return !!String(process.env.AUTH_SECRET||'').trim()&&['DB_HOST','DB_NAME','DB_USER','DB_PASSWORD'].every(k=>!!process.env[k]);
}
