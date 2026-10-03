'use client';
import {useActionState} from 'react';
import {useFormStatus} from 'react-dom';
import {loginAction,signupAction,type AuthFormState} from '../lib/customer-auth-actions';

function Submit({label,busy}:{label:string;busy:string}){const {pending}=useFormStatus();return <button className="btn authSubmit" type="submit" disabled={pending}>{pending?busy:label}</button>}
function FieldError({msg,id}:{msg?:string;id:string}){return msg?<small className="authFieldError" id={id}>{msg}</small>:null}

export function LoginForm({next,initialError}:{next:string;initialError?:string}){
  const [state,action]=useActionState<AuthFormState,FormData>(loginAction,{error:initialError});
  return <form className="authForm" action={action} noValidate>
    {state.error&&<div className="authAlert" role="alert">{state.error}</div>}
    <input type="hidden" name="next" value={next}/>
    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={190} defaultValue={state.values?.email||''}/></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
    <label className="authCheck"><input name="remember" type="checkbox"/> Remember me for 30 days</label>
    <Submit label="Log in" busy="Logging in…"/>
  </form>;
}

export function SignupForm({countries}:{countries:string[]}){
  const [state,action]=useActionState<AuthFormState,FormData>(signupAction,{});
  const v=state.values||{},fe=state.fieldErrors||{};
  return <form className="authForm" action={action} noValidate>
    {state.error&&<div className="authAlert" role="alert">{state.error}</div>}
    <label>Full name<input name="fullName" autoComplete="name" required maxLength={120} defaultValue={v.fullName||''} aria-invalid={!!fe.fullName} aria-describedby="e-fullName"/><FieldError id="e-fullName" msg={fe.fullName}/></label>
    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={190} defaultValue={v.email||''} aria-invalid={!!fe.email} aria-describedby="e-email"/><FieldError id="e-email" msg={fe.email}/></label>
    <div className="authRow">
      <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} aria-invalid={!!fe.password} aria-describedby="e-password"/><FieldError id="e-password" msg={fe.password}/></label>
      <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required maxLength={128} aria-invalid={!!fe.confirm} aria-describedby="e-confirm"/><FieldError id="e-confirm" msg={fe.confirm}/></label>
    </div>
    <small className="authHint">At least 8 characters, with a letter and a number.</small>
    <div className="authRow">
      <label>Country<input name="country" list="authCountries" autoComplete="country-name" required maxLength={100} defaultValue={v.country||''} aria-invalid={!!fe.country} aria-describedby="e-country"/><FieldError id="e-country" msg={fe.country}/></label>
      <label>Phone / WhatsApp <span className="authOptional">(optional)</span><input name="phone" type="tel" autoComplete="tel" maxLength={32} defaultValue={v.phone||''} aria-invalid={!!fe.phone} aria-describedby="e-phone"/><FieldError id="e-phone" msg={fe.phone}/></label>
    </div>
    <datalist id="authCountries">{countries.map(c=><option key={c} value={c}/>)}</datalist>
    <Submit label="Create account" busy="Creating account…"/>
  </form>;
}
