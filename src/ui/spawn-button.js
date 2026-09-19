export function mountSpawnButton(root,state,bus) {
  const group=document.createElement('div');
  group.className='spawn-control';
  const button=document.createElement('button');
  button.type='button';button.className='spawn-button';button.textContent='+ Aircraft';
  button.setAttribute('aria-label','Spawn aircraft');button.disabled=true;
  button.title='Loading traffic routes…';
  const feedback=document.createElement('div');
  feedback.className='spawn-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  group.append(button,feedback);root.append(group);
  let timeout;
  const notify=text=>{
    clearTimeout(timeout);feedback.textContent=text;feedback.classList.add('visible');
    timeout=setTimeout(()=>feedback.classList.remove('visible'),6500);
  };
  const ready=()=>{
    button.disabled=!state.air.spawner;
    const count=state.air.spawner?.catalogue.groups.length;
    button.title=count?`Spawn accepted aircraft from ${count} airport pairs`:state.air.spawnError||'Loading traffic routes…';
    if(state.air.spawnError)notify('Aircraft spawner unavailable: '+state.air.spawnError);
  };
  bus.on('spawner:ready',ready);ready();
  button.addEventListener('click',()=>{
    try {
      const track=state.air.spawner.spawn(state);
      notify(`${track.callsign} · ${track.departure} → ${track.destination} · ${track.onGround
        ? 'On ground. Set speed and a higher CFL to depart.' : `${track.spawnPoint} · FL${track.actualFlightLevel}`}`);
    } catch(error) {notify(error.message);}
  });
}
