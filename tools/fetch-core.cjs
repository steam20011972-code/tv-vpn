'use strict';
// Downloads the sing-box release pinned in core.lock.json into downloads/ and verifies every hash.
const fs=require('fs'),https=require('https'),crypto=require('crypto'),cp=require('child_process'),path=require('path');
const lock=require('../core.lock.json');
const DIR='downloads',archive=path.join(DIR,lock.asset),unpacked=path.join(DIR,lock.directory);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function get(url,file,redirects=5){return new Promise((resolve,reject)=>{
 https.get(url,{headers:{'user-agent':'tv-vpn-fetch-core'}},res=>{
  if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location&&redirects>0){res.resume();return resolve(get(new URL(res.headers.location,url).href,file,redirects-1));}
  if(res.statusCode!==200){res.resume();return reject(Error('Download failed: HTTP '+res.statusCode));}
  const out=fs.createWriteStream(file+'.part');res.pipe(out);out.on('finish',()=>out.close(()=>{fs.renameSync(file+'.part',file);resolve();}));out.on('error',reject);
 }).on('error',reject);
});}
function verified(){return fs.existsSync(path.join(unpacked,'sing-box'))&&sha(path.join(unpacked,'sing-box'))===lock.binarySha256&&sha(path.join(unpacked,'LICENSE'))===lock.licenseSha256;}
async function fetchCore(){
 if(verified())return unpacked;
 fs.mkdirSync(DIR,{recursive:true});
 if(!fs.existsSync(archive)||sha(archive)!==lock.sha256)await get(lock.url,archive);
 if(sha(archive)!==lock.sha256){fs.unlinkSync(archive);throw Error('Core archive SHA256 mismatch');}
 cp.execFileSync('tar',['-xzf',lock.asset],{cwd:DIR,stdio:'inherit'});
 if(!verified())throw Error('Unpacked core does not match core.lock.json');
 return unpacked;
}
module.exports={fetchCore,lock};
if(require.main===module)fetchCore().then(d=>console.log('Core '+lock.version+' '+lock.arch+' verified: '+d)).catch(e=>{console.error(e.message);process.exitCode=1;});
