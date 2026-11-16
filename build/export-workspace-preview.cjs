// Export the same synthetic APIs used by the packed frontend acceptance suite.
const fs=require('node:fs/promises'),path=require('node:path');
const {setup}=require('./workspace-guided-acceptance.cjs');
(async()=>{
 const [assets,out,prefix]=process.argv.slice(2);
 if(!assets||!out||!/^\/[a-z0-9-]+$/.test(prefix||''))throw Error('usage: export-workspace-preview.cjs assets output /prefix');
 const scripts=[];await setup({addInitScript:async f=>scripts.push(typeof f==='string'?f:`(${f.toString()})();`),route:async()=>{}});
 await fs.cp(assets,out,{recursive:true});
 // Normalize the preview subdirectory before every synthetic fetch wrapper.
 const normalized=scripts.map(s=>s.replaceAll('const url=new URL','const url=new URL').replace(/(const url=new URL[^;]+;)/g,`$1url.pathname=url.pathname.replace(${JSON.stringify(prefix)},'');`));
 const fixture=normalized.join('\n');
 await fs.writeFile(path.join(out,'preview-fixture.js'),fixture);
 await fs.writeFile(path.join(out,'boot.js'),'// Preview preferences are supplied by the isolated fixture.\n');
 let html=await fs.readFile(path.join(out,'index.html'),'utf8');
 html=html.replace('<head>','<head><script src="preview-fixture.js"></script>');
 await fs.writeFile(path.join(out,'index.html'),html);
 console.log('Interactive preview exported:',out);
})().catch(e=>{console.error(e);process.exitCode=1});
