'use strict';
const fs=require('fs');
const {execFileSync}=require('child_process');
function parse(uri){
 const u=new URL(uri.trim());
 if(u.protocol!=='vless:')throw Error('Expected vless:// profile');
 const q=u.searchParams, allowed=new Set(['type','encryption','security','pbk','fp','sni','sid','spx','flow']);
 for(const k of q.keys())if(!allowed.has(k)||q.getAll(k).length!==1)throw Error('Unsupported or repeated profile field: '+k);
 if(q.get('type')!=='tcp'||q.get('security')!=='reality'||q.get('encryption')!=='none'||q.get('flow')!=='xtls-rprx-vision')throw Error('MVP requires TCP / Reality / Vision / encryption=none');
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(u.username))throw Error('Invalid UUID');
 if(!u.hostname||!u.port||Number(u.port)>65535)throw Error('Invalid endpoint');
 if(!/^[A-Za-z0-9_-]{43}$/.test(q.get('pbk')||''))throw Error('Invalid Reality public key');
 if(!/^(?:[a-f0-9]{2}){0,8}$/i.test(q.get('sid')||''))throw Error('Invalid short ID');
 if(!/^[a-z0-9.-]+$/i.test(q.get('sni')||''))throw Error('Invalid SNI');
 if(!['chrome','firefox','edge','safari','ios','android','random','randomized'].includes(q.get('fp')))throw Error('Unsupported fingerprint');
 return {name:decodeURIComponent(u.hash.slice(1))||'VPN',warnings:q.has('spx')?['Xray spiderX is retained in encrypted source, not used by sing-box.']:[],outbound:{type:'vless',tag:'proxy',server:u.hostname,server_port:Number(u.port),uuid:u.username,flow:q.get('flow'),tls:{enabled:true,server_name:q.get('sni'),utls:{enabled:true,fingerprint:q.get('fp')},reality:{enabled:true,public_key:q.get('pbk'),short_id:q.get('sid')||''}}}};
}
// Link source: TVVPN_PROFILE_FILE, then Windows DPAPI file private/profile.dpapi, then stdin.
function load(){
 if(process.env.TVVPN_PROFILE_FILE)return parse(fs.readFileSync(process.env.TVVPN_PROFILE_FILE,'utf8'));
 if(!fs.existsSync('private/profile.dpapi'))return parse(fs.readFileSync(0,'utf8'));
 const text=execFileSync(process.env.TV_PWSH||'pwsh',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $s=Get-Content -Raw -LiteralPath 'private/profile.dpapi' | ConvertTo-SecureString; [Console]::Write((New-Object System.Net.NetworkCredential('', $s)).Password)"],{encoding:'utf8'});
 return parse(text);
}
function config(p,iface,tun=false,localIP=null){
 return {log:{level:'warn',timestamp:true},dns:{servers:[{type:'https',tag:'remote-dns',server:'1.1.1.1',server_port:443,path:'/dns-query',tls:{enabled:true,server_name:'cloudflare-dns.com'},detour:'proxy'}],final:'remote-dns',strategy:'ipv4_only'},inbounds:[{type:'mixed',tag:'health-proxy',listen:'127.0.0.1',listen_port:17890},...(localIP?[{type:'direct',tag:'local-dns',listen:localIP,listen_port:53}]:[]),...(tun?[{type:'tun',tag:'tun-in',interface_name:'tvvpn0',address:['172.30.247.1/30'],mtu:1400,auto_route:true,auto_redirect:false,strict_route:false,stack:'gvisor',iproute2_table_index:20220,iproute2_rule_index:18000,dns_mode:'hijack'}]:[])],outbounds:[{...p.outbound,bind_interface:iface}],route:{default_interface:iface,rules:[...(localIP?[{inbound:'local-dns',source_ip_cidr:[localIP+'/32'],action:'hijack-dns'},{inbound:'local-dns',action:'reject'}]:[]),{protocol:'dns',action:'hijack-dns'},{port:53,action:'hijack-dns'}],final:'proxy'}};
}
module.exports={parse,load,config};
