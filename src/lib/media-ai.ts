/* Optional media intelligence using an OpenAI-compatible API.
   Text sales replies continue to use DeepSeek. Media AI is only used when MEDIA_AI_API_KEY or OPENAI_API_KEY is configured. */
const API_KEY=()=>process.env.MEDIA_AI_API_KEY||process.env.OPENAI_API_KEY||'';
const BASE=()=> (process.env.MEDIA_AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');

export function mediaAiConfigured(){return !!API_KEY();}

export async function transcribeAudio(data:Buffer,mimeType:string){
  if(!mediaAiConfigured()) return null;
  const form=new FormData();
  const ext=mimeType.includes('ogg')?'ogg':mimeType.includes('mp4')?'m4a':mimeType.includes('mpeg')?'mp3':'bin';
  const bytes=new Uint8Array(new ArrayBuffer(data.byteLength));
  bytes.set(data);
  form.append('file',new Blob([bytes.buffer],{type:mimeType||'application/octet-stream'}),`voice.${ext}`);
  form.append('model',process.env.MEDIA_AI_TRANSCRIPTION_MODEL||'whisper-1');
  const r=await fetch(`${BASE()}/audio/transcriptions`,{method:'POST',headers:{Authorization:`Bearer ${API_KEY()}`},body:form,signal:AbortSignal.timeout(35000)});
  if(!r.ok) throw new Error(`Transcription HTTP ${r.status}: ${(await r.text()).slice(0,500)}`);
  const j:any=await r.json();
  const text=String(j.text||'').trim();
  return text||null;
}

export async function describeImage(data:Buffer,mimeType:string){
  if(!mediaAiConfigured()) return null;
  const b64=data.toString('base64');
  const model=process.env.MEDIA_AI_VISION_MODEL||'gpt-4.1-mini';
  const body={model,temperature:0,max_tokens:250,messages:[{role:'user',content:[
    {type:'text',text:'Describe only what is visibly present in this customer-sent vehicle-related image. Be concise and factual. If text/specs are visible, transcribe them. Do not guess make/model/year/condition unless visibly supported.'},
    {type:'image_url',image_url:{url:`data:${mimeType||'image/jpeg'};base64,${b64}`}}
  ]}]};
  const r=await fetch(`${BASE()}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${API_KEY()}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  if(!r.ok) throw new Error(`Vision HTTP ${r.status}: ${(await r.text()).slice(0,500)}`);
  const j:any=await r.json();
  const text=String(j.choices?.[0]?.message?.content||'').trim();
  return text||null;
}
