'use strict';
// In-app installer, run as root through Homebrew Channel exec.
// setup.cjs status | install | uninstall [delete-profile] [--app <installed app directory>]. Prints one JSON line;
// never prints secrets.
// setup:app-option — app/commands.js runs the root-only copy installed in BASE/runtime and names the package with
// --app; the package's own copy (APP = its parent directory) runs only to bootstrap. Keep this marker.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),net=require('net');
// Loaded now, from the copy that runs: after park() moves BASE/runtime, its key is still the installed one.
const SIG=require('./signature.cjs');
let APP=path.dirname(__dirname);
const BASE=process.env.TVVPN_HOME||'/media/developer/tv-vpn';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=file=>{const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.alloc(1<<20);try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
const readJSON=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
function fail(code){const e=Error(code);e.code=code;return e;}
// The app directory is root-owned, but earlier packages (0.6.0 and older) put 0666/0777 modes in it, which the
// installer keeps. Before anything is copied from it: no symlinks, owner root, nothing writable by group or others
// (tightened here when the owner is right). A foreign owner or a link means the package cannot be trusted.
function secureApp(app=APP,owner=0){
 (function walk(p){
  // A hard link would let a file from elsewhere pose as part of the package.
  const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.uid!==owner||!s.isDirectory()&&s.nlink!==1)throw fail('package-unsafe');
  if(s.mode&0o022)fs.chmodSync(p,s.isDirectory()?0o755:0o644);
  if(s.isDirectory())for(const e of fs.readdirSync(p))walk(path.join(p,e));
 })(app);
}
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
 return {ok:true,checks:c,ready:Object.keys(c).every(k=>c[k]),appVersion,installed:installed&&{version:installed.version},current,profile:fs.existsSync(BASE+'/profile.json')||!!(readJSON(BASE+'/profiles/index.json')||{}).active};
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
// The open app polls ctl.cjs, which relaunches a stopped controller (so does the watchdog). Moving the installed
// runtime aside first leaves nothing to relaunch while we stop and replace it; unpark() puts it back after a failure.
// A running supervisor is unaffected: its code is loaded and ownership checks use its original command line.
function park(C){const live=C.BASE+'/runtime',parked=C.BASE+'/runtime.parked';if(fs.existsSync(live)){fs.rmSync(parked,{recursive:true,force:true});fs.renameSync(live,parked);}}
function unpark(C){const live=C.BASE+'/runtime',parked=C.BASE+'/runtime.parked';if(!fs.existsSync(live)&&fs.existsSync(parked))fs.renameSync(parked,live);}
function freeKiB(dir){try{return Number(cp.execFileSync('df',['-kP',dir],{encoding:'utf8',timeout:4000}).trim().split('\n').pop().split(/\s+/)[3]);}catch{return null;}}
// The package's signed file list (runtime/signature.cjs), checked with the key of the running copy. An unsigned
// package is refused unless TVVPN_ALLOW_UNSIGNED=1 (developers installing their own build over SSH).
function signedFiles(app,publicKey){
 try{return SIG.verify(app,publicKey);}catch(e){if(e.code==='package-unsigned'&&process.env.TVVPN_ALLOW_UNSIGNED==='1')return null;throw e.code?e:fail('package-signature');}
}
// Copies runtime, core and boot hook from the app directory into BASE. Idempotent.
// Every copy is hashed again after copying, so a file changed in the app directory after the check is not installed.
function deploy(C,app=APP,{publicKey}={}){
 C.checkBase();
 const signed=signedFiles(app,publicKey),same=(rel,file)=>{if(signed&&signed[rel]!==sha(file))throw fail('package-mismatch');};
 same('core.lock.json',app+'/core.lock.json');same('appinfo.json',app+'/appinfo.json');
 const lock=readJSON(app+'/core.lock.json'),info=readJSON(app+'/appinfo.json');
 if(!lock||!info)throw fail('install-failed');
 const source=app+'/core/sing-box',bin=C.BASE+'/bin',target=bin+'/sing-box';
 if(!fs.existsSync(source)||sha(source)!==lock.binarySha256||signed&&signed['core/sing-box']!==lock.binarySha256)throw fail('core-mismatch');
 fs.mkdirSync(bin,{recursive:true,mode:0o700});fs.chmodSync(C.BASE,0o700);fs.chmodSync(bin,0o700);
 if(!fs.existsSync(target)||sha(target)!==lock.binarySha256){
  const free=freeKiB(C.BASE),need=Math.ceil(fs.statSync(source).size/1024)+16384;
  if(free!==null&&free<need)throw fail('no-space');
  // COPYFILE_EXCL: a file or link already sitting at the name is never written through.
  fs.rmSync(target+'.new',{force:true});fs.copyFileSync(source,target+'.new',fs.constants.COPYFILE_EXCL);fs.chmodSync(target+'.new',0o700);
  if(sha(target+'.new')!==lock.binarySha256){fs.unlinkSync(target+'.new');throw fail('core-mismatch');}
  fs.renameSync(target+'.new',target);
 }
 fs.rmSync(bin+'/LICENSE.new',{force:true});fs.copyFileSync(app+'/core/LICENSE',bin+'/LICENSE.new',fs.constants.COPYFILE_EXCL);fs.chmodSync(bin+'/LICENSE.new',0o600);fs.renameSync(bin+'/LICENSE.new',bin+'/LICENSE');
 const fresh=C.BASE+'/runtime.new',live=C.BASE+'/runtime',old=C.BASE+'/runtime.old';
 fs.rmSync(fresh,{recursive:true,force:true});fs.mkdirSync(fresh,{mode:0o700});
 try{for(const file of fs.readdirSync(app+'/runtime'))if(/\.(cjs|sh)$/.test(file)){fs.copyFileSync(app+'/runtime/'+file,fresh+'/'+file);fs.chmodSync(fresh+'/'+file,file.endsWith('.sh')?0o700:0o600);same('runtime/'+file,fresh+'/'+file);}}
 catch(e){fs.rmSync(fresh,{recursive:true,force:true});throw e;}
 fs.rmSync(old,{recursive:true,force:true});if(fs.existsSync(live))fs.renameSync(live,old);fs.renameSync(fresh,live);fs.rmSync(old,{recursive:true,force:true});fs.rmSync(C.BASE+'/runtime.parked',{recursive:true,force:true});
 const hook=fs.readFileSync(app+'/runtime/70-tv-vpn','utf8');
 if(signed&&signed['runtime/70-tv-vpn']!==SIG.sha(Buffer.from(hook)))throw fail('package-mismatch');
 if(fs.existsSync(C.HOOK)){const existing=fs.readFileSync(C.HOOK,'utf8');if(existing!==hook&&!existing.includes('/media/developer/tv-vpn/runtime/launch.cjs'))throw fail('hook-conflict');}
 fs.mkdirSync(path.dirname(C.HOOK),{recursive:true,mode:0o755});fs.rmSync(C.HOOK+'.new',{force:true});fs.writeFileSync(C.HOOK+'.new',hook,{mode:0o700,flag:'wx'});fs.renameSync(C.HOOK+'.new',C.HOOK);
 C.write('installed.json',{version:info.version,core:lock.version,coreSha256:lock.binarySha256,installedAt:new Date().toISOString()});
 C.harden();
}
async function install(){
 const c=checks();
 if(!c.root)throw fail('not-root');
 if(!Object.keys(c).every(k=>c[k]))throw fail('not-ready');
 // A package that fails the signature check must not even stop the running VPN.
 signedFiles(APP);
 const C=require('./common.cjs');
 const prefs=C.read('preferences.json');
 let wanted;park(C);
 try{wanted=await stopController(C);deploy(C);}catch(e){unpark(C);throw e;}
 // Autostart stays off on a fresh install; an update keeps the user's choices and reconnects if VPN was on.
 C.write('preferences.json',{autostart:!!(prefs&&prefs.autostart),desired:wanted});
 if(wanted)cp.spawn(process.execPath,[C.BASE+'/runtime/launch.cjs','resume'],{detached:true,stdio:'ignore'}).unref();
 C.log('installed '+(readJSON(APP+'/appinfo.json',{}).version||''));
 return {...status(),ok:true};
}
async function uninstall(deleteProfile){
 if(!checks().root)throw fail('not-root');
 const C=require('./common.cjs');
 const script=runtimeFile(C,'uninstall.cjs');park(C);
 try{await stopController(C);cp.execFileSync(process.execPath,[script,...(deleteProfile?['--delete-profile']:[])],{stdio:'ignore',timeout:30000});}
 catch(e){unpark(C);throw e.code?e:fail('uninstall-failed');}
 return {...status(),ok:true,profileRetained:!deleteProfile};
}
// A sibling of this file once park() has run: the installed copy moves with BASE/runtime to runtime.parked.
function runtimeFile(C,name){return path.resolve(__dirname)===path.resolve(C.BASE,'runtime')?path.join(C.BASE,'runtime.parked',name):path.join(__dirname,name);}
// --app <dir>: the installed app directory, required when this is the copy in BASE (else it would install itself).
function appOption(argv){
 const at=argv.indexOf('--app');
 if(at<0){if(path.resolve(APP)===path.resolve(BASE))throw fail('app-required');return argv;}
 const dir=argv[at+1];if(!dir||!path.isAbsolute(dir)||path.normalize(dir)!==dir||path.resolve(dir)===path.resolve(BASE))throw fail('invalid-action');
 APP=dir;return argv.slice(0,at).concat(argv.slice(at+2));
}
module.exports={checks,secureApp,status,park,unpark,deploy,stopController,install,uninstall,runtimeFile,appOption};
if(require.main===module)(async()=>{
 const [action,arg]=appOption(process.argv.slice(2));
 if(checks().root)secureApp();
 if(action==='status')return status();
 if(action==='install'&&!arg)return install();
 if(action==='uninstall'&&(!arg||arg==='delete-profile'||arg==='keep-profile'))return uninstall(arg==='delete-profile');
 throw fail('invalid-action');
// Exit 0 with ok:false so Homebrew exec still hands the error code to the app.
})().then(r=>console.log(JSON.stringify(r)),e=>console.log(JSON.stringify({ok:false,error:e.code||'install-failed'})));
