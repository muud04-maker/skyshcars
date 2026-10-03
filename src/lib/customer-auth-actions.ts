'use server';
import {headers} from 'next/headers';
import {AuthError} from 'next-auth';
import {signIn} from '../auth';
import {customerAccountsEnabled} from './auth-providers';
import {clean,clientIp,rateLimit} from './ratelimit';
import {createPasswordAccount,normEmail,safeNext,validateSignup,type SignupInput} from './customer-auth';

export type AuthFormState={error?:string;fieldErrors?:Partial<Record<keyof SignupInput,string>>;values?:Record<string,string>};

const UNAVAILABLE='Sign-in is temporarily unavailable. Please try again later or contact us.';

async function requestIp(){return clientIp(new Request('http://local',{headers:await headers()}))}

export async function loginAction(_prev:AuthFormState,fd:FormData):Promise<AuthFormState>{
  const email=normEmail(fd.get('email')),password=String(fd.get('password')||'').slice(0,128),remember=fd.get('remember')==='on';
  const values={email};
  if(!email||!password)return {error:'Enter your email and password.',values};
  if(!customerAccountsEnabled())return {error:UNAVAILABLE,values};
  try{
    await signIn('credentials',{email,password,remember:remember?'1':'0',redirectTo:safeNext(fd.get('next'))});
    return {};
  }catch(e:any){
    if(e instanceof AuthError){
      if((e as any).code==='rate_limited')return {error:'Too many attempts. Please wait a few minutes and try again.',values};
      if(e.type==='CredentialsSignin')return {error:'Email or password is incorrect.',values};
      console.error('CUSTOMER_LOGIN',e);
      return {error:UNAVAILABLE,values};
    }
    throw e; // Next.js redirect on success
  }
}

export async function signupAction(_prev:AuthFormState,fd:FormData):Promise<AuthFormState>{
  const input:SignupInput={
    fullName:clean(fd.get('fullName'),120),email:normEmail(fd.get('email')),
    password:String(fd.get('password')||''),confirm:String(fd.get('confirm')||''),
    country:clean(fd.get('country'),100),phone:clean(fd.get('phone'),32),
  };
  const values={fullName:input.fullName,email:input.email,country:input.country,phone:input.phone};
  const fieldErrors=validateSignup(input);
  if(Object.keys(fieldErrors).length)return {fieldErrors,values};
  if(!customerAccountsEnabled())return {error:UNAVAILABLE,values};
  const ip=await requestIp();
  if(!rateLimit('customer-signup-ip:'+ip,5,60*60*1000).ok||!rateLimit('customer-signup-email:'+input.email,3,60*60*1000).ok)return {error:'Too many sign-up attempts. Please wait a while and try again.',values};
  try{
    const r=await createPasswordAccount(input);
    if(!r.ok)return {fieldErrors:{email:'An account with this email already exists. Please log in instead.'},values};
  }catch(e){console.error('CUSTOMER_SIGNUP',e);return {error:'We could not create your account right now. Please try again shortly.',values}}
  try{
    await signIn('credentials',{email:input.email,password:input.password,remember:'0',redirectTo:'/account'});
    return {};
  }catch(e:any){
    if(e instanceof AuthError)return {error:'Your account was created. Please log in to continue.',values};
    throw e;
  }
}
