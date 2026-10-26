'use strict';
// Turns pasted text, a USB file or a subscription into stored profiles.
// Accepted: share links one per line (protocols.cjs), base64 of such a list, sing-box JSON with outbounds, http(s) subscription URLs.
// Results hold only counters and reason codes: links, names and URLs are never echoed back.
const C=require('./common.cjs'),P=require('./profiles.cjs'),{SCHEMES,parse,fromOutbound}=require('./protocols.cjs');
const MAX_TEXT=65536,MAX_SUBSCRIPTION=1048576,MAX_PROFILES=200,MAX_URLS=3,DAY=86400000;
const USB=process.env.TVVPN_USB_ROOT||'/tmp/usb';
function fail(code){const e=Error(code);e.code=code;return e;}
const REASONS=['invalid-link','unsupported-protocol','unsupported-settings','unsupported-by-core','skip'];
function reason(e){return REASONS.includes(e&&e.code)?e.code:'invalid-link';}
// events.log gets the scheme and protocols.cjs's code and detail, which name fields only, never values.
function note(kind,e){if(reason(e)!=='skip')C.log('link-rejected '+kind+' '+(REASONS.includes(e&&e.code)?String(e.message).replace(/[^\w .:=+\/-]/g,'').slice(0,80):'internal'));return reason(e);}
function base64(text){
 const s=text.replace(/\s+/g,'');if(!/^[A-Za-z0-9+/_-]+=*$/.test(s))return null;
 const out=Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');return out.includes('://')?out:null;
}
// Profiles and subscription URLs found in one body; reasons for everything else.
function scan(text){
 const found={profiles:[],urls:[],rejected:[]};text=String(text).replace(/^\uFEFF/,'').trim();
 if(!text){found.rejected.push('empty');return found;}
 if(text[0]==='{'){
  let j;try{j=JSON.parse(text);}catch{found.rejected.push('unrecognized-format');return found;}
  const list=Array.isArray(j.outbounds)?j.outbounds:j.type?[j]:[];if(!list.length)found.rejected.push('unrecognized-format');
  for(const o of list)try{found.profiles.push(fromOutbound(o));}catch(e){const r=note('json',e);if(r!=='skip')found.rejected.push(r);}
  return found;
 }
 const lines=(text.includes('://')?text:base64(text)||'').split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
 if(!lines.length)found.rejected.push('unrecognized-format');
 for(const line of lines){
  if(/^https?:\/\//i.test(line))found.urls.push(line);
  else if(SCHEMES.test(line))try{found.profiles.push(parse(line));}catch(e){const r=note(line.match(SCHEMES)[1].toLowerCase(),e);if(r!=='skip')found.rejected.push(r);}
  else found.rejected.push(/^[a-z][a-z0-9+.-]*:\/\//i.test(line)?'unsupported-protocol':'unrecognized-format');
 }
 return found;
}
// Panels choose the answer by client: by User-Agent the format, and with a device limit (Remnawave HWID)
// an empty body unless the client sends a device id. We ask as a v2rayN-compatible client (share links)
// with a random per-TV id in BASE/device-id (0600).
const UA='v2rayN/7.0';
function deviceId(){
 const f=C.BASE+'/device-id';try{const id=C.fs.readFileSync(f,'utf8').trim();if(/^[0-9a-f]{32}$/.test(id))return id;}catch{}
 const id=require('crypto').randomBytes(16).toString('hex');C.fs.writeFileSync(f,id,{mode:0o600});return id;
}
// The URL goes to curl through its config on stdin, so the subscription token never appears on a command line.
function curlConfig(url){
 let u;try{u=new URL(url);}catch{return null;}
 if(!/^https?:$/.test(u.protocol)||url.length>2048||/["\\\s\x00-\x1f]/.test(url))return null;
 return ['url = "'+url+'"','user-agent = "'+UA+'"','header = "x-hwid: '+deviceId()+'"','header = "x-device-os: webOS"','header = "x-device-model: LG TV"','write-out = "%{stderr}%{http_code} %{size_download} %{content_type}"',''].join('\n');
}
// Status, size and content type (never the body or URL) go to events.log, so a rejected subscription can be diagnosed.
function download(url){return new Promise((resolve,reject)=>{
 const config=curlConfig(url);if(!config)return reject(fail('subscription-failed'));
 const child=C.cp.execFile('curl',['--silent','--fail','--location','--max-redirs','3','--proto','=http,https','--proto-redir','=http,https','--max-time','15','--max-filesize',String(MAX_SUBSCRIPTION),'-K','-'],{timeout:17000,maxBuffer:MAX_SUBSCRIPTION,encoding:'utf8'},(err,out,meta)=>{
  const [status,size,...type]=String(meta||'').trim().split(' ');
  C.log((err?'subscription-error curl='+(err.code||'?')+' http=':'subscription-response ')+(/^\d{3}$/.test(status)?status:'-')+' '+(/^\d+$/.test(size)?size:'-')+' '+(type.join(' ').replace(/[^\w.+\/;= -]/g,'').slice(0,60)||'-'));
  err?reject(fail('subscription-failed')):resolve(out);
 });
 child.stdin.on('error',()=>{});child.stdin.end(config);
});}
function blank(){return {added:0,updated:0,removed:0,rejected:{},activeChanged:false};}
function count(result,r){result.rejected[r]=(result.rejected[r]||0)+1;}
function merge(result,r){for(const k of ['added','updated','removed'])result[k]+=r[k]||0;if(r.activeChanged)result.activeChanged=true;}
// Fetches a subscription and stores its profiles. Links inside a subscription are taken, further URLs are not followed.
async function subscribe(url,result,fetch){
 const body=await fetch(url);if(!String(body).replace(/^﻿/,'').trim())throw fail('subscription-no-data');
 const found=scan(body);found.rejected.forEach(r=>count(result,r));found.urls.forEach(()=>count(result,'unsupported-protocol'));
 if(!found.profiles.length)throw fail('subscription-empty');
 if(found.profiles.length>MAX_PROFILES)count(result,'too-many');
 merge(result,P.replace(url,found.profiles.slice(0,MAX_PROFILES)));
}
async function importText(text,{fetch=download,result=blank()}={}){
 if(Buffer.byteLength(String(text))>MAX_TEXT){count(result,'too-large');return result;}
 const found=scan(text);found.rejected.forEach(r=>count(result,r));
 if(found.profiles.length>MAX_PROFILES)count(result,'too-many');
 if(found.profiles.length)merge(result,P.addMany(found.profiles.slice(0,MAX_PROFILES)));
 for(const url of found.urls.slice(0,MAX_URLS))try{await subscribe(url,result,fetch);}catch(e){count(result,e.code||'subscription-failed');}
 if(found.urls.length>MAX_URLS)count(result,'too-many');
 return result;
}
// webOS mounts USB storage at /tmp/usb/<disk>/<partition>/; the file is tv-vpn.txt in a partition root.
function usbFiles(){
 const ls=d=>{try{return C.fs.readdirSync(d);}catch{return [];}},out=[];
 for(const disk of ls(USB))for(const part of ls(USB+'/'+disk)){const f=USB+'/'+disk+'/'+part+'/tv-vpn.txt';try{if(C.fs.statSync(f).isFile())out.push(f);}catch{}}
 return out;
}
async function importUsb(opts={}){
 const files=usbFiles();if(!files.length)throw fail('usb-not-found');
 const result=blank();
 for(const f of files){if(C.fs.statSync(f).size>MAX_TEXT){count(result,'too-large');continue;}await importText(C.fs.readFileSync(f,'utf8'),{...opts,result});}
 return {...result,files:files.length};
}
async function refresh(id,{fetch=download}={}){
 const url=P.subscriptionUrl(id);if(!url)throw fail('unknown-subscription');
 const result=blank();await subscribe(url,result,fetch);return result;
}
// Called once after boot: subscriptions older than a day are refreshed; a failure keeps the stored profiles.
async function refreshStale(opts={}){
 const result=blank();
 for(const s of P.subscriptions())if(!s.updatedAt||Date.now()-s.updatedAt>=DAY)try{merge(result,await refresh(s.id,opts));}catch{}
 return result;
}
module.exports={MAX_TEXT,scan,fromOutbound,curlConfig,deviceId,download,importText,importUsb,refresh,refreshStale};
