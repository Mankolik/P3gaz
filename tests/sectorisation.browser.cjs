const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><link rel="stylesheet" href="/styles.css"><div id="app"><header id="topbar"></header><main id="main"><canvas id="radar" width="1100" height="700"></canvas><div id="track-overlay"></div></main><footer id="bottombar"></footer></div>
<script type="module">
import {createState} from '/src/core/state.js';import {createBus} from '/src/core/bus.js';
import {mountTopbar} from '/src/ui/topbar.js';import {mountSectorPanel} from '/src/ui/panels/sector-panel.js';
import {createSectorIndex} from '/src/radar/sectors.js';import {createAirspaceIndex} from '/src/radar/airspace.js';
import {groupAirspace} from '/src/radar/sectorisation.js';import {updateTrafficControl} from '/src/radar/traffic-control.js';
import {setFlightPlan} from '/src/radar/routes.js';import {syncTrackLabels} from '/src/render/tracks.js';
import {drawFrame} from '/src/render/draw.js';
const feature=(properties,a,b)=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[[[a,-1],[b,-1],[b,1],[a,1],[a,-1]]]}});
const state=createState(createBus());state.map.project=(lon,lat)=>[lon*100+30,250-lat*100];
state.air.airspaceIndex=groupAirspace(createAirspaceIndex(createSectorIndex([{features:['LOW','HIGH'].flatMap(vertical=>['T','C','J'].map((sector,i)=>feature({sector,vertical,min_fl:vertical==='LOW'?95:365,max_fl:vertical==='LOW'?365:660},i*2,(i+1)*2)))}]),{features:[feature({AV_AIRSPAC:'EPWWFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},0,6),feature({AV_AIRSPAC:'ESAAFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},6,10)]}),state.air.sectorisation);
const t={id:'LOT123',callsign:'LOT123',aircraftType:'A320',departure:'EPWA',destination:'ESSA',lon:1,lat:0,heading:90,groundSpeed:450,actualFlightLevel:330,clearedFlightLevel:350,expectedCruiseLevel:380,plannedEntryLevel:330,exitFlightLevel:360};
setFlightPlan(t,[{name:'END',lon:8,lat:0}]);state.air.tracks.push(t);
mountTopbar(document.querySelector('#topbar'),state,state.bus);
const overlay=document.querySelector('#track-overlay');mountSectorPanel(document.querySelector('#main'),overlay,state);
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
const render=()=>{updateTrafficControl(state);drawFrame({el:canvas,ctx},{x:0,y:0,z:1},{...state,air:{...state.air,tracks:[]}},null);syncTrackLabels(overlay,[{track:t,x:160,y:250,zoom:1}]);state.bus.emit('tick',0);};
state.bus.on('sectorisation:changed',render);window.test={state,t,render};render();
</script>`;
(async()=>{
  const server=http.createServer(async(req,res)=>{try{
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
    const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+path.sep))throw Error('Outside project');
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
    const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.test);
    const open=()=>page.getByRole('button',{name:'Sectorisation',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Sectorisation'});
    const selectMixed=async()=>{for(const name of ['T Low','C Low','T High','C High','J High'])await dialog.getByRole('checkbox',{name,exact:true}).check();};
    await open();assert.equal(await dialog.getByRole('checkbox').count(),20);
    await selectMixed();await dialog.getByRole('button',{name:'New sector from selected'}).click();
    assert.equal(await page.evaluate(()=>window.test.state.air.controlledSector),'ALLFIR','draft changes do not affect live traffic');
    await dialog.getByRole('radio',{name:'TC L TCJ H',exact:true}).check();
    await dialog.getByRole('button',{name:'Apply configuration'}).click();
    assert.equal(await page.evaluate(()=>window.test.state.air.controlledSector),'TC L TCJ H');
    assert.equal(await page.evaluate(()=>window.test.t.control.owner),'TC L TCJ H');
    assert.equal(await page.evaluate(()=>window.test.t.clearedFlightLevel),350);
    assert.equal(await page.evaluate(()=>window.test.t.exitFlightLevel),360,'remaining under user control keeps XFL even in a newly created group');
    await page.locator('.track-label').hover();
    assert.match(await page.locator('.elw-sequence').innerText(),/TC L TCJ H/);
    const pixels=await page.evaluate(()=>{const ctx=document.querySelector('canvas').getContext('2d');return [Array.from(ctx.getImageData(550,250,1,1).data),Array.from(ctx.getImageData(750,250,1,1).data),getComputedStyle(document.querySelector('canvas')).backgroundColor];});
    assert.deepEqual(pixels,[[2,6,9,255],[0,0,0,0],'rgb(11, 17, 23)'],'High-only J is dark, outside remains lighter');
    await open();await dialog.getByRole('checkbox',{name:'C Low',exact:true}).check();await dialog.getByRole('button',{name:'Make standalone'}).click();
    assert.equal(await dialog.getByRole('radio',{name:'C L',exact:true}).count(),1);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.test.state.air.controlledSector),'TC L TCJ H');
    await open();await dialog.getByRole('checkbox',{name:'T Low',exact:true}).check();await dialog.getByRole('button',{name:'Make standalone'}).click();await dialog.getByRole('button',{name:'Apply configuration'}).click();
    assert.equal(await page.evaluate(()=>window.test.t.control.owner),'T L','aircraft outside the new area transfers immediately');
    assert.equal(await page.evaluate(()=>window.test.state.air.controlledSector),'C L TCJ H');
    // Named sets are selected literally, including the unusual E High split.
    await open();await dialog.getByLabel('Named sector').selectOption('NFIR H');await dialog.getByRole('button',{name:'Select named group'}).click();
    assert.equal(await dialog.getByRole('checkbox',{name:'E High',exact:true}).isChecked(),false);
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
    await open();await page.setViewportSize({width:390,height:740});
    const bounds=await dialog.boundingBox();assert(bounds.x>=0 && bounds.x+bounds.width<=391);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    // Full application: startup, actual geometry, spawn and live editor together.
    await page.setViewportSize({width:1440,height:950});await page.goto(origin+'/');
    await page.getByRole('button',{name:'Spawn aircraft'}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.spawn-button')?.disabled);
    await open();await selectMixed();await dialog.getByRole('button',{name:'New sector from selected'}).click();await dialog.getByRole('radio',{name:'TC L TCJ H',exact:true}).check();
    if(process.env.SECTOR_SCREENSHOT)await page.screenshot({path:process.env.SECTOR_SCREENSHOT});
    await dialog.getByRole('button',{name:'Apply configuration'}).click();
    await page.getByRole('button',{name:'Spawn aircraft'}).click();await page.locator('.track-label').first().waitFor();
    if(process.env.SECTOR_MAP_SCREENSHOT)await page.screenshot({path:process.env.SECTOR_MAP_SCREENSHOT});
    await page.reload();await open();assert.equal(await dialog.getByRole('radio',{name:'ALLFIR',exact:true}).isChecked(),true);
    assert.deepEqual(errors,[]);console.log('Sectorisation browser checks passed.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
