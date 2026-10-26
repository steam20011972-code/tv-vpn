const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-profiles-'));
process.env.TVVPN_HOME=path.join(tmp,'base');process.env.TVVPN_HOOK_DIR=path.join(tmp,'init.d');
fs.mkdirSync(process.env.TVVPN_HOME);
const C=require('../runtime/common.cjs'),P=require('../runtime/profiles.cjs'),{parse}=require('../tools/profile.cjs');
const BASE=process.env.TVVPN_HOME;
const link=(n,name)=>'vless://00000000-0000-4000-8000-00000000000'+n+'@192.0.2.1'+n+':8443?type=tcp&encryption=none&security=reality&pbk='+('A'.repeat(43))+'&fp=chrome&sni=example.com&sid=abcd&flow=xtls-rprx-vision#'+name;
const first=parse(link(1,'Home')),second=parse(link(2,'Backup'));
const unix=process.platform!=='win32';
test('legacy profile.json migrates into the store as the active profile',()=>{
 fs.writeFileSync(BASE+'/profile.json',JSON.stringify(first),{mode:0o600});
 const l=P.list();
 assert.equal(l.items.length,1);assert.equal(l.active,l.items[0].id);assert.match(l.active,P.ID);
 assert.deepEqual(l.items[0],{id:l.active,name:'Home',kind:'VLESS · Reality · Vision',subscription:false});
 assert.ok(!fs.existsSync(BASE+'/profile.json'));
 assert.deepEqual(P.active(),first);
 if(unix){assert.equal(fs.statSync(BASE+'/profiles').mode&0o777,0o700);assert.equal(fs.statSync(BASE+'/profiles/'+l.active+'.json').mode&0o777,0o600);assert.equal(fs.statSync(BASE+'/profiles/index.json').mode&0o777,0o600);}
});
test('re-importing the same outbound does not duplicate it',()=>{
 const id=P.list().active;
 fs.writeFileSync(BASE+'/profile.json',JSON.stringify({...first,name:'Home renamed'}),{mode:0o600});
 const l=P.list();assert.equal(l.items.length,1);assert.equal(l.active,id);assert.equal(l.items[0].name,'Home renamed');
});
test('list and index hold no secrets',()=>{
 P.add(second);
 const text=JSON.stringify(P.list())+fs.readFileSync(BASE+'/profiles/index.json','utf8');
 for(const secret of [first.outbound.uuid,second.outbound.uuid,first.outbound.server,second.outbound.server,first.outbound.tls.reality.public_key])assert.ok(!text.includes(secret),secret);
});
test('adding keeps the active profile; select switches it; unknown or malformed ids are refused',()=>{
 const l=P.list(),backup=l.items.find(x=>x.name==='Backup').id;
 assert.equal(l.items.length,2);assert.notEqual(l.active,backup);
 assert.equal(P.select(backup),true);assert.equal(P.list().active,backup);assert.deepEqual(P.active(),second);
 for(const bad of ['nothere00','../index','ABCDEFGH12','short',null])assert.equal(P.select(bad),false);
 assert.equal(P.list().active,backup);
});
test('removing the active profile moves active to the next one, then to none',()=>{
 const l=P.list(),other=l.items.find(x=>x.id!==l.active).id;
 assert.equal(P.remove(l.active),true);
 assert.equal(P.list().active,other);assert.ok(!fs.existsSync(BASE+'/profiles/'+l.active+'.json'));
 assert.equal(P.remove('nothere00'),false);
 assert.equal(P.remove(other),true);
 assert.deepEqual(P.list(),{active:null,items:[]});assert.equal(P.active(),null);
});
test('invalid legacy profile is left in place, not imported',()=>{
 fs.writeFileSync(BASE+'/profile.json','{"name":"x"}');
 assert.equal(P.list().items.length,0);assert.ok(fs.existsSync(BASE+'/profile.json'));
 fs.unlinkSync(BASE+'/profile.json');
});
test('uninstall keeps the store unless --delete-profile',()=>{
 P.add(first);fs.mkdirSync(BASE+'/runtime',{recursive:true});
 for(const f of fs.readdirSync('runtime'))fs.copyFileSync('runtime/'+f,BASE+'/runtime/'+f);
 const run=args=>JSON.parse(cp.execFileSync(process.execPath,[path.join(BASE,'runtime/uninstall.cjs'),...args],{env:process.env,encoding:'utf8'}));
 assert.equal(run([]).profileRetained,true);assert.ok(fs.existsSync(BASE+'/profiles/index.json'));
 fs.mkdirSync(BASE+'/runtime',{recursive:true});
 for(const f of fs.readdirSync('runtime'))fs.copyFileSync('runtime/'+f,BASE+'/runtime/'+f);
 assert.equal(run(['--delete-profile']).profileRetained,false);assert.ok(!fs.existsSync(BASE+'/profiles'));
});
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
