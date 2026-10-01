import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePose,validateRecovery} from '../src/lib/poseRecovery.js';
import {preserveSharedGrip} from '../src/lib/sharedGrip.js';
function fixture(){const landmarks=Array.from({length:33},()=>({x:.5,y:.2,visibility:.9}));for(const [i,x,y]of [[11,.65,.3],[12,.35,.3],[13,.8,.45],[14,.2,.45],[15,.6,.5],[16,.4,.5],[23,.6,.7],[24,.4,.7]])landmarks[i]={x,y,visibility:.9};return {landmarks,confidence:.9,heldObjects:[{label:'spada',hands:['left','right']}]};}
test('valid local detection never calls paid fallback',async()=>{const f=fixture();const r=await resolvePose({detect:()=>({landmarks:[f.landmarks]}),recover:()=>assert.fail(),width:100,height:200});assert.equal(r.source,'mediapipe');assert.equal(r.landmarks[11].x,65);});
test('missing pose recovers automatically and preserves shared grip',async()=>{let calls=0;const r=await resolvePose({detect:()=>({landmarks:[]}),recover:async()=>{calls++;return fixture()},width:100,height:200});assert.equal(calls,1);assert.equal(r.source,'vision');assert.equal(r.heldObjects[0].hands.length,2);});
test('low confidence local pose triggers recovery',async()=>{const f=fixture();f.landmarks[11].visibility=.1;assert.equal((await resolvePose({detect:()=>({landmarks:[f.landmarks]}),recover:()=>fixture(),width:100,height:100})).source,'vision');});
test('out of bounds, collapsed and uncertain model results are rejected',()=>{for(const mutate of [f=>f.landmarks[11].x=2,f=>f.landmarks[12]=f.landmarks[11],f=>f.confidence=.3,f=>f.heldObjects[0].hands=['left','left']]){const f=fixture();mutate(f);assert.throws(()=>validateRecovery(f));}});
test('failed fallback cannot produce successful pose',async()=>{await assert.rejects(resolvePose({detect:()=>({}),recover:()=>({}),width:100,height:100}));});
test('two hand grip freezes only arms and objects without mutating input',()=>{const p=[{partKey:'braccio_sx',role:'arm',animationType:'sway'},{partKey:'oggetto',role:'accessory',animationType:'sway'},{partKey:'testa',role:'head',animationType:'sway'}];const r=preserveSharedGrip(p,fixture().heldObjects);assert.equal(r[0].animationType,'static');assert.equal(r[1].animationType,'static');assert.equal(r[2].animationType,'sway');assert.equal(p[0].animationType,'sway');assert.equal(preserveSharedGrip(p,[]),p);});

import { landmarksFromClicks, MANUAL_POINTS } from '../src/lib/poseRecovery.js';
test('posa manuale: 9 click -> 33 landmark validi, punti cliccati invariati', () => {
  const clicks = { nose:{x:500,y:300}, shoulderSx:{x:650,y:600}, shoulderDx:{x:350,y:600}, elbowSx:{x:700,y:800}, elbowDx:{x:300,y:800}, wristSx:{x:600,y:900}, wristDx:{x:420,y:900}, hipSx:{x:600,y:1100}, hipDx:{x:400,y:1100} };
  const L = landmarksFromClicks(clicks);
  assert.equal(L.length, 33);
  assert.ok(L.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)));
  for (const p of MANUAL_POINTS) { assert.equal(L[p.index].x, clicks[p.key].x); assert.equal(L[p.index].visibility, 0.95); }
  assert.ok(L[7].x > L[0].x && L[8].x < L[0].x, 'orecchio sinistro dal lato della spalla sinistra');
  assert.throws(() => landmarksFromClicks({ ...clicks, hipDx: undefined }));
});
