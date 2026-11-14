import {createWorkBuddySubscriptionAdapter} from 'sub2agent/core/source-adapters/workbuddy-subscription-adapter';
import snapshot from 'sub2agent/generated/codebuddy-models.json';

const positive = value => Number.isSafeInteger(value) && value >= 512 ? value : undefined;
// Measured ~1 MiB MaaS transport: advertise a working window, not the
// underlying model's 1M-token capacity. Raw discovery stays in the bundle.
const MAAS_WORKING_WINDOW = 256000;
const base = id => String(id).toLowerCase().replace(/-maas(?:-[a-z0-9_.-]+)?$/, '');

// Preserve the vendor's input cap separately from its full window. Never copy
// credentials, prices or unrecognised response fields into model metadata.
export function modelMetadata(row) {
  const input=positive(row?.maxInputTokens),context=positive(row?.maxAllowedSize),output=positive(row?.maxOutputTokens);
  const limit={...(context?{context}:{}),...(input?{input}:{}),...(output?{output}:{})};
  return Object.keys(limit).length ? {limit} : {};
}

export function workBuddyModelSet(bundle, ids) {
  const fallback=new Map(snapshot.models.map(row=>[row.id.toLowerCase(),row]));
  return Object.fromEntries(ids.map(id=>{
    const upstream=bundle.modelMap?.[id] || id;
    const row=fallback.get(base(upstream)) || fallback.get(base(id));
    const saved=bundle.modelMetadata?.[id];
    const metadata={...modelMetadata(row),...(saved?.limit?{limit:{...modelMetadata(row).limit,...saved.limit}}:{})};
    if ([upstream,id].some(name=>/-maas(?:-|\||$)/i.test(name)) && !/^auto(?:-|$)/i.test(id)) {
      const limit={...metadata.limit};
      limit.context=Math.min(limit.context || MAAS_WORKING_WINDOW,MAAS_WORKING_WINDOW);
      limit.input=Math.min(limit.input || MAAS_WORKING_WINDOW,limit.context,MAAS_WORKING_WINDOW);
      metadata.limit=limit;
    }
    return [id,{name:id,...metadata}];
  }));
}

// Capture metadata from the same authenticated discovery the private adapter
// already validates. A fresh adapter per call isolates concurrent accounts.
export function workBuddyAdapter(fetchImpl) {
  const adapter=createWorkBuddySubscriptionAdapter({fetchImpl});
  return {...adapter,async listModels(bundle) {
    const rows=[];
    const capture=async(url,init)=>{
      const response=await fetchImpl(url,init);
      if(response.ok && (/\/v3\/config$/.test(String(url)) || /\/config\/models$/.test(String(url)))) {
        const envelope=await response.clone().json().catch(()=>null);
        if(envelope && Number(envelope.code||0)===0) {
          const data=envelope.data;
          rows.push(...(Array.isArray(data)?data:Array.isArray(data?.models)?data.models:[]));
        }
      }
      return response;
    };
    const discovered=await createWorkBuddySubscriptionAdapter({fetchImpl:capture}).listModels(bundle);
    const byID=new Map(rows.filter(r=>typeof r?.id==='string').map(r=>[r.id,r]));
    const metadata=Object.fromEntries(discovered.models.map(name=>[name,modelMetadata(byID.get(discovered.modelMap[name]))]));
    return {...discovered,modelMetadata:metadata};
  }};
}
