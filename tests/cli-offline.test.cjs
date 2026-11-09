'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const sharp=require('sharp');
const core=require('../scripts/image-core.cjs');
const cli=path.resolve(__dirname,'../scripts/tiled-upscale.cjs');
function run(argv,env={}){
 const r=spawnSync(process.execPath,[cli,...argv],{encoding:'utf8',env:{...process.env,...env},windowsHide:true});
 assert.ifError(r.error);let data;try{data=JSON.parse(r.stdout)}catch{}
 return {status:r.status,data,stderr:r.stderr,stdout:r.stdout};
}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tiled-public-cli-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const input=path.join(root,'input.png'),work=path.join(root,'work');
 const pixels=Buffer.alloc(512*512*3);
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*3;pixels[i]=x%256;pixels[i+1]=y%256;pixels[i+2]=(x+y)%256}
 await sharp(pixels,{raw:{width:512,height:512,channels:3}}).png().toFile(input);
 return {root,input,work};
}
test('plan validates scales and public limits',()=>{
 for(const scale of [2,3,4,6,8,10]){const p=core.buildTiledUpscalePlan({width:768,height:1024,scale});assert.equal(p.targetWidth,768*scale);assert.ok(p.tiles.length>0)}
 assert.throws(()=>core.buildTiledUpscalePlan({width:768,height:1024,scale:5}));
 assert.throws(()=>core.buildTiledUpscalePlan({width:20000,height:100,scale:2}));
});
test('offline prepare/import/stitch validates dimensions, interpolation and overwrite protection',async t=>{
 const {root,input,work}=await fixture(t);
 let r=run(['prepare','--input',input,'--scale','2','--work-dir',work]);assert.equal(r.status,0,r.stderr);assert.equal(r.data.total,1);assert.deepEqual(r.data.target,[1024,1024]);
 r=run(['stitch','--work-dir',work,'--output',path.join(root,'missing.png')]);assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/缺少/);
 const crop=path.join(work,'crops/r1c1.png');r=run(['import','--work-dir',work,'--tile','r1c1','--image',crop]);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.data.completed,1);
 r=run(['stitch','--work-dir',work,'--output',path.join(root,'strict.png'),'--no-interpolation']);assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/禁止插值/);
 const out=path.join(root,'result.png');r=run(['stitch','--work-dir',work,'--output',out]);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.data.warning,/插值/);const meta=await sharp(out).metadata();assert.equal(meta.width,1024);assert.equal(meta.height,1024);
 r=run(['stitch','--work-dir',work,'--output',out]);assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/已存在/);
});
test('modified plan is rejected and does not silently reuse cache',async t=>{
 const {input,work}=await fixture(t);assert.equal(run(['prepare','--input',input,'--work-dir',work]).status,0);
 const file=path.join(work,'manifest.json'),m=JSON.parse(await fs.readFile(file,'utf8'));m.plan.tiles[0].x+=1;await fs.writeFile(file,JSON.stringify(m));
 const r=run(['status','--work-dir',work]);assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/计划被修改/);
});
test('full CLI recovers mock truncated response, accepts/cache-reuses image without another call',async t=>{
 const {root,input,work}=await fixture(t),provider=path.join(root,'provider.cjs'),count=path.join(root,'calls');
 // Emits the observed malformed completion using a local crop; no fetch/network.
 await fs.writeFile(provider,`const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(count)},'1');const b=fs.readFileSync(a[a.indexOf('--image')+1]);process.stderr.write(JSON.stringify({code:'sse_json_parse_error',message:'bad JSON',detail:{data:'{"type":"image_edit.completed","b64_json":"'+b.toString('base64')+'","usage":{'}}));process.exitCode=1;`);
 let r=run(['prepare','--input',input,'--work-dir',work,'--provider-script',provider]);assert.equal(r.status,0,r.stdout+r.stderr);
 r=run(['generate','--work-dir',work,'--max-new','1'],{IMAGE_GEN_API_KEY:'offline-fake-key'});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.data.completed,1);assert.equal(r.data.submittedThisRun,1);assert.match(r.stderr,/救回/);
 r=run(['generate','--work-dir',work,'--max-new','1'],{IMAGE_GEN_API_KEY:'offline-fake-key'});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.data.submittedThisRun,0);assert.equal(await fs.readFile(count,'utf8'),'1');
 const receipts=(await fs.readdir(path.join(work,'generated'))).filter(n=>n.endsWith('.provider.json'));assert.equal(receipts.length,1);assert.ok(!(await fs.readFile(path.join(work,'generated',receipts[0]),'utf8')).includes('offline-fake-key'));
});

