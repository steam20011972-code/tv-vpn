'use strict';
const fs=require('fs'),zlib=require('zlib'),cp=require('child_process'),path=require('path'),crypto=require('crypto');
const {fetchCore,lock}=require('./fetch-core.cjs');
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum]);}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
// Original code-rendered launcher icon; no borrowed branding or raster assets.
const size=160,raw=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++){let row=y*(1+size*4);for(let x=0;x<size;x++){let p=row+1+x*4,dx=x-80,dy=y-82,r=Math.hypot(dx,dy);let ring=r>37&&r<45&&!(dy<-15&&Math.abs(dx)<23),stem=Math.abs(dx)<4&&y>28&&y<79;let ink=ring||stem;raw[p]=ink?245:17;raw[p+1]=ink?249:116;raw[p+2]=ink?255:240;raw[p+3]=255;}}
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
for(const name of ['runtime/setup.cjs','runtime/supervisor.cjs','runtime/profile.cjs','runtime/profiles.cjs','runtime/importer.cjs','runtime/import-server.cjs','vendor/qrcode.js','runtime/watchdog.sh','runtime/70-tv-vpn','core/LICENSE','core.lock.json'])inPkg(name);
fs.rmSync('dist/stage',{recursive:true,force:true});
fs.writeFileSync('dist/'+file+'.sha256',sha(fs.readFileSync('dist/'+file))+'  '+file+'\n');
fs.writeFileSync('dist/build.json',JSON.stringify({version,node:process.version,core:lock.version,coreArch:lock.arch,coreSha256:lock.binarySha256,runtime:'Node.js 16',packages:[file]},null,2));
console.log('Built dist/'+file+' with verified core '+lock.version);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
