import test from 'node:test';
import assert from 'node:assert/strict';
import { routeDisplayPoints, drawTrackRoutes } from '../src/render/route-display.js';
import { setFlightPlan, assignDirectTo, assignHeading, completeNavigationPoint } from '../src/radar/routes.js';

const fixes=[{name:'PAST',lon:0,lat:0},{name:'NEXT',lon:1,lat:1},{name:'JOIN',lon:2,lat:1},{name:'LAST',lon:3,lat:2}];
const aircraft=()=>{const t={x:0,y:0};setFlightPlan(t,fixes,1);return t;};
const names=t=>routeDisplayPoints(t).map(p=>p.name);

test('route display advances with the flight plan and retains the filed route on a heading',()=>{
  const t=aircraft();assert.deepEqual(names(t),['NEXT','JOIN','LAST']);
  completeNavigationPoint(t);assert.deepEqual(names(t),['JOIN','LAST']);
  assignHeading(t,90);assert.deepEqual(names(t),['JOIN','LAST']);
  assert.deepEqual(routeDisplayPoints({}),[]);
});

test('route display follows direct shortcuts, rejoin and end-here without resurrecting skipped legs',()=>{
  const t=aircraft(),off={name:'OFF',lon:1.5,lat:3};
  assignDirectTo(t,fixes[2],{planIndex:2});assert.deepEqual(names(t),['JOIN','LAST']);
  assignDirectTo(t,off,{rejoinIndex:3});assert.deepEqual(names(t),['OFF','LAST']);
  assignDirectTo(t,off);assert.deepEqual(names(t),['OFF']);
  const old=t.directTo;
  setFlightPlan(t,fixes);t.directTo=old;t.navigationMode='direct';
  assert.deepEqual(names(t),['OFF']);
});

const recorder=()=>{
  const calls=[];
  const ctx=Object.fromEntries(['save','restore','beginPath','moveTo','lineTo','stroke','arc','fill','strokeText','fillText'].map(name=>[name,(...args)=>calls.push([name,...args])]));
  return {ctx,calls};
};

test('multiple toggles and editor preview share green geometry without duplicate route drawing',()=>{
  const a=aircraft(),b=aircraft();a.routeVisible=true;b.x=5;
  const {ctx,calls}=recorder();
  drawTrackRoutes(ctx,{z:2},[a,b],(lon,lat)=>[lon*100,lat*100],b);
  assert.equal(calls.filter(c=>c[0]==='moveTo').length,2);
  assert.equal(calls.filter(c=>c[0]==='lineTo').length,6);
  assert.equal(calls.filter(c=>c[0]==='arc').length,6);
  assert.deepEqual(calls.filter(c=>c[0]==='fillText').map(c=>c[1]),['NEXT','JOIN','LAST']);
  assert.equal(ctx.fillStyle,'#00ff55');assert.match(ctx.font,/5.5px/);
  const once=recorder();drawTrackRoutes(once.ctx,{z:1},[a],(lon,lat)=>[lon,lat],a);
  assert.equal(once.calls.filter(c=>c[0]==='lineTo').length,3);
  const hidden=recorder();a.routeVisible=false;
  drawTrackRoutes(hidden.ctx,{z:1},[a,b],(lon,lat)=>[lon,lat]);
  assert(!hidden.calls.some(c=>c[0]==='lineTo'));
});

test('invalid or unavailable projection never draws a shortcut across missing geometry',()=>{
  const t=aircraft();t.routeVisible=true;
  t.flightPlan.waypoints[2]={name:'BAD',lon:NaN,lat:1};
  const {ctx,calls}=recorder();drawTrackRoutes(ctx,{z:1},[t],(lon,lat)=>[lon,lat]);
  assert.deepEqual(calls.filter(c=>c[0]==='fillText').map(c=>c[1]),['NEXT']);
  const none=recorder();drawTrackRoutes(none.ctx,{z:1},[t],null);
  assert.deepEqual(none.calls,[]);
});

test('hover adds a cyan aircraft-to-fix segment while preserving the green route',()=>{
  const t=aircraft(),before=JSON.stringify(t),{ctx,calls}=recorder();
  const strokes=[];ctx.stroke=()=>strokes.push(ctx.strokeStyle);
  drawTrackRoutes(ctx,{z:2},[t],(lon,lat)=>[lon*100,lat*100],t,fixes[2]);
  assert.deepEqual(strokes,['#00ff55','#00ffff']);
  assert.deepEqual(calls.filter(c=>c[0]==='lineTo').at(-1),['lineTo',200,100]);
  assert.equal(ctx.lineWidth,0.75);
  assert.equal(JSON.stringify(t),before);
  const cleared=recorder();drawTrackRoutes(cleared.ctx,{z:1},[t],(lon,lat)=>[lon,lat],t);
  assert.equal(cleared.calls.filter(c=>c[0]==='lineTo').length,3);
  const closed=recorder();drawTrackRoutes(closed.ctx,{z:1},[t],(lon,lat)=>[lon,lat],null,fixes[2]);
  assert(!closed.calls.some(c=>c[0]==='lineTo'));
});
