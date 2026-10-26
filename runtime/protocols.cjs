'use strict';
// Share links and sing-box outbounds → one validated sing-box outbound tagged "proxy".
// Links: vless:// (none/tls/reality; tcp/ws/grpc/httpupgrade; Vision), vmess:// (base64 JSON), trojan://,
// ss:// (SIP002 and legacy base64, no plugins), hysteria2:// (hy2://), tuic://.
// Every parameter and JSON field is checked against an allowlist: anything unknown is refused, never dropped,
// so a profile never connects with settings other than the ones it asked for.
// Errors carry a code (e.code, message prefix): invalid-link, unsupported-protocol, unsupported-settings,
// unsupported-by-core (Xray-only features such as xhttp or kcp). Details name fields, never values.
const SCHEMES=/^(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\//i;
const CORE_MISSING=new Set(['xhttp','splithttp','kcp','mkcp','domainsocket']);
const FINGERPRINTS=['chrome','firefox','edge','safari','360','qq','ios','android','random','randomized'];
const SS_METHODS=['2022-blake3-aes-128-gcm','2022-blake3-aes-256-gcm','2022-blake3-chacha20-poly1305','aes-128-gcm','aes-192-gcm','aes-256-gcm','chacha20-ietf-poly1305','xchacha20-ietf-poly1305'];
const VMESS_SECURITY=['auto','none','zero','aes-128-gcm','chacha20-poly1305'];
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DOMAIN=/^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)*\.?$/i;
const IPV4=/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function fail(code,detail){const e=Error(code+(detail?': '+detail:''));e.code=code;return e;}
const str=v=>typeof v==='string'?v:typeof v==='number'||typeof v==='boolean'?String(v):'';
function dec(v){try{return decodeURIComponent(str(v));}catch{throw fail('invalid-link','percent-encoding');}}
function text(v,what,max=256){v=str(v);if(!v||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw fail('invalid-link',what);return v;}
// IPv6 servers cannot work: the TV kernel has no IPv6 policy routing, so external IPv6 is blocked.
// Case is kept as given: profile ids hash the outbound, and earlier versions stored hosts unchanged.
function host(v,what='server'){v=str(v);if(v.startsWith('[')||v.includes(':'))throw fail('unsupported-settings','ipv6 '+what);if(!IPV4.test(v)&&!DOMAIN.test(v)||/^\d+(\.\d+)*$/.test(v)&&!IPV4.test(v))throw fail('invalid-link',what);return v.replace(/\.$/,'');}
function port(v){const n=Number(v);if(!/^\d{1,5}$/.test(str(v))||n<1||n>65535)throw fail('invalid-link','port');return n;}
function uuid(v){v=str(v);if(!UUID.test(v))throw fail('invalid-link','uuid');return v;}
function path(v){v=str(v);if(v.length>512||!v.startsWith('/')||/[\x00-\x20\x7f]/.test(v))throw fail('invalid-link','path');return v;}
function bool(v,what){if(v===true||v===false)return v;v=str(v).trim().toLowerCase();if(['1','true'].includes(v))return true;if(['','0','false'].includes(v))return false;throw fail('invalid-link',what);}
function oneOf(v,list,what,code='unsupported-settings'){if(!list.includes(v))throw fail(code,what);return v;}
function only(o,keys,what){if(!o||typeof o!=='object'||Array.isArray(o))throw fail('invalid-link',what);for(const k of Object.keys(o))if(!keys.includes(k))throw fail('unsupported-settings',what+'.'+k);return o;}
function alpn(v){const list=Array.isArray(v)?v:str(v).split(',');const out=list.map(s=>str(s).trim()).filter(Boolean);if(out.some(s=>!/^[a-z0-9./-]{1,32}$/i.test(s)))throw fail('invalid-link','alpn');return out;}
// The key order of every result is fixed here: profile ids hash the outbound JSON.
function tls(t,{required=false,reality=false}={}){
 // sing-box ignores tls, utls and reality objects unless enabled is true.
 if(!t||t.enabled!==true){if(required)throw fail('unsupported-settings','tls required');return undefined;}
 only(t,['enabled','server_name','disable_sni','insecure','alpn','utls','reality'],'tls');
 const out={enabled:true};
 if(t.server_name!==undefined&&t.server_name!=='')out.server_name=host(t.server_name,'sni');
 if(bool(t.disable_sni||false,'disable_sni'))out.disable_sni=true;
 if(bool(t.insecure||false,'insecure'))out.insecure=true;
 const protocols=t.alpn===undefined?[]:alpn(t.alpn);if(protocols.length)out.alpn=protocols;
 const u=t.utls===undefined?null:only(t.utls,['enabled','fingerprint'],'utls'),r=t.reality===undefined?null:only(t.reality,['enabled','public_key','short_id'],'reality');
 if(r&&r.enabled===true){
  if(!reality)throw fail('unsupported-settings','reality');
  if(!out.server_name)throw fail('invalid-link','sni');if(out.insecure||out.disable_sni)throw fail('unsupported-settings','reality');
  // Reality needs uTLS; chrome is sing-box's default fingerprint.
  out.utls={enabled:true,fingerprint:oneOf(str(u&&u.fingerprint)||'chrome',FINGERPRINTS,'fingerprint')};
  if(!/^[A-Za-z0-9_-]{43}$/.test(str(r.public_key)))throw fail('invalid-link','public_key');
  if(!/^(?:[a-f0-9]{2}){0,8}$/i.test(str(r.short_id)))throw fail('invalid-link','short_id');
  out.reality={enabled:true,public_key:r.public_key,short_id:str(r.short_id)};
 }else if(u&&u.enabled===true&&u.fingerprint)out.utls={enabled:true,fingerprint:oneOf(str(u.fingerprint),FINGERPRINTS,'fingerprint')};
 return out;
}
function transport(t){
 if(t===undefined||t===null)return undefined;
 if(!t||typeof t!=='object')throw fail('invalid-link','transport');
 if(CORE_MISSING.has(t.type))throw fail('unsupported-by-core',t.type);
 if(t.type==='ws'){
  only(t,['type','path','headers','max_early_data','early_data_header_name'],'transport');
  const out={type:'ws'};if(t.path)out.path=path(t.path);
  if(t.headers!==undefined){only(t.headers,['Host'],'headers');if(t.headers.Host)out.headers={Host:host(t.headers.Host,'host')};}
  if(t.max_early_data){const n=Number(t.max_early_data);if(!Number.isInteger(n)||n<0||n>65536)throw fail('invalid-link','early data');out.max_early_data=n;out.early_data_header_name=oneOf(str(t.early_data_header_name)||'Sec-WebSocket-Protocol',['Sec-WebSocket-Protocol'],'early data');}
  return out;
 }
 if(t.type==='grpc'){only(t,['type','service_name'],'transport');const out={type:'grpc'};if(t.service_name){if(!/^[A-Za-z0-9_.\/-]{1,128}$/.test(str(t.service_name)))throw fail('invalid-link','service_name');out.service_name=str(t.service_name);}return out;}
 if(t.type==='httpupgrade'){only(t,['type','host','path'],'transport');const out={type:'httpupgrade'};if(t.host)out.host=host(t.host,'host');if(t.path)out.path=path(t.path);return out;}
 throw fail('unsupported-settings','transport '+str(t.type));
}
const DIAL=['type','tag','server','server_port'];
const TYPES={
 vless:o=>{
  only(o,[...DIAL,'uuid','flow','tls','transport','packet_encoding'],'outbound');
  const out={uuid:uuid(o.uuid)},t=tls(o.tls,{reality:true}),tr=transport(o.transport);
  if(o.flow){oneOf(o.flow,['xtls-rprx-vision'],'flow');if(!t||tr)throw fail('unsupported-settings','flow');out.flow=o.flow;}
  if(t&&t.reality&&tr&&tr.type!=='grpc')throw fail('unsupported-settings','reality transport');
  if(o.packet_encoding)out.packet_encoding=oneOf(o.packet_encoding,['xudp','packetaddr'],'packet_encoding');
  return {...out,...(t&&{tls:t}),...(tr&&{transport:tr})};
 },
 vmess:o=>{
  only(o,[...DIAL,'uuid','security','alter_id','tls','transport','packet_encoding'],'outbound');
  const out={uuid:uuid(o.uuid),security:oneOf(str(o.security)||'auto',VMESS_SECURITY,'security')};
  if(o.alter_id!==undefined&&Number(o.alter_id)!==0)throw fail('unsupported-settings','alter_id');
  if(o.packet_encoding)out.packet_encoding=oneOf(o.packet_encoding,['xudp','packetaddr'],'packet_encoding');
  const t=tls(o.tls),tr=transport(o.transport);return {...out,...(t&&{tls:t}),...(tr&&{transport:tr})};
 },
 trojan:o=>{
  only(o,[...DIAL,'password','tls','transport'],'outbound');
  const out={password:text(o.password,'password')},t=tls(o.tls,{reality:true}),tr=transport(o.transport);return {...out,...(t&&{tls:t}),...(tr&&{transport:tr})};
 },
 shadowsocks:o=>{
  only(o,[...DIAL,'method','password','plugin','plugin_opts'],'outbound');
  if(o.plugin||o.plugin_opts)throw fail('unsupported-settings','plugin');
  return {method:oneOf(str(o.method),SS_METHODS,'method'),password:text(o.password,'password')};
 },
 hysteria2:o=>{
  only(o,[...DIAL,'server_ports','hop_interval','password','obfs','tls'],'outbound');
  const out={};
  if(o.server_ports!==undefined){const list=Array.isArray(o.server_ports)?o.server_ports:[o.server_ports];if(!list.length||list.length>8||list.some(r=>!/^\d{1,5}:\d{1,5}$/.test(str(r))||str(r).split(':').some(n=>+n<1||+n>65535)))throw fail('invalid-link','ports');out.server_ports=list.map(str);}
  if(o.hop_interval){if(!/^\d{1,4}s$/.test(str(o.hop_interval)))throw fail('invalid-link','hop_interval');out.hop_interval=o.hop_interval;}
  if(o.obfs!==undefined){only(o.obfs,['type','password'],'obfs');out.obfs={type:oneOf(o.obfs.type,['salamander'],'obfs'),password:text(o.obfs.password,'obfs password')};}
  out.password=text(o.password,'password');out.tls=tls(o.tls,{required:true});return out;
 },
 tuic:o=>{
  only(o,[...DIAL,'uuid','password','congestion_control','udp_relay_mode','zero_rtt_handshake','tls'],'outbound');
  const out={uuid:uuid(o.uuid),password:text(o.password,'password')};
  if(o.congestion_control)out.congestion_control=oneOf(o.congestion_control,['cubic','new_reno','bbr'],'congestion_control');
  if(o.udp_relay_mode)out.udp_relay_mode=oneOf(o.udp_relay_mode,['native','quic'],'udp_relay_mode');
  if(bool(o.zero_rtt_handshake||false,'zero_rtt_handshake'))out.zero_rtt_handshake=true;
  out.tls=tls(o.tls,{required:true});return out;
 }
};
const GROUPS=['selector','urltest','direct','block','dns'];
// A candidate outbound (from a link or sing-box JSON) → canonical outbound, or an error.
function outbound(o){
 if(!o||typeof o!=='object'||Array.isArray(o))throw fail('invalid-link','outbound');
 const build=Object.prototype.hasOwnProperty.call(TYPES,o.type)&&TYPES[o.type];if(!build)throw fail('unsupported-protocol');
 return {type:o.type,tag:'proxy',server:host(o.server),server_port:port(o.server_port),...build(o)};
}
function name(v,fallback='VPN'){let s;try{s=decodeURIComponent(str(v));}catch{s=str(v);}s=s.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,64);return s||fallback;}
// Query parameters: each at most once and from the allowlist.
function params(q,allowed){const out={};for(const k of new Set(q.keys())){if(!allowed.includes(k))throw fail('unsupported-settings',k);if(q.getAll(k).length!==1)throw fail('invalid-link','repeated '+k);out[k]=q.get(k);}return out;}
// Xray share-link transport parameters (VLESS, Trojan) → sing-box transport.
function xrayTransport(q){
 const type=(q.type||'tcp').toLowerCase();
 if(CORE_MISSING.has(type))throw fail('unsupported-by-core',type);
 if(type==='tcp'||type==='raw'){if(q.headerType&&q.headerType!=='none')throw fail('unsupported-settings','headerType');if(q.path||q.serviceName)throw fail('unsupported-settings','tcp path');return undefined;}
 if(q.headerType&&q.headerType!=='none')throw fail('unsupported-settings','headerType');
 // As in v2rayN: the first of a comma-separated host list, and a path is always absolute.
 const host=q.host&&q.host.split(',')[0].trim(),slash=p=>p&&!p.startsWith('/')?'/'+p:p;
 if(type==='ws'){
  const out={type:'ws'};let p=slash(q.path||'');
  // Xray puts early data in the path ("/ws?ed=2048"); sing-box takes it as separate fields.
  const m=p.match(/^([^?]*)\?ed=(\d{1,5})$/);if(m){p=m[1];out.max_early_data=Number(m[2]);out.early_data_header_name='Sec-WebSocket-Protocol';}
  if(p)out.path=p;if(host)out.headers={Host:host};return out;
 }
 if(type==='grpc'){if(q.mode&&q.mode!=='gun')throw fail('unsupported-settings','grpc mode');return {type:'grpc',...(q.serviceName&&{service_name:q.serviceName})};}
 if(type==='httpupgrade')return {type:'httpupgrade',...(host&&{host}),...(q.path&&{path:slash(q.path)})};
 throw fail('unsupported-settings','type '+type);
}
function xrayTls(q,security){
 // Without TLS, sni/fp/alpn mean nothing and generators often leave them in; Reality keys mean a broken link.
 if(security==='none'){if(q.pbk||q.sid||q.spx)throw fail('unsupported-settings','reality fields');return undefined;}
 if(security!=='tls'&&security!=='reality')throw fail('unsupported-settings','security '+security);
 if(security==='tls'&&(q.pbk||q.sid||q.spx))throw fail('unsupported-settings','reality fields');
 return {enabled:true,...(q.sni&&{server_name:q.sni}),...(bool(q.allowInsecure||'','allowInsecure')&&{insecure:true}),...(q.alpn&&{alpn:q.alpn}),
  ...(q.fp&&{utls:{enabled:true,fingerprint:q.fp}}),...(security==='reality'&&{reality:{enabled:true,public_key:q.pbk,short_id:q.sid||''}})};
}
function url(uri){try{return new URL(uri);}catch{throw fail('invalid-link','url syntax');}}
const XRAY=['type','security','sni','fp','alpn','pbk','sid','spx','host','path','serviceName','mode','headerType','allowInsecure'];
const LINKS={
 vless(uri){
  const u=url(uri),q=params(u.searchParams,[...XRAY,'encryption','flow']);
  // VLESS encryption (ML-KEM) exists only in Xray.
  if(q.encryption&&q.encryption!=='none')throw fail('unsupported-by-core','encryption');
  const warnings=q.spx?['Xray spiderX is not used by sing-box.']:[];
  return {name:name(u.hash.slice(1)),warnings,outbound:outbound({type:'vless',server:u.hostname,server_port:u.port,uuid:dec(u.username),...(q.flow&&{flow:q.flow}),tls:xrayTls(q,(q.security||'none').toLowerCase()),transport:xrayTransport(q)})};
 },
 trojan(uri){
  const u=url(uri),q=params(u.searchParams,[...XRAY,'peer']);
  if(q.peer&&!q.sni)q.sni=q.peer;
  return {name:name(u.hash.slice(1)),warnings:[],outbound:outbound({type:'trojan',server:u.hostname,server_port:u.port||443,password:dec(u.username),tls:xrayTls(q,(q.security||'tls').toLowerCase()),transport:xrayTransport(q)})};
 },
 // vmess:// + base64 of the v2rayN JSON object.
 vmess(uri){
  const body=uri.slice(8).split('#')[0];let j;
  try{j=JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));}catch{throw fail('invalid-link','vmess json');}
  only(j,['v','ps','add','port','id','aid','scy','net','type','host','path','tls','sni','alpn','fp','allowInsecure'],'vmess');
  const net=str(j.net||'tcp').toLowerCase(),security=str(j.tls||'none').toLowerCase()||'none';
  const q={type:net,...(j.type&&j.type!=='none'&&net==='tcp'&&{headerType:str(j.type)}),...(j.host&&{host:str(j.host)}),...(j.path&&(net==='grpc'?{serviceName:str(j.path)}:{path:str(j.path)})),...(net==='grpc'&&j.type&&j.type!=='none'&&{mode:str(j.type)}),
   ...(j.sni&&{sni:str(j.sni)}),...(j.alpn&&{alpn:str(j.alpn)}),...(j.fp&&{fp:str(j.fp)}),...(j.allowInsecure!==undefined&&{allowInsecure:str(j.allowInsecure)})};
  return {name:name(j.ps),warnings:[],outbound:outbound({type:'vmess',server:j.add,server_port:j.port,uuid:j.id,alter_id:j.aid||0,security:j.scy||'auto',tls:xrayTls(q,security),transport:xrayTransport(q)})};
 },
 // SIP002: ss://base64url(method:password)@host:port[/][?plugin=…]#name; 2022 keys may be percent-encoded instead.
 // Legacy: ss://base64(method:password@host:port)#name.
 ss(uri){
  const hash=uri.indexOf('#'),label=hash<0?'':uri.slice(hash+1);let rest=uri.slice(5,hash<0?undefined:hash);
  const qs=rest.indexOf('?');let query='';if(qs>=0){query=rest.slice(qs+1);rest=rest.slice(0,qs);}rest=rest.replace(/\/$/,'');
  const b64=s=>{const d=Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');return /^[\x20-\x7e]+$/.test(d)?d:null;};
  if(!rest.includes('@')){rest=b64(rest);if(!rest||!rest.includes('@'))throw fail('invalid-link','ss base64');}
  const at=rest.lastIndexOf('@'),user=rest.slice(0,at),addr=rest.slice(at+1);
  const plain=(()=>{try{return decodeURIComponent(user);}catch{return '';}})(),creds=plain.includes(':')?plain:b64(user)||'';
  const colon=creds.indexOf(':');if(colon<1)throw fail('invalid-link','userinfo');
  const m=addr.match(/^([^:\[\]]+):(\d{1,5})$/);if(!m){if(addr.startsWith('['))throw fail('unsupported-settings','ipv6 server');throw fail('invalid-link','address');}
  const q=params(new URLSearchParams(query),['plugin']);if(q.plugin)throw fail('unsupported-settings','plugin');
  return {name:name(label),warnings:[],outbound:outbound({type:'shadowsocks',server:m[1],server_port:m[2],method:creds.slice(0,colon).toLowerCase(),password:creds.slice(colon+1)})};
 },
 // hysteria2://auth@host:port/?sni=&insecure=1&obfs=salamander&obfs-password=&mport=20000-30000#name
 hysteria2(uri){
  const u=url(uri.replace(/^hy2:/i,'hysteria2:')),q=params(u.searchParams,['sni','insecure','obfs','obfs-password','mport','alpn']);
  const auth=dec(u.username)+(u.password?':'+dec(u.password):'');
  const ports=q.mport?q.mport.split(',').map(r=>{const [a,b]=r.trim().split('-');return a+':'+(b||a);}):undefined;
  if(q['obfs-password']&&!q.obfs)throw fail('invalid-link','obfs');
  return {name:name(u.hash.slice(1)),warnings:[],outbound:outbound({type:'hysteria2',server:u.hostname,server_port:u.port||443,...(ports&&{server_ports:ports}),password:auth,
   ...(q.obfs&&{obfs:{type:q.obfs,password:q['obfs-password']}}),tls:{enabled:true,...(q.sni&&{server_name:q.sni}),...(bool(q.insecure||'','insecure')&&{insecure:true}),...(q.alpn&&{alpn:q.alpn})}})};
 },
 // tuic://uuid:password@host:port?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=&allow_insecure=1#name
 tuic(uri){
  const u=url(uri),q=params(u.searchParams,['congestion_control','udp_relay_mode','alpn','sni','allow_insecure','insecure','disable_sni']);
  return {name:name(u.hash.slice(1)),warnings:[],outbound:outbound({type:'tuic',server:u.hostname,server_port:u.port,uuid:dec(u.username),password:dec(u.password),
   ...(q.congestion_control&&{congestion_control:q.congestion_control}),...(q.udp_relay_mode&&{udp_relay_mode:q.udp_relay_mode}),
   tls:{enabled:true,...(q.sni&&{server_name:q.sni}),...(bool(q.allow_insecure||q.insecure||'','insecure')&&{insecure:true}),...(bool(q.disable_sni||'','disable_sni')&&{disable_sni:true}),...(q.alpn&&{alpn:q.alpn})}})};
 }
};
function parse(uri){
 uri=str(uri).trim();const m=uri.match(SCHEMES);
 if(!m)throw fail(/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)?'unsupported-protocol':'invalid-link');
 const scheme=m[1].toLowerCase();return LINKS[scheme==='hy2'?'hysteria2':scheme](uri);
}
// A sing-box JSON outbound; group and service outbounds are skipped by the caller ("skip").
function fromOutbound(o){
 if(o&&GROUPS.includes(o.type))throw fail('skip');
 return {name:name(o&&o.tag),warnings:[],outbound:outbound(o)};
}
module.exports={SCHEMES,parse,fromOutbound,outbound};
