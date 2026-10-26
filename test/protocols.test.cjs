const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,fromOutbound,outbound}=require('../runtime/protocols.cjs');
const {config,exitOk}=require('../runtime/profile.cjs');
const ID='00000000-0000-4000-8000-000000000001',KEY='A'.repeat(43);
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64');
const code=(fn,c)=>assert.throws(fn,e=>e.code===c,c);

test('VLESS Reality Vision keeps the exact outbound JSON of earlier versions (profile ids hash it)',()=>{
 const p=parse('vless://'+ID+'@192.0.2.10:8443?type=tcp&encryption=none&security=reality&pbk='+KEY+'&fp=chrome&sni=example.com&sid=abcd&flow=xtls-rprx-vision#Test');
 assert.equal(JSON.stringify(p.outbound),'{"type":"vless","tag":"proxy","server":"192.0.2.10","server_port":8443,"uuid":"'+ID+'","flow":"xtls-rprx-vision","tls":{"enabled":true,"server_name":"example.com","utls":{"enabled":true,"fingerprint":"chrome"},"reality":{"enabled":true,"public_key":"'+KEY+'","short_id":"abcd"}}}');
 assert.equal(p.name,'Test');
});
test('VLESS: none / tls, ws with early data, grpc, httpupgrade',()=>{
 assert.deepEqual(parse('vless://'+ID+'@example.com:80?type=ws&path=%2Fws%3Fed%3D2048&host=cdn.example.com#WS').outbound,
  {type:'vless',tag:'proxy',server:'example.com',server_port:80,uuid:ID,transport:{type:'ws',path:'/ws',headers:{Host:'cdn.example.com'},max_early_data:2048,early_data_header_name:'Sec-WebSocket-Protocol'}});
 assert.deepEqual(parse('vless://'+ID+'@example.com:443?type=grpc&security=tls&sni=example.com&alpn=h2&fp=firefox&serviceName=svc&mode=gun').outbound,
  {type:'vless',tag:'proxy',server:'example.com',server_port:443,uuid:ID,tls:{enabled:true,server_name:'example.com',alpn:['h2'],utls:{enabled:true,fingerprint:'firefox'}},transport:{type:'grpc',service_name:'svc'}});
 assert.deepEqual(parse('vless://'+ID+'@example.com:443?type=httpupgrade&security=tls&host=example.com&path=%2Fup&flow=').outbound.transport,{type:'httpupgrade',host:'example.com',path:'/up'});
 assert.equal(parse('vless://'+ID+'@example.com:443?security=tls&flow=xtls-rprx-vision').outbound.flow,'xtls-rprx-vision');
 // Reality over gRPC is valid Xray. Without sni (as v2rayN accepts) the core picks the server name itself.
 assert.equal(parse('vless://'+ID+'@192.0.2.1:443?type=grpc&security=reality&pbk='+KEY+'&sni=example.com').outbound.tls.utls.fingerprint,'chrome');
 assert.deepEqual(parse('vless://'+ID+'@192.0.2.1:443?security=reality&pbk='+KEY+'&sni=&flow=xtls-rprx-vision').outbound.tls,{enabled:true,utls:{enabled:true,fingerprint:'chrome'},reality:{enabled:true,public_key:KEY,short_id:''}});
});
test('VMess (v2rayN base64 JSON) with ws + TLS, and plain TCP',()=>{
 const p=parse('vmess://'+b64({v:'2',ps:'VM',add:'example.com',port:'443',id:ID,aid:'0',scy:'auto',net:'ws',type:'none',host:'cdn.example.com',path:'/v',tls:'tls',sni:'cdn.example.com',fp:'chrome',alpn:''}));
 assert.equal(p.name,'VM');
 assert.deepEqual(p.outbound,{type:'vmess',tag:'proxy',server:'example.com',server_port:443,uuid:ID,security:'auto',tls:{enabled:true,server_name:'cdn.example.com',utls:{enabled:true,fingerprint:'chrome'}},transport:{type:'ws',path:'/v',headers:{Host:'cdn.example.com'}}});
 assert.deepEqual(parse('vmess://'+b64({v:2,ps:'T',add:'192.0.2.5',port:10086,id:ID,aid:0,net:'tcp',tls:''})).outbound,{type:'vmess',tag:'proxy',server:'192.0.2.5',server_port:10086,uuid:ID,security:'auto'});
 code(()=>parse('vmess://'+b64({add:'192.0.2.5',port:1,id:ID,aid:64})),'unsupported-settings');
 code(()=>parse('vmess://'+b64({add:'192.0.2.5',port:1,id:ID,net:'kcp'})),'unsupported-by-core');
 code(()=>parse('vmess://'+b64({add:'192.0.2.5',port:1,id:ID,extra:1})),'unsupported-settings');
 code(()=>parse('vmess://not-json'),'invalid-link');
});
test('Trojan: TLS by default, sni / peer, ws transport, insecure flag',()=>{
 assert.deepEqual(parse('trojan://p%40ss@example.com:443?sni=example.com#TR').outbound,{type:'trojan',tag:'proxy',server:'example.com',server_port:443,password:'p@ss',tls:{enabled:true,server_name:'example.com'}});
 assert.deepEqual(parse('trojan://pw@192.0.2.7:8443?peer=example.com&allowInsecure=1&type=ws&path=%2Ft').outbound,{type:'trojan',tag:'proxy',server:'192.0.2.7',server_port:8443,password:'pw',tls:{enabled:true,server_name:'example.com',insecure:true},transport:{type:'ws',path:'/t'}});
 code(()=>parse('trojan://@example.com:443'),'invalid-link');
});
test('Shadowsocks: SIP002 base64url, percent-encoded 2022 key, legacy base64; no plugins or stream ciphers',()=>{
 const sip=parse('ss://'+Buffer.from('chacha20-ietf-poly1305:secret').toString('base64url')+'@192.0.2.8:8388/#SS');
 assert.deepEqual(sip.outbound,{type:'shadowsocks',tag:'proxy',server:'192.0.2.8',server_port:8388,method:'chacha20-ietf-poly1305',password:'secret'});
 assert.equal(sip.name,'SS');
 assert.equal(parse('ss://2022-blake3-aes-128-gcm:'+encodeURIComponent('AAAAAAAAAAAAAAAAAAAAAA==')+'@example.com:443#K').outbound.password,'AAAAAAAAAAAAAAAAAAAAAA==');
 assert.equal(parse('ss://'+Buffer.from('aes-256-gcm:pw@192.0.2.9:1234').toString('base64')+'#Old').outbound.server_port,1234);
 code(()=>parse('ss://'+Buffer.from('aes-256-gcm:pw').toString('base64url')+'@192.0.2.8:8388/?plugin=obfs-local%3Bobfs%3Dhttp'),'unsupported-settings');
 code(()=>parse('ss://'+Buffer.from('rc4-md5:pw').toString('base64url')+'@192.0.2.8:8388'),'unsupported-settings');
 code(()=>parse('ss://'+Buffer.from('aes-256-gcm:pw').toString('base64url')+'@[2001:db8::1]:8388'),'unsupported-settings');
});
test('Hysteria2 / hy2: auth, obfs, port hopping, TLS always on',()=>{
 assert.deepEqual(parse('hy2://user:pass@example.com:443/?sni=example.com&obfs=salamander&obfs-password=ob&mport=20000-30000&insecure=1#H').outbound,
  {type:'hysteria2',tag:'proxy',server:'example.com',server_port:443,server_ports:['20000:30000'],obfs:{type:'salamander',password:'ob'},password:'user:pass',tls:{enabled:true,server_name:'example.com',insecure:true}});
 assert.equal(parse('hysteria2://secret@192.0.2.11#X').outbound.server_port,443);
 code(()=>parse('hysteria2://secret@192.0.2.11:443?pinSHA256=AB'),'unsupported-settings');
});
test('TUIC: uuid:password, congestion control, relay mode, alpn',()=>{
 assert.deepEqual(parse('tuic://'+ID+':pw@example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=example.com#T').outbound,
  {type:'tuic',tag:'proxy',server:'example.com',server_port:443,uuid:ID,password:'pw',congestion_control:'bbr',udp_relay_mode:'native',tls:{enabled:true,server_name:'example.com',alpn:['h3']}});
 code(()=>parse('tuic://'+ID+':pw@example.com:443?congestion_control=reno'),'unsupported-settings');
});
test('Xray-only features and unknown parameters give clear codes',()=>{
 const v='vless://'+ID+'@192.0.2.1:443?security=tls&';
 code(()=>parse(v+'type=xhttp'),'unsupported-by-core');
 code(()=>parse(v+'type=kcp'),'unsupported-by-core');
 code(()=>parse(v+'encryption=mlkem768x25519plus.native.0rtt.x'),'unsupported-by-core');
 code(()=>parse(v+'x=1'),'unsupported-settings');
 code(()=>parse(v+'type=tcp&headerType=http'),'unsupported-settings');
 code(()=>parse(v+'flow=xtls-rprx-vision&type=ws'),'unsupported-settings');
 code(()=>parse(v+'sni=a.example&sni=b.example'),'invalid-link');
 code(()=>parse('vless://'+ID+'@192.0.2.1:443?security=tls&pbk='+KEY),'unsupported-settings');
 code(()=>parse('vless://bad@192.0.2.1:443'),'invalid-link');
 code(()=>parse('vless://'+ID+'@192.0.2.1:70000'),'invalid-link');
 code(()=>parse('vless://'+ID+'@[2001:db8::1]:443'),'unsupported-settings');
 code(()=>parse('wireguard://x@192.0.2.1:1'),'unsupported-protocol');
 code(()=>parse('hello'),'invalid-link');
});
test('sing-box JSON outbounds: allowlisted fields only; tls objects follow sing-box enabled semantics',()=>{
 const t=fromOutbound({type:'trojan',tag:'DE',server:'example.com',server_port:443,password:'pw',tls:{enabled:true,server_name:'example.com',utls:{enabled:true,fingerprint:'safari'}},transport:{type:'grpc',service_name:'g'}});
 assert.equal(t.name,'DE');assert.deepEqual(t.outbound.transport,{type:'grpc',service_name:'g'});
 assert.equal(fromOutbound({type:'vless',server:'192.0.2.1',server_port:443,uuid:ID,tls:{server_name:'example.com'}}).outbound.tls,undefined);
 code(()=>fromOutbound({type:'selector',outbounds:['a']}),'skip');
 code(()=>fromOutbound({type:'vless',server:'192.0.2.1',server_port:443,uuid:ID,multiplex:{enabled:true}}),'unsupported-settings');
 code(()=>fromOutbound({type:'vless',server:'192.0.2.1',server_port:443,uuid:ID,tls:{enabled:true,certificate:'x'}}),'unsupported-settings');
 code(()=>fromOutbound({type:'hysteria2',server:'192.0.2.1',server_port:443,password:'pw'}),'unsupported-settings');
 code(()=>fromOutbound({type:'wireguard',server:'192.0.2.1',server_port:51820}),'unsupported-protocol');
 code(()=>fromOutbound({type:'constructor',server:'192.0.2.1',server_port:1}),'unsupported-protocol');
});
test('normalizing a stored outbound again changes nothing',()=>{
 for(const link of ['vless://'+ID+'@example.com:80?type=ws&path=%2Fws%3Fed%3D2048&host=cdn.example.com','hy2://pw@example.com:443?obfs=salamander&obfs-password=o&mport=1000-2000','tuic://'+ID+':pw@example.com:443?alpn=h3','vmess://'+b64({add:'example.com',port:443,id:ID,net:'grpc',path:'svc',tls:'tls'})]){
  const o=parse(link).outbound;assert.equal(JSON.stringify(outbound(o)),JSON.stringify(o),link.slice(0,8));
 }
});
test('config: a domain server resolves through a hosts server with the pre-resolved IPs, not through the proxy',()=>{
 const p=parse('trojan://pw@vpn.example.com:443');
 assert.throws(()=>config(p,'wlan0',true,'192.168.1.20'),/server-not-found/);
 const c=config(p,'wlan0',true,'192.168.1.20',['192.0.2.30','192.0.2.31']);
 assert.deepEqual(c.dns.servers[1],{type:'hosts',tag:'server-hosts',predefined:{'vpn.example.com':['192.0.2.30','192.0.2.31']}});
 assert.deepEqual(c.outbounds[0].domain_resolver,{server:'server-hosts',strategy:'ipv4_only'});
 assert.equal(c.outbounds[0].server,'vpn.example.com');assert.equal(c.dns.final,'remote-dns');
 const ip=config(parse('trojan://pw@192.0.2.40:443?sni=example.com'),'wlan0',true);
 assert.equal(ip.dns.servers.length,1);assert.equal(ip.outbounds[0].domain_resolver,undefined);
});
test('health: exit equal to a server address, or different from the direct exit; unknown direct exit is strict',()=>{
 const servers=['192.0.2.30','192.0.2.31'];
 assert.equal(exitOk('192.0.2.31',servers,'198.51.100.1'),true);
 assert.equal(exitOk('203.0.113.9',servers,'198.51.100.1'),true);
 assert.equal(exitOk('198.51.100.1',servers,'198.51.100.1'),false);
 assert.equal(exitOk('203.0.113.9',servers,null),false);
 assert.equal(exitOk('192.0.2.30',servers,null),true);
 assert.equal(exitOk(null,servers,'198.51.100.1'),false);
});
test('v2rayN leniency: first of a host list, relative ws path, allowInsecure in any case',()=>{
 const o=parse('vless://'+ID+'@example.com:443?type=ws&security=tls&host=a.example.com,b.example.com&path=ws&allowInsecure=True').outbound;
 assert.deepEqual(o.transport,{type:'ws',path:'/ws',headers:{Host:'a.example.com'}});assert.equal(o.tls.insecure,true);
});
test('server name: strict hostnames unchanged; comma list, IDN, wildcard and odd ASCII accepted like v2rayN',()=>{
 const sni=s=>parse('vless://'+ID+'@192.0.2.1:443?security=reality&pbk='+KEY+'&sni='+encodeURIComponent(s)).outbound.tls.server_name;
 assert.equal(sni('Example.COM'),'Example.COM');
 assert.equal(sni('a.example.com,b.example.com'),'a.example.com');
 assert.equal(sni('пример.рф'),'xn--e1afmkfd.xn--p1ai');
 assert.equal(sni('*.example.com'),'*.example.com');
 assert.equal(sni(' www.example.com '),'www.example.com');
 assert.equal(sni('-bad-.example.com'),'-bad-.example.com');
 assert.throws(()=>sni('a b'),e=>e.code==='invalid-link'&&e.message==='invalid-link: sni len=3 space symbol');
});
test('query values decode like v2rayN: "+" is kept, malformed escapes stay as written',()=>{
 const h=parse('hy2://pw@192.0.2.11:443?obfs=salamander&obfs-password=ab+c%2Bd&sni=example.com').outbound;
 assert.equal(h.obfs.password,'ab+c+d');
 assert.equal(parse('hy2://pw@192.0.2.11:443?obfs=salamander&obfs-password=50%25off%zz').outbound.obfs.password,'50%off%zz');
 code(()=>parse('hy2://pw@192.0.2.11:443?sni=a.example&sni=b.example'),'invalid-link');
});
test('Shadowsocks from Xray-style panels: type=tcp and headerType=none accepted, other transports refused',()=>{
 const u='ss://'+Buffer.from('chacha20-ietf-poly1305:pw').toString('base64url')+'@192.0.2.8:8388';
 const plain=parse(u+'#SS').outbound;
 assert.deepEqual(parse(u+'?type=tcp#SS').outbound,plain);assert.deepEqual(parse(u+'/?type=tcp&headerType=none#SS').outbound,plain);
 code(()=>parse(u+'?type=ws'),'unsupported-settings');code(()=>parse(u+'?type=tcp&headerType=http'),'unsupported-settings');
});
