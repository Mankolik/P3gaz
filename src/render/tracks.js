import { parseSpeedInstruction } from '../utils/speed.js';
import { sectorMembershipTitle } from '../radar/sectors.js';
import { assignHeading, navigationTarget } from '../radar/routes.js';
import { buildDirectToPicker, getDirectToPreviewPoint } from '../ui/direct-to-picker.js';
import { aircraftCeiling } from '../radar/performance.js';

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
const HEADING_STEP = 5;
const IAS_SPEED_MIN = 120;
const IAS_SPEED_MAX = 480;
const IAS_SPEED_STEP = 10;
const MACH_SPEED_MIN = 0.30;
const MACH_SPEED_MAX = 0.90;
const MACH_SPEED_STEP = 0.01;
const VERTICAL_RATE_MIN = -4000;
const VERTICAL_RATE_MAX = 4000;
const VERTICAL_RATE_STEP = 500;
const MACH_LABEL_PRECISION = 2;
const LEVEL_MIN = 0;
const LEVEL_MAX = 600;
const LEVEL_STEP = 10;

const HEADING_OPTIONS = Array.from({ length: Math.floor(360 / HEADING_STEP) }, (_, index)=>index * HEADING_STEP);
const IAS_SPEED_OPTIONS = Array.from({ length: Math.floor((IAS_SPEED_MAX - IAS_SPEED_MIN) / IAS_SPEED_STEP) + 1 },
  (_, index)=>IAS_SPEED_MIN + index * IAS_SPEED_STEP);
const MACH_SPEED_OPTIONS = Array.from({ length: Math.floor((MACH_SPEED_MAX - MACH_SPEED_MIN) / MACH_SPEED_STEP) + 1 },
  (_, index)=>Number((MACH_SPEED_MIN + index * MACH_SPEED_STEP).toFixed(MACH_LABEL_PRECISION)));
const VERTICAL_RATE_OPTIONS = Array.from({ length: Math.floor((VERTICAL_RATE_MAX - VERTICAL_RATE_MIN) / VERTICAL_RATE_STEP) + 1 },
  (_, index)=>VERTICAL_RATE_MIN + index * VERTICAL_RATE_STEP);
const LEVEL_OPTIONS = Array.from({
  length: Math.floor((LEVEL_MAX - LEVEL_MIN) / LEVEL_STEP) + 1,
}, (_, index)=>LEVEL_MAX - index * LEVEL_STEP);

let activeTrackPicker = null;
const labelNodes = new WeakMap();
const shortcutDocuments = new WeakSet();

export function getRoutePreviewTrack(){
  return activeTrackPicker?.panel?.isConnected && activeTrackPicker.panel.dataset.type === 'direct-to'
    ? activeTrackPicker.node.track : null;
}

export function getRoutePreviewPoint(){
  return getRoutePreviewTrack() ? getDirectToPreviewPoint(activeTrackPicker.panel) : null;
}

function bindRouteShortcut(doc){
  if(shortcutDocuments.has(doc)) return;
  shortcutDocuments.add(doc);
  doc.addEventListener('keydown',event=>{
    if(event.key?.toLowerCase() !== 'r' || event.repeat || event.isComposing || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey) return;
    const editing=element=>element?.isContentEditable || element?.closest?.('input,textarea,select,[role="textbox"]');
    if(editing(event.target) || editing(doc.activeElement)) return;
    // Actual pointer hover, not the last selected/focused label. Removed labels
    // and pointer movement outside a label cannot leave a stale shortcut target.
    const node=labelNodes.get(doc.querySelector('.track-label:hover'));
    if(!node?.track) return;
    event.preventDefault();
    node.track.routeVisible=!node.track.routeVisible;
  });
}

function degToRad(heading){
  const deg = Number.isFinite(heading) ? heading : 0;
  return (deg - 90) * Math.PI / 180;
}

function nowMs(){
  if(typeof performance !== 'undefined' && typeof performance.now === 'function'){
    return performance.now();
  }
  return Date.now();
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
    const dx = Number.isFinite(track.vectorDx) ? track.vectorDx : 0;
    const dy = Number.isFinite(track.vectorDy) ? track.vectorDy : 0;
    const vecLength = Math.hypot(dx, dy);
    const angle = vecLength > 0 ? Math.atan2(dy, dx) : degToRad(track.heading);
    const half = size / 2;
    ctx.save();
    ctx.translate(track.x, track.y);
    ctx.lineWidth = invZoom / pixelScale;
    if(vecLength > 0){
      ctx.save();
      ctx.rotate(angle);
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

function normalizeSpeedAssignment(track){
  const existing = track?.assignedSpeed;
  const modeHint = existing && typeof existing === 'object' && existing.mode ? existing.mode : 'IAS';
  const parsed = parseSpeedInstruction(existing, modeHint);
  const mode = parsed.mode === 'Mach' ? 'Mach' : 'IAS';
  let value = parsed.value;
  if(!Number.isFinite(value)){
    value = null;
  }else if(mode === 'Mach'){
    value = Number(Math.min(Math.max(value, MACH_SPEED_MIN), MACH_SPEED_MAX).toFixed(MACH_LABEL_PRECISION));
  }else{
    value = Math.round(Math.min(Math.max(value, IAS_SPEED_MIN), IAS_SPEED_MAX));
  }
  const normalized = { mode, value };
  track.assignedSpeed = normalized;
  return normalized;
}

function formatAssignedSpeedDisplay(assignment){
  if(!assignment || assignment.value==null || Number.isNaN(assignment.value)){
    return '';
  }
  const mode = String(assignment.mode || 'IAS').toUpperCase().startsWith('M') ? 'Mach' : 'IAS';
  if(mode === 'Mach'){
    const mach = Number(assignment.value);
    if(!Number.isFinite(mach)) return '';
    const hundredths = Math.round(mach * 100).toString().padStart(2, '0');
    return `M${hundredths}`;
  }
  const knots = Math.round(Number(assignment.value));
  if(!Number.isFinite(knots) || knots <= 0) return '';
  const tens = Math.round(knots / 10).toString().padStart(2, '0');
  return `N${tens}`;
}

function normalizeVerticalAssignment(track, preserveFlag=false){
  const assignment = track?.assignedVertical;
  if(!assignment || typeof assignment !== 'object'){
    track.assignedVertical = null;
    if(!preserveFlag){
      track.verticalRateAssigned = false;
    }
    return null;
  }
  const rawValue = Number(assignment.value);
  if(!Number.isFinite(rawValue)){
    track.assignedVertical = null;
    if(!preserveFlag){
      track.verticalRateAssigned = false;
    }
    return null;
  }
  const comparator = assignment.comparator === 'or-greater'
    ? 'or-greater'
    : assignment.comparator === 'or-less'
      ? 'or-less'
      : 'exact';
  const value = Math.round(Math.max(Math.min(rawValue, 6000), -6000));
  const normalized = { value, comparator };
  track.assignedVertical = normalized;
  track.verticalRateAssigned = true;
  return normalized;
}

function clearVerticalAssignment(track){
  track.assignedVertical = null;
  track.verticalRateAssigned = false;
}

function formatAssignedVerticalDisplay(assignment){
  if(!assignment || assignment.value==null || Number.isNaN(assignment.value)){
    return '';
  }
  const magnitude = Math.round(Math.abs(assignment.value));
  const prefix = assignment.value > 0 ? '+' : assignment.value < 0 ? '-' : '';
  let display = magnitude === 0 ? '0' : `${prefix}${magnitude}`;
  if(assignment.comparator === 'or-greater'){
    display += '+';
  }else if(assignment.comparator === 'or-less'){
    display += '-';
  }
  return display;
}

function levelItemsFromTrack(track){
  const items = [];
  if(track.actualFlightLevel!=null){
    items.push({ label:'AFL', value:track.actualFlightLevel, field:'actualFlightLevel' });
  }

  const status = track.status || '';
  let primaryLevel = null;
  const preferPel = status === 'inbound' || status === 'preinbound';
  const forceCfl = status === 'accepted' || status === 'intruder' || status === 'unconcerned';

  if(forceCfl){
    if(track.clearedFlightLevel!=null){
      primaryLevel = { label:'CFL', value:track.clearedFlightLevel, field:'clearedFlightLevel' };
    }
  }else if(preferPel){
    if(track.plannedEntryLevel!=null){
      primaryLevel = { label:'PEL', value:track.plannedEntryLevel, field:'plannedEntryLevel' };
    }else if(track.clearedFlightLevel!=null){
      primaryLevel = { label:'CFL', value:track.clearedFlightLevel, field:'clearedFlightLevel' };
    }
  }else if(track.clearedFlightLevel!=null){
    primaryLevel = { label:'CFL', value:track.clearedFlightLevel, field:'clearedFlightLevel' };
  }else if(track.plannedEntryLevel!=null){
    primaryLevel = { label:'PEL', value:track.plannedEntryLevel, field:'plannedEntryLevel' };
  }

  if(primaryLevel){
    items.push(primaryLevel);
  }

  if(track.exitFlightLevel!=null){
    items.push({ label:'XFL', value:track.exitFlightLevel, field:'exitFlightLevel' });
  }

  return items;
}

function determinePrimaryLabel(track){
  if(!track) return null;
  const status = track.status || '';
  const preferPel = status === 'inbound' || status === 'preinbound';
  const forceCfl = status === 'accepted' || status === 'intruder' || status === 'unconcerned';
  if(forceCfl) return 'CFL';
  if(preferPel){
    if(track.plannedEntryLevel!=null) return 'PEL';
    if(track.clearedFlightLevel!=null) return 'CFL';
    return 'PEL';
  }
  if(track.clearedFlightLevel!=null) return 'CFL';
  if(track.plannedEntryLevel!=null) return 'PEL';
  return null;
}

function updateLevelSegments(node, track, items){
  if(!node || !node.levelSegments) return;
  const segments = node.levelSegments;
  const aflItem = items.find(item=>item.label === 'AFL');
  const aflTrend = formatVsIndicator(track?.verticalSpeed);
  applyLevelSegment(segments.afl, 'AFL', aflItem?.value ?? track?.actualFlightLevel, null, false, aflTrend);

  const primaryItem = items.find(item=>item.label === 'CFL' || item.label === 'PEL');
  const primaryLabel = primaryItem?.label || determinePrimaryLabel(track) || 'CFL';
  const primaryField = primaryItem?.field || (primaryLabel === 'PEL' ? 'plannedEntryLevel' : 'clearedFlightLevel');
  const primaryEditable = !!primaryField;
  const primaryValue = primaryItem?.value ?? track?.[primaryField] ?? null;
  applyLevelSegment(segments.primary, primaryLabel, primaryValue, primaryEditable ? primaryField : null, primaryEditable);

  const exitItem = items.find(item=>item.label === 'XFL');
  const exitValue = exitItem?.value ?? track?.exitFlightLevel ?? null;
  applyLevelSegment(segments.exit, 'XFL', exitValue, 'exitFlightLevel', true);
  segments.exit.segment.classList.toggle('is-empty-exit',exitValue==null);
  if(exitValue==null)segments.exit.value.textContent='\u00a0';

  // Keep every field in the same column, even when a repeated value is hidden.
  let previousValue = null;
  for(const segment of [segments.afl, segments.primary, segments.exit]){
    const value = segment.value.textContent;
    segment.segment.classList.toggle('is-repeated', value !== '---' && value === previousValue);
    previousValue = value;
  }
}

function applyLevelSegment(segment, label, value, field, editable, trend){
  if(!segment) return;
  segment.label.textContent = label || '';
  segment.value.textContent = formatFlightLevel(value);
  if(segment.trend){
    const trendValue = trend || '';
    segment.trend.textContent = trendValue;
    segment.segment.classList.toggle('has-trend', trendValue.length>0);
  }
  if(field){
    segment.segment.dataset.field = field;
  }else{
    delete segment.segment.dataset.field;
  }
  if(label){
    segment.segment.dataset.label = label;
  }else{
    delete segment.segment.dataset.label;
  }
  segment.segment.dataset.editable = editable ? 'true' : 'false';
  segment.segment.classList.toggle('editable', !!editable);
  segment.value.title = `${label} ${formatFlightLevel(value)}`;
  if(segment.value.tagName === 'BUTTON'){
    segment.value.disabled = !editable;
    segment.value.setAttribute('aria-label', `Edit ${label}, ${formatFlightLevel(value)}`);
  }
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
  bindRouteShortcut(overlay.ownerDocument);
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
  root.title = 'R: toggle route display';

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

  const levels = document.createElement('span');
  levels.className = 'levels muted';
  const levelsDetail = document.createElement('span');
  levelsDetail.className = 'levels__detail';

  const createLevelSegment = role=>{
    const segment = document.createElement('span');
    segment.className = `level-segment level-${role}`;
    segment.dataset.role = role;
    const label = document.createElement('span');
    label.className = 'level-segment__label';
    const trend = role === 'afl' ? document.createElement('span') : null;
    if(trend){
      trend.className = 'level-segment__trend';
    }
    const value = document.createElement(role === 'afl' ? 'span' : 'button');
    if(role !== 'afl') value.type = 'button';
    value.className = 'level-segment__value';
    if(trend){
      segment.append(label, value, trend);
    }else{
      segment.append(label, value);
    }
    return { segment, label, value, trend };
  };

  const levelAfl = createLevelSegment('afl');
  const levelPrimary = createLevelSegment('primary');
  const levelExit = createLevelSegment('exit');

  levelsDetail.append(levelAfl.segment, levelPrimary.segment, levelExit.segment);
  levels.append(levelsDetail);

  row2.append(levels);

  const typeToggle = document.createElement('span');
  typeToggle.className = 'toggle type muted';
  const wake = document.createElement('span');
  wake.className = 'wake';
  const destination = document.createElement('button');
  destination.type = 'button';
  destination.className = 'destination muted';
  destination.setAttribute('aria-label','Direct to point');
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
    levels,
    levelsDetail,
    levelSegments: {
      afl: levelAfl,
      primary: levelPrimary,
      exit: levelExit,
    },
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
    activePicker: null,
    lastGroundSpeed: null,
    lastVerticalSpeed: null,
    lastMetricsUpdate: 0,
  };
  labelNodes.set(root,node);

  speedToggle.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    node.track.showGroundSpeed = !node.track.showGroundSpeed;
    updateLabelNode(node, node.track);
  });

  destination.addEventListener('click', event=>{
    event.preventDefault(); event.stopPropagation();
    if(!node.track) return;
    showTrackPicker(node, destination, 'track-picker--direct-to', (panel,close)=>{
      buildDirectToPicker(panel,{track:node.track,index:node.navigationIndex,onChange:()=>updateLabelNode(node,node.track),close});
    });
  });

  root.addEventListener('pointerenter', ()=>{
    if(node.track) root.dispatchEvent(new CustomEvent('track-hover', { bubbles:true, detail:{track:node.track} }));
  });

  typeToggle.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    node.track.showType = !node.track.showType;
    updateLabelNode(node, node.track);
  });

  levels.addEventListener('click', evt=>{
    if(!node.track) return;
    const valueEl = evt.target.closest('button.level-segment__value');
    if(valueEl && levels.contains(valueEl)){
      const segmentEl = valueEl.closest('.level-segment');
      const editable = segmentEl.dataset.editable === 'true';
      if(!editable) return;
      evt.preventDefault();
      evt.stopPropagation();
      const field = segmentEl.dataset.field;
      if(!field) return;
      const label = segmentEl.dataset.label || segmentEl.dataset.role || '';
      openSingleLevelPicker(node, valueEl, { label, key: field });
    }
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

  node.assignedHeading.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    openHeadingPicker(node, node.assignedHeading);
  });

  node.assignedSpeed.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    openSpeedPicker(node, node.assignedSpeed);
  });

  node.assignedVertical.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    openVerticalPicker(node, node.assignedVertical);
  });

  node.ecl.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    if(!node.track) return;
    openEclPicker(node, node.ecl);
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
  node.callsign.title = sectorMembershipTitle(track.sectorMembership);
  node.root.dataset.sectors = (track.sectorMembership?.sectors || []).map(sector=>sector.id).join(' ');
  node.root.dataset.sectorStatus = track.sectorMembership?.status || 'unknown';

  const showGs = track.showGroundSpeed !== false;
  let speedLabel = null;
  if(showGs){
    const groundSpeed = formatGroundSpeed(track.groundSpeed);
    speedLabel = groundSpeed;
  }else{
    speedLabel = formatVerticalSpeed(track.verticalSpeed);
  }
  node.speedToggle.textContent = speedLabel;
  node.speedToggle.classList.toggle('muted', false);
  node.speedToggle.title = showGs ? 'Show vertical speed' : 'Show ground speed';

  const levelItems = levelItemsFromTrack(track);
  node.levels.title = levelItems.map(item=>`${item.label} ${formatFlightLevel(item.value)}`).join(' | ');
  node.levels.classList.toggle('muted', levelItems.length === 0);
  updateLevelSegments(node, track, levelItems);

  const showType = track.showType !== false;
  const typeLabel = showType ? (track.aircraftType || '---') : (track.squawk || '----');
  node.typeToggle.textContent = typeLabel;
  node.typeToggle.title = showType ? 'Show squawk code' : 'Show aircraft type';
  node.typeToggle.classList.toggle('muted', false);

  node.wake.textContent = track.wake || '-';
  const target = navigationTarget(track);
  node.destination.textContent = target?.name || track.destination || track.exitPoint || '----';
  node.destination.title = target ? `Direct to ${target.name} · click to reroute` : 'Direct to point';

  const speedAssignment = normalizeSpeedAssignment(track);
  const verticalAssignment = normalizeVerticalAssignment(track, true);

  const headingValue = formatHeading(track.assignedHeading);
  node.assignedHeading.textContent = headingValue;
  node.assignedHeading.dataset.empty = headingValue === 'h';
  node.assignedHeading.title = headingValue === 'h' ? '' : headingValue;

  const speedValue = formatAssignedSpeedDisplay(speedAssignment);
  node.assignedSpeed.textContent = speedValue || 's';
  node.assignedSpeed.dataset.empty = !speedValue;
  node.assignedSpeed.dataset.mode = speedAssignment?.mode === 'Mach' ? 'mach' : 'ias';
  node.assignedSpeed.title = speedValue || '';

  const verticalValue = formatAssignedVerticalDisplay(verticalAssignment);
  const hasVerticalAssignment = track.verticalRateAssigned && !!verticalAssignment;
  node.assignedVertical.textContent = track.verticalRateAssigned ? 'R' : 'r';
  node.assignedVertical.dataset.empty = !track.verticalRateAssigned;
  node.assignedVertical.dataset.mode = hasVerticalAssignment
    ? (verticalAssignment?.comparator || 'exact')
    : (track.verticalRateAssigned ? 'pending' : 'exact');
  node.assignedVertical.dataset.value = verticalValue || '';
  node.assignedVertical.title = track.verticalRateAssigned
    ? (verticalValue ? `${verticalValue} FPM` : 'Rate assigned')
    : '';

  const eclValue = track.expectedCruiseLevel!=null ? formatExpectedLevel(track.expectedCruiseLevel) : '--';
  node.ecl.textContent = eclValue;
  node.ecl.title = track.expectedCruiseLevel!=null ? `ECL FL${formatFlightLevel(track.expectedCruiseLevel)}` : 'ECL';
  node.ecl.dataset.empty = eclValue === '--';
  node.needsMeasure = true;

  node.lastGroundSpeed = Number.isFinite(track.groundSpeed) ? Math.round(track.groundSpeed) : null;
  node.lastVerticalSpeed = Number.isFinite(track.verticalSpeed) ? Math.round(track.verticalSpeed) : null;
  node.lastMetricsUpdate = nowMs();
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

export function syncTrackLabels(overlay, projected, navigationIndex){
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
      if(node.track !== track || node.revision !== revision || shouldRefreshMetrics(node, track)){
        updateLabelNode(node, track);
      }
    }
    const anchor = positionLabel(node, track, item);
    node.navigationIndex = navigationIndex;
    anchors.set(track.id, anchor);
  }
  for(const [id, node] of cache){
    if(!nextIds.has(id)){
      if(activeTrackPicker?.node === node){
        closeActivePicker();
      }
      overlay.removeChild(node.root);
      cache.delete(id);
    }
  }
  return anchors;
}

function closeActivePicker(){
  if(!activeTrackPicker) return;
  const picker = activeTrackPicker;
  // Removing a focused input can fire change and attempt to close again.
  activeTrackPicker = null;
  document.removeEventListener('pointerdown', picker.handlePointerDown, true);
  document.removeEventListener('keydown', picker.handleKeyDown, true);
  if(picker.node){
    picker.node.activePicker = null;
  }
  picker.resizeObserver?.disconnect();
  picker.panel?.remove();
}

function shouldRefreshMetrics(node, track){
  if(!node || !track) return false;
  const now = nowMs();
  const elapsed = now - (node.lastMetricsUpdate || 0);
  const ground = Number.isFinite(track.groundSpeed) ? Math.round(track.groundSpeed) : null;
  const vertical = Number.isFinite(track.verticalSpeed) ? Math.round(track.verticalSpeed) : null;
  if(node.lastGroundSpeed !== ground || node.lastVerticalSpeed !== vertical){
    return true;
  }
  return elapsed >= 3000;
}

function showTrackPicker(node, anchor, className, build){
  if(!node || !anchor || typeof build !== 'function') return;
  closeActivePicker();
  const panel = document.createElement('div');
  panel.className = `track-picker${className ? ` ${className}` : ''}`;
  panel.dataset.trackId = node.track?.id || '';
  panel.style.position = 'fixed';
  panel.style.zIndex = '12000';
  const close = ()=>closeActivePicker();
  build(panel, close);
  document.body.appendChild(panel);
  positionTrackPicker(panel, anchor);
  scrollPickerToCurrentValue(panel);
  const handlePointerDown = evt=>{
    if(panel.contains(evt.target) || anchor.contains(evt.target)) return;
    closeActivePicker();
  };
  const handleKeyDown = evt=>{
    if(evt.key === 'Escape'){
      closeActivePicker();
    }
  };
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('keydown', handleKeyDown, true);
  const resizeObserver = new ResizeObserver(()=>positionTrackPicker(panel,anchor));
  resizeObserver.observe(panel);
  activeTrackPicker = { panel, node, anchor, handlePointerDown, handleKeyDown, resizeObserver };
  node.activePicker = panel;
  const input = panel.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([disabled])');
  input?.focus({preventScroll:true});
  input?.select();
}

function positionTrackPicker(panel, anchor){
  if(!panel || !anchor) return;
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 8;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;
  if(left + panelRect.width > window.innerWidth - margin){
    left = window.innerWidth - panelRect.width - margin;
  }
  if(top + panelRect.height > window.innerHeight - margin){
    top = Math.max(margin, anchorRect.top - panelRect.height - 6);
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function scrollPickerToCurrentValue(panel){
  for(const list of panel.querySelectorAll('.track-picker__options')){
    const rawCurrent = list.dataset.currentValue;
    if(rawCurrent == null || rawCurrent === '') continue;
    const current = Number(rawCurrent);
    if(!Number.isFinite(current)) continue;
    // Manual entries may fall between presets: show that range without
    // marking a different value as the selected assignment.
    let target = list.querySelector('.selected');
    if(!target){
      let nearestDistance = Infinity;
      for(const option of list.querySelectorAll('[data-value]')){
        const distance = Math.abs(Number(option.dataset.value) - current);
        if(distance < nearestDistance){
          nearestDistance = distance;
          target = option;
        }
      }
    }
    if(!target) continue;
    const listRect = list.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    list.scrollTop += targetRect.top - listRect.top - (list.clientHeight - targetRect.height) / 2;
  }
}

function createPickerOption(label, selected, value){
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'track-picker__option';
  option.textContent = label;
  if(value != null) option.dataset.value = String(value);
  if(selected) option.classList.add('selected');
  return option;
}

function createManualInput(options){
  const { placeholder, type, step, min, max, defaultValue, onSubmit, onClear, close } = options || {};
  const container = document.createElement('div');
  container.className = 'track-picker__manual';
  const input = document.createElement('input');
  input.type = type || 'text';
  if(step!=null) input.step = String(step);
  if(min!=null) input.min = String(min);
  if(max!=null) input.max = String(max);
  if(placeholder) input.placeholder = placeholder;
  input.title = 'Press Enter to apply';
  if(defaultValue!=null && defaultValue!==''){
    input.value = defaultValue;
  }
  container.appendChild(input);
  const handleSubmit = ()=>{
    if(typeof onSubmit !== 'function'){
      if(typeof close === 'function') close();
      return;
    }
    const result = onSubmit(input.value);
    if(result !== false && typeof close === 'function'){
      close();
    }
  };
  input.addEventListener('keydown', evt=>{
    if(evt.key === 'Enter'){
      evt.preventDefault();
      handleSubmit();
    }
    evt.stopPropagation();
  });
  if(typeof onClear === 'function'){
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'track-picker__clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', evt=>{
      evt.preventDefault();
      evt.stopPropagation();
      input.value = '';
      onClear();
      if(typeof close === 'function') close();
    });
    container.appendChild(clearBtn);
  }
  return container;
}

function formatVerticalOption(value){
  if(value === 0) return '0';
  const sign = value > 0 ? '+' : '-';
  return `${sign}${Math.abs(value)}`;
}

function openHeadingPicker(node, anchor){
  if(!node || !anchor || !node.track) return;
  const track = node.track;
  const selected = Number.isFinite(track.assignedHeading)
    ? ((track.assignedHeading % 360) + 360) % 360
    : null;
  showTrackPicker(node, anchor, 'track-picker--heading', (panel, close)=>{
    panel.dataset.type = 'heading';
    const list = document.createElement('div');
    list.className = 'track-picker__options';
    list.dataset.currentValue = selected ?? '';
    HEADING_OPTIONS.forEach(value=>{
      const option = createPickerOption(formatHeading(value), selected!=null && selected === value, value);
      option.addEventListener('click', evt=>{
        evt.preventDefault();
        evt.stopPropagation();
        assignHeading(track, value);
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
        close();
      });
      list.appendChild(option);
    });
    panel.appendChild(list);
    const manual = createManualInput({
      placeholder: 'Manual heading',
      type: 'number',
      min: 0,
      max: 359,
      step: 1,
      defaultValue: Number.isFinite(track.assignedHeading) ? String(Math.round(((track.assignedHeading % 360) + 360) % 360)) : '',
      onSubmit: raw=>{
        const parsed = parseInt(raw, 10);
        if(!Number.isFinite(parsed)) return false;
        const normalized = ((parsed % 360) + 360) % 360;
        assignHeading(track, normalized);
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
        return true;
      },
      onClear: ()=>{
        assignHeading(track);
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
      },
      close,
    });
    panel.appendChild(manual);
  });
}

function openSpeedPicker(node, anchor){
  if(!node || !anchor || !node.track) return;
  const track = node.track;
  const assignment = normalizeSpeedAssignment(track);
  const mode = assignment.mode === 'Mach' ? 'Mach' : 'IAS';
  const selectedValue = Number.isFinite(assignment.value) ? assignment.value : null;
  showTrackPicker(node, anchor, 'track-picker--speed', (panel, close)=>{
    panel.dataset.type = 'speed';
    const modes = document.createElement('div');
    modes.className = 'track-picker__mode-toggle';
    const iasBtn = document.createElement('button');
    iasBtn.type = 'button';
    iasBtn.textContent = 'IAS';
    const machBtn = document.createElement('button');
    machBtn.type = 'button';
    machBtn.textContent = 'MN';
    const updateModeButtons = ()=>{
      iasBtn.classList.toggle('active', mode !== 'Mach');
      machBtn.classList.toggle('active', mode === 'Mach');
    };
    updateModeButtons();
    iasBtn.addEventListener('click', evt=>{
      evt.preventDefault();
      evt.stopPropagation();
      if(mode === 'IAS') return;
      track.assignedSpeed = { mode: 'IAS', value: null };
      track.labelRevision = (track.labelRevision || 0) + 1;
      updateLabelNode(node, track);
      close();
      requestAnimationFrame(()=>openSpeedPicker(node, anchor));
    });
    machBtn.addEventListener('click', evt=>{
      evt.preventDefault();
      evt.stopPropagation();
      if(mode === 'Mach') return;
      track.assignedSpeed = { mode: 'Mach', value: null };
      track.labelRevision = (track.labelRevision || 0) + 1;
      updateLabelNode(node, track);
      close();
      requestAnimationFrame(()=>openSpeedPicker(node, anchor));
    });
    modes.append(iasBtn, machBtn);
    panel.appendChild(modes);

    const list = document.createElement('div');
    list.className = 'track-picker__options';
    const values = mode === 'Mach' ? MACH_SPEED_OPTIONS : IAS_SPEED_OPTIONS;
    list.dataset.currentValue = selectedValue ?? '';
    values.forEach(value=>{
      const label = mode === 'Mach' ? value.toFixed(MACH_LABEL_PRECISION) : String(value);
      const selected = selectedValue!=null && (mode === 'Mach'
        ? Math.abs(value - selectedValue) < 1e-3
        : Math.abs(value - selectedValue) < 0.5);
      const option = createPickerOption(label, selected, value);
      option.addEventListener('click', evt=>{
        evt.preventDefault();
        evt.stopPropagation();
        track.assignedSpeed = { mode, value: mode === 'Mach' ? Number(value.toFixed(MACH_LABEL_PRECISION)) : value };
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
        close();
      });
      list.appendChild(option);
    });
    panel.appendChild(list);

    const manual = createManualInput({
      placeholder: mode === 'Mach' ? '0.78' : '250',
      type: 'number',
      step: mode === 'Mach' ? '0.01' : '10',
      min: mode === 'Mach' ? MACH_SPEED_MIN : IAS_SPEED_MIN,
      max: mode === 'Mach' ? MACH_SPEED_MAX : IAS_SPEED_MAX,
      defaultValue: selectedValue!=null
        ? (mode === 'Mach' ? selectedValue.toFixed(MACH_LABEL_PRECISION) : String(selectedValue))
        : '',
      onSubmit: raw=>{
        if(mode === 'Mach'){
          let parsed = parseFloat(raw);
          if(Number.isNaN(parsed)) return false;
          if(parsed >= 10) parsed /= 100;
          parsed = Math.min(Math.max(parsed, MACH_SPEED_MIN), MACH_SPEED_MAX);
          track.assignedSpeed = { mode, value: Number(parsed.toFixed(MACH_LABEL_PRECISION)) };
        }else{
          let parsed = parseFloat(raw);
          if(Number.isNaN(parsed)) return false;
          parsed = Math.round(parsed);
          parsed = Math.min(Math.max(parsed, IAS_SPEED_MIN), IAS_SPEED_MAX);
          track.assignedSpeed = { mode, value: parsed };
        }
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
        return true;
      },
      onClear: ()=>{
        track.assignedSpeed = { mode, value: null };
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
      },
      close,
    });
    panel.appendChild(manual);
  });
}

function openVerticalPicker(node, anchor){
  if(!node || !anchor || !node.track) return;
  const track = node.track;
  const assignment = normalizeVerticalAssignment(track, true);
  let comparator = assignment?.comparator || 'exact';
  let selectedValue = Number.isFinite(assignment?.value) ? assignment.value : null;
  showTrackPicker(node, anchor, 'track-picker--vertical', (panel, close)=>{
    panel.dataset.type = 'vertical';
    const controls = document.createElement('div');
    controls.className = 'track-picker__controls';
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '-';
    function updateComparatorButtons(){
      plusBtn.classList.toggle('active', comparator === 'or-greater');
      minusBtn.classList.toggle('active', comparator === 'or-less');
    }
    function setComparator(next){
      comparator = comparator === next ? 'exact' : next;
      updateComparatorButtons();
      if(selectedValue!=null){
        track.assignedVertical = { value: selectedValue, comparator };
        track.labelRevision = (track.labelRevision || 0) + 1;
        normalizeVerticalAssignment(track);
        updateLabelNode(node, track);
      }
    }
    plusBtn.addEventListener('click', evt=>{
      evt.preventDefault();
      evt.stopPropagation();
      setComparator('or-greater');
    });
    minusBtn.addEventListener('click', evt=>{
      evt.preventDefault();
      evt.stopPropagation();
      setComparator('or-less');
    });
    updateComparatorButtons();
    controls.append(plusBtn, minusBtn);
    panel.appendChild(controls);

    const list = document.createElement('div');
    list.className = 'track-picker__options';
    list.dataset.currentValue = selectedValue ?? '';
    VERTICAL_RATE_OPTIONS.forEach(value=>{
      const option = createPickerOption(formatVerticalOption(value), selectedValue!=null && value === selectedValue, value);
      option.addEventListener('click', evt=>{
        evt.preventDefault();
        evt.stopPropagation();
        selectedValue = value;
        track.assignedVertical = { value, comparator };
        track.labelRevision = (track.labelRevision || 0) + 1;
        normalizeVerticalAssignment(track);
        updateLabelNode(node, track);
        close();
      });
      list.appendChild(option);
    });
    panel.appendChild(list);

    const manual = createManualInput({
      placeholder: 'FPM',
      type: 'number',
      step: '100',
      defaultValue: selectedValue!=null ? String(selectedValue) : '',
      onSubmit: raw=>{
        const parsed = parseInt(raw, 10);
        if(!Number.isFinite(parsed)) return false;
        const quantized = Math.round(parsed / 100) * 100;
        selectedValue = Math.max(Math.min(quantized, 6000), -6000);
        track.assignedVertical = { value: selectedValue, comparator };
        track.labelRevision = (track.labelRevision || 0) + 1;
        normalizeVerticalAssignment(track);
        updateLabelNode(node, track);
        return true;
      },
      onClear: ()=>{
        selectedValue = null;
        clearVerticalAssignment(track);
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
      },
      close,
    });
    panel.appendChild(manual);
  });
}

function openSingleLevelPicker(node, anchor, field){
  if(!node || !anchor || !node.track || !field || !field.key) return;
  const track = node.track;
  showTrackPicker(node, anchor, 'track-picker--levels', (panel, close)=>{
    panel.dataset.type = 'levels-single';
    const container = document.createElement('div');
    container.className = 'track-picker__levels';
    container.appendChild(createLevelEditor({ label: field.label || field.key, key: field.key }, track, node, close, { closeOnSelect: true }));
    panel.appendChild(container);
  });
}

function openEclPicker(node, anchor){
  openSingleLevelPicker(node, anchor, { label: 'ECL', key: 'expectedCruiseLevel' });
}

function createLevelEditor(field, track, node, close, options){
  const ceiling=Math.min(LEVEL_MAX,aircraftCeiling(track));
  const row = document.createElement('div');
  row.className = 'track-picker__level';
  const header = document.createElement('div');
  header.className = 'track-picker__level-header';
  const label = document.createElement('span');
  label.className = 'track-picker__level-label';
  label.textContent = field.label;
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'track-picker__clear';
  clearBtn.textContent = 'Clear';
  header.append(label, clearBtn);

  const list = document.createElement('div');
  list.className = 'track-picker__options track-picker__options--level';
  const manual = document.createElement('div');
  manual.className = 'track-picker__manual';
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(LEVEL_STEP);
  input.min = String(LEVEL_MIN);
  input.max = String(ceiling);
  input.placeholder = 'Manual level';
  input.title = `Press Enter to apply (ceiling FL${ceiling})`;
  manual.appendChild(input);

  const closeOnSelect = options?.closeOnSelect === true;

  const refresh = ()=>{
    const current = getTrackLevelValue(track, field.key);
    list.dataset.currentValue = current ?? '';
    const buttons = list.querySelectorAll('.track-picker__option');
    buttons.forEach(btn=>{
      const value = Number.parseInt(btn.dataset.value || '', 10);
      btn.classList.toggle('selected', current!=null && value === current);
    });
    if(current==null){
      input.value = '';
    }else{
      input.value = String(current);
    }
  };

  const applyValue = raw=>{
    const trimmed = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
    if(!trimmed){
      const hadValue = track[field.key]!=null;
      if(hadValue){
        track[field.key] = null;
        track.labelRevision = (track.labelRevision || 0) + 1;
        updateLabelNode(node, track);
      }
      refresh();
      return true;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if(!Number.isFinite(parsed)){
      return false;
    }
    const clamped = Math.min(clampLevelValue(parsed),ceiling);
    const previous = getTrackLevelValue(track, field.key);
    if(previous !== clamped || typeof track[field.key] !== 'number'){
      track[field.key] = clamped;
      track.labelRevision = (track.labelRevision || 0) + 1;
      updateLabelNode(node, track);
    }
    refresh();
    return true;
  };

  LEVEL_OPTIONS.filter(value=>value<=ceiling).forEach(value=>{
    const option = createPickerOption(formatFlightLevel(value), false);
    option.dataset.value = String(value);
    option.addEventListener('click', evt=>{
      evt.preventDefault();
      evt.stopPropagation();
      const applied = applyValue(value);
      if(applied && closeOnSelect && typeof close === 'function'){
        close();
      }
    });
    list.appendChild(option);
  });

  // Apply only with Enter or an option click; autofocus must not turn an
  // outside click/Escape into an accidental clearance through blur/change.
  input.addEventListener('keydown', evt=>{
    if(evt.key === 'Enter'){
      evt.preventDefault();
      const applied = applyValue(input.value);
      if(applied && closeOnSelect && typeof close === 'function'){
        close();
      }
    }else if(evt.key === 'Escape'){
      evt.preventDefault();
      refresh();
    }
    evt.stopPropagation();
  });
  input.addEventListener('pointerdown', evt=>evt.stopPropagation());
  clearBtn.addEventListener('click', evt=>{
    evt.preventDefault();
    evt.stopPropagation();
    const applied = applyValue('');
    if(applied && closeOnSelect && typeof close === 'function'){
      close();
    }
  });

  row.append(header, list, manual);
  refresh();
  return row;
}

function getTrackLevelValue(track, key){
  if(!track) return null;
  const value = track[key];
  if(!Number.isFinite(value)) return null;
  return Math.round(value);
}

function clampLevelValue(value){
  if(!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, LEVEL_MIN), LEVEL_MAX);
}
