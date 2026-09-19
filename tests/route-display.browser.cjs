// NODE_PATH may point to shared Playwright; BROWSER_CHANNEL=chrome uses installed Chrome.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><link rel="stylesheet" href="/styles.css">
<main id="main" style="width:100vw;height:100vh"><canvas id="radar"></canvas><div id="track-overlay"></div></main>
<script type="module">
import {initCanvas} from '/src/render/canvas.js';
import {drawFrame} from '/src/render/draw.js';
import {createCamera} from '/src/render/camera.js';
import {createState} from '/src/core/state.js';
import {createBus} from '/src/core/bus.js';
import {createTrack} from '/src/radar/tracks.js';
import {assignDirectTo,setFlightPlan} from '/src/radar/routes.js';
const state=createState(createBus()),project=(lon,lat)=>[lon*100,lat*100];state.map.project=project;
const plans=[[
 {name:'PAST',lon:1,lat:1},{name:'ALPHA',lon:4.8,lat:1.6},{name:'BRAVO',lon:7,lat:2.9},{name:'CHARLIE',lon:9.2,lat:2.2}
],[{name:'DELTA',lon:5,lat:5.2},{name:'ECHO',lon:7.5,lat:4.8},{name:'FOXTROT',lon:9.5,lat:5.8}]];
state.air.tracks=plans.map((waypoints,i)=>createTrack({id:'route-'+i,callsign:i?'LOT202':'LOT101',lon:i?8.2:2.2,lat:i?4.8:1.8,
 heading:90,groundSpeed:450,actualFlightLevel:350,clearedFlightLevel:350,aircraftType:'B738',destination:'EPWA',
 labelSide:'right',labelOffset:{x:30,y:-20},flightPlan:{waypoints,nextIndex:i?0:1}},project,i));
state.air.navigationIndex=new Map(plans.flat().map(p=>[p.name,[p]]));
const canvas=initCanvas(document.querySelector('canvas')),camera=createCamera(canvas.el),overlay=document.querySelector('#track-overlay');
const renderLog={names:[],arcs:[],lines:[]};
for(const [method,key] of [['fillText','names'],['arc','arcs'],['lineTo','lines']]){
 const original=canvas.ctx[method].bind(canvas.ctx);
 canvas.ctx[method]=(...args)=>{if(canvas.ctx.fillStyle==='#00ff55' && method!=='lineTo' || method==='lineTo' && canvas.ctx.strokeStyle==='#00ff55'){
  const m=canvas.ctx.getTransform();renderLog[key].push({args,transform:[m.a,m.d,m.e,m.f],lineWidth:canvas.ctx.lineWidth});
 }return original(...args);};
}
function render(){for(const key in renderLog)renderLog[key]=[];drawFrame(canvas,camera,state,overlay);}
window.routeTest={state,camera,canvas,renderLog,render,assignDirectTo,setFlightPlan,plans};
function frame(){render();requestAnimationFrame(frame);}frame();
</script>`;
(async()=>{
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
   const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep))throw Error('Outside project');
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');
   res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1100,height:700},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='http://127.0.0.1:'+server.address().port;
  await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.routeTest);
  const labels=page.locator('.track-label'),first=labels.nth(0),second=labels.nth(1);
  const expectNames=async expected=>{await page.waitForFunction(e=>JSON.stringify(window.routeTest.renderLog.names.map(c=>c.args[0]))===JSON.stringify(e),expected);};
  const a=['ALPHA','BRAVO','CHARLIE'],b=['DELTA','ECHO','FOXTROT'];
  await expectNames([]);
  // Editor preview is temporary and closing/switching pickers clears it.
  await first.locator('.destination').click();await expectNames(a);
  assert.equal(await page.locator('[data-type="direct-to"]').count(),1);
  assert.equal(await page.locator('[data-plan-index]').count(),3);
  if(process.env.ROUTE_EDITOR_SCREENSHOT)await page.screenshot({path:process.env.ROUTE_EDITOR_SCREENSHOT});
  await page.keyboard.press('Escape');await expectNames([]);
  await first.locator('.destination').click();await page.mouse.click(30,650);await expectNames([]);
  await first.locator('.destination').click();await second.locator('.destination').click();await expectNames(b);
  await page.keyboard.press('Escape');await expectNames([]);
  // R requires actual hover, opens no picker, persists off-label and supports multiple tracks.
  await page.mouse.move(30,650);await page.keyboard.press('r');await expectNames([]);
  await first.hover();await page.keyboard.press('r');await expectNames(a);
  assert.equal(await page.locator('.track-picker').count(),0);
  await page.mouse.move(30,650);await expectNames(a);
  await second.hover();await page.keyboard.press('Shift+R');await expectNames([...a,...b]);
  // Repeats and modified shortcuts do not flip the flag.
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'r',repeat:true,bubbles:true})));
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'r',ctrlKey:true,bubbles:true})));await expectNames([...a,...b]);
  // Opening another route's editor and closing it preserves toggled routes.
  await second.hover();await page.keyboard.press('r');await expectNames(a);
  await second.locator('.destination').click();await expectNames([...a,...b]);
  await first.hover();await page.keyboard.press('r');
  assert.equal(await page.locator('.direct-to__input').first().inputValue(),'r');
  await page.keyboard.press('Escape');await expectNames(a);
  // A pinned route draws once while its editor is open; turning it off leaves the preview until close.
  await first.locator('.destination').click();await expectNames(a);
  assert.equal((await page.evaluate(()=>window.routeTest.renderLog.names)).length,3);
  await page.evaluate(()=>document.activeElement.blur());await first.hover();await page.keyboard.press('r');await expectNames(a);
  await page.keyboard.press('Escape');await expectNames([]);
  // Pan/zoom and aircraft movement change geometry; names and markers retain CSS dimensions.
  await first.hover();await page.keyboard.press('r');await second.hover();await page.keyboard.press('r');await expectNames([...a,...b]);
  await page.evaluate(()=>{const t=window.routeTest;t.camera.x=50;t.camera.y=30;t.camera.z=1.1;t.state.air.tracks[0].x+=10;t.render();});
  const geometry=await page.evaluate(()=>window.routeTest.renderLog.names[0]);
  [2.2,2.2,-110,-66].forEach((value,i)=>assert(Math.abs(geometry.transform[i]-value)<1e-4,JSON.stringify(geometry.transform)));
  const arc=await page.evaluate(()=>window.routeTest.renderLog.arcs[0]);
  assert(Math.abs(arc.args[2]*1.1-3)<1e-8);
  if(process.env.ROUTE_SCREENSHOT)await page.screenshot({path:process.env.ROUTE_SCREENSHOT});
  // A direct shortcut updates the displayed route immediately and removes passed/skipped fixes.
  await page.evaluate(()=>{const t=window.routeTest;t.assignDirectTo(t.state.air.tracks[0],t.plans[0][2],{planIndex:2});});
  await expectNames(['BRAVO','CHARLIE',...b]);
  // Removed tracks clear both their label and any editor preview, without affecting other toggles.
  await first.locator('.destination').click();
  await page.evaluate(()=>window.routeTest.state.air.tracks.splice(0,1));await expectNames(b);
  assert.equal(await page.locator('.track-picker').count(),0);assert.equal(await labels.count(),1);
  await page.evaluate(()=>window.routeTest.state.air.tracks=[]);await expectNames([]);
  await page.keyboard.press('r');assert.equal(await labels.count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: route editor lifecycle, independent hover toggles, typing/repeat guards, markers/names, pan/zoom, direct changes and removal.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
