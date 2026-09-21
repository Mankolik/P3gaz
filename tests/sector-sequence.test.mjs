import test from 'node:test';
import assert from 'node:assert/strict';
import {filterSectorSequence} from '../src/radar/sector-sequence.js';
const visit=(sector,start,end,closed=true)=>({sector,entry:{distanceNm:start,level:350},
  [closed?'exit':'end']:{distanceNm:end,level:350},targetLevel:350});

test('three-mile threshold is inclusive, uses flown route distance, and preserves the target entry',()=>{
  const raw=[visit('EDU',0,20),visit('A',20,22.99),visit('B',22.99,25.99),
    visit('ALLFIR',25.99,29.001),visit('ESA',29.001,40,false)];
  const filtered=filterSectorSequence(raw);
  assert.deepEqual(filtered.sequence.map(v=>v.sector),['EDU','ALLFIR','ESA']);
  assert.equal(filtered.sequence[1].entry.distanceNm,25.99);
  assert.deepEqual(filtered.omitted.map(v=>v.sector),['A','B']);
  assert.equal(raw.length,5);
});

test('same-sector visits merge across omitted sectors; terminal stays and the current visit survive',()=>{
  const raw=[visit('ALLFIR',0,1),visit('APWA',1,4),visit('ALLFIR',4,10),visit('ESA',10,11,false)];
  const filtered=filterSectorSequence(raw).sequence;
  assert.deepEqual(filtered.map(v=>v.sector),['ALLFIR','ESA']);
  assert.equal(filtered[0].entry.distanceNm,0);assert.equal(filtered[0].exit.distanceNm,10);
  assert.equal(filtered[1].entry.distanceNm,10);
});
