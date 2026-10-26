'use strict';
const {run,upload,quote}=require('./tv.cjs'),fs=require('fs');
const {id,version}=require('../app/appinfo.json');
(async()=>{
 const file=`dist/${id}_${version}_all.ipk`,remote='/media/developer/tv-vpn/tv-vpn.ipk';
 await upload(file,remote,'600');
 const payload=JSON.stringify({id,ipkUrl:remote,subscribe:true});
 const r=await run('timeout 25 luna-send -i -f luna://com.webos.appInstallService/dev/install '+quote(payload),null,true,true);
 fs.writeFileSync('dist/install.txt',r.out+r.stderr);
 console.log(r.out.slice(-2500));
 const check=await run('test -f /media/developer/apps/usr/palm/applications/'+id+'/appinfo.json && echo INSTALLED',null,true);
 if(!check.out.includes('INSTALLED'))throw Error('Package not confirmed installed');
 const installed=await run('sha256sum /media/developer/apps/usr/palm/applications/'+id+'/app.js',null,true);
 // webOS CLI minifies JavaScript; compare against the actual package payload.
 const cp=require('child_process'),data=cp.execFileSync('tar',['-xOf',file,'data.tar.gz']);
 const packaged=cp.execFileSync('tar',['-xzOf','-','usr/palm/applications/'+id+'/app.js'],{input:data});
 const expected=require('crypto').createHash('sha256').update(packaged).digest('hex');
 if(!installed.out.startsWith(expected))throw Error('Installed application does not match the current build');
 const launched=await run('timeout 12 luna-send -n 1 -f luna://com.webos.applicationManager/launch '+quote(JSON.stringify({id})),null,true,true);
 if(!/"returnValue"\s*:\s*true/.test(launched.out))throw Error('Installed but app launch not confirmed');
 console.log('Application installed and launch confirmed');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
