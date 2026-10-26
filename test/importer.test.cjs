const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-import-'));
process.env.TVVPN_HOME=path.join(tmp,'base');process.env.TVVPN_HOOK_DIR=path.join(tmp,'init.d');process.env.TVVPN_USB_ROOT=path.join(tmp,'usb');
fs.mkdirSync(process.env.TVVPN_HOME);
const P=require('../runtime/profiles.cjs'),I=require('../runtime/importer.cjs');
const BASE=process.env.TVVPN_HOME,unix=process.platform!=='win32';
const link=(n,name,key='A')=>'vless://00000000-0000-4000-8000-00000000000'+n+'@192.0.2.1'+n+':8443?type=tcp&encryption=none&security=reality&pbk='+key.repeat(43)+'&fp=chrome&sni=example.com&sid=abcd&flow=xtls-rprx-vision#'+encodeURIComponent(name);
const SUB='https://sub.example.com/s/0123456789abcdef';
const reset=()=>fs.rmSync(BASE+'/profiles',{recursive:true,force:true});
const fetchFrom=bodies=>async url=>{if(!(url in bodies))throw Object.assign(Error('subscription-failed'),{code:'subscription-failed'});return bodies[url];};

test('plain list: links are taken, other schemes and junk are rejected by reason',()=>{
 const f=I.scan([link(1,'One'),'# comment','wireguard://abc','hello',link(2,'Two'),link(3,'Bad').replace('sid=abcd','sid=abc'),link(4,'Ws').replace('type=tcp','type=ws'),SUB].join('\r\n'));
 assert.deepEqual(f.profiles.map(p=>p.name),['One','Two']);
 assert.deepEqual(f.urls,[SUB]);
 assert.deepEqual(f.rejected.sort(),['invalid-link','unrecognized-format','unsupported-protocol','unsupported-settings']);
});
test('base64 list (standard and URL-safe) decodes to links',()=>{
 const text=link(1,'Один')+'\n'+link(2,'Два');
 assert.equal(I.scan(Buffer.from(text).toString('base64')).profiles.length,2);
 assert.equal(I.scan(Buffer.from(text).toString('base64url')).profiles.length,2);
 assert.deepEqual(I.scan('bm90IGEgbGluaw==').rejected,['unrecognized-format']);
});
test('sing-box JSON: vless Reality outbounds kept, groups skipped, others rejected',()=>{
 const good={type:'vless',tag:'NL',server:'192.0.2.20',server_port:443,uuid:'00000000-0000-4000-8000-000000000020',flow:'xtls-rprx-vision',tls:{enabled:true,server_name:'example.com',utls:{enabled:true,fingerprint:'firefox'},reality:{enabled:true,public_key:'B'.repeat(43),short_id:'ab'}}};
 const f=I.scan(JSON.stringify({outbounds:[{type:'selector',tag:'proxy',outbounds:['NL']},good,{type:'wireguard',tag:'x'},{...good,transport:{type:'ws'}},{type:'direct',tag:'direct'}]}));
 assert.equal(f.profiles.length,1);
 assert.deepEqual(f.profiles[0].outbound,{type:'vless',tag:'proxy',server:'192.0.2.20',server_port:443,uuid:good.uuid,flow:'xtls-rprx-vision',tls:{enabled:true,server_name:'example.com',utls:{enabled:true,fingerprint:'firefox'},reality:{enabled:true,public_key:'B'.repeat(43),short_id:'ab'}}});
 assert.equal(f.profiles[0].name,'NL');
 assert.deepEqual(f.rejected.sort(),['unsupported-protocol','unsupported-settings']);
 assert.deepEqual(I.scan('{broken').rejected,['unrecognized-format']);
});
test('pasted links are stored; results hold counters only, no secrets',async()=>{
 reset();
 const r=await I.importText(link(1,'One')+'\n'+link(2,'Two')+'\n'+link(1,'One again')+'\nwireguard://x@y:1');
 assert.deepEqual(r,{added:2,updated:0,removed:0,rejected:{'unsupported-protocol':1},activeChanged:false});
 assert.equal(P.list().items.length,2);
 const again=await I.importText(link(1,'One'));assert.equal(again.added,0);assert.equal(again.updated,1);
});
test('subscription: profiles stored, URL kept only in its own 0600 file',async()=>{
 reset();
 const r=await I.importText(SUB,{fetch:fetchFrom({[SUB]:Buffer.from(link(1,'NL')+'\n'+link(2,'FI')).toString('base64')})});
 assert.equal(r.added,2);
 const l=P.list();assert.equal(l.subscriptions.length,1);assert.equal(l.subscriptions[0].count,2);assert.ok(l.items.every(x=>x.subscription));
 const visible=JSON.stringify(l)+fs.readFileSync(BASE+'/profiles/index.json','utf8')+JSON.stringify(r);
 for(const secret of ['sub.example.com','0123456789abcdef','00000000-0000-4000-8000-000000000001','192.0.2.11'])assert.ok(!visible.includes(secret),secret);
 assert.equal(P.subscriptionUrl(l.subscriptions[0].id),SUB);
 if(unix)assert.equal(fs.statSync(BASE+'/profiles/sub-'+l.subscriptions[0].id+'.json').mode&0o777,0o600);
});
test('refresh: removed profiles go, the active one follows its name when credentials rotate',async()=>{
 const l=P.list(),sub=l.subscriptions[0].id,nl=l.items.find(x=>x.name==='NL').id;
 assert.equal(P.select(nl),true);
 const r=await I.refresh(sub,{fetch:fetchFrom({[SUB]:link(3,'NL','C')+'\n'+link(4,'DE')})});
 assert.deepEqual({added:r.added,removed:r.removed,activeChanged:r.activeChanged},{added:2,removed:2,activeChanged:true});
 const after=P.list();assert.deepEqual(after.items.map(x=>x.name).sort(),['DE','NL']);
 assert.notEqual(after.active,nl);assert.equal(after.items.find(x=>x.id===after.active).name,'NL');assert.equal(P.active().outbound.server,'192.0.2.13');
});
test('refresh keeps the active profile when it vanished; failures and empty lists change nothing',async()=>{
 const sub=P.list().subscriptions[0].id,active=P.list().active;
 const r=await I.refresh(sub,{fetch:fetchFrom({[SUB]:link(4,'DE')})});
 assert.equal(r.activeChanged,false);assert.equal(P.list().active,active);assert.equal(P.list().items.length,2);
 const before=fs.readFileSync(BASE+'/profiles/index.json','utf8');
 await assert.rejects(I.refresh(sub,{fetch:fetchFrom({})}),{code:'subscription-failed'});
 await assert.rejects(I.refresh(sub,{fetch:fetchFrom({[SUB]:'nothing here'})}),{code:'subscription-empty'});
 await assert.rejects(I.refresh('nothere00'),{code:'unknown-subscription'});
 assert.equal(fs.readFileSync(BASE+'/profiles/index.json','utf8'),before);
});
test('refreshStale skips subscriptions updated within a day',async()=>{
 let calls=0;const r=await I.refreshStale({fetch:async()=>{calls++;return link(4,'DE');}});
 assert.equal(calls,0);assert.equal(r.added,0);
});
test('deleting the last profile of a subscription removes the subscription and its URL file',()=>{
 const sub=P.list().subscriptions[0].id;
 for(const it of P.list().items)P.remove(it.id);
 assert.deepEqual(P.list().subscriptions,[]);assert.ok(!fs.existsSync(BASE+'/profiles/sub-'+sub+'.json'));
});
test('limits: oversized text, more than three subscription URLs',async()=>{
 assert.deepEqual((await I.importText('x'.repeat(I.MAX_TEXT+1))).rejected,{'too-large':1});
 const urls=[1,2,3,4].map(n=>'https://example.com/'+n),r=await I.importText(urls.join('\n'),{fetch:fetchFrom({})});
 assert.deepEqual(r.rejected,{'subscription-failed':3,'too-many':1});
});
test('download refuses non-http schemes and characters that could escape the curl config',async()=>{
 for(const bad of ['file:///etc/passwd','https://example.com/"\nurl = "http://evil','https://example.com/a b','ftp://example.com/'])await assert.rejects(I.download(bad),{code:'subscription-failed'});
});
test('USB: tv-vpn.txt in a partition root is imported; none found is an error',async()=>{
 reset();
 await assert.rejects(I.importUsb(),{code:'usb-not-found'});
 const part=path.join(process.env.TVVPN_USB_ROOT,'sda','sda1');fs.mkdirSync(part,{recursive:true});
 fs.writeFileSync(path.join(part,'tv-vpn.txt'),link(5,'USB'));
 const r=await I.importUsb();assert.equal(r.files,1);assert.equal(r.added,1);assert.equal(P.list().items[0].name,'USB');
 fs.writeFileSync(path.join(part,'tv-vpn.txt'),'x'.repeat(I.MAX_TEXT+1));
 assert.deepEqual((await I.importUsb()).rejected,{'too-large':1});
});
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
test('every supported scheme is imported from one list; Xray-only transports get their own reason',async()=>{
 reset();
 const id='00000000-0000-4000-8000-0000000000aa',ss=Buffer.from('aes-256-gcm:pw').toString('base64url');
 const vm=Buffer.from(JSON.stringify({add:'192.0.2.51',port:443,id,net:'ws',path:'/v',tls:'tls',ps:'VM'})).toString('base64');
 const text=['trojan://pw@192.0.2.50:443#TR','vmess://'+vm,'ss://'+ss+'@192.0.2.52:8388#SS','hy2://pw@192.0.2.53:443#HY','tuic://'+id+':pw@192.0.2.54:443?alpn=h3#TU','vless://'+id+'@192.0.2.55:443?type=xhttp&security=tls'].join('\n');
 const r=await I.importText(Buffer.from(text).toString('base64'));
 assert.equal(r.added,5);assert.deepEqual(r.rejected,{'unsupported-by-core':1});
 assert.deepEqual(P.list().items.map(x=>x.kind).sort(),['Hysteria2','Shadowsocks','TUIC','Trojan · TLS','VMess · TLS · WS']);
 const visible=fs.readFileSync(BASE+'/profiles/index.json','utf8');for(const s of ['pw',id,'192.0.2.5'])assert.ok(!visible.includes(s),s);
});
test('subscription client: v2rayN user agent, stable 0600 device id, empty body has its own reason',async()=>{
 const cfg=I.curlConfig(SUB),id=I.deviceId();
 assert.match(id,/^[0-9a-f]{32}$/);assert.equal(I.deviceId(),id);
 if(unix)assert.equal(fs.statSync(BASE+'/device-id').mode&0o777,0o600);
 assert.ok(cfg.includes('user-agent = "v2rayN/7.0"'));assert.ok(cfg.includes('header = "x-hwid: '+id+'"'));
 assert.equal(cfg.split('\n').filter(l=>l.startsWith('url = ')).length,1);
 assert.equal(I.curlConfig('https://example.com/"\nurl = "http://evil'),null);
 reset();
 const r=await I.importText(SUB,{fetch:fetchFrom({[SUB]:'\uFEFF \n'})});
 assert.deepEqual(r.rejected,{'subscription-no-data':1});assert.equal(P.list().items.length,0);
});
