const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tvvpn-report-'));
const base=path.join(tmp,'base'),nyx=path.join(tmp,'nyx');
for(const d of [base+'/run',base+'/profiles',nyx])fs.mkdirSync(d,{recursive:true});
const json=(file,v)=>fs.writeFileSync(file,JSON.stringify(v));
json(nyx+'/os_info.json',{webos_name:'webOS TV Lite',webos_release:'10.3.1',webos_manufacturing_version:'33.31.61',core_os_kernel_version:'5.4.268',encryption_key_type:'prodkey'});
json(nyx+'/device_info.json',{product_id:'55UA75009LA.BDKS6JD',board_type:'K25_DVB',ram_size:'2 GB',serial_number:'SERIAL123456',nduid:'deadbeefcafe',device_name:'Living room TV',wifi_addr:'aa:bb:cc:dd:ee:ff',p2p_addr:'2a:bb:cc:dd:ee:ff'});
json(base+'/installed.json',{version:'0.6.0',core:'1.14.3',coreSha256:'x',installedAt:'2026-10-26T00:00:00Z'});
json(base+'/run/status.json',{state:'connected',healthy:true,error:null,autostart:true,desired:true,latency:48,exitMatchesServer:true,profile:'Secret Amsterdam',profileKind:'VLESS · Reality · Vision',connectedAt:1});
json(base+'/profiles/index.json',{active:'abcd1234',items:[{id:'abcd1234',name:'Secret Amsterdam',kind:'VLESS · Reality'},{id:'abcd1235',name:'Secret Helsinki',kind:'Trojan · TLS'}],subscriptions:[{id:'s1',count:1,updatedAt:1}]});
fs.writeFileSync(base+'/run/events.log','2026-10-26T18:56:43.508Z connected\n2026-10-26T18:57:00.000Z subscription 200 284 text/html from https://sub.example.com/abc 192.0.2.7 00000000-0000-4000-8000-000000000001\n');

test('report keeps model, versions and state but no names, addresses or ids',()=>{
 const out=cp.execFileSync(process.execPath,[path.join(__dirname,'../runtime/report.cjs')],{env:{...process.env,TVVPN_HOME:base,TVVPN_NYX_DIR:nyx},encoding:'utf8'});
 const r=JSON.parse(out);
 assert.equal(r.tv.model,'55UA75009LA');assert.equal(r.tv.webos_release,'10.3.1');assert.equal(r.tv.ram_size,'2 GB');
 assert.deepEqual(r.installed,{version:'0.6.0',core:'1.14.3'});
 assert.equal(r.status.state,'connected');assert.equal(r.status.profileKind,'VLESS · Reality · Vision');
 assert.deepEqual(r.profiles,{count:2,subscriptions:1});
 assert.equal(typeof r.checks.node,'boolean');
 assert.equal(r.events.length,2);assert.match(r.events[1],/<url> <ip> <uuid>$/);
 for(const secret of ['Secret','SERIAL','deadbeef','Living room','aa:bb','2a:bb','BDKS6JD','example.com','192.0.2.7','00000000-0000','prodkey','abcd1234'])assert.ok(!out.includes(secret),secret);
});
test('report works before installation',()=>{
 const empty=path.join(tmp,'none'),out=cp.execFileSync(process.execPath,[path.join(__dirname,'../runtime/report.cjs')],{env:{...process.env,TVVPN_HOME:empty,TVVPN_NYX_DIR:empty},encoding:'utf8'});
 const r=JSON.parse(out);
 assert.equal(r.installed,null);assert.equal(r.status,null);assert.deepEqual(r.events,[]);assert.equal(fs.existsSync(empty),false);
});
