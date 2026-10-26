'use strict';
const fs=require('fs'),zlib=require('zlib'),cp=require('child_process'),path=require('path'),crypto=require('crypto');
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum]);}
// Original code-rendered launcher icon; no borrowed branding or raster assets.
const size=160,raw=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++){let row=y*(1+size*4);for(let x=0;x<size;x++){let p=row+1+x*4,dx=x-80,dy=y-82,r=Math.hypot(dx,dy);let ring=r>37&&r<45&&!(dy<-15&&Math.abs(dx)<23),stem=Math.abs(dx)<4&&y>28&&y<79;let ink=ring||stem;raw[p]=ink?245:17;raw[p+1]=ink?249:116;raw[p+2]=ink?255:240;raw[p+3]=255;}}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync('app/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
fs.mkdirSync('dist',{recursive:true});
const cli=require.resolve('@webos-tools/cli/bin/ares-package.js');
cp.execFileSync(process.execPath,[cli,'app','-o','dist'],{stdio:'inherit'});
const files=fs.readdirSync('dist').filter(n=>n.endsWith('.ipk'));for(const file of files){const hash=crypto.createHash('sha256').update(fs.readFileSync('dist/'+file)).digest('hex');fs.writeFileSync('dist/'+file+'.sha256',hash+'  '+file+'\n');}
fs.writeFileSync('dist/build.json',JSON.stringify({version:'0.1.0',node:process.version,core:'1.14.3',runtime:'Node.js 16',packages:files},null,2));
