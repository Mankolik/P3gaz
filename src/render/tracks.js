const STATUS_COLORS = {
  default: '#bfbfbf',
  accepted: '#00FF55',
  inbound: '#ffffff',
  preinbound: '#bfbfbf',
  intruder: '#ff6659',
  unconcerned: '#bfbfbf',
};

const STATUS_STROKES = {
  preinbound: '#bfbfbf',
  unconcerned: '#bfbfbf',
  default: '#101820',
};

const DEFAULT_SYMBOL_SIZE = 12;
const DEFAULT_VECTOR_SCALE = 6;
const CONNECTOR_COLOR = '#bfbfbf';
const VECTOR_COLORS = {
  accepted: '#00FF55',
  inbound: '#ffffff',
  preinbound: '#bfbfbf',
  intruder: '#ff6659',
  unconcerned: '#bfbfbf',
  default: '#bfbfbf',
};
const DEFAULT_LABEL_OFFSET = { x: 78, y: 0 };

function degToRad(heading){
  const deg = Number.isFinite(heading) ? heading : 0;
  return (deg - 90) * Math.PI / 180;
}

export function drawTrackSymbols(ctx, camera, tracks){
  if(!ctx || !camera || !Array.isArray(tracks) || !tracks.length) return;
  const zoom = Math.max(camera.z || 1, 1e-6);
  const invZoom = 1 / zoom;
  const pixelScale = window.devicePixelRatio || 1;
  for(const track of tracks){
    if(track?.x==null || track?.y==null) continue;
    const fill = STATUS_COLORS[track.status] || STATUS_COLORS.default;
    const stroke = STATUS_STROKES[track.status] || STATUS_STROKES.default;
    const size = (track.symbolSize || DEFAULT_SYMBOL_SIZE) * invZoom;
    const vectorMinutes = Math.max(track.vectorMinutes || 0, 0);
    const rawScale = Number.isFinite(track.vectorScale) ? track.vectorScale : DEFAULT_VECTOR_SCALE;
    const vectorScale = rawScale > 0 ? rawScale : DEFAULT_VECTOR_SCALE;
    const vecLength = vectorMinutes * vectorScale;
    const half = size / 2;
    const rad = degToRad(track.heading);
    ctx.save();
    ctx.translate(track.x, track.y);
    ctx.lineWidth = invZoom / pixelScale;
    if(vecLength > 0){
      ctx.save();
      ctx.rotate(rad);
      const vectorColor = VECTOR_COLORS[track.status] || VECTOR_COLORS.default;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(vecLength, 0);
      ctx.strokeStyle = vectorColor;
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(half, 0);
    ctx.lineTo(0, half);
    ctx.lineTo(-half, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }
}

export function projectTracksToScreen(tracks, camera){
  if(!Array.isArray(tracks) || !camera) return [];
  const zoom = Math.max(camera.z || 1, 1e-6);
  return tracks
    .filter(track=>track?.x!=null && track?.y!=null)
    .map(track=>({
      track,
      x: (track.x - camera.x) * zoom,
      y: (track.y - camera.y) * zoom,
      zoom,
    }));
}

export function drawTrackConnectors(ctx, projected, anchors){
  if(!ctx || !Array.isArray(projected) || projected.length===0) return;
  const pixelScale = window.devicePixelRatio || 1;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1 / pixelScale;
  ctx.strokeStyle = CONNECTOR_COLOR;
  ctx.beginPath();
  for(const {track, x, y} of projected){
    const anchor = anchors?.get?.(track.id);
    if(!anchor) continue;
    ctx.moveTo(x, y);
    ctx.lineTo(anchor.x, anchor.y);
  }
  ctx.stroke();
  ctx.restore();
}

function getLabelOffset(track){
  if(!track || typeof track !== 'object'){
    return { ...DEFAULT_LABEL_OFFSET };
  }
  const current = track.labelOffset || DEFAULT_LABEL_OFFSET;
  const x = Number.isFinite(current.x) ? current.x : DEFAULT_LABEL_OFFSET.x;
  const y = Number.isFinite(current.y) ? current.y : DEFAULT_LABEL_OFFSET.y;
  return { x, y };
}

function createRow(className){
  const row = document.createElement('div');
  row.className = `row ${className}`;
  return row;
}

function formatFlightLevel(level){
  if(level==null || Number.isNaN(level)) return '---';
  const value = Math.round(level);
  return value.toString().padStart(3, '0');
}

function formatGroundSpeed(gs){
  if(gs==null || Number.isNaN(gs)) return '---';
  return Math.round(gs).toString();
}

function formatVerticalSpeed(vs){
  if(vs==null || Number.isNaN(vs)) return '0';
  const sign = vs > 0 ? '+' : vs < 0 ? '-' : '±';
  const value = Math.abs(Math.round(vs)).toString().padStart(2, '0');
  return `${sign}${value}`;
}

function formatHeading(hdg){
  if(hdg==null || Number.isNaN(hdg)) return 'h';
  const norm = Math.round(((hdg % 360) + 360) % 360);
  return `${norm.toString().padStart(3, '0')}°`;
}

function levelItemsFromTrack(track){
  const items = [];
  if(track.actualFlightLevel!=null){
    items.push({ label:'AFL', value:track.actualFlightLevel });
  }

  const status = track.status || '';
  let primaryLevel = null;
  const preferPel = status === 'inbound' || status === 'preinbound';
  const forceCfl = status === 'accepted' || status === 'intruder' || status === 'unconcerned';

  if(forceCfl){
    if(track.clearedFlightLevel!=null){
      primaryLevel = { label:'CFL', value:track.clearedFlightLevel };
    }
  }else if(preferPel){
    if(track.plannedEntryLevel!=null){
      primaryLevel = { label:'PEL', value:track.plannedEntryLevel };
    }else if(track.clearedFlightLevel!=null){
      primaryLevel = { label:'CFL', value:track.clearedFlightLevel };
    }
  }else if(track.clearedFlightLevel!=null){
    primaryLevel = { label:'CFL', value:track.clearedFlightLevel };
  }else if(track.plannedEntryLevel!=null){
    primaryLevel = { label:'PEL', value:track.plannedEntryLevel };
  }

  if(primaryLevel){
    items.push(primaryLevel);
  }

  if(track.exitFlightLevel!=null){
    items.push({ label:'XFL', value:track.exitFlightLevel });
  }

  return items;
}

function computeLevelDisplay(track){
  const items = levelItemsFromTrack(track);
  if(items.length===0) return { text:'', tooltip:'', condensed:false };
  const tooltip = items.map(item=>`${item.label} ${formatFlightLevel(item.value)}`).join(' | ');
  const displayItems = items.filter(item=>item.label !== 'AFL');
  if(displayItems.length===0){
    return { text:'', tooltip, condensed:false };
  }
  const rawValues = displayItems.map(item=>formatFlightLevel(item.value));
  const displayValues = [];
  for(const value of rawValues){
    if(displayValues.length===0 || displayValues[displayValues.length-1] !== value){
      displayValues.push(value);
    }
  }
  const condensed = displayValues.length < rawValues.length;
  return { text: displayValues.join(' '), tooltip, condensed };
}

function formatVsIndicator(vs){
  if(vs>0) return '↑';
  if(vs<0) return '↓';
  return '';
}

function formatExpectedLevel(level){
  if(level==null || Number.isNaN(level)) return '--';
  const value = Math.round(level);
  return Math.floor(value / 10).toString().padStart(2, '0');
}

function ensureOverlayCache(overlay){
  if(!overlay.__trackNodes){
    overlay.__trackNodes = new Map();
  }
  return overlay.__trackNodes;
}

function getTrackRevision(track){
  if(!track || typeof track !== 'object') return 0;
  if(typeof track.labelRevision === 'number') return track.labelRevision;
  if(typeof track.revision === 'number') return track.revision;
  if(typeof track.version === 'number') return track.version;
  if(typeof track.rev === 'number') return track.rev;
  return track.__revision || track.__version || 0;
}

function createLabelNode(){
  const root = document.createElement('div');
  root.className = 'track-label';

  const row0 = createRow('row0');
  const row1 = createRow('row1');
  const row2 = createRow('row2');
  const row3 = createRow('row3');
  const row4 = createRow('row4');

  const callsign = document.createElement('span');
  callsign.className = 'callsign';
  const speedToggle = document.createElement('span');
  speedToggle.className = 'toggle speed muted';

  row1.append(callsign, speedToggle);

  const afl = document.createElement('span');
  afl.className = 'afl';
  const vsIndicator = document.createElement('span');
  vsIndicator.className = 'vs-indicator muted';
  const levels = document.createElement('span');
  levels.className = 'levels muted';

  row2.append(afl, vsIndicator, levels);

  const typeToggle = document.createElement('span');
  typeToggle.className = 'toggle type muted';
  const wake = document.createElement('span');
  wake.className = 'wake';
  const destination = document.createElement('span');
  destination.className = 'destination muted';

  row3.append(typeToggle, wake, destination);

  const assignedHeading = document.createElement('span');
  assignedHeading.className = 'assigned-heading';
  const assignedSpeed = document.createElement('span');
  assignedSpeed.className = 'assigned-speed';
  const assignedVertical = document.createElement('span');
  assignedVertical.className = 'assigned-vertical';
  const ecl = document.createElement('span');
  ecl.className = 'assigned-ecl';

  row4.append(assignedHeading, assignedSpeed, assignedVertical, ecl);

  root.append(row0, row1, row2, row3, row4);

  const node = {
    root,
    row0,
    callsign,
    speedToggle,
    afl,
    vsIndicator,
    levels,
    typeToggle,
    wake,
    destination,
    assignedHeading,
    assignedSpeed,
    assignedVertical,
    ecl,
    track: null,
    revision: undefined,
    needsMeasure: true,
    width: 0,
    height: 0,
    dragState: null,
    lastScreen: null,
  };

  speedToggle.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    node.track.showGroundSpeed = !node.track.showGroundSpeed;
    updateLabelNode(node, node.track);
  });

  typeToggle.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    node.track.showType = !node.track.showType;
    updateLabelNode(node, node.track);
  });

  const handlePointerDown = evt=>{
    if(evt.button!==2 || !node.track) return;
    evt.preventDefault();
    evt.stopPropagation();
    measureLabel(node);
    node.dragState = {
      pointerId: evt.pointerId,
      lastX: evt.clientX,
      lastY: evt.clientY,
    };
    node.root.classList.add('dragging');
    node.root.setPointerCapture?.(evt.pointerId);
  };

  const handlePointerMove = evt=>{
    const drag = node.dragState;
    if(!drag || evt.pointerId !== drag.pointerId || !node.track) return;
    const dx = evt.clientX - drag.lastX;
    const dy = evt.clientY - drag.lastY;
    if(dx===0 && dy===0) return;
    drag.lastX = evt.clientX;
    drag.lastY = evt.clientY;
    const track = node.track;
    const side = track.labelSide || 'left';
    const offset = getLabelOffset(track);
    const zoom = Number.isFinite(node.lastScreen?.zoom) ? node.lastScreen.zoom : 1;
    const deltaX = dx / zoom;
    const deltaY = dy / zoom;
    const nextOffset = {
      x: side === 'left' ? offset.x - deltaX : offset.x + deltaX,
      y: offset.y + deltaY,
    };
    track.labelOffset = nextOffset;
    const screen = node.lastScreen;
    if(screen){
      const width = node.width;
      const height = node.height;
      const screenZoom = Number.isFinite(screen.zoom) ? screen.zoom : 1;
      const scaledOffsetX = nextOffset.x * screenZoom;
      const scaledOffsetY = nextOffset.y * screenZoom;
      const labelX = side === 'left'
        ? screen.x - scaledOffsetX - width
        : screen.x + scaledOffsetX;
      const labelY = screen.y + scaledOffsetY - height / 2;
      node.root.dataset.side = side;
      node.root.style.transform = `translate(${Math.round(labelX)}px, ${Math.round(labelY)}px)`;
    }
  };

  const endDrag = evt=>{
    const drag = node.dragState;
    if(!drag || evt.pointerId !== drag.pointerId) return;
    evt.preventDefault();
    evt.stopPropagation();
    node.dragState = null;
    node.root.classList.remove('dragging');
    node.root.releasePointerCapture?.(evt.pointerId);
  };

  node.root.addEventListener('pointerdown', handlePointerDown);
  node.root.addEventListener('pointermove', handlePointerMove);
  node.root.addEventListener('pointerup', endDrag);
  node.root.addEventListener('pointercancel', endDrag);
  node.root.addEventListener('contextmenu', evt=>{
    evt.preventDefault();
  });

  return node;
}

function filterAlerts(track){
  if(!Array.isArray(track?.alerts)) return [];
  if(track.status !== 'intruder') return track.alerts;
  return track.alerts.filter(alert=>String(alert).toUpperCase() !== 'INTRUDER');
}

function updateLabelNode(node, track){
  node.track = track;
  node.revision = getTrackRevision(track);
  const status = track.status ? `status-${track.status}` : 'status-neutral';
  node.root.className = `track-label ${status}`;

  const alerts = filterAlerts(track);
  if(alerts.length){
    node.row0.style.display = 'flex';
    node.row0.textContent = alerts.join(' · ');
  }else{
    node.row0.style.display = 'none';
    node.row0.textContent = '';
  }

  node.callsign.textContent = track.callsign || 'UNKNOWN';

  const showGs = track.showGroundSpeed !== false;
  const speedLabel = showGs ? formatGroundSpeed(track.groundSpeed) : formatVerticalSpeed(track.verticalSpeed);
  node.speedToggle.textContent = speedLabel;
  node.speedToggle.classList.toggle('muted', false);
  node.speedToggle.title = showGs ? 'Show vertical speed' : 'Show ground speed';

  node.afl.textContent = formatFlightLevel(track.actualFlightLevel);

  node.vsIndicator.textContent = formatVsIndicator(track.verticalSpeed);
  node.vsIndicator.classList.toggle('muted', track.verticalSpeed==null || track.verticalSpeed===0);

  const levelDisplay = computeLevelDisplay(track);
  node.levels.textContent = levelDisplay.text;
  node.levels.dataset.mode = levelDisplay.condensed ? 'condensed' : 'full';
  node.levels.title = levelDisplay.tooltip;
  node.levels.classList.toggle('muted', !levelDisplay.text);

  const showType = track.showType !== false;
  const typeLabel = showType ? (track.aircraftType || '---') : (track.squawk || '----');
  node.typeToggle.textContent = typeLabel;
  node.typeToggle.title = showType ? 'Show squawk code' : 'Show aircraft type';
  node.typeToggle.classList.toggle('muted', false);

  node.wake.textContent = track.wake || '-';
  node.destination.textContent = track.destination || track.exitPoint || '----';

  const headingValue = formatHeading(track.assignedHeading);
  node.assignedHeading.textContent = headingValue;
  node.assignedHeading.dataset.empty = headingValue === 'h';

  const speedValue = track.assignedSpeed || 's';
  node.assignedSpeed.textContent = speedValue;
  node.assignedSpeed.dataset.empty = speedValue === 's';

  const verticalValue = track.verticalRateAssigned ? 'R' : 'r';
  node.assignedVertical.textContent = verticalValue;
  node.assignedVertical.dataset.empty = verticalValue === 'r';

  const eclValue = track.expectedCruiseLevel!=null ? formatExpectedLevel(track.expectedCruiseLevel) : '--';
  node.ecl.textContent = eclValue;
  node.ecl.dataset.empty = eclValue === '--';
  node.needsMeasure = true;
}

function measureLabel(node){
  if(!node.needsMeasure) return;
  node.needsMeasure = false;
  node.width = node.root.offsetWidth || 0;
  node.height = node.root.offsetHeight || 0;
}

function positionLabel(node, track, screen){
  measureLabel(node);
  const overlayOffset = getLabelOffset(track);
  const side = track.labelSide || 'left';
  const width = node.width;
  const height = node.height;
  const zoom = Number.isFinite(screen?.zoom) ? screen.zoom : 1;
  const scaledOffsetX = overlayOffset.x * zoom;
  const scaledOffsetY = overlayOffset.y * zoom;
  const baseX = side === 'left'
    ? screen.x - scaledOffsetX
    : screen.x + scaledOffsetX;
  const labelX = side === 'left' ? baseX - width : baseX;
  const labelY = screen.y + scaledOffsetY - height / 2;
  node.root.dataset.side = side;
  node.root.style.transform = `translate(${Math.round(labelX)}px, ${Math.round(labelY)}px)`;
  const rectLeft = labelX;
  const rectRight = labelX + width;
  const rectTop = labelY;
  const rectBottom = labelY + height;
  const anchorX = Math.min(Math.max(screen.x, rectLeft), rectRight);
  const anchorY = Math.min(Math.max(screen.y, rectTop), rectBottom);
  node.lastScreen = { x: screen.x, y: screen.y, zoom };
  return { x: anchorX, y: anchorY };
}

export function syncTrackLabels(overlay, projected){
  if(!overlay) return new Map();
  const cache = ensureOverlayCache(overlay);
  const anchors = new Map();
  const nextIds = new Set();
  for(const item of projected){
    const track = item.track;
    nextIds.add(track.id);
    let node = cache.get(track.id);
    if(!node){
      node = createLabelNode();
      cache.set(track.id, node);
      overlay.appendChild(node.root);
      updateLabelNode(node, track);
    }else{
      const revision = getTrackRevision(track);
      if(node.track !== track || node.revision !== revision){
        updateLabelNode(node, track);
      }
    }
    const anchor = positionLabel(node, track, item);
    anchors.set(track.id, anchor);
  }
  for(const [id, node] of cache){
    if(!nextIds.has(id)){
      overlay.removeChild(node.root);
      cache.delete(id);
    }
  }
  return anchors;
}
