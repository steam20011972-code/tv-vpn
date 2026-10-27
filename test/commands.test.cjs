const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const K=require('../app/commands.js');
const posix=process.platform!=='win32';

test('ctl commands: fixed actions, checked ids, nothing else reaches the shell',()=>{
 assert.equal(K.ctl('status'),'/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs status');
 assert.equal(K.ctl('select','abcd1234'),'/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs select abcd1234');
 assert.equal(K.ctl('set-autostart','on'),'/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs set-autostart on');
 for(const [a,b] of [['rm',''],['select','abc;reboot'],['select','ABCDEFGH'],['delete',''],['start','x'],['set-autostart','yes'],['status','$(id)']])assert.equal(K.ctl(a,b||undefined),null,a+' '+b);
});
test('setup commands refuse odd actions, arguments and paths',()=>{
 const A='/media/developer/apps/usr/palm/applications/io.github.x.tvvpn';
 assert.ok(K.setup(A,'status'));assert.ok(K.setup(A,'uninstall','keep-profile'));
 for(const [dir,a,b] of [[A,'rm'],[A,'install','now'],['relative/app','status'],['/a b','status'],['/a;reboot','status'],['/a/../b','status'],['/a/$(id)','status']])assert.equal(K.setup(dir,a,b),null,dir+' '+a);
 // The installed copy is recognised by the marker that runtime/setup.cjs carries.
 assert.match(fs.readFileSync(path.join(__dirname,'../runtime/setup.cjs'),'utf8'),/setup:app-option/);
 assert.match(K.setup(A,'status'),/grep -qs setup:app-option \/media\/developer\/tv-vpn\/runtime\/setup\.cjs; then exec \/usr\/bin\/node \/media\/developer\/tv-vpn\/runtime\/setup\.cjs status --app /);
});

// The real command under sh: a stand-in app directory left 0777/0666 the way the webOS installer leaves it.
function sandbox(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-cmd-')),app=path.join(tmp,'app'),base=path.join(tmp,'base');
 fs.mkdirSync(app+'/runtime',{recursive:true});fs.mkdirSync(base);
 for(const f of fs.readdirSync('runtime'))fs.copyFileSync('runtime/'+f,app+'/runtime/'+f);
 fs.writeFileSync(app+'/appinfo.json',JSON.stringify({version:'9.9.9'}));fs.writeFileSync(app+'/core.lock.json','{}');
 for(const f of fs.readdirSync(app+'/runtime'))fs.chmodSync(app+'/runtime/'+f,0o666);
 fs.chmodSync(app+'/runtime',0o777);fs.chmodSync(app,0o777);
 const run=action=>JSON.parse(cp.execFileSync('sh',['-c',K.setup(app,action,null,{base,node:process.execPath,uid:process.getuid()})],{env:{...process.env,TVVPN_HOME:base,TVVPN_HOOK_DIR:path.join(tmp,'init.d')},encoding:'utf8'}).trim().split('\n').pop());
 return {tmp,app,base,run};
}
test('bootstrap: root takes write access away from the app directory before running its setup.cjs',{skip:!posix},()=>{
 const {tmp,app,run}=sandbox();
 const r=run('status');assert.equal(r.ok,true);assert.equal(r.appVersion,'9.9.9');
 assert.equal(fs.statSync(app).mode&0o777,0o755);assert.equal(fs.statSync(app+'/runtime').mode&0o777,0o755);
 assert.equal(fs.statSync(app+'/runtime/setup.cjs').mode&0o777,0o644);
 fs.rmSync(tmp,{recursive:true,force:true});
});
test('bootstrap refuses a package holding a symlink or a hard-linked file, and runs nothing from it',{skip:!posix},()=>{
 for(const plant of [app=>fs.symlinkSync('/etc/hostname',app+'/runtime/extra.cjs'),app=>fs.linkSync(app+'/runtime/setup.cjs',app+'/runtime/setup-copy.cjs')]){
  const {tmp,app,run}=sandbox();plant(app);
  fs.writeFileSync(app+'/runtime/setup.cjs','require("fs").writeFileSync(process.argv[1]+".ran","");console.log("{\\"ok\\":true}")');
  assert.deepEqual(run('status'),{ok:false,error:'package-unsafe'});assert.ok(!fs.existsSync(app+'/runtime/setup.cjs.ran'));
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
test('once installed, the root-only copy in BASE runs and gets the package as --app',{skip:!posix},()=>{
 const {tmp,app,base,run}=sandbox();
 fs.mkdirSync(base+'/runtime');fs.writeFileSync(base+'/runtime/setup.cjs','// setup:app-option\nconsole.log(JSON.stringify({ok:true,from:"base",args:process.argv.slice(2)}))\n');
 assert.deepEqual(run('install'),{ok:true,from:'base',args:['install','--app',app]});
 // The package directory is left as it was: its code was not involved.
 assert.equal(fs.statSync(app).mode&0o777,0o777);
 fs.rmSync(tmp,{recursive:true,force:true});
});
