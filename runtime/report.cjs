'use strict';
// Anonymized report for bug reports: report.cjs prints JSON safe to paste into a public issue.
// Read-only: it starts nothing and changes nothing (it does not load common.cjs, which creates run/).
// Left out on purpose: profile names, servers, links, subscription URLs, LAN/public addresses, serial numbers, MACs.
const fs=require('fs'),path=require('path');
const BASE=process.env.TVVPN_HOME||'/media/developer/tv-vpn',NYX=process.env.TVVPN_NYX_DIR||'/var/run/nyx';
const readJSON=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const pick=(o,keys)=>o?Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])):null;
// Event lines are "<ISO time> <code ...>"; addresses and URLs are masked in case a future event carries one.
function scrub(line){return line.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi,'<url>').replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g,'<ip>').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'<uuid>').replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi,'<mac>');}
function events(n=30){try{return fs.readFileSync(BASE+'/run/events.log','utf8').split('\n').filter(Boolean).slice(-n).map(scrub);}catch{return [];}}
function report(){
 const os=readJSON(NYX+'/os_info.json'),dev=readJSON(NYX+'/device_info.json');
 const app=path.dirname(__dirname),appInfo=readJSON(app+'/appinfo.json');
 const status=readJSON(BASE+'/run/status.json'),index=readJSON(BASE+'/profiles/index.json');
 let checks=null;try{checks=require('./setup.cjs').checks();}catch{}
 return {
  report:1,generatedAt:new Date().toISOString(),
  // product_id is "<model>.<region code>"; only the model is kept.
  tv:{model:dev&&dev.product_id?String(dev.product_id).split('.')[0]:null,...pick(dev,['board_type','ram_size']),...pick(os,['webos_name','webos_release','webos_manufacturing_version','core_os_kernel_version'])},
  node:process.version,arch:process.arch,checks,
  app:appInfo&&appInfo.version||null,installed:pick(readJSON(BASE+'/installed.json'),['version','core']),
  status:pick(status,['state','healthy','error','autostart','desired','latency','exitMatchesServer','profileKind']),
  profiles:index&&Array.isArray(index.items)?{count:index.items.length,subscriptions:(index.subscriptions||[]).length}:null,
  events:events()
 };
}
module.exports={report,scrub};
if(require.main===module)console.log(JSON.stringify(report(),null,1));
