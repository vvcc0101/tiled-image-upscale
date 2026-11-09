'use strict';
const fs=require('node:fs/promises');
const sharp=require('sharp');
const {createHash,randomUUID}=require('node:crypto');
function parseError(stderr){
 try{return JSON.parse(stderr)}catch{}
 // Node may prepend a warning before the structured error.
 const index=stderr.indexOf('{');
 if(index>=0){try{return JSON.parse(stderr.slice(index))}catch{}}
 return null;
}
async function handleProviderResult({code,stderr='',stdout='',output,secret='',truncated=false}){
 const redact=s=>secret?s.split(secret).join('[REDACTED]'):s;
 const error=parseError(stderr);
 const receipt={exitCode:code,truncated,stdout:redact(stdout),stderr:redact(stderr),recovered:false};
 let receiptPath=output+'.provider.json';
 try { await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2),{flag:'wx'}); }
 catch(e){if(e.code!=='EEXIST')throw e;receiptPath=output+'.'+randomUUID()+'.provider.json';await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2),{flag:'wx'});}
 if(code===0)return {recovered:false,receiptPath};
 let recoveryReason='not an eligible completed-image response';
 // Recover only the observed defect: a valid completed image object followed by
 // an empty, truncated usage object. Never invent missing image JSON or accept
 // arbitrary malformed frames, partial events, HTTP errors, or stream errors.
 if(!truncated&&error?.code==='sse_json_parse_error'&&typeof error.detail?.data==='string'){
  const data=error.detail.data,tail= /,\s*"usage"\s*:\s*\{\s*$/.exec(data);
  if(tail){try{
   const event=JSON.parse(data.slice(0,tail.index)+'}');
   if(!['image_edit.completed','image_generation.completed'].includes(event.type))throw Error('not a completed event');
   const b64=event.b64_json;
   if(typeof b64!=='string'||!b64.length||b64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))throw Error('invalid base64');
   const bytes=Buffer.from(b64,'base64');
   if(bytes.toString('base64')!==b64)throw Error('noncanonical base64');
   if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(-12).toString('hex')!=='0000000049454e44ae426082')throw Error('incomplete PNG');
   const image=sharp(bytes,{limitInputPixels:100_000_000,failOn:'warning'});
   const meta=await image.metadata();await image.raw().toBuffer();
   await fs.writeFile(output,bytes,{flag:'wx'});
   receipt.recovered=true;
   receipt.image={width:meta.width,height:meta.height,sha256:createHash('sha256').update(bytes).digest('hex'),reason:'complete PNG recovered from truncated usage metadata'};
   await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2));
   return {recovered:true,receiptPath};
  }catch(e){recoveryReason=e.code==='EEXIST'?'output already exists':e.message}}
 }
 receipt.recoveryReason=redact(recoveryReason);
 await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2));
 const status=error?.detail?.status;
 const message=redact(String(error?.message||'未识别的生图子进程错误')).slice(0,240);
 throw new Error(`生图接口失败 [${error?.code||'unknown_exit'}${status?' HTTP '+status:''}]：${message}；记录：${receiptPath}。请求可能已计费，不自动重试。`);
}
module.exports={handleProviderResult};
