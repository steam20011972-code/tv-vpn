'use strict';
const {load,config}=require('../runtime/profile.cjs');
const {run,quote}=require('./tv.cjs');
(async()=>{
 const active=await run('test ! -f /media/developer/tv-vpn/run/lease.json',null,true);
 if(active.code)throw Error('Stop VPN and restore network before importing a profile');
 const p=load(); const net=await run('ip -4 route show default',null,true);
 const iface=net.out.match(/\bdev\s+([a-zA-Z0-9_.:-]+)/)?.[1]; if(!iface)throw Error('No default interface');
 // A domain server is resolved on this PC (same LAN); the supervisor resolves it again on the TV at every start.
 const ips=/^\d+\.\d+\.\d+\.\d+$/.test(p.outbound.server)?null:(await require('dns').promises.lookup(p.outbound.server,{all:true,family:4})).map(a=>a.address);
 let c=config(p,iface,process.argv.includes('--tun'),null,ips);
 if(process.argv.includes('--tun-probe'))c.inbounds.push({type:'tun',tag:'tun-probe',interface_name:'tvvpnprobe',address:['172.30.247.1/30'],auto_route:false,auto_redirect:false,stack:'gvisor'});
 let r=await run('umask 077; cat > /media/developer/tv-vpn/config.json',Buffer.from(JSON.stringify(c)),true);if(r.code)throw Error('Upload failed');
 r=await run('/media/developer/tv-vpn/bin/sing-box check -c /media/developer/tv-vpn/config.json',null,true);
 if(r.code)throw Error('Core rejected config: '+[p.outbound.uuid,p.outbound.password,p.outbound.server].filter(Boolean).reduce((s,secret)=>s.replaceAll(secret,'[redacted]'),r.stderr));
 await run('umask 077; cat > /media/developer/tv-vpn/profile.json',Buffer.from(JSON.stringify(p)),true);
 console.log(JSON.stringify({validated:true,interface:iface,mode:process.argv.slice(2),warnings:p.warnings}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
