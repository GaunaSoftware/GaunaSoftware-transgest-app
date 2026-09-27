// Deterministic geometric ink for isolated tests, not a person's signature.
const zlib=require('node:zlib');
module.exports=function syntheticSignature(blank=false){
 const crc=buffer=>{let c=0xffffffff;for(const b of buffer){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const name=Buffer.from(type),n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([n,name,data,sum]);};
 const w=120,h=60,raw=Buffer.alloc((w*4+1)*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*(w*4+1)+1+x*4,ink=!blank&&x>10&&x<110&&Math.abs(y-(15+(x%40)/2))<3;raw[i]=raw[i+1]=raw[i+2]=ink?20:255;raw[i+3]=255;}
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w,0);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=6;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
};
