import {getAdminSession} from '../../../../../lib/admin';
import {getAnalytics, type AnalyticsReport} from '../../../../../lib/analytics';
import {db} from '../../../../../lib/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function value(v:any){return typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'')}
function csvCell(v:any){const s=value(v);return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function htmlCell(v:any){return value(v).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}

function flatten(report:AnalyticsReport):string[][]{
  const out:string[][]=[];
  out.push(['SKY CARS BUSINESS ANALYTICS']);
  out.push(['Period',report.period.label,'From',report.period.from,'To',report.period.to,'Comparison',report.period.comparisonLabel]);
  out.push(['Generated',report.generatedAt,'Database configured',report.databaseConfigured?'yes':'no']);
  out.push([]);
  out.push(['SECTION','KPIs']);
  out.push(['Key','Label','Value','Change %','Current state','Quality','Source','Method']);
  for(const k of report.kpis)out.push([k.key,k.label,value(k.value),k.change==null?'':value(k.change),k.current?'yes':'no',k.quality,k.source,k.method]);
  out.push([]);
  out.push(['SECTION','ANALYTICAL PANELS']);
  for(const p of report.panels){
    out.push(['Panel',p.key,p.title,p.kind,p.quality,p.source,p.method,p.error||'',p.note||'']);
    if(p.kind==='bars'||p.kind==='donut'||p.kind==='status'){
      out.push(['Label','Value','Detail']);
      for(const i of p.data.items||[])out.push([i.label,i.value,i.title||'']);
    }else if(p.kind==='funnel'){
      out.push(['Stage','Value','Note']);
      for(const s of p.data.steps||[])out.push([s.label,s.value,s.note||'']);
    }else if(p.kind==='line'||p.kind==='stacked'){
      out.push(['Point',...(p.data.series||[]).map((s:any)=>s.name)]);
      for(let i=0;i<(p.data.labels||[]).length;i++)out.push([p.data.labels[i],...(p.data.series||[]).map((s:any)=>s.values[i]??0)]);
    }else if(p.kind==='table'){
      out.push((p.data.columns||[]).map((c:any)=>c.label));
      for(const r of p.data.rows||[])out.push((p.data.columns||[]).map((c:any)=>value(r[c.key])));
    }
    out.push([]);
  }
  out.push(['SECTION','DETAILED TABLES']);
  for(const t of report.tables){
    out.push(['Table',t.key,t.title,t.quality,t.source,t.error||'']);
    out.push(t.columns.map((c)=>c.label));
    for(const r of t.rows||[])out.push(t.columns.map((c)=>value(r[c.key])));
    out.push([]);
  }
  out.push(['SECTION','ACTION PRIORITIES']);
  out.push(['Priority','Need','Detail','Link']);
  for(const a of report.alerts||[])out.push([a.priority,a.need,a.detail,a.href]);
  out.push([]);
  out.push(['SECTION','METRIC DEFINITIONS']);
  out.push(['Metric','Source','Period','Method','Quality','Limitation']);
  for(const d of report.definitions)out.push([d.metric,d.source,d.period,d.method,d.quality,d.limitation]);
  return out;
}

export async function GET(req:Request){
  const admin=await getAdminSession();if(!admin)return Response.json({error:'Unauthorized'},{status:401});
  const u=new URL(req.url);
  const format=String(u.searchParams.get('format')||'csv').toLowerCase();
  if(!['csv','xls'].includes(format))return Response.json({error:'Supported formats: csv, xls. Use /admin/analytics/print for a print-ready PDF.'},{status:400});
  const report=await getAnalytics({range:u.searchParams.get('range')||'30d',from:u.searchParams.get('from')||'',to:u.searchParams.get('to')||''});
  const rows=flatten(report);
  const stamp=new Date().toISOString().slice(0,10);
  let body='',mime='',ext=format;
  if(format==='csv'){
    body='\uFEFF'+rows.map((r)=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
    mime='text/csv; charset=utf-8';
  }else{
    body=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:5px 7px;font-size:12px}h2{margin-top:24px}</style></head><body><h1>Sky Cars Business Analytics</h1><p>${htmlCell(report.period.label)} · ${htmlCell(report.generatedAt)}</p><table>${rows.map((r)=>`<tr>${r.map((c)=>`<td>${htmlCell(c)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
    mime='application/vnd.ms-excel; charset=utf-8';
  }
  try{await db().execute('INSERT INTO audit_logs(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',[admin.email,`export_analytics_${format}`,'analytics',report.period.label,JSON.stringify({from:report.period.from,to:report.period.to,kpis:report.kpis.length,panels:report.panels.length})]);}catch{}
  return new Response(body,{headers:{'content-type':mime,'content-disposition':`attachment; filename="sky-cars-analytics-${stamp}.${ext}"`,'cache-control':'no-store'}});
}
