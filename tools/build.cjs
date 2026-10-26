'use strict';
const fs=require('fs'),zlib=require('zlib'),cp=require('child_process'),path=require('path'),crypto=require('crypto');
const {fetchCore,lock}=require('./fetch-core.cjs');
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum]);}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
// Original code-rendered launcher icon; no borrowed branding or raster assets.
// The letter M drawn as a route TV → server → internet (same geometry as the header mark, 100-unit grid), antialiased by distance.
const size=160,k=size/100,raw=Buffer.alloc(size*(1+size*4)),bg=[17,121,245],route=[[22,74],[22,30],[50,58],[78,30],[78,74]];
const seg=(px,py,[ax,ay],[bx,by])=>{const vx=bx-ax,vy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*vx+(py-ay)*vy)/(vx*vx+vy*vy)));return Math.hypot(px-ax-t*vx,py-ay-t*vy);},cover=d=>Math.max(0,Math.min(1,.5-d*k));
for(let y=0;y<size;y++){let row=y*(1+size*4);for(let x=0;x<size;x++){let p=row+1+x*4,px=(x+.5)/k,py=(y+.5)/k,d=Infinity;for(let i=1;i<route.length;i++)d=Math.min(d,seg(px,py,route[i-1],route[i]));
 let ink=Math.max(cover(d-3.5),cover(Math.hypot(px-22,py-74)-8));
 // Server and internet nodes are rings: blue inside, so the line stops at their edge.
 for(const [cx,cy,r,w] of [[50,58,6.5,4.5],[78,74,8,5]]){const dc=Math.hypot(px-cx,py-cy),outer=cover(dc-r-w/2),inner=cover(dc-r+w/2);ink=ink*(1-outer)+outer-inner;}
 for(let c=0;c<3;c++)raw[p+c]=Math.round(bg[c]+(255-bg[c])*ink);raw[p+3]=255;}}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync('app/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
const core=await fetchCore(),{id,version}=require('../app/appinfo.json');
// Stage the package: UI, TV runtime (setup.cjs installs it into /media/developer/tv-vpn) and the pinned core.
const stage='dist/stage/app';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync(stage+'/runtime',{recursive:true});fs.mkdirSync(stage+'/core');
fs.cpSync('app',stage,{recursive:true});
for(const file of fs.readdirSync('runtime'))fs.copyFileSync('runtime/'+file,stage+'/runtime/'+file);
fs.copyFileSync(path.join(core,'sing-box'),stage+'/core/sing-box');fs.copyFileSync(path.join(core,'LICENSE'),stage+'/core/LICENSE');
fs.copyFileSync('core.lock.json',stage+'/core.lock.json');fs.copyFileSync('THIRD_PARTY_NOTICES',stage+'/THIRD_PARTY_NOTICES');fs.copyFileSync('LICENSE',stage+'/LICENSE');
const cli=require.resolve('@webos-tools/cli/bin/ares-package.js');
cp.execFileSync(process.execPath,[cli,stage,'-o','dist'],{stdio:'inherit'});
const file=`${id}_${version}_all.ipk`;
// Verify what was actually packaged, not the staging copy.
const packaged=require('./ipk.cjs').files('dist/'+file);
const inPkg=name=>{const b=packaged[`usr/palm/applications/${id}/${name}`];if(!b)throw Error('Missing from package: '+name);return b;};
if(sha(inPkg('core/sing-box'))!==lock.binarySha256)throw Error('Packaged core does not match core.lock.json');
for(const name of ['i18n.js','runtime/report.cjs','runtime/setup.cjs','runtime/supervisor.cjs','runtime/profile.cjs','runtime/protocols.cjs','runtime/profiles.cjs','runtime/importer.cjs','runtime/import-server.cjs','vendor/qrcode.js','fonts/manrope-cyrillic.woff2','fonts/manrope-latin.woff2','fonts/OFL.txt','runtime/watchdog.sh','runtime/70-tv-vpn','core/LICENSE','core.lock.json'])inPkg(name);
fs.rmSync('dist/stage',{recursive:true,force:true});
fs.writeFileSync('dist/'+file+'.sha256',sha(fs.readFileSync('dist/'+file))+'  '+file+'\n');
fs.writeFileSync('dist/build.json',JSON.stringify({version,node:process.version,core:lock.version,coreArch:lock.arch,coreSha256:lock.binarySha256,runtime:'Node.js 16',packages:[file]},null,2));
console.log('Built dist/'+file+' with verified core '+lock.version);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
