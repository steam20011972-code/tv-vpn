'use strict';
const fs=require('fs');
const {execFileSync}=require('child_process');
const {parse,outbound}=require('./protocols.cjs');
const IPV4=/^\d+\.\d+\.\d+\.\d+$/;
// Link source: TVVPN_PROFILE_FILE, then Windows DPAPI file private/profile.dpapi, then stdin.
function load(){
 if(process.env.TVVPN_PROFILE_FILE)return parse(fs.readFileSync(process.env.TVVPN_PROFILE_FILE,'utf8'));
 if(!fs.existsSync('private/profile.dpapi'))return parse(fs.readFileSync(0,'utf8'));
 const text=execFileSync(process.env.TV_PWSH||'pwsh',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $s=Get-Content -Raw -LiteralPath 'private/profile.dpapi' | ConvertTo-SecureString; [Console]::Write((New-Object System.Net.NetworkCredential('', $s)).Password)"],{encoding:'utf8'});
 return parse(text);
}
// serverIPs: IPv4 addresses of a domain server, resolved by the caller before the tunnel exists.
// They reach the core through a hosts server used only as the outbound's domain resolver: resolving the
// server through remote-dns would need the proxy that is not connected yet, and the physical DNS is
// pointed at our own listener while the VPN runs. App DNS queries still go to remote-dns.
function config(p,iface,tun=false,localIP=null,serverIPs=null){
 const proxy=outbound(p.outbound),domain=!IPV4.test(proxy.server);
 if(domain&&!(serverIPs&&serverIPs.length&&serverIPs.every(ip=>IPV4.test(ip))))throw Error('server-not-found');
 return {log:{level:'warn',timestamp:true},dns:{servers:[{type:'https',tag:'remote-dns',server:'1.1.1.1',server_port:443,path:'/dns-query',tls:{enabled:true,server_name:'cloudflare-dns.com'},detour:'proxy'},...(domain?[{type:'hosts',tag:'server-hosts',predefined:{[proxy.server]:serverIPs}}]:[])],final:'remote-dns',strategy:'ipv4_only'},inbounds:[{type:'mixed',tag:'health-proxy',listen:'127.0.0.1',listen_port:17890},...(localIP?[{type:'direct',tag:'local-dns',listen:localIP,listen_port:53}]:[]),...(tun?[{type:'tun',tag:'tun-in',interface_name:'tvvpn0',address:['172.30.247.1/30'],mtu:1400,auto_route:true,auto_redirect:false,strict_route:false,stack:'gvisor',iproute2_table_index:20220,iproute2_rule_index:18000,dns_mode:'hijack'}]:[])],outbounds:[{...proxy,bind_interface:iface,...(domain&&{domain_resolver:{server:'server-hosts',strategy:'ipv4_only'}})}],route:{default_interface:iface,rules:[...(localIP?[{inbound:'local-dns',source_ip_cidr:[localIP+'/32'],action:'hijack-dns'},{inbound:'local-dns',action:'reject'}]:[]),{protocol:'dns',action:'hijack-dns'},{port:53,action:'hijack-dns'}],final:'proxy'}};
}
// Connected = the trace over the tunnel shows the server as exit, or at least not the direct exit measured
// before the tunnel (domain servers, CDN fronting, a separate exit IP). Without a direct exit only the server counts.
function exitOk(ip,serverIPs,directIP){return !!ip&&(serverIPs.includes(ip)||!!directIP&&ip!==directIP);}
module.exports={parse,load,config,exitOk};
