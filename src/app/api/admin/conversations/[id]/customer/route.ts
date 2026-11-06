import {NextResponse} from 'next/server';import {one,db} from '../../../../../../lib/db';import {adminDenied} from '../../../../../../lib/admin-guard';import {ensureCustomerMemorySchema,groupMessagesForCustomer,refreshCustomerMemory} from '../../../../../../lib/customer-memory';
import {FACT_KEYS,deleteFact,factsForCustomer,setFact} from '../../../../../../lib/customer-facts';
/*
  One editable customer profile for the WhatsApp desk (Nov 7): name, country, language, notes AND the
  AI-extracted memory facts. Staff edits are stored as source='admin' (traceable in customer_fact_events)
  and the AI reads them on its next reply. Customer-scoped only - never a global rule.
*/
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const d=await adminDenied();if(d)return d;const {id}=await params;await ensureCustomerMemorySchema();const c=await one<any>(`SELECT cu.id,cu.full_name,cu.phone,cu.email,cu.country,cu.preferred_language,cu.notes,cm.summary memory_summary,cm.preferences_json,cm.last_stock_no,cm.updated_at memory_updated_at FROM conversations co LEFT JOIN customers cu ON cu.id=co.customer_id LEFT JOIN customer_memory cm ON cm.customer_id=cu.id WHERE co.id=? LIMIT 1`,[id]);if(c?.id){c.group_messages=await groupMessagesForCustomer(Number(c.id),50);try{c.facts=await factsForCustomer(Number(c.id))}catch{c.facts=[]}}return NextResponse.json({customer:c||null,fact_keys:FACT_KEYS})}
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){const d=await adminDenied();if(d)return d;const {id}=await params;const b=await req.json().catch(()=>({}));const c:any=await one(`SELECT customer_id FROM conversations WHERE id=? LIMIT 1`,[id]);if(!c?.customer_id)return NextResponse.json({error:'Customer not found'},{status:404});
  await db().execute('UPDATE customers SET country=?,preferred_language=?,notes=? WHERE id=?',[String(b.country||'').trim()||null,String(b.preferred_language||'').trim()||null,String(b.notes||'').trim()||null,c.customer_id]);
  if(typeof b.full_name==='string'&&b.full_name.trim()){try{await db().execute('UPDATE customers SET full_name=? WHERE id=?',[b.full_name.trim().slice(0,150),c.customer_id])}catch{}}
  let factsSaved=0;const errors:string[]=[];
  if(b.facts&&typeof b.facts==='object'){
    for(const [k,v] of Object.entries(b.facts as Record<string,any>)){
      if(!(FACT_KEYS as readonly string[]).includes(k))continue;
      const value=String(v==null?'':v).trim();
      try{if(value){await setFact(Number(c.customer_id),k,value,'staff');factsSaved++}else{await deleteFact(Number(c.customer_id),k,'staff')}}catch(e:any){errors.push(`${k}: ${e?.message||'not saved'}`)}
    }
  }
  if(b.refresh_memory){try{await refreshCustomerMemory(Number(id))}catch{}}
  return NextResponse.json({ok:true,facts_saved:factsSaved,errors})}
