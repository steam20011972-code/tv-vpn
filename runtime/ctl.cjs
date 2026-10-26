'use strict';
const net=require('net'),C=require('./common.cjs');
const [action,arg]=process.argv.slice(2);
if(!['start','stop','status','set-autostart','diagnostics','restore-network','profiles','select','delete'].includes(action)||(action==='set-autostart'&&!['on','off'].includes(arg))||(['select','delete'].includes(action)&&!/^[a-z0-9]{8,16}$/.test(arg||''))){console.log(JSON.stringify({ok:false,error:'Invalid action'}));process.exit(1);}
C.command('/usr/bin/node',[C.BASE+'/runtime/launch.cjs','manual']);
let tries=0;
function connect(){let connected=false;const s=net.createConnection(C.RUN+'/control.sock');s.on('connect',()=>{connected=true;s.end(JSON.stringify({action,arg})+'\n');});let data='';s.on('data',b=>data+=b);s.on('end',()=>{if(data)process.stdout.write(data);});s.on('error',()=>{if(!connected&&tries++<20)setTimeout(connect,150);else{console.log(JSON.stringify({ok:false,error:'Controller unavailable'}));process.exitCode=1;}});s.setTimeout(15000,()=>s.destroy());}
connect();
