// NODE_PATH may point to a shared Playwright installation; BROWSER_CHANNEL=chrome is supported.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><link rel="stylesheet" href="/styles.css"><div id="app"><header id="topbar"></header><main id="main"></main><footer id="bottombar"></footer></div>
<script type="module">
import {createState} from '/src/core/state.js';import {createBus} from '/src/core/bus.js';
import {mountTopbar} from '/src/ui/topbar.js';import {createNavigationIndex} from '/src/radar/routes.js';
import {loadJSON,loadAirways,loadAircraftSpawner} from '/src/data/loader.js';
import {createAircraftSpawner} from '/src/radar/spawner.js';import {updateTrackMovement} from '/src/radar/movement.js';
const bus=createBus(),state=createState(bus);state.map.project=(lon,lat)=>[lon*1000,-lat*1000];
mountTopbar(document.querySelector('#topbar'),state,bus);window.spawnTest={state,bus,updateTrackMovement};
const nav=await Promise.all(['pl_enr4_4_waypoints.geojson','WptsAbroad.geojson','airports_static.json'].map(p=>loadJSON('/assets/geojson/'+p)));
state.air.navigationIndex=createNavigationIndex(nav);const resolver=await loadAirways(state.air.navigationIndex);
const loaded=await loadAircraftSpawner(resolver,await loadJSON('/assets/geojson/flightmap_europe_fir_uir.json'));
window.spawnDraws=[];state.air.spawner=createAircraftSpawner(loaded.catalogue,{random:()=>window.spawnDraws.shift()??0});
bus.emit('spawner:ready');
</script>`;
(async()=>{
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
      const url=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep))throw Error('Outside project');
      res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');
      res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin+'/fixture');
    const button=page.getByRole('button',{name:'Spawn aircraft'});
    await page.waitForFunction(()=>window.spawnTest?.state.air.spawner);
    assert.equal(await button.isEnabled(),true);
    await button.click();
    let track=await page.evaluate(()=>window.spawnTest.state.air.tracks.at(-1));
    assert.equal(track.status,'accepted');assert.equal(track.departure,'EPWA');assert.equal(track.onGround,true);
    assert.equal(track.actualFlightLevel,0);assert.equal(track.groundSpeed,0);
    assert.match(await page.getByRole('status').innerText(),/On ground/);
    await page.evaluate(()=>{
      const {state}=window.spawnTest;const t=state.air.tracks.at(-1);window.spawnTest.updateTrackMovement(state,30);
      if(t.groundSpeed!==0||t.actualFlightLevel!==0)throw Error('Ground track moved');
      t.assignedSpeed={mode:'IAS',value:180};t.clearedFlightLevel=100;window.spawnTest.updateTrackMovement(state,10);
      if(t.onGround||t.groundSpeed<=0||t.actualFlightLevel<=0)throw Error('Departure did not release');
      const groups=state.air.spawner.catalogue.groups;window.spawnDraws=[(groups.findIndex(g=>g.departure==='KJFK'&&g.destination==='EPWA')+0.1)/groups.length,0,0,0.5];
    });
    await button.click();track=await page.evaluate(()=>window.spawnTest.state.air.tracks.at(-1));
    assert.equal(track.spawnPoint,'BIVKI');assert.equal(track.status,'accepted');assert.equal(track.onGround,false);
    assert.equal(track.flightPlan.waypoints[track.flightPlan.nextIndex].name,'SONAL');
    assert.match(await page.getByRole('status').innerText(),/BIVKI/);
    // The small control stays at the upper-right at common and narrow widths.
    for(const width of [1440,1100,650,390]){
      await page.setViewportSize({width,height:900});
      const box=await button.boundingBox();assert(box.x+box.width<=width-4);assert(box.y<20);assert(box.x>=0);
      const overlaps=await page.locator('#topbar > .topgroup').evaluateAll((items,b)=>items.some(el=>{
        const r=el.getBoundingClientRect();return r.left<b.x+b.width&&r.right>b.x&&r.top<b.y+b.height&&r.bottom>b.y;
      }),box);assert.equal(overlaps,false);
    }
    // Actual application: startup, one click, visible accepted label and keyboard activation.
    await page.setViewportSize({width:1440,height:900});
    await page.goto(origin+'/');await page.waitForFunction(()=>!document.querySelector('.spawn-button')?.disabled);
    const before=await page.locator('.track-label.status-accepted').count();
    await button.click();await page.waitForFunction(n=>document.querySelectorAll('.track-label.status-accepted').length===n+1,before);
    await button.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(n=>document.querySelectorAll('.track-label.status-accepted').length===n+2,before);
    if(process.env.SPAWNER_SCREENSHOT)await page.screenshot({path:process.env.SPAWNER_SCREENSHOT});
    assert.deepEqual(errors,[]);
    // Data failures keep the button disabled and explain why.
    await page.route('**/Airporty_revamped.txt',route=>route.fulfill({status:404,body:''}));
    await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('.spawn-feedback')?.textContent.includes('unavailable'));
    assert.equal(await button.isDisabled(),true);
    assert.match(await page.getByRole('status').innerText(),/route catalogue/);
    console.log('PASS: ground and inbound spawning, clearances, accepted labels, keyboard, responsive placement and data failure.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
