const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const sharp=require('sharp');
const {handleProviderResult}=require('../scripts/provider-result.cjs');
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tiled-receipt-'));return {dir,output:path.join(dir,'tile.pending.png')}}
async function png(){return sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer()}
function malformed(bytes,tail='"usage":{'){return JSON.stringify({ok:false,code:'sse_json_parse_error',message:'SSE data 不是合法 JSON',detail:{data:'{"type":"image_edit.completed","b64_json":"'+bytes.toString('base64')+'",'+tail}})}
test('recover complete PNG in malformed completed SSE and keep original receipt',async()=>{const f=await fixture(),bytes=await png();try{const r=await handleProviderResult({...f,code:1,stderr:malformed(bytes),stdout:'',secret:'secret-value'});assert.equal(r.recovered,true);assert.deepEqual(await fs.readFile(f.output),bytes);const receipt=await fs.readFile(f.output+'.provider.json','utf8');assert.match(receipt,/sse_json_parse_error/);assert.match(receipt,/recovered/)}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('refuse PNG with truncated IEND, preserve error',async()=>{const f=await fixture();try{await assert.rejects(handleProviderResult({...f,code:1,stderr:malformed((await png()).subarray(0,-12)),stdout:'',secret:'xyz'}),/sse_json_parse_error/);await assert.rejects(fs.stat(f.output));assert.match(await fs.readFile(f.output+'.provider.json','utf8'),/sse_json_parse_error/)}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('refuse explicit errors and incomplete or unknown event types',async()=>{for(const event of ['error','image_generation.partial_image','unknown']){const f=await fixture();try{await assert.rejects(handleProviderResult({...f,code:1,stderr:malformed(await png()).replace('image_edit.completed',event),stdout:'',secret:'xyz'}));await assert.rejects(fs.stat(f.output))}finally{await fs.rm(f.dir,{recursive:true,force:true})}}});
test('do not recover malformed JSON before or inside image field',async()=>{const f=await fixture();try{const stderr=malformed(await png()).replace('\\"type\\":','BROKEN\\"type\\":');await assert.rejects(handleProviderResult({...f,code:1,stderr,stdout:'',secret:'xyz'}))}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('retain error code/status, redact keys in saved receipt and thrown error',async()=>{const f=await fixture();try{await assert.rejects(handleProviderResult({...f,code:1,stderr:JSON.stringify({code:'api_http_error',message:'bad secret-value',detail:{status:403,body:'secret-value'}}),stdout:'secret-value',secret:'secret-value'}),e=>e.message.includes('api_http_error')&&e.message.includes('403')&&!e.message.includes('secret-value'));assert.ok(!(await fs.readFile(f.output+'.provider.json','utf8')).includes('secret-value'))}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('success preserves receipt and does not overwrite output',async()=>{const f=await fixture();try{const bytes=await png();await fs.writeFile(f.output,bytes);const r=await handleProviderResult({...f,code:0,stderr:'',stdout:'{"ok":true}',secret:'xyz'});assert.equal(r.recovered,false);assert.deepEqual(await fs.readFile(f.output),bytes)}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('never overwrite existing output during recovery',async()=>{const f=await fixture();try{await fs.writeFile(f.output,'existing');await assert.rejects(handleProviderResult({...f,code:1,stderr:malformed(await png()),stdout:'',secret:'xyz'}));assert.equal(await fs.readFile(f.output,'utf8'),'existing')}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('truncated captured output cannot trigger recovery',async()=>{const f=await fixture();try{await assert.rejects(handleProviderResult({...f,code:1,stderr:malformed(await png()),stdout:'',secret:'xyz',truncated:true}));await assert.rejects(fs.stat(f.output))}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('repeat failure keeps earlier receipt instead of overwriting it',async()=>{const f=await fixture();try{for(const message of ['first','second'])await assert.rejects(handleProviderResult({...f,code:1,stderr:JSON.stringify({code:'api_http_error',message}),stdout:'',secret:'xyz'}));const receipts=(await fs.readdir(f.dir)).filter(n=>n.endsWith('.provider.json'));assert.equal(receipts.length,2);assert.match(await fs.readFile(f.output+'.provider.json','utf8'),/first/)}finally{await fs.rm(f.dir,{recursive:true,force:true})}});
test('actual invokeProvider captures stderr, recovers once, never resubmits',async()=>{
 const vm=require('node:vm'),{createRequire}=require('node:module');const f=await fixture();
 try{
  const source=await fs.readFile(path.join(__dirname,'../scripts/tiled-upscale.cjs'),'utf8');
  const start=source.indexOf('async function invokeProvider('),end=source.indexOf('async function generate(',start);
  const script=path.join(f.dir,'fake-provider.cjs'),count=path.join(f.dir,'count');
  const payload=malformed(await png());
  await fs.writeFile(script,`require('node:fs').appendFileSync(${JSON.stringify(count)},'1');process.stderr.write(${JSON.stringify(payload)});process.exitCode=1;`);
  const context={require:createRequire(path.join(__dirname,'../scripts/tiled-upscale.cjs')),spawn:require('node:child_process').spawn,process,Buffer,checkStop(){},stopped:false,child:null};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.invoke=invokeProvider;',context);
  await context.invoke(script,['--out',f.output],{...process.env,IMAGE_GEN_API_KEY:'fake-test-secret'});
  assert.equal(await fs.readFile(count,'utf8'),'1');assert.equal((await sharp(f.output).metadata()).width,8);assert.match(await fs.readFile(f.output+'.provider.json','utf8'),/sse_json_parse_error/);
 }finally{await fs.rm(f.dir,{recursive:true,force:true})}
});
