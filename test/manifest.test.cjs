const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {manifest}=require('../tools/manifest.cjs'),app=require('../app/appinfo.json');
const file=`${app.id}_${app.version}_all.ipk`;
function dist(body,sum){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-manifest-'));
 fs.writeFileSync(path.join(dir,file),body);
 fs.writeFileSync(path.join(dir,file+'.sha256'),(sum||crypto.createHash('sha256').update(body).digest('hex'))+'  '+file+'\n');
 return dir;
}

test('manifest describes the built IPK for Homebrew Channel',()=>{
 const body=Buffer.from('fake ipk'),dir=dist(body),m=manifest(dir);
 const want=fs.readFileSync(path.join(dir,file+'.sha256'),'utf8').split(' ')[0];
 assert.deepEqual(Object.keys(m),['id','version','type','title','appDescription','iconUri','sourceUrl','rootRequired','ipkUrl','ipkHash','ipkSize']);
 assert.equal(m.id,app.id);assert.equal(m.version,app.version);assert.equal(m.type,'web');assert.equal(m.title,app.title);assert.equal(m.appDescription,app.appDescription);
 assert.equal(m.rootRequired,true);
 assert.deepEqual(m.ipkHash,{sha256:want});assert.equal(m.ipkSize,body.length);
 assert.equal(m.ipkUrl,`${m.sourceUrl}/releases/download/v${app.version}/${file}`);
 assert.match(m.sourceUrl,/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
 assert.match(m.iconUri,new RegExp(`^https://raw\\.githubusercontent\\.com/[^/]+/[^/]+/v${app.version.replace(/\./g,'\\.')}/app/icon\\.png$`));
 fs.rmSync(dir,{recursive:true,force:true});
});

test('manifest refuses a .sha256 that does not match the IPK',()=>{
 const dir=dist(Buffer.from('fake ipk'),'0'.repeat(64));
 assert.throws(()=>manifest(dir),/does not match/);
 fs.rmSync(dir,{recursive:true,force:true});
});
