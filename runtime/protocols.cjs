'use strict';
// Share links and sing-box outbounds → one validated sing-box outbound tagged "proxy".
// Links: vless:// (none/tls/reality; tcp/ws/grpc/httpupgrade; Vision), vmess:// (base64 JSON), trojan://,
// ss:// (SIP002 and legacy base64, no plugins), hysteria2:// (hy2://), tuic://.
// Every parameter and JSON field is checked against an allowlist. What panels add on top (see DROP and EXTRA) is
// either mapped, dropped because sing-box needs nothing for it, or refused; anything unknown is refused, never
// dropped, so a profile never connects with settings other than the ones it asked for.
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
// Shape of a refused value for events.log: length and character classes, never the value.
function shape(s){return 'len='+s.length+[[/[A-Z]/,'upper'],[/[^\x00-\x7f]/,'unicode'],[/,/,'comma'],[/\*/,'star'],[/\s/,'space'],[/_/,'underscore'],[/[^\w.\-]/,'symbol'],[/(^|\.)-|-(\.|$)/,'edge-dash'],[/[^.]{64}/,'long-label']].filter(([r])=>r.test(s)).map(([,n])=>' '+n).join('');}
// Xray and sing-box send the server name as given. A strict hostname keeps earlier output (profile ids);
// otherwise, as v2rayN does: the first of a comma list, an international name in punycode, any printable ASCII.
function serverName(v){
 try{return host(v,'sni');}catch(e){if(e.code!=='invalid-link')throw e;}
 let s=str(v).split(',')[0].trim();const raw=s;
 const ascii=require('url').domainToASCII(s);if(ascii)s=ascii;
 if(/^[\x21-\x7e]{1,253}$/.test(s))return s;
 throw fail('invalid-link','sni '+shape(raw));
}
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
 only(t,['enabled','server_name','disable_sni','insecure','alpn','fragment','utls','reality'],'tls');
 const out={enabled:true};
 if(t.server_name!==undefined&&str(t.server_name).trim()!=='')out.server_name=serverName(t.server_name);
 if(bool(t.disable_sni||false,'disable_sni'))out.disable_sni=true;
 if(bool(t.insecure||false,'insecure'))out.insecure=true;
 const protocols=t.alpn===undefined?[]:alpn(t.alpn);if(protocols.length)out.alpn=protocols;
 // TLS ClientHello fragmentation (Xray/Hiddify "fragment"); sing-box picks the sizes itself.
 if(bool(t.fragment||false,'fragment'))out.fragment=true;
 const u=t.utls===undefined?null:only(t.utls,['enabled','fingerprint'],'utls'),r=t.reality===undefined?null:only(t.reality,['enabled','public_key','short_id'],'reality');
 if(r&&r.enabled===true){
  if(!reality)throw fail('unsupported-settings','reality');
  // No server name: like Xray, the core sends the server's domain, or no SNI for an IP (the Reality server may allow "").
  if(out.insecure||out.disable_sni)throw fail('unsupported-settings','reality');
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
  only(o,[...DIAL,'server_ports','hop_interval','up_mbps','down_mbps','password','obfs','tls'],'outbound');
  const out={},size=(v,what)=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>65535)throw fail('invalid-link',what);return n;};
  if(o.server_ports!==undefined){const list=Array.isArray(o.server_ports)?o.server_ports:[o.server_ports];if(!list.length||list.length>8||list.some(r=>!/^\d{1,5}:\d{1,5}$/.test(str(r))||str(r).split(':').some(n=>+n<1||+n>65535)))throw fail('invalid-link','ports');out.server_ports=list.map(str);}
  if(o.hop_interval){if(!/^\d{1,4}s$/.test(str(o.hop_interval)))throw fail('invalid-link','hop_interval');out.hop_interval=o.hop_interval;}
  // Bandwidth hints switch the client to Hysteria's Brutal congestion control, as the link asks.
  for(const k of ['up_mbps','down_mbps'])if(o[k]!==undefined)out[k]=size(o[k],k);
  if(o.obfs!==undefined){
   only(o.obfs,['type','password','min_packet_size','max_packet_size'],'obfs');
   out.obfs={type:oneOf(o.obfs.type,['salamander','gecko'],'obfs'),password:text(o.obfs.password,'obfs password')};
   // gecko (sing-box 1.14) takes packet size bounds; salamander has none.
   for(const k of ['min_packet_size','max_packet_size'])if(o.obfs[k]!==undefined){if(out.obfs.type!=='gecko')throw fail('unsupported-settings','obfs.'+k);out.obfs[k]=size(o.obfs[k],k);}
  }
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
// Decoded like v2rayN (Uri.UnescapeDataString): "+" stays "+", unlike URLSearchParams which turns it into a space
// and would corrupt base64 passwords; a malformed escape is kept as written.
function params(raw,allowed){
 const out=Object.create(null),un=s=>s.replace(/(%[0-9a-f]{2})+/gi,m=>{try{return decodeURIComponent(m);}catch{return m;}});
 for(const pair of String(raw).replace(/^\?/,'').split('&')){
  if(!pair)continue;const i=pair.indexOf('='),k=un(i<0?pair:pair.slice(0,i)),v=i<0?'':un(pair.slice(i+1));
  if(!allowed.includes(k))throw fail('unsupported-settings',k);if(k in out)throw fail('invalid-link','repeated '+k);out[k]=v;
 }
 return out;
}
// Xray share-link transport parameters (VLESS, Trojan) → sing-box transport.
function xrayTransport(q){
 const type=(q.type||'tcp').toLowerCase();
 if(CORE_MISSING.has(type))throw fail('unsupported-by-core',type);
 // Plain TCP has no path or host; panels (Marzban) still write them, usually empty.
 if(type==='tcp'||type==='raw'){if(q.headerType&&q.headerType!=='none')throw fail('unsupported-settings','headerType');return undefined;}
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
function xrayTls(q,security,x){
 // Without TLS, sni/fp/alpn mean nothing and generators often leave them in; Reality keys mean a broken link.
 if(security==='none'){if(q.pbk||q.sid)throw fail('unsupported-settings','reality fields');return undefined;}
 if(security!=='tls'&&security!=='reality')throw fail('unsupported-settings','security '+security);
 if(security==='tls'&&q.pbk)throw fail('unsupported-settings','reality fields');
 if(x.fragment&&security==='reality')x.warn(WARN.fragment);
 return {enabled:true,...(q.sni&&{server_name:q.sni}),...(x.insecure&&{insecure:true}),...(q.alpn&&{alpn:q.alpn}),...(x.fragment&&security==='tls'&&{fragment:true}),
  ...(q.fp&&{utls:{enabled:true,fingerprint:q.fp}}),...(security==='reality'&&{reality:{enabled:true,public_key:q.pbk,short_id:q.sid||''}})};
}
function url(uri){try{return new URL(uri);}catch{throw fail('invalid-link','url syntax');}}
const XRAY=['type','security','sni','fp','alpn','pbk','sid','spx','host','path','serviceName','mode','headerType','allowInsecure'];
// What panels (Marzban, 3x-ui, Remnawave, Hiddify) add beyond the core link format, and what we do with it.
// Dropped: markers, keep-alives and Xray hints that need no counterpart, mux and anti-DPI tricks a server never
// requires, and checks sing-box's own certificate verification already covers. The ones that change how the
// connection looks leave a warning on the profile. Refused when set: settings whose loss would change what the
// server expects or weaken security (ECH, a gRPC authority other than the server name, a pin with insecure).
const WARN={spx:'Xray spiderX is not used by sing-box.',pqv:'Reality ML-DSA verification is not done by sing-box.',mux:'Multiplexing from the link is not used.',
 tricks:'TLS mixed-case SNI and padding from the link are not used.',fragment:'TLS fragmentation is not used with Reality.',pin:'The certificate pin is not checked; the certificate is verified normally.'};
const DROP={hiddify:null,core:null,heartbeatPeriod:null,'support-x25519mlkem768':null,vcn:null,cs:null,fragment_v1:null,spx:'spx',pqv:'pqv',mc:'tricks',padsize:'tricks',
 muxtype:'mux',muxmaxc:'mux',mux:'mux',muxsmax:'mux',muxpad:'mux',muxup:'mux',muxdown:'mux'};
const EXTRA=[...Object.keys(DROP),'fragment','ech','fm','extra','authority','quicSecurity','key','seed','pcs','pinSHA256','insecure','allow_insecure','allowInsecure'];
// Xray finalmask (fm, JSON). Only an empty mask has no meaning; a lone UDP salamander mask is Hysteria2 obfs.
function mask(fm){
 let j;try{j=JSON.parse(fm);}catch{throw fail('invalid-link','finalmask');}
 const set=v=>Array.isArray(v)?v.some(set):v&&typeof v==='object'?Object.values(v).some(set):v!==undefined&&v!==null&&v!==''&&v!==false&&v!==0;
 if(!set(j))return null;
 const udp=Array.isArray(j.udp)?j.udp:[],rest={...j};delete rest.udp;const m=udp[0],s=m&&m.settings||{};
 if(!set(rest)&&udp.length===1&&m.type==='salamander'&&s.password&&Object.keys(s).every(k=>k==='password'||!set(s[k])))return {type:'salamander',password:str(s.password)};
 throw fail('unsupported-by-core','finalmask');
}
// Checks the panel extras of one link; returns what maps to sing-box and collects warnings.
function extras(q,server){
 const warnings=[],warn=w=>{if(!warnings.includes(w))warnings.push(w);};
 for(const k of Object.keys(q))if(DROP[k]&&q[k]!=='')warn(WARN[DROP[k]]);
 for(const k of ['ech','extra','quicSecurity','key','seed'])if(q[k])throw fail(k==='extra'?'unsupported-by-core':'unsupported-settings',k);
 // :authority must name the same host the core sends anyway.
 if(q.authority&&![q.sni,server].includes(q.authority))throw fail('unsupported-settings','authority');
 const insecure=['allowInsecure','insecure','allow_insecure'].some(k=>q[k]!==undefined&&bool(q[k],k));
 if(q.pcs||q.pinSHA256){if(insecure)throw fail('unsupported-settings','pinned certificate');warn(WARN.pin);}
 return {warnings,warn,insecure,fragment:!!q.fragment,mask:q.fm?mask(q.fm):null};
}
// As Xray does: WebSocket and HTTPUpgrade run over HTTP/1.1, so h2 in a link's alpn is dropped for them.
function http1(tls,tr){if(tls&&tls.alpn&&tr&&['ws','httpupgrade'].includes(tr.type)){const a=alpn(tls.alpn).filter(p=>p!=='h2');if(a.length)tls.alpn=a;else delete tls.alpn;}return tls;}
// Hiddify puts usage and expiry in a fake Trojan entry; it is information, not a server.
const INFO_SNI='fake_ip_for_sub_link';
const LINKS={
 vless(uri){
  const u=url(uri),q=params(u.search,[...XRAY,...EXTRA,'encryption','flow']);
  if(q.sni===INFO_SNI)throw fail('skip');
  // VLESS encryption (ML-KEM) exists only in Xray.
  if(q.encryption&&q.encryption!=='none')throw fail('unsupported-by-core','encryption');
  // Transport first: a kcp or xhttp link is reported as such, not by one of its parameters.
  const tr=xrayTransport(q);
  const x=extras(q,u.hostname);if(x.mask)throw fail('unsupported-by-core','finalmask');
  return {name:name(u.hash.slice(1)),warnings:x.warnings,outbound:outbound({type:'vless',server:u.hostname,server_port:u.port,uuid:dec(u.username),...(q.flow&&{flow:q.flow}),tls:http1(xrayTls(q,(q.security||'none').toLowerCase(),x),tr),transport:tr})};
 },
 trojan(uri){
  const u=url(uri),q=params(u.search,[...XRAY,...EXTRA,'peer','flow']);
  if(q.sni===INFO_SNI)throw fail('skip');
  if(q.peer&&!q.sni)q.sni=q.peer;
  // 3x-ui writes flow for Trojan too; sing-box's Trojan has no XTLS flow.
  if(q.flow)throw fail('unsupported-settings','flow');
  // Transport first: a kcp or xhttp link is reported as such, not by one of its parameters.
  const tr=xrayTransport(q);
  const x=extras(q,u.hostname);if(x.mask)throw fail('unsupported-by-core','finalmask');
  return {name:name(u.hash.slice(1)),warnings:x.warnings,outbound:outbound({type:'trojan',server:u.hostname,server_port:u.port||443,password:dec(u.username),tls:http1(xrayTls(q,(q.security||'tls').toLowerCase(),x),tr),transport:tr})};
 },
 // vmess:// + base64 of the v2rayN JSON object.
 vmess(uri){
  const body=uri.slice(8).split('#')[0];let j;
  try{j=JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));}catch{throw fail('invalid-link','vmess json');}
  only(j,['v','ps','add','port','id','aid','scy','net','type','host','path','tls','sni','alpn','fp','mode','pbk','sid',...EXTRA],'vmess');
  const net=str(j.net||'tcp').toLowerCase(),security=str(j.tls||'none').toLowerCase()||'none',type=str(j.type);
  // gRPC mode is "mode" (Marzban) or "type" (v2rayN, 3x-ui); the path holds the service name.
  const q={type:net,...(type&&type!=='none'&&net==='tcp'&&{headerType:type}),...(j.host&&{host:str(j.host)}),...(j.path&&(net==='grpc'?{serviceName:str(j.path)}:{path:str(j.path)})),
   ...(net==='grpc'&&(j.mode||type&&type!=='none')&&{mode:str(j.mode||type)})};
  for(const k of ['sni','alpn','fp','pbk','sid',...EXTRA])if(j[k]!==undefined&&j[k]!==null&&q[k]===undefined)q[k]=typeof j[k]==='object'?JSON.stringify(j[k]):str(j[k]);
  // Transport first: a kcp or xhttp link is reported as such, not by one of its parameters.
  const tr=xrayTransport(q);
  const x=extras(q,str(j.add));if(x.mask)throw fail('unsupported-by-core','finalmask');
  return {name:name(j.ps),warnings:x.warnings,outbound:outbound({type:'vmess',server:j.add,server_port:j.port,uuid:j.id,alter_id:j.aid||0,security:j.scy||'auto',tls:http1(xrayTls(q,security,x),tr),transport:tr})};
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
  const q=params(query,['plugin','udp-over-tcp','type','headerType','security','sni','fp','alpn','path','host',...EXTRA]);if(q.plugin)throw fail('unsupported-settings','plugin');
  // Xray-style panels add type=tcp (plain TCP, what Shadowsocks does anyway); any other transport is refused,
  // and so is Shadowsocks inside TLS (3x-ui can write it, SIP002 clients cannot use it).
  if(q.type&&!['tcp','raw'].includes(q.type.toLowerCase()))throw fail('unsupported-settings','type');
  if(q.headerType&&q.headerType!=='none')throw fail('unsupported-settings','headerType');
  if(q.security&&q.security!=='none')throw fail('unsupported-settings','security '+q.security);
  const x=extras(q,m[1]);if(x.mask)throw fail('unsupported-by-core','finalmask');
  return {name:name(label),warnings:x.warnings,outbound:outbound({type:'shadowsocks',server:m[1],server_port:m[2],method:creds.slice(0,colon).toLowerCase(),password:creds.slice(colon+1)})};
 },
 // hysteria2://auth@host:port/?sni=&insecure=1&obfs=salamander&obfs-password=&mport=20000-30000#name
 hysteria2(uri){
  const u=url(uri.replace(/^hy2:/i,'hysteria2:')),q=params(u.search,['sni','obfs','obfs-password','mport','alpn','security','fp','upmbps','downmbps','minPacketSize','maxPacketSize',...EXTRA]);
  const auth=dec(u.username)+(u.password?':'+dec(u.password):'');
  const ports=q.mport?q.mport.split(',').map(r=>{const [a,b]=r.trim().split('-');return a+':'+(b||a);}):undefined;
  if(q.security&&q.security!=='tls')throw fail('unsupported-settings','security '+q.security);
  // QUIC has no uTLS fingerprint; 3x-ui still writes fp.
  const x=extras(q,u.hostname);
  // Remnawave repeats the salamander obfs as an Xray finalmask; it must agree with obfs-password.
  if(x.mask){if(q.obfs&&q.obfs!=='salamander'||q['obfs-password']&&q['obfs-password']!==x.mask.password)throw fail('invalid-link','obfs');q.obfs='salamander';q['obfs-password']=x.mask.password;}
  if(q['obfs-password']&&!q.obfs)throw fail('invalid-link','obfs');
  const obfs=q.obfs&&{type:q.obfs,password:q['obfs-password'],...(q.minPacketSize&&{min_packet_size:q.minPacketSize}),...(q.maxPacketSize&&{max_packet_size:q.maxPacketSize})};
  return {name:name(u.hash.slice(1)),warnings:x.warnings,outbound:outbound({type:'hysteria2',server:u.hostname,server_port:u.port||443,...(ports&&{server_ports:ports}),
   ...(q.upmbps&&{up_mbps:q.upmbps}),...(q.downmbps&&{down_mbps:q.downmbps}),password:auth,...(obfs&&{obfs}),
   tls:{enabled:true,...(q.sni&&{server_name:q.sni}),...(x.insecure&&{insecure:true}),...(q.alpn&&{alpn:q.alpn})}})};
 },
 // tuic://uuid:password@host:port?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=&allow_insecure=1#name
 tuic(uri){
  const u=url(uri),q=params(u.search,['congestion_control','udp_relay_mode','alpn','sni','disable_sni','security','fp',...EXTRA]);
  if(q.security&&q.security!=='tls')throw fail('unsupported-settings','security '+q.security);
  const x=extras(q,u.hostname);if(x.mask)throw fail('unsupported-by-core','finalmask');
  return {name:name(u.hash.slice(1)),warnings:x.warnings,outbound:outbound({type:'tuic',server:u.hostname,server_port:u.port,uuid:dec(u.username),password:dec(u.password),
   ...(q.congestion_control&&{congestion_control:q.congestion_control}),...(q.udp_relay_mode&&{udp_relay_mode:q.udp_relay_mode}),
   tls:{enabled:true,...(q.sni&&{server_name:q.sni}),...(x.insecure&&{insecure:true}),...(bool(q.disable_sni||'','disable_sni')&&{disable_sni:true}),...(q.alpn&&{alpn:q.alpn})}})};
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
