import {NextRequest,NextResponse} from 'next/server';
import {adminDenied} from '../../../../../lib/admin-guard';
import {db,rows,lim} from '../../../../../lib/db';
import {resourceFor} from '../../../../../lib/admin-resources';

function cleanValue(field:any,value:any){
 if(field.type==='boolean')return value===true||value===1||value==='1'?1:0;
 if(field.type==='number')return value===''||value===null||value===undefined?null:Number(value);
 return value===''?null:value;
}
async function audit(action:string,type:string,id:any,details:any){try{await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',['admin',action,type,String(id||''),JSON.stringify(details||{})])}catch{}}

export async function GET(req:NextRequest,{params}:{params:Promise<{resource:string}>}){
 const denied=await adminDenied();if(denied)return denied;
 const {resource}=await params;const cfg=resourceFor(resource);if(!cfg)return NextResponse.json({error:'Unknown resource'},{status:404});
 const url=new URL(req.url);const limit=lim(url.searchParams.get('limit')||300,500);
 const data=await rows<any>(`SELECT * FROM ${cfg.table} ORDER BY ${cfg.order} LIMIT ${limit}`);
 return NextResponse.json({resource,label:cfg.label,fields:cfg.fields,list:cfg.list,readonly:!!cfg.readonly,data});
}
export async function POST(req:NextRequest,{params}:{params:Promise<{resource:string}>}){
 const denied=await adminDenied();if(denied)return denied;const {resource}=await params;const cfg=resourceFor(resource);if(!cfg||cfg.readonly)return NextResponse.json({error:'Not writable'},{status:403});
 const body=await req.json();const fields=cfg.fields.filter(f=>!f.readonly&&f.key in body);for(const f of cfg.fields.filter(f=>f.required)){if(body[f.key]===undefined||body[f.key]==='')return NextResponse.json({error:`${f.label} is required`},{status:400})}
 if(!fields.length)return NextResponse.json({error:'No fields supplied'},{status:400});const vals=fields.map(f=>cleanValue(f,body[f.key]));const [r]:any=await db().execute(`INSERT INTO ${cfg.table}(${fields.map(f=>f.key).join(',')}) VALUES(${fields.map(()=>'?').join(',')})`,vals);await audit('create',cfg.table,r.insertId,body);return NextResponse.json({ok:true,id:r.insertId});
}
export async function PATCH(req:NextRequest,{params}:{params:Promise<{resource:string}>}){
 const denied=await adminDenied();if(denied)return denied;const {resource}=await params;const cfg=resourceFor(resource);if(!cfg||cfg.readonly)return NextResponse.json({error:'Not writable'},{status:403});const body=await req.json();const id=body[cfg.id]??body.id;if(!id)return NextResponse.json({error:'id required'},{status:400});const fields=cfg.fields.filter(f=>!f.readonly&&f.key in body);if(!fields.length)return NextResponse.json({error:'No editable fields supplied'},{status:400});await db().execute(`UPDATE ${cfg.table} SET ${fields.map(f=>`${f.key}=?`).join(',')} WHERE ${cfg.id}=?`,[...fields.map(f=>cleanValue(f,body[f.key])),id]);await audit('update',cfg.table,id,body);return NextResponse.json({ok:true});
}
export async function DELETE(req:NextRequest,{params}:{params:Promise<{resource:string}>}){
 const denied=await adminDenied();if(denied)return denied;const {resource}=await params;const cfg=resourceFor(resource);if(!cfg||cfg.readonly)return NextResponse.json({error:'Not writable'},{status:403});const body=await req.json();const id=body[cfg.id]??body.id;if(!id)return NextResponse.json({error:'id required'},{status:400});await db().execute(`DELETE FROM ${cfg.table} WHERE ${cfg.id}=?`,[id]);await audit('delete',cfg.table,id,{});return NextResponse.json({ok:true});
}
