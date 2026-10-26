'use strict';
const fs=require('fs'),{run,upload}=require('./tv.cjs');
(async()=>{
 const stop=await run('test ! -S /media/developer/tv-vpn/run/control.sock || /usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs stop',null,true);
 if(stop.code)throw Error('Cannot stop installed controller');
 // Do not replace files underneath an active supervisor.
 const recovered=await run("if [ -f /media/developer/tv-vpn/runtime/common.cjs ]; then /usr/bin/node -e 'const C=require(\"/media/developer/tv-vpn/runtime/common.cjs\"); const s=C.read(\"run/supervisor.json\"); if(s)C.killOwned(s.pid,s.identity,C.BASE+\"/runtime/supervisor.cjs\"); if(!C.cleanup())process.exit(1);'; fi",null,true);
 if(recovered.code)throw Error('Recovery incomplete; runtime not replaced');
 await run('mkdir -p /media/developer/tv-vpn/runtime; chmod 700 /media/developer/tv-vpn/runtime',null,true);
 for(const file of fs.readdirSync('runtime'))if(/\.(cjs|sh)$/.test(file))await upload('runtime/'+file,'/media/developer/tv-vpn/runtime/'+file,file.endsWith('.sh')?'700':'600');
 await upload('tools/profile.cjs','/media/developer/tv-vpn/runtime/profile.cjs','600');
 console.log('Runtime deployed');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
