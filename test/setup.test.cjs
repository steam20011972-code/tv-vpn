const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-setup-'));
process.env.TVVPN_HOME=path.join(tmp,'base');process.env.TVVPN_HOOK_DIR=path.join(tmp,'init.d');
// Fake packages below are unsigned; the signature tests turn this off.
process.env.TVVPN_ALLOW_UNSIGNED='1';
fs.mkdirSync(process.env.TVVPN_HOME);
const C=require('../runtime/common.cjs'),setup=require('../runtime/setup.cjs');
const BASE=process.env.TVVPN_HOME;
// Fake app directory laid out like the IPK built by tools/build.cjs.
function fakeApp(name,version='9.9.9',core=Buffer.from('fake core '+name)){
 const app=path.join(tmp,name);fs.mkdirSync(app+'/runtime',{recursive:true});fs.mkdirSync(app+'/core');
 for(const f of fs.readdirSync('runtime'))fs.copyFileSync('runtime/'+f,app+'/runtime/'+f);
 fs.writeFileSync(app+'/core/sing-box',core);fs.writeFileSync(app+'/core/LICENSE','license');
 fs.writeFileSync(app+'/core.lock.json',JSON.stringify({version:'1.0.0',binarySha256:crypto.createHash('sha256').update(core).digest('hex')}));
 fs.writeFileSync(app+'/appinfo.json',JSON.stringify({version}));
 return app;
}
const app=fakeApp('app');
test('deploy installs runtime, verified core, boot hook and version marker',()=>{
 fs.writeFileSync(BASE+'/profile.json','{}');fs.chmodSync(BASE+'/profile.json',0o777);
 setup.deploy(C,app);
 if(process.platform!=='win32')assert.equal(fs.statSync(BASE+'/profile.json').mode&0o777,0o600);
 fs.unlinkSync(BASE+'/profile.json');
 for(const f of ['runtime/supervisor.cjs','runtime/watchdog.sh','runtime/setup.cjs','bin/sing-box','bin/LICENSE'])assert.ok(fs.existsSync(BASE+'/'+f),f);
 assert.equal(fs.readFileSync(C.HOOK,'utf8'),fs.readFileSync('runtime/70-tv-vpn','utf8'));
 assert.equal(C.read('installed.json').version,'9.9.9');
 assert.ok(!fs.existsSync(BASE+'/runtime.new')&&!fs.existsSync(BASE+'/runtime.old'));
 if(process.platform!=='win32'){assert.equal(fs.statSync(BASE+'/bin/sing-box').mode&0o777,0o700);assert.equal(fs.statSync(BASE+'/runtime/common.cjs').mode&0o777,0o600);}
 const s=setup.status(app);assert.equal(s.current,true);assert.equal(s.installed.version,'9.9.9');
});
test('deploy is idempotent and does not recopy a matching core',()=>{
 const before=fs.statSync(BASE+'/bin/sing-box').mtimeMs;
 setup.deploy(C,app);
 assert.equal(fs.statSync(BASE+'/bin/sing-box').mtimeMs,before);
 assert.equal(setup.status(app).current,true);
});
test('a newer app version reports the install as outdated',()=>{
 assert.equal(setup.status(fakeApp('newer','10.0.0')).current,false);
});
test('core whose hash differs from core.lock.json is rejected before anything is replaced',()=>{
 const bad=fakeApp('bad','9.9.10');fs.writeFileSync(bad+'/core/sing-box','tampered');
 assert.throws(()=>setup.deploy(C,bad),{code:'core-mismatch'});
 assert.equal(C.read('installed.json').version,'9.9.9');
});
test('foreign boot hook is not overwritten',()=>{
 const saved=fs.readFileSync(C.HOOK);fs.writeFileSync(C.HOOK,'#!/bin/sh\necho other\n');
 assert.throws(()=>setup.deploy(C,app),{code:'hook-conflict'});
 assert.equal(fs.readFileSync(C.HOOK,'utf8'),'#!/bin/sh\necho other\n');
 fs.writeFileSync(C.HOOK,saved);
});
test('stopController is a no-op without a running controller or lease',async()=>{
 await setup.stopController(C);await setup.stopController(C);
});
test('install parks the live runtime so nothing can relaunch it; a failure puts it back, a deploy replaces it',()=>{
 setup.deploy(C,app);
 setup.park(C);
 assert.ok(!fs.existsSync(BASE+'/runtime/launch.cjs')&&fs.existsSync(BASE+'/runtime.parked/launch.cjs'));
 setup.unpark(C);
 assert.ok(fs.existsSync(BASE+'/runtime/launch.cjs')&&!fs.existsSync(BASE+'/runtime.parked'));
 const broken=fakeApp('broken');fs.writeFileSync(broken+'/core/sing-box','tampered');
 setup.park(C);assert.throws(()=>setup.deploy(C,broken),/core-mismatch/);
 setup.unpark(C);assert.ok(fs.existsSync(BASE+'/runtime/launch.cjs'));
 setup.park(C);setup.deploy(C,app);
 assert.ok(fs.existsSync(BASE+'/runtime/launch.cjs')&&!fs.existsSync(BASE+'/runtime.parked'));
});
test('uninstall removes owned files and the hook, keeps the profile unless asked',()=>{
 fs.writeFileSync(BASE+'/profile.json','{}',{mode:0o600});
 const run=args=>JSON.parse(cp.execFileSync(process.execPath,[path.join(BASE,'runtime/uninstall.cjs'),...args],{env:process.env,encoding:'utf8'}));
 assert.equal(run([]).profileRetained,true);
 for(const f of ['runtime','bin','installed.json','preferences.json'])assert.ok(!fs.existsSync(BASE+'/'+f),f);
 assert.ok(!fs.existsSync(C.HOOK));assert.ok(fs.existsSync(BASE+'/profile.json'));
 setup.deploy(C,app);
 assert.equal(run(['--delete-profile']).profileRetained,false);assert.ok(!fs.existsSync(BASE+'/profile.json'));
 assert.equal(setup.status(app).current,false);
});
test('secureApp tightens group/other-writable app files and refuses a foreign owner',{skip:process.platform==='win32'},()=>{
 const loose=fakeApp('loose');fs.chmodSync(loose,0o777);fs.chmodSync(loose+'/runtime',0o777);fs.chmodSync(loose+'/runtime/setup.cjs',0o666);
 setup.secureApp(loose,process.getuid());
 assert.equal(fs.statSync(loose).mode&0o777,0o755);assert.equal(fs.statSync(loose+'/runtime').mode&0o777,0o755);assert.equal(fs.statSync(loose+'/runtime/setup.cjs').mode&0o777,0o644);
 assert.throws(()=>setup.secureApp(loose,process.getuid()+1),{code:'package-unsafe'});
 fs.symlinkSync('/etc/hostname',loose+'/runtime/link.cjs');
 assert.throws(()=>setup.secureApp(loose,process.getuid()),{code:'package-unsafe'});
});
test('write() replaces a link left under the temporary name instead of writing through it',{skip:process.platform==='win32'},()=>{
 const victim=path.join(tmp,'victim.txt');fs.writeFileSync(victim,'keep');
 fs.symlinkSync(victim,BASE+'/state.json.tmp');
 C.write('state.json',{a:1});
 assert.equal(fs.readFileSync(victim,'utf8'),'keep');assert.deepEqual(C.read('state.json'),{a:1});
 assert.ok(!fs.lstatSync(BASE+'/state.json').isSymbolicLink());
});
test('the installed copy needs --app; --app must be an absolute normalized directory other than BASE',()=>{
 setup.deploy(C,app);
 const run=args=>JSON.parse(cp.execFileSync(process.execPath,[path.join(BASE,'runtime/setup.cjs'),...args],{env:process.env,encoding:'utf8'}).trim());
 assert.deepEqual(run(['status']),{ok:false,error:'app-required'});
 const s=run(['status','--app',app]);assert.equal(s.ok,true);assert.equal(s.appVersion,'9.9.9');assert.equal(s.current,true);
 for(const bad of ['relative/app',app+path.sep+'..'+path.sep+'app',BASE])assert.deepEqual(run(['status','--app',bad]),{ok:false,error:'invalid-action'},bad);
 assert.deepEqual(run(['install','--app']),{ok:false,error:'invalid-action'});
});
test('after park() the installed copy finds its siblings in runtime.parked',()=>{
 assert.equal(setup.runtimeFile(C,'uninstall.cjs'),path.join(__dirname,'..','runtime','uninstall.cjs'));
 const installed=require(path.join(BASE,'runtime/setup.cjs'));
 assert.equal(path.resolve(installed.runtimeFile(C,'uninstall.cjs')),path.resolve(BASE,'runtime.parked','uninstall.cjs'));
});
test('signed packages: a valid signature installs; unsigned, foreign-key and altered packages are refused before any change',()=>{
 const SIG=require('../runtime/signature.cjs');
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),other=crypto.generateKeyPairSync('ed25519');
 const signed=(name,key=privateKey)=>{const a=fakeApp(name,'9.9.20');const m=SIG.manifest(a,'9.9.20');fs.writeFileSync(a+'/manifest.json',m);fs.writeFileSync(a+'/manifest.sig',SIG.sign(m,key));return a;};
 delete process.env.TVVPN_ALLOW_UNSIGNED;
 try{
  const before=C.read('installed.json');
  assert.throws(()=>setup.deploy(C,fakeApp('unsigned','9.9.20'),{publicKey}),{code:'package-unsigned'});
  assert.throws(()=>setup.deploy(C,signed('foreign',other.privateKey),{publicKey}),{code:'package-signature'});
  const altered=signed('altered');fs.appendFileSync(altered+'/runtime/supervisor.cjs','\n// changed after signing\n');
  assert.throws(()=>setup.deploy(C,altered,{publicKey}),{code:'package-mismatch'});
  const extra=signed('extra');fs.writeFileSync(extra+'/runtime/added.cjs','');
  assert.throws(()=>setup.deploy(C,extra,{publicKey}),{code:'package-mismatch'});
  assert.deepEqual(C.read('installed.json'),before);assert.ok(!fs.existsSync(BASE+'/runtime.new'));
  setup.deploy(C,signed('good'),{publicKey});assert.equal(C.read('installed.json').version,'9.9.20');
  // The real release key is built in, so a package signed with a test key fails without the option.
  assert.throws(()=>setup.deploy(C,signed('good2')),{code:'package-signature'});
 }finally{process.env.TVVPN_ALLOW_UNSIGNED='1';}
});
test('secureApp refuses a hard-linked file',{skip:process.platform==='win32'},()=>{
 const linked=fakeApp('linked');fs.linkSync(linked+'/runtime/setup.cjs',linked+'/runtime/twin.cjs');
 assert.throws(()=>setup.secureApp(linked,process.getuid()),{code:'package-unsafe'});
});
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
