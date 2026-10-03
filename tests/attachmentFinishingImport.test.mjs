import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PNG} from 'pngjs';
import {importExplodedSheet} from '../src/lib/explodedSheet.js';
const read=url=>{const p=PNG.sync.read(fs.readFileSync(url));return{width:p.width,height:p.height,rgba:p.data};};
test('raccordi: importatore blocca ricette anche valide su una tavola non fedele',()=>{
 const dir=new URL('./fixtures/exploded/folletto_ridisegnata/',import.meta.url);
 const original=read(new URL('original.png',dir)),sheet=read(new URL('sheet.png',dir));
 const landmarks=JSON.parse(fs.readFileSync(new URL('landmarks.json',dir))).landmarks.map(([x,y,v])=>({x,y,visibility:v}));
 assert.throws(()=>importExplodedSheet({sheet,original,landmarks,attachmentRules:[{type:'jointInk',arm:'braccio_dx',radius:24}]}),/Raccordi non applicati/);
});
