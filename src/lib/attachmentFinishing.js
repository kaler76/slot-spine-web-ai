// Finishing rules: never erase exterior ink or punch a permanent hole in a held prop.
// Coordinates of approved polygons are in original-image space, not sheet space.
export const ATTACHMENT_RULES_VERSION = "2026-10-02.zeus.1";
const ARM = /^braccio_(sx|dx)$/;
const PROP = /^oggetto(?:_|$)/;
const error = (a, b) => (Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3;
const light = a => .2126*a[0]+.7152*a[1]+.0722*a[2];
function pixel(p, x, y) {
  const u=Math.round(x-p.x),v=Math.round(y-p.y);
  if(u<0||v<0||u>=p.width||v>=p.height)return [0,0,0,0];
  const i=(v*p.width+u)*4;return p.rgba.subarray(i,i+4);
}
function inside(x,y,poly) {
  let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const [ax,ay]=poly[i],[bx,by]=poly[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)yes=!yes;
  }
  return yes;
}
function validPolygon(poly) {
  if(!Array.isArray(poly)||poly.length<3||poly.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new Error("Maschera raccordo non valida");
}
function cropOverlay(source, polygon, name, parent, pivot) {
  validPolygon(polygon);
  const x=Math.max(source.x,Math.floor(Math.min(...polygon.map(p=>p[0]))));
  const y=Math.max(source.y,Math.floor(Math.min(...polygon.map(p=>p[1]))));
  const x1=Math.min(source.x+source.width,Math.ceil(Math.max(...polygon.map(p=>p[0]))));
  const y1=Math.min(source.y+source.height,Math.ceil(Math.max(...polygon.map(p=>p[1]))));
  const width=x1-x,height=y1-y;
  if(width<=0||height<=0)throw new Error("Maschera fuori dal pezzo sorgente");
  const rgba=new Uint8ClampedArray(width*height*4);let area=0;
  for(let v=0;v<height;v++)for(let u=0;u<width;u++) {
    const a=pixel(source,x+u,y+v);if(!a[3])continue;
    let n=0;for(const dx of [.25,.75])for(const dy of [.25,.75])if(inside(x+u+dx,y+v+dy,polygon))n++;
    if(!n)continue;const i=(v*width+u)*4;rgba.set(a,i);rgba[i+3]=Math.round(a[3]*n/4);if(rgba[i+3]>128)area++;
  }
  if(!area)throw new Error("Maschera senza pixel visibili");
  return {name,parent,pivot:{...pivot},x,y,width,height,rgba,area,motionLocked:true,matchError:0};
}
function sourceImage(original) {
  if(!original?.rgba||!Number.isInteger(original.width)||!Number.isInteger(original.height))throw new Error("Immagine originale necessaria per il raccordo");
  return {...original,x:0,y:0};
}
function assertOverlap(a,b) {
  for(let y=a.y;y<a.y+a.height;y++)for(let x=a.x;x<a.x+a.width;x++)if(pixel(a,x,y)[3]>128&&pixel(b,x,y)[3]>128)return;
  throw new Error("Copertura senza sovrapposizione con il pezzo da coprire");
}

/** Conservative automatic seam repair: only dark boundary pixels whose opaque parent
 * is a better match to the original. Exterior silhouette and original dark ink survive.
 * No painted/generated RGB is introduced. Ambiguous exposed cutlines remain unresolved. */
export function repairJointInk(arm,parent,original,{radius=24}={}) {
  const out={...arm,rgba:Uint8ClampedArray.from(arm.rgba)};const src=sourceImage(original);let changed=0;
  if(!arm.pivot)return {piece:out,changed};
  for(let v=0;v<arm.height;v++)for(let u=0;u<arm.width;u++) {
    const x=arm.x+u,y=arm.y+v;
    if(Math.hypot(x-arm.pivot.x,y-arm.pivot.y)>radius)continue;
    const p=pixel(arm,x,y),back=pixel(parent,x,y),ref=pixel(src,x,y);
    if(p[3]<32||back[3]<250||ref[3]<250||light(p)>75||light(ref)-light(p)<35)continue;
    const boundary=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>pixel(arm,x+dx,y+dy)[3]<128);
    if(!boundary||error(back,ref)>25||error(p,ref)<error(back,ref)+25)continue;
    out.rgba[(v*arm.width+u)*4+3]=0;changed++;
  }
  return {piece:out,changed};
}

/** Apply explicit reusable recipes. No implicit semantic segmentation from color.
 * A cape mask must be approved (or produced by a separately validated segmenter).
 * Returns copies: master textures and complete lightning/sword/staff remain intact.
 * Draw-order constraints are stable and cycle checked. */
export function finishAttachments(input,{original,rules=[],maxPieces=16}={}) {
  const pieces=input.map(p=>({...p,pivot:p.pivot&&{...p.pivot},rgba:Uint8ClampedArray.from(p.rgba)}));
  const changes=[],edges=[];const byName=new Map(pieces.map(p=>[p.name,p]));
  if(byName.size!==pieces.length)throw new Error("Nomi dei pezzi duplicati");
  const need=name=>{const p=byName.get(name);if(!p)throw new Error(`Pezzo mancante: ${name}`);return p;};
  const add=p=>{if(byName.has(p.name))throw new Error(`Nome copertura duplicato: ${p.name}`);pieces.push(p);byName.set(p.name,p);};
  for(const rule of rules) {
    if(rule.type==="jointInk") {
      const arm=need(rule.arm),parent=need(arm.parent);
      if(!ARM.test(arm.name))throw new Error("Pulizia raccordo limitata alle braccia");
      const r=repairJointInk(arm,parent,original,{radius:rule.radius??24});arm.rgba=r.piece.rgba;
      changes.push({type:rule.type,piece:arm.name,pixels:r.changed});
    } else if(rule.type==="shoulderCover") {
      const parent=need(rule.parent),arm=need(rule.arm);
      if(!ARM.test(arm.name)||arm.parent!==parent.name)throw new Error("Copertura spalla: gerarchia incoerente");
      const source=rule.source==="original"?sourceImage(original):need(rule.source??parent.name);
      const cover=cropOverlay(source,rule.polygon,rule.name??`copertura_${arm.name}`,parent.name,arm.pivot);
      assertOverlap(cover,arm);add(cover);edges.push([parent.name,cover.name],[arm.name,cover.name]);
      // Shoulder pivot lets the torso mesh reparent this overlay to the chest bone.
      changes.push({type:rule.type,piece:cover.name,source:rule.source??parent.name,mask:rule.polygon});
    } else if(rule.type==="grip") {
      const arm=need(rule.arm),object=need(rule.object);
      if(!ARM.test(arm.name)||!PROP.test(object.name)||object.parent!==arm.name)throw new Error("Presa: oggetto e braccio non condividono la gerarchia prevista");
      const cover=cropOverlay(arm,rule.polygon,rule.name??`presa_${arm.name}`,arm.name,object.pivot);
      assertOverlap(cover,object);add(cover);edges.push([arm.name,cover.name],[object.name,cover.name]);
      // Child props and the finger overlay inherit exactly the same arm motion.
      object.motionLocked=true;
      changes.push({type:rule.type,piece:cover.name,object:object.name,mask:rule.polygon,wholeObjectPreserved:true});
    } else throw new Error(`Regola raccordo sconosciuta: ${rule.type}`);
  }
  if(pieces.length>maxPieces)throw new Error(`Raccordi: ${pieces.length} pezzi oltre il limite ${maxPieces}`);
  const ordered=[...pieces].sort((a,b)=>(a.order??Infinity)-(b.order??Infinity));const result=[];
  while(ordered.length) {
    const i=ordered.findIndex(p=>edges.every(([back,front])=>front!==p.name||result.some(q=>q.name===back)));
    if(i<0)throw new Error("Ciclo nell'ordine delle coperture");
    result.push(ordered.splice(i,1)[0]);
  }
  result.forEach((p,i)=>p.order=i);
  return {pieces:result,changes,version:ATTACHMENT_RULES_VERSION,front:edges};
}

/** Structural gate for one-click callers. Warnings are not silently treated as approval. */
export function inspectAttachments(pieces) {
  const issues=[];const names=new Set(pieces.map(p=>p.name));
  for(const p of pieces) {
    if(!p.name.startsWith("presa_")&&!p.name.startsWith("copertura_"))continue;
    if(!names.has(p.parent))issues.push({piece:p.name,code:"missing-parent"});
    if(!p.motionLocked)issues.push({piece:p.name,code:"independent-overlay-motion"});
  }
  return {ok:!issues.length,issues,version:ATTACHMENT_RULES_VERSION};
}
