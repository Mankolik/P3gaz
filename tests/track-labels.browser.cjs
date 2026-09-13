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
  const tracks = createDemoTracks();
  tracks.forEach(track=>{ track.labelOffset = {x:40,y:0}; });
  window.labelTest = { tracks, render(){
    syncTrackLabels(document.querySelector('#track-overlay'), tracks.map((track, i)=>({
      track, x:150 + (i % 3) * 330, y:100 + Math.floor(i / 3) * 150, zoom:1
    })));
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

    // Load the actual application, not just the focused fixture.
    await page.goto(origin + '/index.html');
    await page.waitForFunction(()=>document.querySelectorAll('.track-label').length > 0);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: application boots and renders live traffic without JavaScript errors');
    if(process.env.LABEL_SCREENSHOT) await page.screenshot({path:process.env.LABEL_SCREENSHOT});
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{ console.error(error); process.exitCode = 1; });
