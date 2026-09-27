'use strict';
const fs = require('fs');
const base = 'D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/';
function probe(file, tokens, before, after, max) {
  let s;
  try { s = fs.readFileSync(base + file, 'utf8'); }
  catch (e) { console.log('\n######## ' + file + ' READ ERR ' + e.message); return; }
  console.log('\n######## ' + file + ' | len ' + s.length);
  for (const tok of tokens) {
    let i = 0, c = 0;
    while ((i = s.indexOf(tok, i)) >= 0 && c < max) {
      console.log('----- [' + tok + '] @' + i + ' -----');
      console.log(s.slice(Math.max(0, i - before), i + after));
      i += tok.length; c++;
    }
    if (c === 0) console.log('----- [' + tok + '] NONE -----');
  }
}
probe('renderer-DtFVcmkW.js', ['model3.json', 'petModel', 'Live2DModel', 'baseURI', 'file://', '.from('], 320, 320, 3);
probe('renderer-base-Cdn9HcKK.js', ['model3.json', 'Live2DModel', 'petModel'], 320, 320, 3);
probe('settings-BVI_D-HL.js', ['pet-model', 'petModel', 'onPetModelChanged'], 320, 320, 4);
