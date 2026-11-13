'use strict';
const fs=require('node:fs');const path=require('node:path');
// A dated server-maintained reference, not a live exchange-rate claim.
const initial={currency:'CNY',usd_to_cny:6.7152,as_of:'2026-11-13',source:'https://www.chinamoney.com.cn/english/bmkcpr/?tab=2'};
function validate(value){
 if(value?.currency!=='CNY'||!Number.isFinite(value.usd_to_cny)||value.usd_to_cny<=0||!/^\d{4}-\d{2}-\d{2}$/.test(value.as_of)||!Number.isFinite(Date.parse(value.as_of))||typeof value.source!=='string'||!value.source)throw Error('Invalid report currency');
 return {currency:'CNY',usd_to_cny:value.usd_to_cny,as_of:value.as_of,source:value.source};
}
function createReportCurrency({dataDir}){
 const file=path.join(dataDir,'report-currency.json');
 let current=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))):{...initial};
 const get=()=>({...current});
 const set=value=>{const next=validate(value);const tmp=file+'.pending';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);current=next;return get();};
 if(!fs.existsSync(file))set(current);
 return {get,set};
}
module.exports={createReportCurrency};
