// Build game navigation + feet heights from the exported Source 2 GNV and
// world collision mesh. The standalone maps/dotamap viewer is read-only input.
// GNV layout follows ValveResourceFormat's GridNavFile reader (https://s2v.app).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.join(root,'maps/dotamap');
const target=path.join(root,'maps/dotamap-game/surface.json');
const gridBytes=fs.readFileSync(path.join(source,'navigation/dota.gnv'));
if(gridBytes.readUInt32LE(0)!==0xFADEBEAD)throw Error('Invalid Dota grid navigation signature');
const edge=gridBytes.readFloatLE(4),width=gridBytes.readInt32LE(16),height=gridBytes.readInt32LE(20);
const minX=gridBytes.readInt32LE(24),minY=gridBytes.readInt32LE(28);
if(gridBytes.length!==32+width*height)throw Error('Invalid Dota grid dimensions');
const scale=.0254,step=edge*scale,sizeX=height,sizeZ=width,originX=minY*edge*scale,originZ=minX*edge*scale;
const flags=gridBytes.subarray(32),heights=new Float64Array(sizeX*sizeZ).fill(-Infinity);
const raw=fs.readFileSync(path.join(source,'geometry/terrain-collision.glb'));
const length=raw.readUInt32LE(12),gltf=JSON.parse(raw.toString('utf8',20,20+length));
const binOffset=20+length+8;
function attribute(index){
 const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView];
 return {a,offset:binOffset+(v.byteOffset||0)+(a.byteOffset||0),stride:v.byteStride||({SCALAR:1,VEC3:3}[a.type])*(a.componentType===5123?2:4)};
}
let triangles=0;
for(const node of gltf.nodes||[]){
 if(node.mesh===undefined||node.name!=='physics_group')continue;
 const m=node.matrix;
 for(const primitive of gltf.meshes[node.mesh].primitives){
  const pos=attribute(primitive.attributes.POSITION),idx=attribute(primitive.indices);
  const vertices=new Float64Array(pos.a.count*3);
  for(let i=0;i<pos.a.count;i++){
   const o=pos.offset+i*pos.stride,x=raw.readFloatLE(o),y=raw.readFloatLE(o+4),z=raw.readFloatLE(o+8);
   vertices[i*3]=m[0]*x+m[4]*y+m[8]*z+m[12];
   vertices[i*3+1]=m[1]*x+m[5]*y+m[9]*z+m[13];
   vertices[i*3+2]=m[2]*x+m[6]*y+m[10]*z+m[14];
  }
  const getIndex=i=>idx.a.componentType===5123?raw.readUInt16LE(idx.offset+i*idx.stride):raw.readUInt32LE(idx.offset+i*idx.stride);
  for(let i=0;i<idx.a.count;i+=3){
   const ai=getIndex(i)*3,bi=getIndex(i+1)*3,ci=getIndex(i+2)*3;
   const ax=vertices[ai],ay=vertices[ai+1],az=vertices[ai+2],bx=vertices[bi],by=vertices[bi+1],bz=vertices[bi+2],cx=vertices[ci],cy=vertices[ci+1],cz=vertices[ci+2];
   const denom=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
   if(Math.abs(denom)<1e-9)continue;
   const nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay),ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az),nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
   if(Math.abs(ny)<Math.hypot(nx,ny,nz)*.35)continue;
   const x0=Math.max(0,Math.ceil((Math.min(ax,bx,cx)-originX)/step-.5)),x1=Math.min(sizeX-1,Math.floor((Math.max(ax,bx,cx)-originX)/step-.5));
   const z0=Math.max(0,Math.ceil((Math.min(az,bz,cz)-originZ)/step-.5)),z1=Math.min(sizeZ-1,Math.floor((Math.max(az,bz,cz)-originZ)/step-.5));
   for(let r=z0;r<=z1;r++)for(let c=x0;c<=x1;c++){
    const x=originX+(c+.5)*step,z=originZ+(r+.5)*step;
    const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denom,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denom,w=1-u-v;
    if(u<-.00001||v<-.00001||w<-.00001)continue;
    const y=u*ay+v*by+w*cy,k=r*sizeX+c;
    heights[k]=Math.max(heights[k],y);
   }
   triangles++;
  }
 }
}
const rows=Array.from({length:sizeZ},()=>Array(sizeX)),queue=new Int32Array(heights.length);let head=0,tail=0,missingOpen=0;
for(let r=0;r<sizeZ;r++)for(let c=0;c<sizeX;c++){
 const f=flags[c*width+r],k=r*sizeX+c,open=!!(f&1)&&!(f&(2|4|8));
 rows[r][c]=open&&Number.isFinite(heights[k])?2:7;
 if(open&&!Number.isFinite(heights[k]))missingOpen++;
 if(Number.isFinite(heights[k]))queue[tail++]=k;
}
while(head<tail){
 const k=queue[head++],r=Math.floor(k/sizeX),c=k%sizeX;
 for(const n of [c>0?k-1:-1,c<sizeX-1?k+1:-1,r>0?k-sizeX:-1,r<sizeZ-1?k+sizeX:-1])if(n>=0&&!Number.isFinite(heights[n])){heights[n]=heights[k];queue[tail++]=n}
}
const heightRows=Array.from({length:sizeZ},(_,r)=>Array.from({length:sizeX},(_,c)=>Math.round(heights[r*sizeX+c]*100)));
const result={source:'Dota 2 .gnv and world_physics collision export; ValveResourceFormat / Source 2 Viewer',authoritativeWalkability:true,grid:{sizeX,sizeZ,cellWorld:step,originX,originZ,frame:'world'},rows,heightUnit:.01,heights:heightRows};
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(result)+'\n');
console.log({target,grid:result.grid,walkableCells:rows.flat().filter(n=>n===2).length,missingOpen,triangles});
