// Generate a standalone canvas diagnostic with the game's exact terrain/grid coordinates.
// Usage: node --import tsx scripts/render-sgb-path.mjs maps/<map>/<map>.sgb [output.html] [layout.json]
// Open the HTML and use Download PNG, or export canvas.toDataURL() in a browser.
import fs from 'node:fs';
import path from 'node:path';
import { createSgbParser } from '../src/maps/sgb-parser.js';
import { applyPathEdits } from '../pathfinding/astar-integrated.js';

const source = process.argv[2];
if (!source) throw Error('Usage: node --import tsx scripts/render-sgb-path.mjs <map.sgb> [output.html]');
const map = path.basename(source, '.sgb'), folder = path.dirname(source);
const paint = JSON.parse(fs.readFileSync(path.join(folder, `${map}_path.json`)));
const layoutFile = process.argv[4] || path.join(folder, `${map}.json`);
const layout = JSON.parse(fs.readFileSync(layoutFile));
const editsFile = path.join(folder, `${map}_path_edits.json`);
if (fs.existsSync(editsFile)) applyPathEdits(paint, JSON.parse(fs.readFileSync(editsFile)).edits);
const parser = createSgbParser(null);parser.parse(fs.readFileSync(source));
const bounds = layout.bounds || 256, samples = 641, heights = [];
for (let row = 0; row < samples; row++) {
  for (let column = 0; column < samples; column++) {
    const x = bounds - column / (samples - 1) * bounds * 2;
    const z = bounds - row / (samples - 1) * bounds * 2;
    // Inverse of the runtime terrain root: yaw 90 degrees, horizontal mirror.
    heights.push(Math.round(parser.sampleHeight(-z, -x) * 1000) / 1000);
  }
}
const data = { map, paint, layout, bounds, samples, heights };
const output = process.argv[3] || `artifacts/${map}-path.html`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Passability · ${map}</title>
<style>body{margin:0;background:#e8edf3;font-family:Arial}canvas{display:block;width:100%;height:auto}button{position:fixed;right:12px;top:12px;padding:12px;cursor:pointer}</style>
<button id="download">Download PNG</button><canvas id="map"></canvas><script>
(() => {
const data=${JSON.stringify(data).replaceAll('<', '\\u003c')};
const canvas=document.getElementById('map');canvas.width=3400;canvas.height=3540;
const ctx=canvas.getContext('2d'),left=115,top=235,size=3180,bounds=data.bounds;
const px=x=>left+(bounds-x)/(bounds*2)*size,pz=z=>top+(bounds-z)/(bounds*2)*size;
ctx.fillStyle='#f5f7fb';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.fillStyle='#18283b';ctx.font='bold 34px Arial';ctx.fillText(data.layout.name.toUpperCase()+' — проходимость в игровом масштабе',36,55);
ctx.font='23px Arial';ctx.fillStyle='#34465d';
const grid=data.paint.grid;
ctx.fillText('Клетка = '+grid.cellWorld+' единицы из SGB. Сетка: X '+grid.originX+'…'+(grid.originX+grid.sizeX*grid.cellWorld)+', Z '+grid.originZ+'…'+(grid.originZ+grid.sizeZ*grid.cellWorld)+'.',36,100);
ctx.fillText('Рельеф, HQ, strategic points и relics — исходные игровые координаты. Масштаб и ориентация совпадают с игрой.',36,137);
ctx.fillText('2 — проход    3, 7 — закрыто    70, 71 — другие закрытые значения SGB    R — relic    P — strategic point',36,176);
const relief=document.createElement('canvas');relief.width=relief.height=data.samples;const rctx=relief.getContext('2d'),pixels=rctx.createImageData(data.samples,data.samples);
const height=(c,r)=>data.heights[Math.max(0,Math.min(data.samples-1,r))*data.samples+Math.max(0,Math.min(data.samples-1,c))];
for(let r=0;r<data.samples;r++)for(let c=0;c<data.samples;c++){
 const dx=(height(c+1,r)-height(c-1,r))/(bounds*4/(data.samples-1)),dz=(height(c,r+1)-height(c,r-1))/(bounds*4/(data.samples-1));
 const shade=(-dx*.45-dz*.55+1)/Math.hypot(dx,dz,1),tone=Math.max(45,Math.min(210,105+shade*45+height(c,r)*.22)),index=(r*data.samples+c)*4;
 pixels.data[index]=tone*.93;pixels.data[index+1]=tone;pixels.data[index+2]=tone*.96;pixels.data[index+3]=255;
}
rctx.putImageData(pixels,0,0);ctx.drawImage(relief,left,top,size,size);
ctx.textAlign='center';ctx.font='18px Arial';ctx.fillStyle='#18283b';
for(let coordinate=-bounds;coordinate<=bounds;coordinate+=32){ctx.fillText(String(coordinate),px(coordinate),top-12);ctx.fillText(String(coordinate),left-36,pz(coordinate)+6);}
ctx.font='bold 22px Arial';ctx.fillText('X ←',left+size-30,top-40);ctx.fillText('Z ↑',left-70,top+32);
const colors={2:'rgba(45,100,71,.13)',3:'rgba(234,170,37,.52)',7:'rgba(191,63,63,.42)'};
const cellPixels=grid.cellWorld/(bounds*2)*size;
ctx.font=Math.floor(cellPixels*.73)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
for(let row=0;row<grid.sizeZ;row++)for(let column=0;column<grid.sizeX;column++){
 const value=data.paint.rows[row][column],x=px(grid.originX+(column+1)*grid.cellWorld),y=pz(grid.originZ+(row+1)*grid.cellWorld);
 ctx.fillStyle=colors[value]||'rgba(154,58,94,.58)';ctx.fillRect(x,y,cellPixels,cellPixels);
 ctx.strokeStyle='rgba(215,226,235,.35)';ctx.lineWidth=.65;ctx.strokeRect(x,y,cellPixels,cellPixels);
 ctx.strokeStyle='rgba(20,33,39,.8)';ctx.lineWidth=1.7;ctx.strokeText(String(value),x+cellPixels/2,y+cellPixels/2);ctx.fillStyle='#fff';ctx.fillText(String(value),x+cellPixels/2,y+cellPixels/2);
}
ctx.strokeStyle='#4de1f2';ctx.lineWidth=3;ctx.strokeRect(px(grid.originX+grid.sizeX*grid.cellWorld),pz(grid.originZ+grid.sizeZ*grid.cellWorld),cellPixels*grid.sizeX,cellPixels*grid.sizeZ);
function marker(point,label,color){
 const x=px(point.x),y=pz(point.z);ctx.fillStyle=color;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.stroke();
 ctx.font='bold 20px Arial';ctx.textAlign='left';ctx.textBaseline='bottom';const width=ctx.measureText(label).width;let labelX=x+9;if(labelX+width>left+size)labelX=x-width-9;
 ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(labelX-3,y-25,width+6,24);ctx.fillStyle=color;ctx.fillText(label,labelX,y-2);
}
let relic=0,point=0;for(const p of data.layout.strategicPoints||[])marker(p,p.kind==='relic'?'R'+(++relic):'P'+(++point),p.kind==='relic'?'#b87500':'#008b58');
for(const p of data.layout.positions)marker(p,'HQ '+p.faction.toUpperCase(),p.team==='red'?'#b6324d':'#235fb5');
ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.font='21px Arial';ctx.fillStyle='#34465d';
ctx.fillText('Голубая рамка — границы сетки; за ними показан рельеф. Сетка взята из DATAIMPA без растяжения и ручных сдвигов.',36,3470);
ctx.fillText('Игра использует этот же '+data.map+'_path.json для A*, обхода препятствий и проверки шагов движения.',36,3504);
window.__pathPreview={ready:true,map:data.map,grid:data.paint.grid,counts:data.paint.counts};
document.getElementById('download').onclick=()=>{const link=document.createElement('a');link.download=data.map+'-true-grid-scale.png';link.href=canvas.toDataURL('image/png');link.click()};
})();
</script></html>`);
console.log('Wrote', output);
