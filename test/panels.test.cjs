// Share links as four panels generate them (source read 2026-10-26), with test data only:
// Marzban app/subscription/v2ray.py, 3x-ui internal/sub/service.go, Remnawave
// src/modules/subscription-template/generators/xray.generator.service.ts, Hiddify hutils/proxy/xray.py.
// Each builder copies the panel's parameter order and encoding, so a change in our parser shows up here.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../runtime/protocols.cjs'),{config}=require('../runtime/profile.cjs');
const ID='00000000-0000-4000-8000-0000000000aa',KEY='B'.repeat(43),S='192.0.2.40',D='vpn.example.com';
// Python urllib.parse: urlencode (quote_plus) and quote (safe "/"); Go url.Values.Encode (sorted, QueryEscape).
const plus=s=>encodeURIComponent(s).replace(/%20/g,'+').replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const urlencode=o=>Object.entries(o).map(([k,v])=>plus(k)+'='+plus(String(v))).join('&');
const quote=s=>encodeURIComponent(s).replace(/%2F/g,'/');
const goValues=o=>Object.keys(o).sort().map(k=>plus(k)+'='+plus(String(o[k]))).join('&');
const jsQuery=o=>Object.entries(o).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');
const b64=s=>Buffer.from(s).toString('base64');
const code=(fn,c)=>assert.throws(fn,e=>e.code===c,c);
const reality={enabled:true,utls:{enabled:true,fingerprint:'chrome'},reality:{enabled:true,public_key:KEY,short_id:'ab'}};

test('Marzban: VLESS Reality TCP with empty path/host and headerType, spx',()=>{
 const p=parse(`vless://${ID}@${S}:443?`+urlencode({security:'reality',type:'tcp',headerType:'',flow:'xtls-rprx-vision',path:'',host:'',sni:'example.com',fp:'chrome',pbk:KEY,sid:'ab',spx:'/'})+'#'+quote('Marzban NL'));
 assert.equal(p.name,'Marzban NL');
 assert.deepEqual(p.outbound,{type:'vless',tag:'proxy',server:S,server_port:443,uuid:ID,flow:'xtls-rprx-vision',tls:{enabled:true,server_name:'example.com',...reality}});
 assert.deepEqual(p.warnings,['Xray spiderX is not used by sing-box.']);
});
test('Marzban: VLESS WS TLS with alpn h2,http/1.1 (h2 dropped for WebSocket), gRPC with authority, VMess, Trojan, Shadowsocks',()=>{
 const ws=parse(`vless://${ID}@${D}:443?`+urlencode({security:'tls',type:'ws',headerType:'',path:'/ws',host:'cdn.example.com',sni:'cdn.example.com',fp:'chrome',alpn:'h2,http/1.1'})+'#ws').outbound;
 assert.deepEqual(ws.tls,{enabled:true,server_name:'cdn.example.com',alpn:['http/1.1'],utls:{enabled:true,fingerprint:'chrome'}});
 assert.deepEqual(ws.transport,{type:'ws',path:'/ws',headers:{Host:'cdn.example.com'}});
 const grpc=parse(`vless://${ID}@${D}:443?`+urlencode({security:'tls',type:'grpc',headerType:'',serviceName:'svc',authority:D,mode:'gun',sni:D,fp:'chrome'})+'#g').outbound;
 assert.deepEqual(grpc.transport,{type:'grpc',service_name:'svc'});
 code(()=>parse(`vless://${ID}@${D}:443?`+urlencode({security:'tls',type:'grpc',serviceName:'svc',authority:'other.example.com',mode:'gun',sni:D})),'unsupported-settings');
 code(()=>parse(`vless://${ID}@${D}:443?`+urlencode({security:'tls',type:'grpc',serviceName:'svc',authority:'',mode:'multi',sni:D})),'unsupported-settings');
 const vmessJson={add:D,aid:'0',host:'cdn.example.com',id:ID,net:'ws',path:'/vm',port:443,ps:'VM',scy:'auto',sni:'cdn.example.com',fp:'chrome',tls:'tls',type:'',v:'2'};
 const vm=parse('vmess://'+b64(JSON.stringify(vmessJson,Object.keys(vmessJson).sort())));
 assert.equal(vm.name,'VM');assert.deepEqual(vm.outbound.transport,{type:'ws',path:'/vm',headers:{Host:'cdn.example.com'}});
 const tr=parse(`trojan://${quote('p@ss:word')}@${S}:443?`+urlencode({security:'reality',type:'tcp',headerType:'',path:'',host:'',sni:'example.com',fp:'chrome',pbk:KEY,sid:'ab'})+'#tr').outbound;
 assert.equal(tr.password,'p@ss:word');assert.deepEqual(tr.tls,{enabled:true,server_name:'example.com',...reality});
 const ss=parse('ss://'+b64('chacha20-ietf-poly1305:pass/with+chars')+`@${S}:8388#`+quote('Marzban SS')).outbound;
 assert.deepEqual({m:ss.method,p:ss.password},{m:'chacha20-ietf-poly1305',p:'pass/with+chars'});
});
test('Marzban: xhttp, kcp and quic transports are reported, not silently changed',()=>{
 code(()=>parse(`vless://${ID}@${D}:443?`+urlencode({security:'tls',type:'xhttp',headerType:'',path:'/x',host:D,mode:'auto',extra:'{"xPaddingBytes":"100-1000"}',sni:D})),'unsupported-by-core');
 code(()=>parse(`vless://${ID}@${D}:443?`+urlencode({security:'none',type:'kcp',headerType:'none',seed:'s',host:''})),'unsupported-by-core');
 code(()=>parse(`vless://${ID}@${D}:443?`+urlencode({security:'tls',type:'quic',headerType:'none',key:'',quicSecurity:'none',sni:D})),'unsupported-settings');
});
test('3x-ui: VLESS Reality with spx, support-x25519mlkem768 and pqv; TLS with vcn, pcs and cs',()=>{
 const p=parse(`vless://${ID}@${S}:443?`+goValues({type:'tcp',encryption:'none',security:'reality',sni:'example.com',pbk:KEY,sid:'ab',fp:'chrome',pqv:'Q'.repeat(40),spx:'/x7Ab','support-x25519mlkem768':'true',flow:'xtls-rprx-vision'})+'#'+encodeURIComponent('3x-ui NL'));
 assert.deepEqual(p.outbound.tls,{enabled:true,server_name:'example.com',...reality});
 assert.deepEqual(p.warnings.sort(),['Reality ML-DSA verification is not done by sing-box.','Xray spiderX is not used by sing-box.']);
 const t=parse(`vless://${ID}@${D}:443?`+goValues({type:'httpupgrade',encryption:'none',path:'/up',host:D,security:'tls',alpn:'h2,http/1.1',sni:D,fp:'firefox',vcn:D,pcs:'ab'.repeat(32),cs:'TLS_AES_128_GCM_SHA256'}));
 assert.deepEqual(t.outbound.tls,{enabled:true,server_name:D,alpn:['http/1.1'],utls:{enabled:true,fingerprint:'firefox'}});
 assert.deepEqual(t.warnings,['The certificate pin is not checked; the certificate is verified normally.']);
 code(()=>parse(`vless://${ID}@${D}:443?`+goValues({type:'ws',security:'tls',sni:D,pcs:'ab'.repeat(32),allowInsecure:'1'})),'unsupported-settings');
 code(()=>parse(`vless://${ID}@${D}:443?`+goValues({type:'ws',security:'tls',sni:D,ech:'AEX+/w=='})),'unsupported-settings');
 code(()=>parse(`vless://${ID}@${D}:443?`+goValues({type:'tcp',security:'tls',sni:D,fm:'{"tcp":[{"type":"fragment","settings":{"packets":"tlshello"}}]}'})),'unsupported-by-core');
});
test('3x-ui: Shadowsocks 2022 multi-user (percent-encoded keys), Trojan without flow, Hysteria2, TUIC',()=>{
 const ss=parse('ss://'+['2022-blake3-aes-128-gcm','c2VydmVyLWtleS0xNmJ5dA==','dXNlci1rZXktMTYtYnl0ZQ=='].map(plus).join(':')+`@${S}:443?`+goValues({type:'tcp'})+'#ss').outbound;
 assert.deepEqual({m:ss.method,p:ss.password},{m:'2022-blake3-aes-128-gcm',p:'c2VydmVyLWtleS0xNmJ5dA==:dXNlci1rZXktMTYtYnl0ZQ=='});
 code(()=>parse('ss://'+b64('aes-256-gcm:pw')+`@${S}:443?`+goValues({type:'ws',path:'/s'})),'unsupported-settings');
 code(()=>parse('ss://'+b64('aes-256-gcm:pw')+`@${S}:443?`+goValues({type:'tcp',security:'tls',sni:D})),'unsupported-settings');
 assert.equal(parse(`trojan://pw@${S}:443?`+goValues({type:'tcp',security:'reality',sni:'example.com',pbk:KEY,sid:'ab',fp:'chrome',spx:'/a'})).outbound.type,'trojan');
 code(()=>parse(`trojan://pw@${S}:443?`+goValues({type:'tcp',security:'tls',sni:D,flow:'xtls-rprx-vision'})),'unsupported-settings');
 const hy=parse(`hysteria2://${encodeURIComponent('auth')}@${D}:443?`+goValues({security:'tls',alpn:'h3',sni:D,fp:'chrome',obfs:'salamander','obfs-password':'ob/pw+1',mport:'20000-30000'})+'#hy').outbound;
 assert.deepEqual(hy,{type:'hysteria2',tag:'proxy',server:D,server_port:443,server_ports:['20000:30000'],password:'auth',obfs:{type:'salamander',password:'ob/pw+1'},tls:{enabled:true,server_name:D,alpn:['h3']}});
 const gecko=parse(`hysteria2://auth@${D}:443?`+goValues({security:'tls',sni:D,obfs:'gecko',minPacketSize:'512',maxPacketSize:'1200','obfs-password':'g'})).outbound.obfs;
 assert.deepEqual(gecko,{type:'gecko',password:'g',min_packet_size:512,max_packet_size:1200});
 const tuic=parse(`tuic://${ID}:${encodeURIComponent('p:w')}@${D}:443?`+goValues({congestion_control:'bbr',alpn:'h3',sni:D,udp_relay_mode:'native',allow_insecure:'0'})).outbound;
 assert.deepEqual({p:tuic.password,tls:tuic.tls},{p:'p:w',tls:{enabled:true,server_name:D,alpn:['h3']}});
});
test('Remnawave: VLESS Reality, Trojan WS, Shadowsocks with standard base64, Hysteria2 with salamander finalmask',()=>{
 const v=parse(`vless://${ID}@${S}:443?`+jsQuery({flow:'xtls-rprx-vision',type:'tcp',security:'reality',sni:'example.com',fp:'chrome',pbk:KEY,sid:'ab'})+'#'+encodeURIComponent('🇳🇱 Remna'));
 assert.equal(v.name,'🇳🇱 Remna');assert.deepEqual(v.warnings,[]);
 const t=parse(`trojan://${encodeURIComponent('tr/pw+=')}@${D}:443?`+jsQuery({type:'ws',path:'/t',host:D,heartbeatPeriod:30,security:'tls',sni:D,fp:'chrome',alpn:'http/1.1'})).outbound;
 assert.deepEqual({p:t.password,tr:t.transport},{p:'tr/pw+=',tr:{type:'ws',path:'/t',headers:{Host:D}}});
 // Standard base64 of this credential contains "/" and "+".
 const cred='aes-256-gcm:?>?>~~~',enc=b64(cred);assert.ok(/[+/]/.test(enc));
 assert.equal(parse(`ss://${enc}@${S}:8388#`+encodeURIComponent('Remna SS')).outbound.password,'?>?>~~~');
 const fm=JSON.stringify({udp:[{type:'salamander',settings:{password:'obfs-pw'}}]});
 const hy=parse(`hysteria2://${encodeURIComponent('au th')}@${D}:443/?`+jsQuery({obfs:'salamander','obfs-password':'obfs-pw',sni:D,fm})+'#hy').outbound;
 assert.deepEqual({auth:hy.password,obfs:hy.obfs},{auth:'au th',obfs:{type:'salamander',password:'obfs-pw'}});
 assert.deepEqual(parse(`hysteria2://a@${D}:443/?`+jsQuery({sni:D,fm})).outbound.obfs,{type:'salamander',password:'obfs-pw'});
 code(()=>parse(`hysteria2://a@${D}:443/?`+jsQuery({obfs:'salamander','obfs-password':'other',fm})),'invalid-link');
 code(()=>parse(`hysteria2://a@${D}:443/?`+jsQuery({fm:JSON.stringify({udp:[{type:'noise',settings:{}}]})})),'unsupported-by-core');
});
test('Hiddify: marker, alpn, headerType=none, fragment, mux and insecure=true; fake usage entry is skipped',()=>{
 const q={hiddify:1,sni:D,type:'ws',alpn:'h2,http/1.1',muxtype:'h2mux',muxmaxc:4,mux:4,muxsmax:0,muxpad:'False',fragment:'10-100,100-200,tlshello',mc:1,path:'/hp',host:D,encryption:'none',fp:'chrome',headerType:'none',allowInsecure:'true',insecure:'true',security:'tls'};
 const p=parse(`vless://${ID}@${D}:443?`+Object.entries(q).map(([k,v])=>k+'='+quote(String(v)).replace(/,/g,'%2C')).join('&')+'#'+quote('Hiddify WS'));
 assert.deepEqual(p.outbound.tls,{enabled:true,server_name:D,insecure:true,alpn:['http/1.1'],fragment:true,utls:{enabled:true,fingerprint:'chrome'}});
 assert.deepEqual(p.warnings.sort(),['Multiplexing from the link is not used.','TLS mixed-case SNI and padding from the link are not used.']);
 const r=parse(`vless://${ID}@${S}:443?`+jsQuery({hiddify:1,sni:'example.com',type:'grpc',alpn:'h2',serviceName:'g',mode:'gun',encryption:'none',fp:'chrome',headerType:'none',security:'reality',pbk:KEY,sid:'ab'})).outbound;
 assert.deepEqual(r.transport,{type:'grpc',service_name:'g'});assert.equal(r.tls.reality.public_key,KEY);
 const hy=parse(`hysteria2://${ID}@${D}:443?hiddify=1&obfs=salamander&obfs-password=hp&sni=${D}&insecure=1&allow_insecure=1#hy`).outbound;
 assert.deepEqual(hy.tls,{enabled:true,server_name:D,insecure:true});
 assert.equal(parse(`tuic://${ID}:${ID}@${D}:443?congestion_control=cubic&udp_relay_mode=native&sni=${D}&alpn=h3&allow_insecure=1#t`).outbound.tls.insecure,true);
 const vm={v:'2',ps:'HV',add:D,port:443,id:ID,aid:0,scy:'auto',net:'ws',type:'none',host:D,alpn:'h2,http/1.1',path:'/v',tls:'tls',sni:D,fp:'chrome',fragment:'10-100,100-200,tlshello',muxtype:'h2mux',mux:4};
 const v=parse('vmess://'+b64(JSON.stringify(vm)));assert.deepEqual(v.outbound.tls.alpn,['http/1.1']);assert.equal(v.outbound.tls.fragment,true);
 code(()=>parse('ss://'+b64('chacha20-ietf-poly1305:pw')+`@${S}:443?plugin=obfs-local&obfs-host=${D}&obfs=http&udp-over-tcp=true#ss`),'unsupported-settings');
 code(()=>parse(`trojan://1@15.30--2026.10.26.time:1530?sni=fake_ip_for_sub_link&security=tls#${quote('0.1/100GB 30 days')}`),'skip');
});
test('every accepted panel link yields a config the core can take (domain servers through the hosts resolver)',()=>{
 for(const l of [`vless://${ID}@${D}:443?hiddify=1&sni=${D}&type=ws&alpn=h2%2Chttp%2F1.1&path=/hp&fragment=1&security=tls`,`hysteria2://a@${D}:443/?obfs=gecko&obfs-password=g&minPacketSize=512&maxPacketSize=1200`]){
  const c=config(parse(l),'wlan0',true,'192.168.1.20',['192.0.2.50']);assert.equal(c.outbounds[0].domain_resolver.server,'server-hosts');
 }
});
