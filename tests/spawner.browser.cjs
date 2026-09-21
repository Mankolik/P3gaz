// NODE_PATH may point to a shared Playwright installation; BROWSER_CHANNEL=chrome is supported.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><link rel="stylesheet" href="/styles.css"><div id="app"><header id="topbar"></header><main id="main"><div id="track-overlay"></div></main><footer id="bottombar"></footer></div>
<script type="module">
import {createState} from '/src/core/state.js';import {createBus} from '/src/core/bus.js';
import {mountTopbar} from '/src/ui/topbar.js';import {createNavigationIndex} from '/src/radar/routes.js';
import {loadJSON,loadAirways,loadAircraftSpawner} from '/src/data/loader.js';
import {createAircraftSpawner} from '/src/radar/spawner.js';import {updateTrackMovement} from '/src/radar/movement.js';
import {convertIasToTas,convertMachToTas} from '/src/utils/speed.js';
import {syncTrackLabels} from '/src/render/tracks.js';
const bus=createBus(),state=createState(bus);state.map.project=(lon,lat)=>[lon*1000,-lat*1000];
mountTopbar(document.querySelector('#topbar'),state,bus);window.spawnTest={state,bus,updateTrackMovement,convertIasToTas,convertMachToTas};
window.spawnTest.render=()=>syncTrackLabels(document.querySelector('#track-overlay'),state.air.tracks.map((track,i)=>({track,x:160+i*320,y:180,zoom:1})));
const nav=await Promise.all(['pl_enr4_4_waypoints.geojson','WptsAbroad.geojson','airports_static.json','route-point-corrections.geojson'].map(p=>loadJSON('/assets/geojson/'+p)));
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
    assert.equal(await page.evaluate(()=>window.spawnTest.state.air.spawner.catalogue.validVariants),251);
    const elvot=await page.evaluate(()=>window.spawnTest.state.air.navigationIndex.get('ELVOT'));
    assert.equal(elvot.length,1);assert(Math.abs(elvot[0].lat-50.611666666666665)<1e-10);
    assert.equal(await button.isEnabled(),true);
    await button.click();
    let track=await page.evaluate(()=>window.spawnTest.state.air.tracks.at(-1));
    assert.equal(track.status,'accepted');assert.equal(track.departure,'EPWA');assert.equal(track.onGround,false);
    assert.equal(track.actualFlightLevel,10);assert(Math.abs(track.groundSpeed-182.66371101904573)<1e-8);
    assert.equal(track.assignedSpeed.value,null);
    assert.equal(track.aircraftType,'E170');assert.equal(track.sourceRoute.operator,'LOT');
    assert.equal(track.expectedCruiseLevel,180);assert.equal(track.exitFlightLevel,null);
    await page.evaluate(()=>window.spawnTest.render());
    const departureLabel=page.locator('.track-label').first();
    await departureLabel.hover();
    assert.equal(await departureLabel.locator('.assigned-ecl').textContent(),'18');
    assert.equal(await departureLabel.locator('.assigned-ecl').getAttribute('title'),'ECL FL180');
    assert.equal(await departureLabel.locator('.assigned-ecl').evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal((await departureLabel.locator('.level-exit button').textContent()).trim(),'');
    await departureLabel.locator('.assigned-ecl').click();
    await page.locator('.track-picker input').fill('230');await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.spawnTest.state.air.tracks[0].expectedCruiseLevel),230);
    assert.equal((await departureLabel.locator('.level-exit button').textContent()).trim(),'','editing ECL must not fill XFL');
    await page.mouse.move(1000,650);
    const boxed=await departureLabel.locator('.level-exit button').evaluate(el=>{
      const s=getComputedStyle(el);return {width:s.outlineWidth,style:s.outlineStyle,color:s.outlineColor,textColor:s.color,opacity:s.opacity};
    });
    assert.equal(boxed.width,'1px');assert.equal(boxed.style,'solid');assert.equal(boxed.color,boxed.textColor);assert.equal(boxed.opacity,'1');
    const departureXfl=departureLabel.locator('.level-exit button');
    await departureXfl.click();await page.locator('.track-picker input').fill('10');await page.keyboard.press('Enter');
    await page.mouse.click(1000,650);
    assert.equal(await departureXfl.textContent(),'010');
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).opacity),'0','filled XFL matching CFL hides as before');
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await departureLabel.locator('.levels').hover();
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).opacity),'1');
    await departureXfl.click();await page.locator('.track-picker input').fill('200');await page.keyboard.press('Enter');
    await page.mouse.click(1000,650);
    assert.equal(await departureXfl.textContent(),'200');
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).opacity),'1','different filled XFL stays visible without a box');
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await departureXfl.click();await page.locator('.track-picker__clear').click();await page.mouse.move(1000,650);
    assert.equal(await page.evaluate(()=>window.spawnTest.state.air.tracks[0].exitFlightLevel),null);
    assert.equal((await departureXfl.textContent()).trim(),'');
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal(await departureXfl.evaluate(el=>getComputedStyle(el).outlineWidth),'1px','clearing XFL restores the empty box');
    assert.match(await page.getByRole('status').innerText(),/EPWA/);
    await page.evaluate(()=>{
      const {state}=window.spawnTest;const t=state.air.tracks.at(-1);const lon=t.lon,lat=t.lat;window.spawnTest.updateTrackMovement(state,30);
      if(Math.abs(t.groundSpeed-window.spawnTest.convertIasToTas(190,1000))>1e-8||t.actualFlightLevel!==10||(t.lon===lon&&t.lat===lat))throw Error('Departure did not adopt E170 speed');
      t.clearedFlightLevel=100;window.spawnTest.updateTrackMovement(state,10);
      if(t.onGround||t.verticalSpeed!==500||t.actualFlightLevel<=10)throw Error('Departure climb did not build gradually');
      window.spawnTest.updateTrackMovement(state,58);
      if(t.verticalSpeed!==3400)throw Error('Departure did not reach E170 climb baseline');
      const groups=state.air.spawner.catalogue.groups;window.spawnDraws=[(groups.findIndex(g=>g.departure==='KJFK'&&g.destination==='EPWA')+0.1)/groups.length,0,0,0.75,0.5];
    });
    await button.click();track=await page.evaluate(()=>window.spawnTest.state.air.tracks.at(-1));
    assert.equal(track.spawnPoint,'BIVKI');assert.equal(track.status,'accepted');assert.equal(track.onGround,false);
    assert.equal(track.aircraftType,'B789');assert.equal(track.wake,'H');
    assert.equal(track.exitFlightLevel,null);
    assert.notEqual(track.expectedCruiseLevel,track.exitFlightLevel);
    await page.evaluate(()=>window.spawnTest.render());
    const inboundLabel=page.locator('.track-label').last();
    const xfl=inboundLabel.locator('.level-exit button');
    assert.equal((await xfl.textContent()).trim(),'');
    assert.equal(await xfl.evaluate(el=>getComputedStyle(el).opacity),'1','empty XFL remains visible without hover');
    assert.equal(await xfl.evaluate(el=>getComputedStyle(el).outlineWidth),'1px');
    assert.equal(await inboundLabel.locator('.assigned-ecl').textContent(),String(track.expectedCruiseLevel/10));
    assert(track.actualFlightLevel<=430);
    assert.equal(track.actualFlightLevel,track.expectedCruiseLevel);
    assert.equal(track.clearedFlightLevel,track.expectedCruiseLevel);
    assert.equal(track.groundSpeed,await page.evaluate(t=>window.spawnTest.convertMachToTas(0.85,t.actualFlightLevel*100),track));
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
    // Actual application: startup, sector-relative labels and keyboard activation.
    await page.setViewportSize({width:1440,height:900});
    await page.goto(origin+'/');await page.waitForFunction(()=>!document.querySelector('.spawn-button')?.disabled);
    const before=await page.locator('.track-label').count();
    await button.click();await page.waitForFunction(n=>document.querySelectorAll('.track-label').length===n+1,before);
    await button.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(n=>document.querySelectorAll('.track-label').length===n+2,before);
    const spawned=page.locator('.track-label').last();
    assert.match(await spawned.getAttribute('class'),/status-(accepted|inbound|preinbound|unconcerned|intruder)/);
    await spawned.dispatchEvent('pointerenter');
    await page.waitForFunction(()=>document.querySelector('.sector-panel__sequence')?.textContent.length>0);
    if(process.env.SPAWNER_SCREENSHOT)await page.screenshot({path:process.env.SPAWNER_SCREENSHOT});
    assert.deepEqual(errors,[]);
    // Data failures keep the button disabled and explain why.
    await page.route('**/Airporty_revamped.txt',route=>route.fulfill({status:404,body:''}));
    await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('.spawn-feedback')?.textContent.includes('unavailable'));
    assert.equal(await button.isDisabled(),true);
    assert.match(await page.getByRole('status').innerText(),/route catalogue/);
    await page.unroute('**/Airporty_revamped.txt');
    await page.route('**/route-aircraft-types.txt',route=>route.fulfill({status:404,body:''}));
    await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('.spawn-feedback')?.textContent.includes('unavailable'));
    assert.equal(await button.isDisabled(),true);
    assert.match(await page.getByRole('status').innerText(),/aircraft pools/);
    await page.unroute('**/route-aircraft-types.txt');
    await page.route('**/route-point-corrections.geojson',route=>route.fulfill({status:404,body:''}));
    await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('.spawn-feedback')?.textContent.includes('unavailable'));
    assert.equal(await button.isDisabled(),true);
    assert.match(await page.getByRole('status').innerText(),/navigation files/);
    await page.unroute('**/route-point-corrections.geojson');
    await page.route('**/epby_tma.geojson',route=>route.fulfill({status:404,body:''}));
    await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('.spawn-feedback')?.textContent.includes('unavailable'));
    assert.equal(await button.isDisabled(),true);assert.match(await page.getByRole('status').innerText(),/airspace volumes/);
    console.log('PASS: departure/inbound spawning, live trajectory labels and sequence panel, keyboard, responsive placement and data failure.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
