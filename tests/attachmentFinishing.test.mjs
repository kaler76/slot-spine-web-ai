import {test} from 'node:test';
import assert from 'node:assert/strict';
import {finishAttachments,repairJointInk,inspectAttachments} from '../src/lib/attachmentFinishing.js';
import {piecesToCharacterParts} from '../src/lib/characterFromPieces.js';
import {buildCharacterSkeleton} from '../src/lib/characterSkeleton.js';
import {addTorsoBreathMesh} from '../src/lib/torsoMesh.js';
import {toSpine41} from '../src/lib/spineFormat.js';
import {poseAt} from '../src/lib/animationSim.js';
function part(name,x,y,width,height,color,parent=null,order=0,pivot={x,y}) {
 const rgba=new Uint8ClampedArray(width*height*4);for(let i=0;i<rgba.length;i+=4)rgba.set(color,i);
 return {name,x,y,width,height,rgba,parent,order,pivot,area:width*height};
}
const set=(p,x,y,c)=>p.rgba.set(c,((y-p.y)*p.width+x-p.x)*4);
const at=(p,x,y)=>[...p.rgba.slice(((y-p.y)*p.width+x-p.x)*4,((y-p.y)*p.width+x-p.x)*4+4)];
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
function fixture(){
 const torso=part('busto',10,10,30,65,[120,30,180,255],null,0,{x:25,y:55});
 const arm=part('braccio_dx',2,15,20,15,[230,150,90,255],'busto',1,{x:20,y:18});
 const bolt=part('oggetto',5,0,4,65,[255,210,30,255],'braccio_dx',2,{x:7,y:23});
 return [torso,arm,bolt];
}
test('presa: fulmine intero e pixel master intatti; dita sopra il fulmine',()=>{
 const input=fixture(),before=input.map(p=>Uint8ClampedArray.from(p.rgba));
 const r=finishAttachments(input,{rules:[{type:'grip',arm:'braccio_dx',object:'oggetto',polygon:rect(3,18,10,9)}]});
 const by=Object.fromEntries(r.pieces.map(p=>[p.name,p]));
 assert.deepEqual(by.oggetto.rgba,before[2]);assert.deepEqual(by.braccio_dx.rgba,before[1]);
 assert.ok(by.presa_braccio_dx.order>by.oggetto.order);assert.equal(by.presa_braccio_dx.parent,'braccio_dx');
 assert.deepEqual(at(by.presa_braccio_dx,7,23),[230,150,90,255]);
 assert.ok(by.oggetto.motionLocked);assert.ok(inspectAttachments(r.pieces).ok);
 input.forEach((p,i)=>assert.deepEqual(p.rgba,before[i]));
});
test('raccordo: elimina solo il bordo interno quando il genitore corrisponde all originale',()=>{
 const parent=part('busto',0,0,20,20,[210,140,80,255]);
 const arm=part('braccio_dx',5,5,10,10,[210,140,80,255],'busto',1,{x:5,y:5});
 for(let y=5;y<15;y++)set(arm,5,y,[5,5,5,255]);
 const original={width:20,height:20,rgba:parent.rgba};
 const r=repairJointInk(arm,parent,original,{radius:3});
 assert.equal(at(r.piece,5,5)[3],0);assert.equal(at(r.piece,5,14)[3],255);
 assert.deepEqual(at(r.piece,6,6),at(arm,6,6));assert.equal(at(arm,5,5)[3],255);
});
test('raccordo: conserva inchiostro originale, contorno esterno e genitore trasparente',()=>{
 const parent=part('busto',5,0,15,20,[210,140,80,255]);const arm=part('braccio_dx',0,0,10,10,[0,0,0,255],'busto',1,{x:5,y:5});
 const ref=part('ref',0,0,20,20,[210,140,80,255]);set(ref,9,4,[0,0,0,255]);set(parent,9,5,[210,140,80,0]);
 const r=repairJointInk(arm,parent,{width:20,height:20,rgba:ref.rgba},{radius:20});
 assert.equal(at(r.piece,0,5)[3],255);assert.equal(at(r.piece,9,4)[3],255);assert.equal(at(r.piece,9,5)[3],255);
});
test('mantello: copertura originale davanti alla spalla, solidale al busto, senza cambiare il braccio',()=>{
 const input=fixture(),src=part('ref',0,0,80,80,[0,0,0,0]);
 for(let y=15;y<23;y++)for(let x=16;x<25;x++)set(src,x,y,[120,30,180,255]);
 const r=finishAttachments(input,{original:{width:80,height:80,rgba:src.rgba},rules:[{type:'shoulderCover',arm:'braccio_dx',parent:'busto',source:'original',polygon:rect(16,15,9,8)}]});
 const p=r.pieces.find(p=>p.name==='copertura_braccio_dx');assert.equal(p.parent,'busto');assert.deepEqual(p.pivot,input[1].pivot);
 assert.ok(p.order>r.pieces.find(p=>p.name==='braccio_dx').order);assert.deepEqual(at(p,18,18),[120,30,180,255]);
 assert.deepEqual(r.pieces.find(p=>p.name==='braccio_dx').rgba,input[1].rgba);
});
test('presa: 61 fotogrammi, oggetto e dita ereditano la stessa matrice del braccio',()=>{
 const r=finishAttachments(fixture(),{rules:[{type:'grip',arm:'braccio_dx',object:'oggetto',polygon:rect(3,18,10,9)}]});
 const {parts}=piecesToCharacterParts(r.pieces);const json=toSpine41(buildCharacterSkeleton({parts}));
 assert.equal(parts.find(p=>p.partKey==='oggetto').animationType,'static');
 for(let f=0;f<=60;f++){
  const w=poseAt(json,f/15);const a=w.braccio_dx,o=w.oggetto,h=w.presa_braccio_dx;
  for(const k of ['a','b','c','d']){assert.ok(Math.abs(a[k]-o[k])<1e-9);assert.ok(Math.abs(a[k]-h[k])<1e-9);}
  assert.ok(Math.hypot(o.tx-h.tx,o.ty-h.ty)<1e-6);
 }
});
test('mantello: la copertura segue il petto nella mesh di respiro',()=>{
 const input=fixture();const r=finishAttachments(input,{rules:[{type:'shoulderCover',arm:'braccio_dx',parent:'busto',polygon:rect(16,15,8,8)}]});
 const {parts}=piecesToCharacterParts(r.pieces);const j=addTorsoBreathMesh(buildCharacterSkeleton({parts}),parts).json;
 assert.equal(j.bones.find(b=>b.name==='copertura_braccio_dx').parent,'busto_petto');
});
test('ricetta non valida: niente maschere fuori posto, gerarchie arbitrarie o piu di 16 pezzi',()=>{
 const input=fixture();
 assert.throws(()=>finishAttachments(input,{rules:[{type:'grip',arm:'braccio_dx',object:'oggetto',polygon:rect(100,100,4,4)}]}),/fuori/);
 assert.throws(()=>finishAttachments(input,{maxPieces:3,rules:[{type:'grip',arm:'braccio_dx',object:'oggetto',polygon:rect(3,18,10,9)}]}),/limite/);
 assert.throws(()=>finishAttachments(input,{rules:[{type:'grip',arm:'braccio_dx',object:'busto',polygon:rect(3,18,10,9)}]}),/gerarchia/);
 assert.equal(input.length,3);
});
test('nessuna ricetta: pixel e ordine preesistenti conservati',()=>{
 const input=fixture();const r=finishAttachments(input);input.forEach((p,i)=>{assert.deepEqual(r.pieces[i].rgba,p.rgba);assert.equal(r.pieces[i].order,p.order);});
});
