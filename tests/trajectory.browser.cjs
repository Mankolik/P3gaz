const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><link rel="stylesheet" href="/styles.css"><main id="main" style="width:100vw;height:100vh"><div id="track-overlay"></div></main>
<script type="module">
import {createSectorIndex} from '/src/radar/sectors.js';
import {createAirspaceIndex} from '/src/radar/airspace.js';
import {updateTrafficControl,advanceTraffic} from '/src/radar/traffic-control.js';
import {setFlightPlan} from '/src/radar/routes.js';
import {createBus} from '/src/core/bus.js';
import {syncTrackLabels} from '/src/render/tracks.js';
import {mountSectorPanel} from '/src/ui/panels/sector-panel.js';
const feature=(properties,a,b)=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[[[a,-1],[b,-1],[b,1],[a,1],[a,-1]]]}});
const airspaceIndex=createAirspaceIndex(createSectorIndex([{features:[feature({sector:'TEST',vertical:'LOW',min_fl:95,max_fl:660},0,4)]}]),
 {features:[feature({AV_AIRSPAC:'EPWWFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},0,4),feature({AV_AIRSPAC:'EDUUUIR',MIN_FLIGHT:0,MAX_FLIGHT:999},-5,0),feature({AV_AIRSPAC:'ESAAFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},4,8)]});
const t={id:'TEST',callsign:'LOT123',aircraftType:'A320',lon:-2,lat:0,heading:90,groundSpeed:450,
 actualFlightLevel:350,clearedFlightLevel:350,plannedEntryLevel:350,expectedCruiseLevel:380,exitFlightLevel:null,labelOffset:{x:40,y:0}};
setFlightPlan(t,[{name:'MIDDLE',lon:2,lat:0},{name:'END',lon:6,lat:0}]);
const state={bus:createBus(),air:{tracks:[t],airspaceIndex,controlledSector:'ALLFIR'},map:{}};
const overlay=document.querySelector('#track-overlay');mountSectorPanel(document.querySelector('#main'),overlay,state);
const render=()=>{updateTrafficControl(state);syncTrackLabels(overlay,[{track:t,x:180,y:170,zoom:1}]);state.bus.emit('tick',0);};
window.test={t,state,render,advance(seconds){advanceTraffic(state,seconds);render();}};render();
</script>`;
(async()=>{
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
   const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+path.sep))throw Error('Outside repository');
   res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)]||'text/plain');
   res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1100,height:700}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.test);
  const label=page.locator('.track-label'),primary=label.locator('.level-primary button');
  assert.match(await label.getAttribute('class'),/status-inbound/);
  assert.equal(await label.locator('.level-primary').getAttribute('data-field'),'plannedEntryLevel');
  await label.hover();assert.equal(await page.locator('.sector-panel__sequence').textContent(),'EDU → ALLFIR → ESA');
  assert.match(await page.locator('.sector-panel__crossings').textContent(),/Current: EDU\nPredicted entry · FL · distance ahead\nALLFIR · FL350 · 120\.1 NM\nESA · FL350 · 360\.2 NM/);
  await primary.click();await page.locator('.track-picker input').fill('300');await page.keyboard.press('Enter');
  assert.equal(await primary.textContent(),'300');assert.equal(await primary.evaluate(e=>getComputedStyle(e).color),'rgb(255, 64, 64)');
  assert.deepEqual(await page.evaluate(()=>[window.test.t.plannedEntryLevel,window.test.t.clearedFlightLevel]),[350,350]);
  await page.evaluate(()=>window.test.advance(2.9));assert.equal(await primary.getAttribute('class'),'level-segment__value is-proposed');
  await page.evaluate(()=>window.test.advance(0.1));assert.equal(await label.locator('.is-proposed').count(),0);
  assert.deepEqual(await page.evaluate(()=>[window.test.t.plannedEntryLevel,window.test.t.clearedFlightLevel,window.test.t.sectorExitLevels.EDU]),[300,300,300]);
  await label.locator('.destination').click();await page.locator('.direct-to__points button').filter({hasText:'END'}).click();
  assert.equal(await label.locator('.destination').textContent(),'END');assert.equal(await label.locator('.destination.is-proposed').count(),1);
  assert.equal(await page.evaluate(()=>window.test.t.flightPlan.nextIndex),0);
  await page.evaluate(()=>window.test.advance(3));assert.equal(await page.evaluate(()=>window.test.t.flightPlan.nextIndex),1);
  assert.equal(await label.locator('.destination.is-proposed').count(),0);
  await label.locator('.assigned-speed').click();await page.locator('.track-picker input').fill('0.76');await page.keyboard.press('Enter');
  assert.equal(await label.locator('.assigned-speed.is-proposed').count(),1);
  assert.equal(await page.evaluate(()=>window.test.t.assignedSpeed.value),null);
  await page.evaluate(()=>window.test.advance(3));assert.equal(await page.evaluate(()=>window.test.t.assignedSpeed.value),0.76);
  await page.evaluate(()=>{window.test.t.unableVerticalRate=true;window.test.t.assignedVertical={value:2000,comparator:'exact'};window.test.t.verticalRateAssigned=true;window.test.render();});
  await label.locator('.assigned-vertical').click();await page.locator('.track-picker input').fill('-1800');await page.keyboard.press('Enter');
  assert.equal(await label.locator('.assigned-vertical.is-proposed').count(),1);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.assigned-vertical')).color==='rgb(255, 64, 64)');
  await page.evaluate(()=>window.test.advance(3));assert.equal(await page.evaluate(()=>window.test.t.assignedVertical.value),-1800);
  await primary.click();await page.locator('.track-picker__clear').click();
  assert.equal(await primary.textContent(),'---');assert.equal(await label.locator('.level-primary').getAttribute('data-field'),'plannedEntryLevel');
  await page.evaluate(()=>window.test.advance(3));
  assert.equal(await label.locator('.level-primary').getAttribute('data-field'),'plannedEntryLevel','empty inbound PEL must not expose another controller CFL');
  await label.locator('.assigned-heading').click();await page.locator('.track-picker input').fill('100');await page.keyboard.press('Enter');
  assert.equal(await label.locator('.assigned-heading.is-proposed').count(),1);
  assert.equal(await page.evaluate(()=>window.test.t.assignedHeading),null);
  await page.evaluate(()=>window.test.advance(3));assert.equal(await page.evaluate(()=>window.test.t.assignedHeading),100);
  await page.evaluate(()=>{const {t}=window.test;t.lon=-0.1;t.assignedHeading=90;window.test.render();});
  assert.match(await label.getAttribute('class'),/status-accepted/);assert.equal(await label.locator('.level-primary').getAttribute('data-field'),'clearedFlightLevel');
  await page.evaluate(()=>{window.test.t.lon=0.1;window.test.render();window.test.t.lon=3.9;window.test.advance(4);});
  assert.match(await label.getAttribute('class'),/status-intruder/);
  await page.evaluate(()=>{window.test.t.lon=4.1;window.test.render();});assert.match(await label.getAttribute('class'),/status-unconcerned/);
  assert.equal(await page.locator('.sector-panel__sequence').textContent(),'ESA → UNKNOWN');
  await page.evaluate(()=>{window.test.t.assignedHeading=null;window.test.t.navigationMode='route';window.test.render();});
  assert.equal(await page.locator('.sector-panel__sequence').textContent(),'ESA');
  assert.match(await page.locator('.sector-panel__crossings').textContent(),/No further sector crossing/);
  await page.evaluate(()=>{window.test.t.trajectory={sequence:[],complete:false,reason:'Airspace data unavailable'};window.test.state.bus.emit('tick',0);});
  assert.equal(await page.locator('.sector-panel__sequence').textContent(),'');
  assert.match(await page.locator('.sector-panel__message').textContent(),/Airspace data unavailable/);
  await page.evaluate(()=>{window.test.state.air.tracks=[];window.test.state.bus.emit('tick',0);});
  assert.equal(await page.locator('.sector-panel__callsign').textContent(),'Track unavailable');
  assert.deepEqual(errors,[]);
  console.log('PASS: real PEL/shortcut/H/S/R proposals stay red and inactive for three seconds; sector-relative transfer labels and sequence panel update');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
