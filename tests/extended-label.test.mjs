import test from 'node:test';
import assert from 'node:assert/strict';
import {extendedLabelData,extendedSectorSequence} from '../src/ui/panels/extended-label-data.js';
import {radioCallsign} from '../src/radar/radio-callsigns.js';
import {calculateAirSpeeds,calculateGroundSpeedFromInstruction,convertIasToTas,convertMachToTas} from '../src/utils/speed.js';
import {setFlightPlan,assignDirectTo,assignHeading} from '../src/radar/routes.js';

test('ELW formats live values, identifiers, leading zeros and reserved fields',()=>{
  const t={callsign:'WZZ01AB',aircraftType:'A320',wake:'M',departure:'EPWA',destination:'EPKK',
    squawk:'0123',actualFlightLevel:350,clearedFlightLevel:370,expectedCruiseLevel:390,
    heading:359.8,groundSpeed:convertMachToTas(0.78,35000),assignedSpeed:{mode:'Mach',value:0.79}};
  const d=extendedLabelData(t);
  assert.equal(d.radio,'WIZZAIR 01AB');assert.equal(d.transponder,'S/0123');
  assert.equal(d.cfl,'CFL370');assert.equal(d.ecl,'ECL390');assert.equal(d.selectedAltitude,'SEL ALT FL370');
  assert.equal(d.heading,'HDG 000º');assert.equal(d.track,'TRK 000º');
  assert.equal(d.mach,'MN 0.78');assert.match(d.ias,/^IAS \d{3}$/);assert.match(d.gs,/^GS \d{3}$/);
  assert.equal(d.rvsm,'W');assert.equal(d.spacing,'Y');assert.equal(d.rules,'I');
  assert.equal(d.frequency,'XXX,XXX');assert.equal(d.status,'');assert.equal(d.freeText,'');
  assert.equal(d.departure,'EPWA');assert.equal(d.destination,'EPKK');
  t.clearedFlightLevel=null;assert.equal(extendedLabelData(t).selectedAltitude,'SEL ALT FL---');
  assert.equal(extendedLabelData({}).transponder,'S/----');assert.equal(extendedLabelData({}).ias,'IAS ---');
  assert.equal(extendedLabelData({squawk:''}).transponder,'S/----');
  assert.equal(extendedLabelData(null),null);
});

test('ELW route uses the next five drawn fixes and follows approved shortcuts',()=>{
  const t={};const points=Array.from({length:8},(_,i)=>({name:'FIX'+i,lon:i,lat:0}));
  setFlightPlan(t,points,1);assert.equal(extendedLabelData(t).route,'FIX1 FIX2 FIX3 FIX4 FIX5');
  assignHeading(t,180);assert.equal(extendedLabelData(t).route,'FIX1 FIX2 FIX3 FIX4 FIX5');
  assignDirectTo(t,points[5]);assert.equal(extendedLabelData(t).route,'FIX5 FIX6 FIX7');
  assignDirectTo(t,{name:'OFF',lon:1,lat:2});assert.equal(extendedLabelData(t).route,'OFF');
});

test('live IAS/Mach reverse the simulator speed model at low/high levels and with wind',()=>{
  for(const altitude of [1000,24000,43000])for(const mode of ['IAS','Mach']){
    const value=mode==='IAS'?250:0.78;
    for(const wind of [null,{speed:40,direction:90},{speed:40,direction:180}]){
      const gs=calculateGroundSpeedFromInstruction({mode,value},altitude,90,wind);
      const air=calculateAirSpeeds(gs,altitude,90,wind);
      assert(Math.abs((mode==='IAS'?air.ias:air.mach)-value)<1e-8);
    }
  }
  const t={groundSpeed:convertIasToTas(180,1000),actualFlightLevel:10,assignedSpeed:{mode:'IAS',value:250}};
  assert.equal(extendedLabelData(t).ias,'IAS 180','show actual accelerating speed, not clearance');
  assert.equal(calculateAirSpeeds(null,0),null);assert.equal(calculateAirSpeeds(100,null),null);
  assert.equal(calculateAirSpeeds(0,0).ias,0);
});

test('radio identity supports alphanumeric suffixes, explicit names and unknown operator fallback',()=>{
  assert.equal(radioCallsign({callsign:'BAW77'}),'SPEEDBIRD 77');
  assert.equal(radioCallsign({callsign:'LOT001'}),'LOT 001');
  assert.equal(radioCallsign({callsign:'ZZZ12A'}),'ZZZ 12A');
  assert.equal(radioCallsign({callsign:'MSC12',radioCallsign:'Air Cairo 12'}),'AIR CAIRO 12');
});

test('ELW sequence uses ownership colours, next sector, reserved skipped state and XFLs',()=>{
  const t={control:{sector:'ALLFIR',owner:'EDU'},exitFlightLevel:null,
    trajectory:{sequence:[{sector:'EDU',targetLevel:350},{sector:'ALLFIR',targetLevel:350},
      {sector:'APWA',targetLevel:180,skipped:true},{sector:'ESA',targetLevel:350}]}};
  assert.deepEqual(extendedSectorSequence(t),[
    {text:'EDU/350',status:'current'},{text:'ALLFIR/---',status:'next'},
    {text:'APWA/180',status:'skipped'},{text:'ESA/350',status:'later'}]);
  t.control.owner='ALLFIR';t.exitFlightLevel=370;t.sectorExitLevels={ESA:330};
  assert.deepEqual(extendedSectorSequence(t).slice(1),[
    {text:'ALLFIR/370',status:'current'},{text:'APWA/180',status:'skipped'},
    {text:'ESA/330',status:'next'}]);
  assert.deepEqual(extendedSectorSequence(null),[]);
});
