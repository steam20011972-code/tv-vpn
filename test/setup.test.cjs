const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-setup-'));
process.env.TVVPN_HOME=path.join(tmp,'base');process.env.TVVPN_HOOK_DIR=path.join(tmp,'init.d');
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
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
