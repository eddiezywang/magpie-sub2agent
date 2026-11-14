import {createWorkBuddySubscriptionAdapter} from 'sub2agent/core/source-adapters/workbuddy-subscription-adapter';
import snapshot from 'sub2agent/generated/codebuddy-models.json';

const positive = value => Number.isSafeInteger(value) && value >= 512 ? value : undefined;
const base = id => String(id).toLowerCase().replace(/-maas(?:-[a-z0-9_.-]+)?$/, '');

// Operational Agent budget, not the model's advertised token capacity. The
// MaaS transport separately guards 900 KiB of serialized request bytes, so a
// generic 1M-token catalog window must never be exposed as usable on this path.
function agentBudget(limit = {}) {
  const output = Math.min(limit.output || 32000, 32000);
  const context = Math.min(limit.context || 132000, 132000);
  const input = Math.min(limit.input || 100000, 100000, Math.max(1, context-output));
  return {context,input,output:Math.min(output,context-1)};
}

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
    if (/-maas(?:-|\||$)/i.test(upstream) || /-maas(?:-|\||$)/i.test(id)) metadata.limit=agentBudget(metadata.limit);
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
