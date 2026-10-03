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

import { acceptDetectedPose } from "../src/lib/poseRecovery.js";

/** Posa MediaPipe sintetica (normalizzata) di una figura in piedi. */
function standing() {
  const P = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const set = (i, x, y, v = 0.9) => (P[i] = { x, y, visibility: v });
  set(0, 0.5, 0.15); set(11, 0.6, 0.3); set(12, 0.4, 0.3); set(13, 0.65, 0.45); set(14, 0.35, 0.45);
  set(15, 0.68, 0.58); set(16, 0.32, 0.58); set(23, 0.56, 0.6); set(24, 0.44, 0.6);
  for (const i of [17, 19, 21]) set(i, 0.69, 0.62);
  for (const i of [18, 20, 22]) set(i, 0.31, 0.62);
  return P;
}

test("illustrazione: anche coperte dall'abito (visibilità bassa) accettate", () => {
  const P = standing();
  P[23].visibility = 0.1; P[24].visibility = 0.08;
  assert.doesNotThrow(() => acceptDetectedPose(P));
});

test("illustrazione: dita nei guanti (non visibili) ricostruite oltre il polso", () => {
  const P = standing();
  for (const i of [17, 19, 21]) P[i] = { x: NaN, y: NaN, visibility: 0 };
  const R = acceptDetectedPose(P);
  for (const i of [17, 19, 21]) {
    assert.ok(Number.isFinite(R[i].x) && R[i].y > P[15].y, `dito ${i} oltre il polso`);
  }
});

test("posa collassata o senza polsi: rifiutata (si passa al recupero o ai click)", () => {
  const P = standing();
  P[11] = { ...P[12] };
  assert.throws(() => acceptDetectedPose(P), /pose_collapsed/);
  const Q = standing();
  Q[15].visibility = 0.1;
  assert.throws(() => acceptDetectedPose(Q), /pose_point/);
});
