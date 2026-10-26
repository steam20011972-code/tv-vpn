'use strict';
// Run explicitly over SSH. Keep the profile unless --delete-profile is requested.
const C=require('./common.cjs');
const hook='/var/lib/webosbrew/init.d/70-tv-vpn';
if(C.fs.existsSync(hook)){
 if(!C.fs.readFileSync(hook,'utf8').includes(C.BASE+'/runtime/launch.cjs'))throw Error('Boot hook ownership mismatch');
 C.fs.unlinkSync(hook);
}
C.write('preferences.json',{autostart:false,desired:false});
const s=C.read('run/supervisor.json');if(s)C.killOwned(s.pid,s.identity,C.BASE+'/runtime/supervisor.cjs');
let recovered=false;
for(let i=0;i<10;i++){if(C.cleanup()){recovered=true;break;}C.command('sleep',['0.5'],true);}
if(!recovered)throw Error('Recovery incomplete; files retained for recovery');
// Remove only our explicitly named runtime files. The base directory is retained.
for(const directory of ['bin','runtime','run']){
 const target=C.BASE+'/'+directory;
 C.fs.rmSync(target,{recursive:true,force:true});
}
for(const file of ['config.json','preferences.json','tv-vpn.ipk'])try{C.fs.unlinkSync(C.BASE+'/'+file);}catch{}
if(process.argv.includes('--delete-profile'))try{C.fs.unlinkSync(C.BASE+'/profile.json');}catch{}
console.log(JSON.stringify({ok:true,profileRetained:!process.argv.includes('--delete-profile')}));
