const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const {createServer}=await import('../server/index.js'),{createTrack}=await import('../src/radar/tracks.js');
  const app=await createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
    const ca=await browser.newContext({viewport:{width:1440,height:950}}),cb=await browser.newContext({viewport:{width:1440,height:950}});
    const a=await ca.newPage(),b=await cb.newPage(),errors=[];
    for(const page of [a,b])page.on('pageerror',e=>errors.push(e.message));
    const origin='http://127.0.0.1:'+app.server.address().port;
    const open=page=>page.getByRole('button',{name:/^(Multiplayer|Room [A-Z0-9]+)$/}).click();
    const dialog=page=>page.getByRole('dialog',{name:'Multiplayer',exact:true});
    const close=page=>dialog(page).getByRole('button',{name:'Close',exact:true}).click();
    await a.goto(origin);await a.waitForFunction(()=>document.querySelector('.spawn-button')?.disabled===false);
    await open(a);await a.getByLabel('Initials',{exact:true}).fill('AA');await a.getByRole('button',{name:'Create room',exact:true}).click();
    await dialog(a).getByLabel('Your sector',{exact:true}).waitFor();
    assert.equal(await dialog(a).getByLabel('Your sector').inputValue(),'');
    const link=await dialog(a).getByLabel('Invitation link').inputValue();
    await dialog(a).getByRole('button',{name:'Pause',exact:true}).click();await close(a);
    await b.goto(link);await b.waitForFunction(()=>document.querySelector('.spawn-button')?.disabled===false);
    await b.getByLabel('Initials',{exact:true}).fill('BB');await b.getByRole('button',{name:'Join room',exact:true}).click();
    await dialog(b).getByLabel('Your sector').waitFor();assert.equal(await dialog(b).getByLabel('Your sector').inputValue(),'');
    await close(b);assert.equal(await b.getByRole('button',{name:'Spawn aircraft'}).isDisabled(),true);assert.equal(await b.getByRole('button',{name:'Sectorisation',exact:true}).isDisabled(),true);
    await a.getByRole('button',{name:'Sectorisation',exact:true}).click();const editor=a.getByRole('dialog',{name:'Sectorisation',exact:true});
    await editor.getByLabel('Named sector').selectOption('ALLFIR H');await editor.getByRole('button',{name:'Select named group'}).click();await editor.getByRole('button',{name:'New sector from selected'}).click();
    await editor.getByLabel('Sector for AA').selectOption({label:'ALLFIR L'});await editor.getByLabel('Sector for BB').selectOption({label:'ALLFIR H'});
    await editor.getByRole('button',{name:'Apply configuration'}).click();
    const room=[...app.rooms.values()][0],pa=[...room.players.values()].find(p=>p.initials==='AA'),pb=[...room.players.values()].find(p=>p.initials==='BB');
    assert.equal(room.sector(pa),'ALLFIR L');assert.equal(room.sector(pb),'ALLFIR H');
    const t=createTrack({id:'mp-test',callsign:'LOT123',aircraftType:'A320',departure:'EPWA',destination:'ESSA',lon:20,lat:52,heading:45,groundSpeed:450,actualFlightLevel:330,
      clearedFlightLevel:330,expectedCruiseLevel:380,exitFlightLevel:null,flightPlan:{waypoints:[{name:'MID',lon:22,lat:53},{name:'END',lon:24,lat:54}]}});
    t.sectorExitLevels={'ALLFIR L':380,'ALLFIR H':390};room.state.air.tracks.push(t);room.refresh();
    const la=a.locator('.track-label').filter({hasText:'LOT123'}),lb=b.locator('.track-label').filter({hasText:'LOT123'});
    await la.waitFor();await lb.waitFor();assert.match(await la.getAttribute('class'),/status-accepted/);assert.match(await lb.getAttribute('class'),/status-inbound/);
    assert.equal(await la.locator('.level-primary').getAttribute('data-field'),'clearedFlightLevel');
    assert.equal(await lb.locator('.level-primary').getAttribute('data-field'),'plannedEntryLevel');
    assert.equal(await la.locator('.level-primary button').textContent(),'330');assert.equal(await lb.locator('.level-primary button').textContent(),'380');
    assert.equal(await la.locator('.level-exit button').textContent(),'380');assert.equal(await lb.locator('.level-exit button').textContent(),'390');
    // Sender sees red PEL; receiver sees light-blue XFL and accepts without CFL change.
    await lb.locator('.level-primary button').click();await b.locator('.track-picker input').fill('370');await b.keyboard.press('Enter');
    await la.locator('.level-exit button.is-incoming').waitFor();await lb.locator('.level-primary button.is-proposed').waitFor();
    assert.equal(await la.locator('.level-exit button').evaluate(e=>getComputedStyle(e).color),'rgb(143, 191, 255)');
    assert.equal(t.sectorExitLevels['ALLFIR L'],380);room.time+=20;room.step(0);assert.equal(room.proposals.length,1);
    await la.locator('.level-exit button').click();await a.getByRole('button',{name:'Accept',exact:true}).click();
    await a.waitForFunction(()=>!document.querySelector('.is-incoming'));assert.equal(t.sectorExitLevels['ALLFIR L'],370);assert.equal(t.clearedFlightLevel,330);
    // DCT proposal previews cyan but cannot change navigation before acceptance.
    await lb.getByRole('button',{name:'Direct to point'}).click();await b.locator('.direct-to__points button').filter({hasText:'MID'}).first().click();
    await la.locator('.destination.is-incoming').waitFor();assert.equal(t.navigationMode,'route');
    const cyan=await a.locator('#radar').evaluate(canvas=>{const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<p.length;i+=4)if(p[i]===0&&p[i+1]===255&&p[i+2]===255)count++;return count;});
    assert(cyan>0,'receiver sees cyan proposed DCT line');
    if(process.env.MULTIPLAYER_SCREENSHOT)await a.screenshot({path:process.env.MULTIPLAYER_SCREENSHOT});
    await la.locator('.destination').click();await a.getByRole('button',{name:'Reject',exact:true}).click();await a.waitForFunction(()=>!document.querySelector('.is-incoming'));assert.equal(t.navigationMode,'route');
    await lb.getByRole('button',{name:'Direct to point'}).click();await b.locator('.direct-to__points button').filter({hasText:'MID'}).first().click();await la.locator('.destination.is-incoming').waitFor();
    await la.locator('.destination').click();await a.getByRole('button',{name:'Accept',exact:true}).click();await a.waitForFunction(()=>!document.querySelector('.is-incoming'));assert.equal(t.navigationMode,'direct');assert.equal(t.directTo.target.name,'MID');
    // Red outgoing values offer withdrawal and replacement, rather than auto-acceptance.
    await lb.locator('.assigned-heading').click();await b.locator('.track-picker input').fill('090');await b.keyboard.press('Enter');await lb.locator('.assigned-heading.is-proposed').waitFor();
    await lb.locator('.assigned-heading').click();await b.getByRole('button',{name:'Change proposal',exact:true}).click();await b.locator('.track-picker input').fill('180');await b.keyboard.press('Enter');
    await b.waitForFunction(()=>document.querySelector('.assigned-heading.is-proposed')?.textContent==='180°');
    await lb.locator('.assigned-heading').click();await b.getByRole('button',{name:'Withdraw',exact:true}).click();await b.waitForFunction(()=>!document.querySelector('.is-proposed'));assert.equal(t.assignedHeading,null);
    // Sector changes cannot steal occupied sectors; observers have no dark footprint.
    await open(b);assert.equal(await dialog(b).getByLabel('Your sector').locator('option').filter({hasText:'ALLFIR L'}).isDisabled(),true);
    await dialog(b).getByLabel('Your sector').selectOption('');await close(b);
    await b.waitForFunction(()=>document.querySelector('.track-label')?.classList.contains('status-unconcerned'));
    await open(a);await dialog(a).getByRole('button',{name:'Leave room',exact:true}).click();
    await b.waitForFunction(()=>document.querySelector('.multiplayer-message')?.textContent.includes('host left'));
    assert.equal(app.rooms.size,0);assert.deepEqual(errors,[]);console.log('PASS: real two-player rooms, sector views, host assignment, human proposal colours and actions, DCT preview, withdrawal, and host disconnect.');
  }finally{await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
