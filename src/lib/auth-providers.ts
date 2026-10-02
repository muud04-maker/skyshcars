export type AuthProviderMeta={id:string;label:string;brand:string};
const allProviders:AuthProviderMeta[]=[
  {id:'google',label:'Continue with Google',brand:'google'},
  {id:'facebook',label:'Continue with Facebook',brand:'facebook'},
  {id:'github',label:'Continue with GitHub',brand:'github'},
];
export function getEnabledAuthProviders(){return allProviders.filter(p=>{
  if(p.id==='google')return !!process.env.AUTH_GOOGLE_ID&&!!process.env.AUTH_GOOGLE_SECRET;
  if(p.id==='facebook')return !!process.env.AUTH_FACEBOOK_ID&&!!process.env.AUTH_FACEBOOK_SECRET;
  if(p.id==='github')return !!process.env.AUTH_GITHUB_ID&&!!process.env.AUTH_GITHUB_SECRET;
  return false;
})}
