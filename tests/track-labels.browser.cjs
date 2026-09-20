// Run with Playwright installed: node tests/track-labels.browser.cjs
// Set BROWSER_CHANNEL=chrome to use an installed Chrome browser.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><link rel="stylesheet" href="/styles.css">
  <div id="track-overlay"></div><script type="module">
  import { syncTrackLabels } from '/src/render/tracks.js';
  import { createDemoTracks } from '/src/radar/tracks.js';
  import { createNavigationIndex, setFlightPlan } from '/src/radar/routes.js';
  import { updateTrackMovement } from '/src/radar/movement.js';
  const tracks = createDemoTracks();
  const navigationIndex = createNavigationIndex([await (await fetch('/assets/geojson/pl_enr4_4_waypoints.geojson')).json()]);
  tracks.forEach(track=>{ track.labelOffset = {x:40,y:0}; });
  window.labelTest = { tracks, navigationIndex, setFlightPlan, advance(seconds){updateTrackMovement({air:{tracks}},seconds);}, render(){
    syncTrackLabels(document.querySelector('#track-overlay'), tracks.map((track, i)=>({
      track, x:150 + (i % 3) * 370, y:100 + Math.floor(i / 3) * 150, zoom:1
    })),navigationIndex);
  }};
  window.labelTest.render();
  </script>`;

(async()=>{
  const server = http.createServer(async(req, res)=>{
    try{
      if(req.url === '/fixture'){
        res.setHeader('Content-Type', 'text/html');
        return res.end(fixture);
      }
      const requested = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + requested);
      if(!file.startsWith(root + path.sep)) throw new Error('Outside repository');
      const types = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    }catch{
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(resolve=>server.listen(0, '127.0.0.1', resolve));
  let browser;
  try{
    browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport:{ width:1100, height:700 } });
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/fixture');
    await page.waitForFunction(()=>window.labelTest?.tracks.length);
    const labels = page.locator('.track-label');
    const first = labels.nth(0);
    // Let the initial positioning transition finish before measuring hover.
    await first.hover();
    const geometry = label=>label.evaluate(el=>[el, ...el.querySelectorAll('.row, .level-segment__value')].map(node=>{
      const r = node.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    }));

    // Hover must never move any row, number, or the label's connector bounds.
    for(let i=0; i<await labels.count(); i++){
      await page.mouse.move(1090, 690);
      const label = labels.nth(i);
      const before = await geometry(label);
      await label.locator('.levels').hover();
      assert.deepEqual(await geometry(label), before, `hover geometry: track ${i}`);
      const values = label.locator('.level-segment__value');
      for(let j=0; j<3; j++){
        await values.nth(j).hover();
        assert.deepEqual(await geometry(label), before, `field hover geometry: track ${i}, field ${j}`);
      }
    }
    console.log('PASS: fixed hover geometry for all demo statuses and both label sides');

    // Both gaps and the read-only AFL must be inert.
    for(let i=0; i<await labels.count(); i++){
      const segments = labels.nth(i).locator('.level-segment');
      for(let j=0; j<2; j++){
        const a = await segments.nth(j).boundingBox();
        const b = await segments.nth(j+1).boundingBox();
        await page.mouse.click((a.x + a.width + b.x)/2, a.y+a.height/2);
        assert.equal(await page.locator('.track-picker').count(), 0, `gap ${j} on track ${i}`);
      }
      await segments.nth(0).click();
      assert.equal(await page.locator('.track-picker').count(), 0);
    }
    console.log('PASS: gap and AFL clicks never open a picker');

    // Equal values still suppress duplicates until hover or keyboard focus.
    await page.mouse.move(1090, 690);
    const primary = first.locator('.level-primary button');
    assert.equal(await primary.evaluate(el=>getComputedStyle(el).opacity), '0');
    await primary.focus();
    assert.equal(await primary.evaluate(el=>getComputedStyle(el).opacity), '1');
    await primary.press('Enter');
    assert.equal(await page.locator('.track-picker__level').count(), 1);
    assert.equal(await page.locator('.track-picker__level-label').textContent(), 'CFL');
    await page.locator('.track-picker__option[data-value="350"]').click();
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].clearedFlightLevel), 350);
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].actualFlightLevel), 380);
    assert.equal(await page.locator('.track-picker').count(), 0);
    console.log('PASS: duplicate reveal, keyboard editing, single CFL picker, and assignment isolation');

    for(const [trackIndex, field, label, key] of [
      [1, 'primary', 'PEL', 'plannedEntryLevel'],
      [0, 'exit', 'XFL', 'exitFlightLevel'],
      [0, 'primary', 'CFL', 'clearedFlightLevel'],
    ]){
      const value = labels.nth(trackIndex).locator('.level-' + field + ' button');
      await value.click();
      assert.equal(await page.locator('.track-picker__level-label').textContent(), label);
      await page.locator('.track-picker__clear').click();
      assert.equal(await value.textContent(), '---');
      await value.click();
      const input = page.locator('.track-picker input');
      await input.fill('275');
      await input.press('Enter');
      assert.equal(await page.evaluate(({trackIndex,key})=>window.labelTest.tracks[trackIndex][key], {trackIndex,key}), 275);
      assert.equal(await page.locator('.track-picker').count(), 0);
    }
    console.log('PASS: CFL, PEL, and XFL selection, clearing, and manual re-entry');

    // Changing trend must not move later columns or resize the label.
    await page.mouse.move(1090, 690);
    const beforeTrend = await geometry(first);
    for(const vs of [15, -15, 0]){
      await page.evaluate(vs=>{
        window.labelTest.tracks[0].verticalSpeed = vs;
        window.labelTest.tracks[0].labelRevision++;
        window.labelTest.render();
      }, vs);
      assert.deepEqual(await geometry(first), beforeTrend);
    }
    console.log('PASS: climb, descent, and level-flight trend slot stays fixed');

    for(const size of [{width:1100,height:700}, {width:800,height:600}]){
      await page.setViewportSize(size);
      await page.evaluate(()=>{
        const track = window.labelTest.tracks[0];
        track.labelSide = 'right';
        track.labelOffset = {x:window.innerWidth-310, y:window.innerHeight-150};
        window.labelTest.render();
      });
      await first.locator('.level-exit button').click();
      const panel = page.locator('.track-picker');
      const bounds = await panel.boundingBox();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x+bounds.width <= size.width && bounds.y+bounds.height <= size.height);
      assert(await panel.evaluate(el=>el.scrollWidth <= el.clientWidth), 'picker content fits panel');
      await page.keyboard.press('Escape');
      assert.equal(await panel.count(), 0);
    }
    console.log('PASS: picker fits desktop and narrow viewports and closes with Escape');

    // Existing label actions and right-button dragging must remain functional.
    await page.setViewportSize({width:1100,height:700});
    await page.evaluate(()=>{
      window.labelTest.tracks[0].labelOffset = {x:78,y:0};
      window.labelTest.render();
    });
    await first.locator('.speed').click();
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].showGroundSpeed), false);
    await first.locator('.type').click();
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].showType), false);
    for(const field of ['assigned-heading','assigned-speed','assigned-vertical','assigned-ecl']){
      await first.locator('.'+field).click();
      assert.equal(await page.locator('.track-picker').count(),1);
      assert(await page.locator('.track-picker input').evaluate(el=>el === document.activeElement),'picker focuses the editable input');
      await page.keyboard.type('123');
      assert.equal(await page.locator('.track-picker input').inputValue(),'123','typing immediately replaces the selected value');
      await page.mouse.click(1090,690);
      assert.equal(await page.locator('.track-picker').count(),0);
    }
    const drag = await first.locator('.callsign').boundingBox();
    await page.mouse.move(drag.x+5,drag.y+5);
    await page.mouse.down({button:'right'});
    await page.mouse.move(drag.x+25,drag.y+15);
    await page.mouse.up({button:'right'});
    assert.deepEqual(await page.evaluate(()=>window.labelTest.tracks[0].labelOffset), {x:98,y:10});
    console.log('PASS: speed/type toggles, heading/speed/rate/ECL pickers, outside dismissal, and label dragging');

    // Open around the assignment, including manual values between presets.
    for(const [selector, assignments, nearest, exact] of [
      ['.assigned-heading', {assignedHeading:180}, 180, true],
      ['.assigned-heading', {assignedHeading:354}, 355, false],
      ['.assigned-speed', {assignedSpeed:{mode:'IAS',value:280}}, 280, true],
      ['.assigned-speed', {assignedSpeed:{mode:'IAS',value:277}}, 280, false],
      ['.assigned-speed', {assignedSpeed:{mode:'Mach',value:0.78}}, 0.78, true],
      ['.assigned-vertical', {assignedVertical:{value:-1500,comparator:'exact'},verticalRateAssigned:true}, -1500, true],
      ['.assigned-vertical', {assignedVertical:{value:0,comparator:'exact'},verticalRateAssigned:true}, 0, true],
      ['.level-primary button', {clearedFlightLevel:380}, 380, true],
      ['.level-primary button', {clearedFlightLevel:275}, 280, false],
      ['.level-exit button', {exitFlightLevel:390}, 390, true],
      ['.level-exit button', {exitFlightLevel:0}, 0, true],
      ['.assigned-ecl', {expectedCruiseLevel:350}, 350, true],
    ]){
      await page.evaluate(assignments=>{
        Object.assign(window.labelTest.tracks[0], assignments);
        window.labelTest.tracks[0].labelRevision++;
        window.labelTest.render();
      }, assignments);
      await first.locator(selector).click();
      const list = page.locator('.track-picker__options');
      const target = list.locator(`[data-value="${nearest}"]`);
      const listBox = await list.boundingBox();
      const targetBox = await target.boundingBox();
      assert(targetBox.y >= listBox.y - 1 && targetBox.y + targetBox.height <= listBox.y + listBox.height + 1, `${selector} opens at ${nearest}`);
      assert.equal(await list.locator('.selected').count(), exact ? 1 : 0, 'nearest preset must not replace manual selection');
      if(selector.includes('level-') || selector === '.assigned-ecl'){
        const values = await list.locator('[data-value]').evaluateAll(options=>options.map(option=>Number(option.dataset.value)));
        assert.equal(values[0], 390, 'A21N level options stop at its ceiling');
        assert.equal(values.at(-1), 0);
        assert(values.every((value,i)=>i === 0 || value < values[i-1]), 'levels descend');
      }
      await page.keyboard.press('Escape');
    }
    // An unassigned level starts at the highest preset rather than stale scroll.
    await first.locator('.level-exit button').click();
    await page.locator('.track-picker__clear').click();
    await first.locator('.level-exit button').click();
    assert.equal(await page.locator('.track-picker__options').evaluate(el=>el.scrollTop), 0);
    assert.equal(await page.locator('.track-picker__option.selected').count(), 0);
    await page.keyboard.press('Escape');
    console.log('PASS: pickers open at exact or nearest assignments, levels descend, and empty assignments start at the top');

    // Focused level entry supports typing/Enter and cancelling without blur commits.
    const oldLevel=await page.evaluate(()=>window.labelTest.tracks[0].clearedFlightLevel);
    await first.locator('.level-primary button').click();
    await page.keyboard.type('290');
    assert.equal(await page.locator('.track-picker input').inputValue(),'290');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].clearedFlightLevel),oldLevel);
    await first.locator('.level-primary button').click();
    await page.keyboard.type('290');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].clearedFlightLevel),290);
    await first.locator('.level-primary button').click();
    assert.equal(await page.locator('.track-picker input').getAttribute('max'),'390');
    await page.keyboard.type('450');await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].clearedFlightLevel),390,'manual clearance cannot exceed type ceiling');

    // Direct-to works with the real navigation catalog and no flight plan.
    assert.equal(await first.locator('.row3 > *').count(),3,'reuse the existing point field without adding a label column');
    assert.equal(await first.locator('.direct-to').count(),0,'no separate DCT control');
    assert.equal(await first.locator('button.destination').textContent(),'EPKK');
    await page.mouse.move(1090,690);
    assert.equal(await first.locator('.destination').evaluate(el=>getComputedStyle(el).opacity),'1');
    await first.locator('.destination').click();
    assert.equal(await page.locator('[value="rejoin"]').count(),0);
    assert(await page.getByRole('textbox',{name:'Direct-to point',exact:true}).evaluate(el=>el === document.activeElement));
    await page.keyboard.type('NOTAFIX'); await page.keyboard.press('Enter');
    assert.match(await page.locator('.direct-to__error').textContent(),/known point/);
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].directTo),null);
    await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('abapa');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.track-picker').count(),0);
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].directTo.target.name),'ABAPA');
    assert.equal(await first.locator('.destination').textContent(),'ABAPA');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].assignedHeading),null);
    await first.locator('.assigned-heading').click();
    await page.keyboard.type('180'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].directTo),null);
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].assignedHeading),180);
    assert.equal(await first.locator('.destination').textContent(),'EPKK','cancel returns to the existing destination text');

    // Planned traffic is a test fixture only: the application demo stays planless.
    await page.evaluate(()=>{
      const t=window.labelTest.tracks[0];
      Object.assign(t,{lon:0,lat:0,heading:90,groundSpeed:360,assignedSpeed:null,
        aircraftType:'TEST',actualFlightLevel:200,clearedFlightLevel:200,verticalRateAssigned:false});
      window.labelTest.setFlightPlan(t,[{name:'PAST',lon:-0.1,lat:0},{name:'FIRST',lon:0.1,lat:0},{name:'JOIN',lon:0.2,lat:0},{name:'LAST',lon:0.3,lat:0}],1);
      window.labelTest.render();
    });
    await first.locator('.destination').click();
    assert.deepEqual(await page.locator('[data-plan-index]').allTextContents(),['FIRST','JOIN','LAST']);
    await page.locator('[data-plan-index="2"]').click();
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].directTo.planIndex),2);
    await page.evaluate(()=>{window.labelTest.advance(125); window.labelTest.render();});
    assert.equal(await first.locator('.destination').textContent(),'LAST',JSON.stringify(await page.evaluate(()=>window.labelTest.tracks[0])));
    await first.locator('.destination').click();
    assert.deepEqual(await page.locator('[data-plan-index]').allTextContents(),['LAST']);
    await page.keyboard.press('Escape');

    await page.evaluate(()=>{
      const t=window.labelTest.tracks[0]; Object.assign(t,{lon:0,lat:0,heading:90});
      window.labelTest.setFlightPlan(t,[{name:'SKIP',lon:0.1,lat:0},{name:'JOIN',lon:0.3,lat:0},{name:'LAST',lon:0.4,lat:0}]);
      window.labelTest.navigationIndex.set('VIA',[{name:'VIA',lon:0.2,lat:0}]);
      window.labelTest.render();
    });
    await first.locator('.destination').click();
    await page.keyboard.type('VIA');
    assert.equal(await page.locator('input[value="rejoin"]').count(),0);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].directTo.rejoinIndex),null);
    await page.evaluate(()=>{window.labelTest.advance(125); window.labelTest.render();});
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].navigationMode),'heading');

    // Off-plan entry automatically continues on arrival heading without resuming the FPL.
    await page.evaluate(()=>{
      const t=window.labelTest.tracks[0]; Object.assign(t,{lon:0,lat:0,heading:90});
      window.labelTest.setFlightPlan(t,[{name:'LATER',lon:1,lat:0}]); window.labelTest.render();
    });
    await first.locator('.destination').click(); await page.keyboard.type('VIA');
    await page.keyboard.press('Enter');
    await page.evaluate(()=>{window.labelTest.advance(200); window.labelTest.render();});
    assert.equal(await page.evaluate(()=>window.labelTest.tracks[0].navigationMode),'heading');
    assert.equal(await page.evaluate(()=>window.labelTest.tracks.length),5);
    assert((await page.evaluate(()=>window.labelTest.tracks[0].lon))>0.3);

    for(const size of [{width:1100,height:700},{width:360,height:480}]){
      await page.setViewportSize(size);
      await page.evaluate(()=>{const t=window.labelTest.tracks[0];t.labelOffset={x:0,y:0};t.labelSide='right';window.labelTest.render();});
      await first.locator('.destination').click();
      const box=await page.locator('.track-picker').boundingBox();
      assert(box.x>=0 && box.y>=0 && box.x+box.width<=size.width && box.y+box.height<=size.height);
      assert(await page.locator('.track-picker').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1100,height:700});
    console.log('PASS: ceiling-limited levels, immediate typing, direct-to validation, FPL shortcuts, off-plan heading continuation and narrow picker');

    if(process.env.LABEL_DETAIL_SCREENSHOT){
      await page.mouse.click(1090,690);
      await page.screenshot({path:process.env.LABEL_DETAIL_SCREENSHOT});
      await labels.nth(1).hover();
      await page.screenshot({path:process.env.LABEL_DETAIL_SCREENSHOT.replace('.png','-hover.png')});
    }

    // Load the actual application, not just the focused fixture.
    await page.goto(origin + '/index.html');
    await page.waitForFunction(()=>document.querySelectorAll('.track-label').length > 0);
    await page.waitForFunction(()=>[...document.querySelectorAll('.track-label')].every(label=>label.dataset.sectorStatus !== 'unknown'));
    for(const label of ['Range','QL SC','FPL','MAP','CONFIG']){
      const dropdown=page.locator('.topgroup').filter({has:page.locator(':scope > .label',{hasText:new RegExp('^'+label+'$')})}).locator('.dropdown');
      await dropdown.locator(':scope > .value').click();
      const input=dropdown.locator('.dropdown-search');
      assert(await input.evaluate(el=>el === document.activeElement),label+' focuses search');
      await page.keyboard.type(label === 'Range' ? '80' : 'zzzz');
      if(label === 'Range'){
        await page.keyboard.press('Enter');
        assert.equal(await dropdown.locator(':scope > .value').textContent(),'80 NM');
        assert.equal(await dropdown.evaluate(el=>el.classList.contains('open')),false);
      }else{
        assert.equal(await dropdown.locator('.option:visible,.row:visible').count(),0);
        await page.keyboard.press('Escape');
        assert.equal(await dropdown.evaluate(el=>el.classList.contains('open')),false);
      }
    }
    const wizz = page.locator('.track-label').filter({has:page.locator('.callsign', {hasText:'WZZ1891'})});
    await wizz.locator('.destination').click({force:true});
    await page.keyboard.type('ABAPA');
    assert.equal(await page.locator('[data-point-name="ABAPA"]').count(),1,'live app receives navigation catalog');
    if(process.env.DIRECT_TO_SCREENSHOT) await page.screenshot({path:process.env.DIRECT_TO_SCREENSHOT});
    await page.keyboard.press('Enter');
    assert.equal(await wizz.locator('.destination').textContent(),'ABAPA');
    await wizz.locator('.assigned-heading').click({force:true});
    await page.keyboard.type('354'); await page.keyboard.press('Enter');
    assert.equal(await wizz.getAttribute('data-sectors'), 'E:HIGH');
    assert.match(await wizz.locator('.callsign').getAttribute('title'), /EPWW E HIGH.*FL365–FL660/);
    const sectorPanel = page.locator('#track-sector-panel');
    await wizz.hover({force:true});
    await page.waitForFunction(()=>document.querySelector('#track-sector-panel').dataset.trackId === 'WZZ1891');
    await page.mouse.move(1090,690);
    assert.equal(await sectorPanel.locator('.sector-panel__callsign').textContent(),'WZZ1891');
    assert.match(await sectorPanel.locator('.sector-panel__details').textContent(),/EPWW E HIGH/);
    const panelBeforeDrag = await sectorPanel.boundingBox();
    const panelHeader = await sectorPanel.locator('.sector-panel__header').boundingBox();
    await page.mouse.move(panelHeader.x+30,panelHeader.y+12);
    await page.mouse.down();
    await page.mouse.move(panelHeader.x-70,panelHeader.y+92);
    await page.mouse.up();
    const panelAfterDrag = await sectorPanel.boundingBox();
    assert.equal(panelAfterDrag.x,panelBeforeDrag.x-100);
    assert.equal(panelAfterDrag.y,panelBeforeDrag.y+80);
    assert.equal(await sectorPanel.getAttribute('data-track-id'),'WZZ1891');
    await page.evaluate(()=>{
      const track = document.querySelector('#track-overlay').__trackNodes.get('WZZ1891').track;
      track.actualFlightLevel=360;
      track.clearedFlightLevel=360;
    });
    await page.waitForFunction(()=>document.querySelector('.sector-panel__details').textContent.includes('EPWW E LOW'));
    // The same last-hovered track follows the rebuilt Krakow vertical stack.
    for(const [level,name,limits] of [
      [25,'EPKK LTMA','2300 FT AMSL–3500 FT AMSL'],
      [35,'EPKK LTMA B','3500 FT AMSL–FL095'],
      [95,'EPKK UTMA A','FL095–FL245'],
      [245,'EPKK UTMA B','FL245–FL285'],
      [285,'EPWW J LOW','FL095–FL365'],
    ]){
      await page.evaluate(level=>{
        const track = document.querySelector('#track-overlay').__trackNodes.get('WZZ1891').track;
        track.lon=19.97639; track.lat=50.11639;
        track.groundSpeed=0; track.assignedSpeed=null;
        track.actualFlightLevel=level; track.clearedFlightLevel=level;
      },level);
      await page.waitForFunction(({name,limits})=>{
        const details=document.querySelector('.sector-panel__details').textContent;
        return details.includes(name) && details.includes(limits);
      },{name,limits});
    }
    // Return to Warsaw for the existing EPWA checks below.
    await page.evaluate(()=>{
      const track = document.querySelector('#track-overlay').__trackNodes.get('WZZ1891').track;
      track.lon=20.967; track.lat=52.165;
    });
    await page.evaluate(()=>{
      const track = document.querySelector('#track-overlay').__trackNodes.get('WZZ1891').track;
      track.actualFlightLevel=200; track.clearedFlightLevel=200;
    });
    await page.waitForFunction(()=>document.querySelector('.sector-panel__details').textContent.includes('EPWA TMA A'));
    assert.match(await sectorPanel.locator('.sector-panel__details').textContent(),/2000 FT AMSL–FL245/);
    assert.doesNotMatch(await sectorPanel.locator('.sector-panel__details').textContent(),/EPWW/);
    await page.evaluate(()=>{
      const track = document.querySelector('#track-overlay').__trackNodes.get('WZZ1891').track;
      track.actualFlightLevel=245; track.clearedFlightLevel=245;
    });
    await page.waitForFunction(()=>document.querySelector('.sector-panel__details').textContent.includes('EPWW E LOW'));
    await page.evaluate(()=>{
      const track = document.querySelector('#track-overlay').__trackNodes.get('WZZ1891').track;
      track.lon=0; track.lat=0; track.groundSpeed=0; track.assignedSpeed=null;
    });
    await page.waitForFunction(()=>document.querySelector('#track-sector-panel').dataset.sectorStatus === 'outside');
    const lot = page.locator('.track-label').filter({has:page.locator('.callsign',{hasText:'LOT612'})});
    await lot.hover({force:true});
    await page.waitForFunction(()=>document.querySelector('#track-sector-panel').dataset.trackId === 'LOT612');
    assert.match(await sectorPanel.locator('.sector-panel__details').textContent(),/EPGD UTMA/);
    await page.setViewportSize({width:800,height:600});
    await page.waitForFunction(()=>{
      const r = document.querySelector('#track-sector-panel').getBoundingClientRect();
      return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
    console.log('PASS: last-hovered sector window, dragging, live altitude/position changes, track switching, and resize bounds');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: application boots and renders live traffic without JavaScript errors');
    if(process.env.LABEL_SCREENSHOT) await page.screenshot({path:process.env.LABEL_SCREENSHOT});
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{ console.error(error); process.exitCode = 1; });
