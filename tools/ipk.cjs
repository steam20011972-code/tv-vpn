'use strict';
// Minimal IPK reader (ar archive holding data.tar.gz) so checks do not depend on the host tar.
const fs=require('fs'),zlib=require('zlib');
function ar(buf){
 if(buf.toString('latin1',0,8)!=='!<arch>\n')throw Error('Not an ar archive');
 const out={};for(let p=8;p+60<=buf.length;){const name=buf.toString('latin1',p,p+16).trim().replace(/\/$/,''),size=Number(buf.toString('latin1',p+48,p+58).trim());out[name]=buf.subarray(p+60,p+60+size);p+=60+size+(size%2);}
 return out;
}
function tar(buf){
 const out={};let long=null;
 for(let p=0;p+512<=buf.length;){
  const h=buf.subarray(p,p+512);if(h.every(b=>b===0))break;
  const field=(a,b)=>h.toString('utf8',a,b).replace(/\0.*$/s,'');
  const size=parseInt(field(124,136).trim()||'0',8),type=field(156,157),body=buf.subarray(p+512,p+512+size);
  let name=field(345,500)?field(345,500)+'/'+field(0,100):field(0,100);
  p+=512+Math.ceil(size/512)*512;
  if(type==='L'){long=body.toString('utf8').replace(/\0.*$/s,'');continue;}
  if(type==='x'){const m=body.toString('utf8').match(/\d+ path=([^\n]*)\n/);if(m)long=m[1];continue;}
  if(long){name=long;long=null;}
  if(type==='0'||type==='')out[name.replace(/^\.\//,'')]=body;
 }
 return out;
}
function files(ipk){return tar(zlib.gunzipSync(ar(fs.readFileSync(ipk))['data.tar.gz']));}
module.exports={files};
