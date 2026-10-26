'use strict';
// In-app installer, run as root through Homebrew Channel exec from the installed app directory.
// setup.cjs status | install | uninstall [delete-profile]. Prints one JSON line; never prints secrets.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),net=require('net');
const APP=path.dirname(__dirname);
const BASE=process.env.TVVPN_HOME||'/media/developer/tv-vpn';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=file=>{const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.alloc(1<<20);try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
const readJSON=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
function fail(code){const e=Error(code);e.code=code;return e;}
function onPath(name){return (process.env.PATH||'/usr/sbin:/usr/bin:/sbin:/bin').split(':').concat(['/usr/sbin','/usr/bin','/sbin','/bin']).some(d=>{try{fs.accessSync(path.join(d,name),fs.constants.X_OK);return true;}catch{return false;}});}
function works(exe,args){try{cp.execFileSync(exe,args,{timeout:4000,stdio:'ignore'});return true;}catch{return false;}}
function checks(){
 const major=Number(process.versions.node.split('.')[0]);
 return {root:!!process.getuid&&process.getuid()===0,arch:process.arch==='arm',node:major>=14,tun:fs.existsSync('/dev/net/tun'),
  ip:works('ip',['-4','rule','show']),connmanctl:onPath('connmanctl')};
}
function status(app=APP){
 const c=checks(),lock=readJSON(app+'/core.lock.json',{}),appVersion=(readJSON(app+'/appinfo.json',{})).version||null;
 const installed=readJSON(BASE+'/installed.json');
 const current=!!installed&&installed.version===appVersion&&installed.coreSha256===lock.binarySha256&&fs.existsSync(BASE+'/runtime/supervisor.cjs')&&fs.existsSync(BASE+'/bin/sing-box');
 return {ok:true,checks:c,ready:Object.keys(c).every(k=>c[k]),appVersion,installed:installed&&{version:installed.version},current,profile:fs.existsSync(BASE+'/profile.json')};
}
function request(sock,action){return new Promise(resolve=>{
 const s=net.createConnection(sock);let data='';
 s.on('connect',()=>s.end(JSON.stringify({action})+'\n'));s.on('data',b=>data+=b);s.on('end',()=>resolve(data));s.on('error',()=>resolve(''));s.setTimeout(5000,()=>{s.destroy();resolve('');});
});}
// Same order as tools/deploy-runtime.cjs: ask the controller to stop, then make sure it and its lease are gone.
// Returns whether VPN was wanted before the stop: after boot the supervisor keeps that only in memory.
async function stopController(C){
 let wanted=!!(C.read('preferences.json')||{}).desired;
 if(fs.existsSync(C.RUN+'/control.sock')){
  try{const live=JSON.parse(await request(C.RUN+'/control.sock','status'));if(live.ok)wanted=!!live.desired;}catch{}
  await request(C.RUN+'/control.sock','stop');
 }
 for(let i=0;i<40&&C.read('run/lease.json');i++)await sleep(250);
 for(let attempt=0;attempt<3;attempt++){
  const s=C.read('run/supervisor.json');if(s)C.killOwned(s.pid,s.identity,C.BASE+'/runtime/supervisor.cjs');
  let recovered=false;for(let i=0;i<10;i++){if(C.cleanup()){recovered=true;break;}await sleep(500);}
  if(!recovered)throw fail('recovery-pending');
  // A watchdog that saw the supervisor die may have relaunched it; stop that one too.
  await sleep(300);const again=C.read('run/supervisor.json');
  if(!again||!C.ownedProcess(again.pid,again.identity,C.BASE+'/runtime/supervisor.cjs'))return wanted;
 }
 throw fail('recovery-pending');
}
function freeKiB(dir){try{return Number(cp.execFileSync('df',['-kP',dir],{encoding:'utf8',timeout:4000}).trim().split('\n').pop().split(/\s+/)[3]);}catch{return null;}}
// Copies runtime, core and boot hook from the app directory into BASE. Idempotent.
function deploy(C,app=APP){
 const lock=readJSON(app+'/core.lock.json'),info=readJSON(app+'/appinfo.json');
 if(!lock||!info)throw fail('install-failed');
 const source=app+'/core/sing-box',bin=C.BASE+'/bin',target=bin+'/sing-box';
 if(!fs.existsSync(source)||sha(source)!==lock.binarySha256)throw fail('core-mismatch');
 fs.mkdirSync(bin,{recursive:true,mode:0o700});fs.chmodSync(C.BASE,0o700);fs.chmodSync(bin,0o700);
 if(!fs.existsSync(target)||sha(target)!==lock.binarySha256){
  const free=freeKiB(C.BASE),need=Math.ceil(fs.statSync(source).size/1024)+16384;
  if(free!==null&&free<need)throw fail('no-space');
  fs.copyFileSync(source,target+'.new');fs.chmodSync(target+'.new',0o700);
  if(sha(target+'.new')!==lock.binarySha256){fs.unlinkSync(target+'.new');throw fail('core-mismatch');}
  fs.renameSync(target+'.new',target);
 }
 fs.copyFileSync(app+'/core/LICENSE',bin+'/LICENSE');fs.chmodSync(bin+'/LICENSE',0o600);
 const fresh=C.BASE+'/runtime.new',live=C.BASE+'/runtime',old=C.BASE+'/runtime.old';
 fs.rmSync(fresh,{recursive:true,force:true});fs.mkdirSync(fresh,{mode:0o700});
 for(const file of fs.readdirSync(app+'/runtime'))if(/\.(cjs|sh)$/.test(file)){fs.copyFileSync(app+'/runtime/'+file,fresh+'/'+file);fs.chmodSync(fresh+'/'+file,file.endsWith('.sh')?0o700:0o600);}
 fs.rmSync(old,{recursive:true,force:true});if(fs.existsSync(live))fs.renameSync(live,old);fs.renameSync(fresh,live);fs.rmSync(old,{recursive:true,force:true});
 const hook=fs.readFileSync(app+'/runtime/70-tv-vpn','utf8');
 if(fs.existsSync(C.HOOK)){const existing=fs.readFileSync(C.HOOK,'utf8');if(existing!==hook&&!existing.includes('/media/developer/tv-vpn/runtime/launch.cjs'))throw fail('hook-conflict');}
 fs.mkdirSync(path.dirname(C.HOOK),{recursive:true});fs.writeFileSync(C.HOOK+'.new',hook,{mode:0o700});fs.renameSync(C.HOOK+'.new',C.HOOK);
 C.write('installed.json',{version:info.version,core:lock.version,coreSha256:lock.binarySha256,installedAt:new Date().toISOString()});
 C.harden();
}
async function install(){
 const c=checks();
 if(!c.root)throw fail('not-root');
 if(!Object.keys(c).every(k=>c[k]))throw fail('not-ready');
 const C=require('./common.cjs');
 const prefs=C.read('preferences.json');
 const wanted=await stopController(C);
 deploy(C);
 // Autostart stays off on a fresh install; an update keeps the user's choices and reconnects if VPN was on.
 C.write('preferences.json',{autostart:!!(prefs&&prefs.autostart),desired:wanted});
 if(wanted)cp.spawn(process.execPath,[C.BASE+'/runtime/launch.cjs','resume'],{detached:true,stdio:'ignore'}).unref();
 C.log('installed '+(readJSON(APP+'/appinfo.json',{}).version||''));
 return {...status(),ok:true};
}
async function uninstall(deleteProfile){
 if(!checks().root)throw fail('not-root');
 const C=require('./common.cjs');
 await stopController(C);
 try{cp.execFileSync(process.execPath,[__dirname+'/uninstall.cjs',...(deleteProfile?['--delete-profile']:[])],{stdio:'ignore',timeout:30000});}catch{throw fail('uninstall-failed');}
 return {...status(),ok:true,profileRetained:!deleteProfile};
}
module.exports={checks,status,deploy,stopController,install,uninstall};
if(require.main===module)(async()=>{
 const [action,arg]=process.argv.slice(2);
 if(action==='status')return status();
 if(action==='install'&&!arg)return install();
 if(action==='uninstall'&&(!arg||arg==='delete-profile'||arg==='keep-profile'))return uninstall(arg==='delete-profile');
 throw fail('invalid-action');
// Exit 0 with ok:false so Homebrew exec still hands the error code to the app.
})().then(r=>console.log(JSON.stringify(r)),e=>console.log(JSON.stringify({ok:false,error:e.code||'install-failed'})));
