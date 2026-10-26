'use strict';
const net=require('net'),os=require('os'),C=require('./common.cjs');
const {config}=require('./profile.cjs'),P=require('./profiles.cjs');
const mode=process.argv[2]||'manual';
let prefs=C.preferences(),desired=mode==='boot'?prefs.autostart:(mode==='resume'?prefs.desired:false);
// using: the profile the running core was started with; switching: a select arrived while start/health was busy.
let state={state:'disconnected',healthy:false,error:null,autostart:prefs.autostart,profile:null,profileKind:null},core=null,busy=false,failures=0,retry=0,nextTry=0,lastHealth=0,using=null,switching=false;
const old=C.read('run/supervisor.json');if(old&&C.ownedProcess(old.pid,old.identity,C.BASE+'/runtime/supervisor.cjs'))process.exit(0);
C.harden();
function label(){const item=P.activeItem();state.profile=item?item.name:null;state.profileKind=item?item.kind:null;}
try{label();}catch{}
// ConnMan may not be ready when Homebrew starts us. Keep the controller alive
// and retry recovery before acquiring a new lease instead of losing autostart.
if(!C.cleanup()){state.state='fallback';state.error='recovery-pending';}
C.write('run/supervisor.json',{pid:process.pid,identity:C.processIdentity(process.pid)});
try{C.fs.unlinkSync(C.RUN+'/control.sock');}catch{}
function save(){C.write('run/status.json',{...state,autostart:prefs.autostart,desired,updatedAt:Date.now(),retryAt:nextTry||null});}
function heartbeat(){try{C.fs.writeFileSync(C.RUN+'/heartbeat',String(Math.floor(os.uptime())),{mode:0o600});}catch{}}
heartbeat();setInterval(heartbeat,2000);
function remember(){prefs.desired=desired;C.write('preferences.json',prefs);save();}
function health(){return new Promise(resolve=>{
 const start=Date.now();C.cp.execFile('curl',['-4','--silent','--show-error','--max-time','7','https://www.cloudflare.com/cdn-cgi/trace'],{timeout:8500,maxBuffer:8192},(err,out)=>{const ip=out&&out.match(/^ip=(.+)$/m)?.[1];resolve(!err&&using&&ip===using.outbound.server?{ok:true,exitMatchesServer:true,latency:Date.now()-start}:{ok:false});});
});}
function fallback(error){C.cleanup();core=null;state={...state,state:'fallback',healthy:false,error};failures=0;retry++;nextTry=Date.now()+Math.min(300000,10000*Math.pow(2,Math.min(retry-1,5)));C.log(error);save();}
async function start(){
 if(busy||!desired||state.state==='connected')return;busy=true;state.state='connecting';state.error=null;save();
 try{
  if(!C.cleanup())throw Error('recovery-pending');
  const profile=P.active();label();if(!profile)throw Error('no-profile');using=profile;
  const route=C.command('ip',['-4','route','show','default']);const iface=route.match(/\bdev\s+([a-zA-Z0-9_.:-]+)/)?.[1];if(!iface)throw Error('no-network');
  if(C.rules().some(l=>{const n=parseInt(l);return n>=18000&&n<18100;}))throw Error('route-conflict');
  if(C.command('ip',['-4','route','show','table','20220'],true))throw Error('route-conflict');
  if(C.command('ip',['link','show','tvvpn0'],true))throw Error('route-conflict');
  const addr=C.command('ip',['-4','addr','show']);if(addr.includes('172.30.247.'))throw Error('address-conflict');
  const v6=C.command('ip',['-6','route','show']);if(/(?:^|\n)(?:unreachable )?(?:::\/1|8000::\/1)\s/.test(v6))throw Error('route-conflict');
  const srv=C.service(),previous=C.dnsProperties(srv);
  const localIP=C.command('ip',['-4','-o','addr','show','dev',iface]).match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\//)?.[1];if(!localIP)throw Error('no-network');
  C.write('config.json',config(profile,iface,true,localIP));
  try{C.command(C.BASE+'/bin/sing-box',['check','-c',C.BASE+'/config.json']);}catch{throw Error('invalid-profile');}
  const lease={id:Date.now()+'-'+process.pid,supervisor:process.pid,reserved:true,ipv6:true,iface,localIP,dns:{service:srv,previous,target:localIP}};
  C.write('run/lease.json',lease);heartbeat();
  const wd=C.cp.spawn('/bin/sh',[C.BASE+'/runtime/watchdog.sh',lease.id,String(process.pid)],{detached:true,stdio:'ignore'});wd.unref();
  for(const prefix of ['::/1','8000::/1'])C.command('ip',['-6','route','add','unreachable',prefix,'metric','42760','proto','186']);
  const log=C.fs.openSync(C.RUN+'/core.log','w',0o600);
  core=C.cp.spawn(C.BASE+'/bin/sing-box',['run','-c',C.BASE+'/config.json'],{stdio:['ignore',log,log]});C.fs.closeSync(log);
  lease.corePid=core.pid;lease.coreIdentity=C.processIdentity(core.pid);C.write('run/lease.json',lease);
  await new Promise(r=>setTimeout(r,700));
  if(!C.ownedProcess(core.pid,lease.coreIdentity,C.BASE+'/bin/sing-box'))throw Error('core-start-failed');
  lease.rules=C.rules().filter(l=>parseInt(l)>=18000&&parseInt(l)<18100);C.write('run/lease.json',lease);
  C.command('connmanctl',['config',srv,'--nameservers',localIP]);
  const check=await health();if(!check.ok)throw Error('connection-failed');
  if(!desired){C.cleanup();state.state='disconnected';state.healthy=false;return;}
  state={...state,state:'connected',healthy:true,error:null,latency:check.latency,exitMatchesServer:check.exitMatchesServer,connectedAt:Date.now(),ipv6:'blocked-external'};retry=0;nextTry=0;failures=0;lastHealth=Date.now();C.log('connected');
 }catch(e){fallback(e.message);if(e.message==='invalid-profile'||e.message==='no-profile'){desired=false;remember();}}
 finally{busy=false;save();}
}
// Profile switch: drop the current connection (if any) and let tick() start again with the newly active profile.
function reconnect(){if(busy){switching=true;return;}switching=false;C.cleanup();core=null;state={...state,state:'disconnected',healthy:false,error:null};retry=0;nextTry=0;save();}
async function tick(){
 if(busy)return;
 if(switching){reconnect();if(!desired)return;}
 if(!desired&&C.read('run/lease.json')){C.cleanup();core=null;state={...state,state:'disconnected',healthy:false,error:null};save();return;}
 if(desired&&state.state!=='connected'&&Date.now()>=nextTry){await start();return;}
 if(state.state==='connected'){
  const lease=C.read('run/lease.json');
  if(!lease||!C.ownedProcess(lease.corePid,lease.coreIdentity,C.BASE+'/bin/sing-box')){fallback('core-stopped');return;}
  const route=C.command('ip',['-4','route','show','default'],true);if(!route){fallback('no-network');return;}
  const iface=route.match(/\bdev\s+([a-zA-Z0-9_.:-]+)/)?.[1];
  const localIP=iface&&C.command('ip',['-4','-o','addr','show','dev',iface],true).match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\//)?.[1];
  if(iface!==lease.iface||localIP!==lease.localIP){fallback('network-changed');return;}
  if(Date.now()-lastHealth>=8000){busy=true;lastHealth=Date.now();const h=await health();busy=false;if(!desired){C.cleanup();core=null;state={...state,state:'disconnected',healthy:false,error:null};save();}else if(!h.ok){if(++failures>=2)fallback('connection-lost');}else{failures=0;state.latency=h.latency;state.exitMatchesServer=h.exitMatchesServer;save();}}
  try{if(C.fs.statSync(C.RUN+'/core.log').size>262144)C.fs.truncateSync(C.RUN+'/core.log',0);}catch{}
 }
}
setInterval(()=>tick().catch(()=>fallback('controller-error')),1000);
const server=net.createServer({allowHalfOpen:true},socket=>{let data='';socket.on('data',b=>{data+=b;if(data.length>1024)socket.destroy();});socket.on('end',()=>{
 let req;try{req=JSON.parse(data);}catch{return socket.end('{"ok":false}\n');}
 const answer=(extra={})=>{save();socket.end(JSON.stringify({ok:true,...C.read('run/status.json'),...extra})+'\n');};
 const refuse=error=>socket.end(JSON.stringify({ok:false,error})+'\n');
 try{
 // Profile actions never return secrets: list() holds only id, name and protocol label.
 if(req.action==='profiles'){label();answer({profiles:P.list()});return;}
 if(req.action==='select'){
  if(P.list().active===req.arg){answer({profiles:P.list()});return;}
  if(!P.select(req.arg))return refuse('unknown-profile');
  label();C.log('profile-selected');
  // A running or pending connection moves to the new profile; a stopped VPN stays stopped.
  if(desired||C.read('run/lease.json')){reconnect();void tick();}
  answer({profiles:P.list()});return;
 }
 if(req.action==='delete'){
  if(P.list().active===req.arg&&(desired||C.read('run/lease.json')))return refuse('profile-in-use');
  if(!P.remove(req.arg))return refuse('unknown-profile');
  label();C.log('profile-deleted');answer({profiles:P.list()});return;
 }
 }catch{return refuse('profile-store-error');}
 if(req.action==='start'){desired=true;nextTry=0;remember();answer();void tick();}
 else if(req.action==='stop'||req.action==='restore-network'){desired=false;remember();if(!busy){C.cleanup();state={...state,state:'disconnected',healthy:false,error:null};}else state.state='disconnecting';answer();}
 else if(req.action==='set-autostart'&&['on','off'].includes(req.arg)){prefs.autostart=req.arg==='on';remember();answer();}
 else if(req.action==='status')answer();
 else if(req.action==='diagnostics'){const l=C.read('run/lease.json');socket.end(JSON.stringify({ok:true,...C.read('run/status.json'),coreAlive:!!(l&&C.ownedProcess(l.corePid,l.coreIdentity,C.BASE+'/bin/sing-box')),runtime:process.version,memory:process.memoryUsage().rss,ipv6Policy:'external-blocked-kernel-no-ipv6-policy-routing',dns:'ConnMan -> local DNS listener -> DoH via VPN',events:C.command('tail',['-15',C.RUN+'/events.log'],true)})+'\n');}
 else socket.end('{"ok":false,"error":"Invalid action"}\n');
});socket.on('error',()=>{});});
server.listen(C.RUN+'/control.sock',()=>{C.fs.chmodSync(C.RUN+'/control.sock',0o600);save();void tick();});
async function quit(){desired=false;C.cleanup();try{C.fs.unlinkSync(C.RUN+'/control.sock');}catch{}process.exit(0);}
process.on('SIGTERM',quit);process.on('SIGINT',quit);
