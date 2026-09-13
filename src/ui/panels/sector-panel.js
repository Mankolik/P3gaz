import { sectorLimitsText } from '../../radar/sectors.js';

export function mountSectorPanel(parent, overlay, state){
  const panel = document.createElement('section');
  panel.id = 'track-sector-panel';
  panel.className = 'sector-panel';
  panel.setAttribute('aria-label', 'Track sector');
  const header = document.createElement('div');
  header.className = 'sector-panel__header';
  header.textContent = 'Track sector';
  header.title = 'Drag to move. Arrow keys move the window when focused.';
  header.tabIndex = 0;
  const callsign = document.createElement('div');
  callsign.className = 'sector-panel__callsign';
  const level = document.createElement('div');
  level.className = 'sector-panel__level';
  const details = document.createElement('div');
  details.className = 'sector-panel__details';
  panel.append(header, callsign, level, details);
  parent.appendChild(panel);

  let selectedId = null;
  let lastDisplay = '';
  let position = { x:parent.clientWidth-panel.offsetWidth-16, y:16 };
  const place = ()=>{
    position.x = Math.max(0, Math.min(position.x, parent.clientWidth-panel.offsetWidth));
    position.y = Math.max(0, Math.min(position.y, parent.clientHeight-panel.offsetHeight));
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  };
  const refresh = ()=>{
    const track = state.air.tracks.find(track=>track.id === selectedId);
    const membership = track?.sectorMembership;
    const name = track?.callsign || (selectedId ? 'Track unavailable' : 'Hover a track label');
    const actualLevel = Number.isFinite(track?.actualFlightLevel)
      ? `AFL ${String(Math.round(track.actualFlightLevel)).padStart(3,'0')}` : '';
    let description = 'The last hovered track stays selected here.';
    if(selectedId){
      if(!membership || membership.status === 'unknown') description = 'Sector information unavailable';
      else if(membership.status === 'outside') description = 'Outside loaded sector limits';
      else description = membership.sectors.map(sector=>`${sector.name}\n${sectorLimitsText(sector)}`).join('\n\n');
      if(membership?.sectors.length > 1) description += '\n\nShared boundary / overlapping sectors';
    }
    const display = JSON.stringify([selectedId,name,actualLevel,description]);
    if(display === lastDisplay) return;
    lastDisplay = display;
    panel.dataset.trackId = selectedId || '';
    panel.dataset.sectorStatus = membership?.status || 'unknown';
    callsign.textContent = name;
    level.textContent = actualLevel;
    details.textContent = description;
    place();
  };
  overlay.addEventListener('track-hover', event=>{
    selectedId = event.detail?.track?.id ?? null;
    refresh();
  });
  // Registered after the simulation tick handler, so position/altitude and
  // membership are already current when the inspector refreshes.
  state.bus.on('tick', refresh);
  state.bus.on('track:sector-changed', ({track})=>{
    if(track.id === selectedId) refresh();
  });

  let drag = null;
  header.addEventListener('pointerdown', event=>{
    if(event.button !== 0) return;
    event.preventDefault();
    drag = { id:event.pointerId, x:event.clientX-position.x, y:event.clientY-position.y };
    header.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
  });
  header.addEventListener('pointermove', event=>{
    if(!drag || drag.id !== event.pointerId) return;
    position = { x:event.clientX-drag.x, y:event.clientY-drag.y };
    place();
  });
  const endDrag = event=>{
    if(!drag || drag.id !== event.pointerId) return;
    drag = null;
    panel.classList.remove('dragging');
    if(header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
  };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
  header.addEventListener('lostpointercapture', endDrag);
  header.addEventListener('keydown', event=>{
    const directions = {ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};
    const delta = directions[event.key];
    if(!delta) return;
    event.preventDefault();
    position.x += delta[0];
    position.y += delta[1];
    place();
  });
  // Keep the window reachable when the radar area is resized.
  new ResizeObserver(place).observe(parent);
  refresh();
  return panel;
}
