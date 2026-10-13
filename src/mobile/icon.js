const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
<defs><linearGradient id="b" x1="0" x2="1" y1="1" y2="0"><stop stop-color="#071623"/><stop offset="1" stop-color="#20516a"/></linearGradient><linearGradient id="g" x1="0" x2="1"><stop stop-color="#7ad9eb"/><stop offset="1" stop-color="#e0fcff"/></linearGradient></defs>
<rect width="180" height="180" rx="37" fill="url(#b)"/>
<rect x="14" y="14" width="152" height="152" rx="29" fill="#7fd3e4" fill-opacity=".07" stroke="#baf6ff" stroke-opacity=".23" stroke-width="2"/>
<path d="M43 94L75 120L135 55" fill="none" stroke="url(#g)" stroke-width="18" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

export function mobileSvgIcon() {
 return new Response(svg,{headers:{"Content-Type":"image/svg+xml; charset=UTF-8","Cache-Control":"public,max-age=86400","X-Content-Type-Options":"nosniff"}});
}
const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
function int32(v){return new Uint8Array([(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255]);}
function append(parts){
 const size=parts.reduce((total,item)=>total+item.length,0);
 const target=new Uint8Array(size);let offset=0;
 for(const p of parts){target.set(p,offset);offset+=p.length;}
 return target;
}
function crc32(bytes) {
 let crc=0xffffffff;
 for(const b of bytes){
  crc^=b;
  for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
function chunk(name,data) {
 const label=new TextEncoder().encode(name);
 const body=append([label,data]);
 return append([int32(data.length),body,int32(crc32(body))]);
}
function segmentDistance(px,py,ax,ay,bx,by) {
 const dx=bx-ax,dy=by-ay;
 const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
 return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
export async function mobilePngIcon(size=180){
 if(![180,192,512].includes(size))return new Response("invalid icon size",{status:400});
 const width=size,height=size,stride=1+width*4;
 const raw=new Uint8Array(height*stride);
 for(let y=0;y<height;y++){
  const p=y/size;raw[y*stride]=0;
  for(let x=0;x<width;x++){
   const q=x/size,idx=y*stride+1+x*4;
   const rr=Math.min(Math.min(q,1-q),Math.min(p,1-p));
   const circleGlow=Math.max(0,1-Math.hypot(q-.76,p-.14)/.96);
   let red=Math.round(7+19*p+18*circleGlow);
   let green=Math.round(19+28*(1-p)+33*circleGlow);
   let blue=Math.round(31+26*(1-p)+31*circleGlow);
   const rounded=rr<.17&&(Math.hypot(Math.max(.17-q,0,q-.83),Math.max(.17-p,0,p-.83))>.17);
   if(rounded){raw[idx+3]=0;continue;}
   const edge=rr>.074&&rr<.085;
   if(edge){red+=19;green+=38;blue+=44;}
   const d=Math.min(segmentDistance(q,p,.24,.52,.41,.68),segmentDistance(q,p,.41,.68,.75,.32));
   if(d<.047){red=168;green=242;blue=248;}
   else if(d<.068){const t=(.068-d)/.021;red+=Math.round(40*t);green+=Math.round(70*t);blue+=Math.round(79*t);}
   raw[idx]=Math.min(255,red);raw[idx+1]=Math.min(255,green);
   raw[idx+2]=Math.min(255,blue);raw[idx+3]=255;
  }
 }
 const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
 const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
 const header=append([int32(width),int32(height),new Uint8Array([8,6,0,0,0])]);
 const png=append([signature,chunk("IHDR",header),chunk("IDAT",compressed),chunk("IEND",new Uint8Array())]);
 return new Response(png,{headers:{"Content-Type":"image/png","Cache-Control":"public,max-age=86400","X-Content-Type-Options":"nosniff"}});
}
