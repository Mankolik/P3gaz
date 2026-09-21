import { extendedLabelData, extendedSectorSequence } from './extended-label-data.js';

export function mountSectorPanel(parent, overlay, state){
  const panel = document.createElement('section');
  panel.id = 'track-sector-panel';
  panel.className = 'sector-panel';
  panel.setAttribute('aria-label', 'Extended Label Window');
  const header = document.createElement('div');
  header.className = 'sector-panel__header';
  header.textContent = 'Extended Label Window';
  header.title = 'Drag to move. Arrow keys move the window when focused.';
  header.tabIndex = 0;
  const content=document.createElement('div');
  content.className='elw-content';
  const fields=new Map();
  const rows=[['callsign','capabilities','radio','transponder'],['aircraft','status'],[],
    ['departure','destination','frequency'],['rules','route'],['cfl','ecl'],['freeText'],[],
    ['selectedAltitude','heading','track'],['ias','mach','gs']];
  const green=new Set(['callsign','capabilities','radio','frequency']);
  const modeS={selectedAltitude:'SEL ALT',heading:'HDG',track:'TRK',ias:'IAS',mach:'MN',gs:'GS'};
  rows.forEach((keys,index)=>{
    const row=document.createElement('div');row.className='elw-row';row.dataset.row=index+1;
    if(index>=8)row.classList.add('elw-mode-s');
    if(index===7){row.classList.add('elw-sequence','sector-panel__sequence');row.setAttribute('aria-label','Sector sequence and exit levels');}
    for(const key of keys){
      const field=document.createElement('span');field.dataset.field=key;
      field.className=green.has(key) ? 'elw-green' : key==='rules' ? 'elw-yellow' : '';
      if(key==='callsign')field.classList.add('sector-panel__callsign');
      if(key==='freeText')field.classList.add('elw-freetext');
      if(key==='capabilities')field.title='W: RVSM; Y: 8.33 kHz';
      fields.set(key,field);
      if(modeS[key]){
        const pair=document.createElement('span');pair.className='elw-mode-s__pair';
        const designator=document.createElement('small');designator.textContent=modeS[key];
        pair.append(designator,field);row.append(pair);
      }else row.append(field);
    }
    content.append(row);
  });
  panel.append(header,content);
  const sequenceRow=content.querySelector('.elw-sequence');
  parent.appendChild(panel);

  let selectedId = null;
  let lastDisplay = '';
  let lastSequence = '';
  let position = { x:parent.clientWidth-panel.offsetWidth-16, y:16 };
  const place = ()=>{
    position.x = Math.max(0, Math.min(position.x, parent.clientWidth-panel.offsetWidth));
    position.y = Math.max(0, Math.min(position.y, parent.clientHeight-panel.offsetHeight));
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  };
  const refresh = ()=>{
    const track = state.air.tracks.find(track=>track.id === selectedId);
    const data=extendedLabelData(track);
    const sequence=extendedSectorSequence(track);
    const display=JSON.stringify([selectedId,data,sequence]);
    if(display === lastDisplay) return;
    lastDisplay = display;
    panel.dataset.trackId = selectedId || '';
    panel.dataset.currentSector = track?.trajectory?.sequence[0]?.sector || '';
    for(const [key,field] of fields){
      const value=!data && key==='callsign' ? (selectedId ? 'Track unavailable' : 'Hover a track label') : data?.[key] || '';
      if(field.textContent!==value)field.textContent=value;
    }
    const sequenceDisplay=JSON.stringify(sequence);
    if(sequenceDisplay!==lastSequence){
      lastSequence=sequenceDisplay;
      sequenceRow.replaceChildren(...sequence.map(visit=>{
        const span=document.createElement('span');span.className=`elw-sector elw-sector--${visit.status}`;
        span.textContent=visit.text;return span;
      }));
    }
    place();
  };
  overlay.addEventListener('track-hover', event=>{
    selectedId = event.detail?.track?.id ?? null;
    refresh();
  });
  // Registered after the simulation tick handler, so position/altitude and
  // trajectory are already current when the sequence refreshes.
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
