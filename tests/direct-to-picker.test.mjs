import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectToPicker,getDirectToPreviewPoint} from '../src/ui/direct-to-picker.js';
import {setFlightPlan,navigationTarget,completeNavigationPoint} from '../src/radar/routes.js';

// A small DOM surface lets the actual picker event handlers run without dependencies.
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.handlers={};this.value='';this.textContent='';this.classList={add:()=>{}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){(this.handlers[name] ||= []).push(fn);}
  fire(name,event={}){for(const fn of this.handlers[name] || [])fn({target:this,preventDefault(){},stopPropagation(){},...event});}
}
const fixes=[{name:'SUBIX',lon:1,lat:0},{name:'MASIV',lon:2,lat:0},{name:'BIMPA',lon:3,lat:1}];
const off={name:'OFF',lon:4,lat:2};
const descendants=node=>[node,...node.children.flatMap(descendants)];
const buttons=panel=>descendants(panel).filter(n=>n.tagName==='BUTTON');
const rows=panel=>buttons(panel).filter(n=>n.dataset.planIndex != null);
const input=panel=>descendants(panel).find(n=>n.tagName==='INPUT');
const open=(track,index)=>{
  const panel=new Element('div');let closes=0,changes=0;
  buildDirectToPicker(panel,{track,index,onChange:()=>changes++,close:()=>closes++});
  return {panel,get closes(){return closes;},get changes(){return changes;}};
};

globalThis.document={createElement:tag=>new Element(tag)};

test('picker shortcuts preserve the remaining rows across repeated opens and passage',()=>{
  const track={};setFlightPlan(track,fixes);
  let view=open(track);
  assert.deepEqual(rows(view.panel).map(n=>n.textContent),['SUBIX','MASIV','BIMPA']);
  rows(view.panel)[1].fire('click');
  assert.equal(view.closes,1);assert.equal(view.changes,1);
  view=open(track);
  assert.equal(input(view.panel).value,'');
  assert.deepEqual(rows(view.panel).map(n=>n.textContent),['MASIV','BIMPA']);
  assert(!descendants(view.panel).some(n=>n.tagName==='FIELDSET'));
  completeNavigationPoint(track);
  assert.equal(navigationTarget(track).name,'BIMPA');
  assert.deepEqual(rows(open(track).panel).map(n=>n.textContent),['BIMPA']);
});

test('typing a rounded copy of an FPL point resolves uniquely and preserves onward navigation',()=>{
  const track={};setFlightPlan(track,fixes);
  const view=open(track,new Map([['MASIV',[{...fixes[1],lon:2.0000000002}]]]));
  const search=input(view.panel);search.value=' masiv ';search.fire('input');
  assert.equal(buttons(view.panel).filter(n=>n.dataset.pointName==='MASIV').length,1);
  view.panel.fire('keydown',{key:'Enter',target:search});
  assert.equal(view.closes,1);assert.equal(track.directTo.planIndex,1);
  completeNavigationPoint(track);assert.equal(navigationTarget(track).name,'BIMPA');
});

test('off-plan input ends in heading flight, and invalid or ambiguous input never changes navigation',()=>{
  const track={};setFlightPlan(track,fixes);
  const index=new Map([['OFF',[off]],['DUP',[{name:'DUP',lon:5,lat:1},{name:'DUP',lon:6,lat:1}]]]);
  const view=open(track,index),search=input(view.panel),before=JSON.stringify(track);
  for(const value of ['UNKNOWN','DUP']){
    search.value=value;search.fire('input');view.panel.fire('keydown',{key:'Enter',target:search});
    assert.equal(JSON.stringify(track),before);assert.equal(view.closes,0);
    assert(descendants(view.panel).find(n=>n.role==='alert').textContent);
  }
  search.value='OFF';search.fire('input');buttons(view.panel).find(n=>n.dataset.pointName==='OFF').fire('click');
  assert.equal(view.closes,1);assert.equal(track.directTo.planIndex,null);
  completeNavigationPoint(track);assert.equal(track.navigationMode,'heading');assert.equal(navigationTarget(track),null);
});

test('hover and keyboard focus preview points without assigning them and clear on exit or input',()=>{
  const track={};setFlightPlan(track,fixes);
  const {panel}=open(track),row=rows(panel)[1],before=JSON.stringify(track);
  row.fire('pointerenter');assert.equal(getDirectToPreviewPoint(panel).name,'MASIV');
  row.fire('pointerleave');assert.equal(getDirectToPreviewPoint(panel),null);
  row.fire('focus');assert.equal(getDirectToPreviewPoint(panel).name,'MASIV');
  row.fire('blur');assert.equal(getDirectToPreviewPoint(panel),null);
  row.fire('pointerenter');panel.fire('pointerleave');assert.equal(getDirectToPreviewPoint(panel),null);
  row.fire('pointerenter');input(panel).fire('input');assert.equal(getDirectToPreviewPoint(panel),null);
  assert.equal(JSON.stringify(track),before);
});

test('a stale menu cannot redirect a replacement or already-advanced flight plan',()=>{
  const track={};setFlightPlan(track,fixes);
  const view=open(track);completeNavigationPoint(track);
  rows(view.panel)[0].fire('click');assert.equal(view.closes,0);
  setFlightPlan(track,[off]);rows(view.panel)[1].fire('click');
  assert.equal(view.closes,0);assert.equal(navigationTarget(track).name,'OFF');
});
