// One quantity and one occupied length; legacy fields are synchronized on save.
export const PALLET_SIZES = {europeo:[1.2,0.8], americano:[1.2,1], medio:[0.8,0.6]};
const number = v => Number(String(v ?? '').replace(',', '.')) || 0;
export function palletLayout(count, type='europeo', stack=false) {
 const size=PALLET_SIZES[type];
 const n=Math.max(0,Math.ceil(number(count)/(stack?2:1)));
 if(!size||!n)return {length:0,width:0};
 // Keep both orientations, choosing the shortest complete set of rows.
 const options=[size,[size[1],size[0]]].map(([depth,width])=>({depth,width,per:Math.floor(2.4/width+1e-8)}));
 const best=[{length:0,width:0}];
 for(let i=1;i<=Math.min(n,10000);i++){
  best[i]=options.map(o=>{const used=Math.min(i,o.per),prev=best[i-used];return {length:prev.length+o.depth,width:Math.max(prev.width,used*o.width)};}).sort((a,b)=>a.length-b.length||a.width-b.width)[0];
 }
 const result=best[Math.min(n,10000)];
 return {length:Math.round(result.length*100)/100,width:Math.round(result.width*100)/100};
}
export const cargoCount=p=>number(p.palets_cantidad === "" || p.palets_cantidad == null ? p.bultos : p.palets_cantidad);
export function cargoLength(p){
 if(number(p.carga_largo_m)>0)return number(p.carga_largo_m);
 const ml=number(p.metros_lineales);
 if(ml>0&&ml!==13.65)return ml;
 const auto=p.palets_tipo==='granel'?0:palletLayout(cargoCount(p),p.palets_tipo||'europeo',p.palets_apilables).length;
 return auto||ml;
}
export function cargoPayload(p){
 const count=cargoCount(p),length=cargoLength(p);
 return {...p,bultos:count,palets_cantidad:p.palets_tipo==='granel'?null:count,carga_largo_m:length||null,metros_lineales:length||null};
}
export function updateCargo(p,key,value){
 const previous=palletLayout(cargoCount(p),p.palets_tipo||'europeo',p.palets_apilables);
 const next={...p,[key]:value};
 if(key==='palets_cantidad'){next.bultos=value;}
 if(key==='carga_largo_m'){next.metros_lineales=value;next._cargoLengthManual=true;}
 if(key==='carga_ancho_m')next._cargoWidthManual=true;
 if(['palets_cantidad','palets_tipo','palets_apilables'].includes(key)){
  const layout=palletLayout(cargoCount(next),next.palets_tipo||'europeo',next.palets_apilables);
  const oldLength=cargoLength(p);
  const manualLength=p._cargoLengthManual||(oldLength>0&&oldLength!==13.65&&Math.abs(oldLength-previous.length)>0.001);
  const manualWidth=p._cargoWidthManual||(number(p.carga_ancho_m)>0&&Math.abs(number(p.carga_ancho_m)-previous.width)>0.001);
  if(!manualLength){next.carga_largo_m=layout.length||'';next.metros_lineales=layout.length||'';}
  if(!manualWidth)next.carga_ancho_m=layout.width||'';
 }
 return next;
}
