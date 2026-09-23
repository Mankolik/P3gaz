import { initCanvas } from './render/canvas.js';
import { createCamera } from './render/camera.js';
import { drawFrame } from './render/draw.js';
import { createBus } from './core/bus.js';
import { createState, loadConfig, saveConfig } from './core/state.js';
import { bindInput } from './core/input.js';
import { createTick } from './core/tick.js';
import { loadJSON, loadAirways, loadAircraftSpawner } from './data/loader.js';
import { normalizeGeoJSON } from './data/importers/geojson.js';
import { initDefaultLayers } from './map/layers.js';
import { registerLayer, addFeatures } from './render/layers.js';
import { fitAll, fitBounds } from './map/map-store.js';
import { mountTopbar } from './ui/topbar.js';
import { advanceTraffic } from './radar/traffic-control.js';
import { createAirspaceIndex } from './radar/airspace.js';
import { groupAirspace } from './radar/sectorisation.js';
import { createSectorIndex, updateTrackSectors } from './radar/sectors.js';
import { mountSectorPanel } from './ui/panels/sector-panel.js';
import { createNavigationIndex } from './radar/routes.js';
import { createMultiplayerClient } from './multiplayer/client.js';

async function bootstrap(){
  const canvasEl = document.getElementById('radar');
  if(!canvasEl) throw new Error('Missing #radar canvas element');

  const bus = createBus();
  const state = createState(bus);
  loadConfig(state);
  createMultiplayerClient(state);

  const canvas = initCanvas(canvasEl);
  let overlayEl = canvas.el.parentElement?.querySelector('#track-overlay');
  if(!overlayEl){
    overlayEl = document.createElement('div');
    overlayEl.id = 'track-overlay';
    canvas.el.parentElement?.appendChild(overlayEl);
  }
  const mainEl = canvas.el.parentElement;
  canvas.el.addEventListener('contextmenu', evt=>evt.preventDefault());
  overlayEl?.addEventListener('contextmenu', evt=>evt.preventDefault());
  mainEl?.addEventListener('contextmenu', evt=>evt.preventDefault());

  const camera = createCamera(canvas.el);

  bindInput(canvas.el, bus, camera);
  bus.on('camera:pan', ({dx, dy})=>camera.pan(dx, dy));
  bus.on('camera:zoom', ({scale, x, y})=>camera.zoomAbout(scale, x, y));

  createTick(bus);
  bus.on('tick', dt=>{
    if(!state.multiplayer.connected)advanceTraffic(state, dt);
    updateTrackSectors(state);
    drawFrame(canvas, camera, state, overlayEl);
  });

  initDefaultLayers(state);

  const topbarEl = document.getElementById('topbar');
  if(topbarEl) mountTopbar(topbarEl, state, bus);
  mountSectorPanel(mainEl, overlayEl, state);

  bus.on('ui:changed', ()=>saveConfig(state));

  await loadDatasets(state, camera, canvas.el);
}

async function loadDatasets(state, camera, canvasEl){
  try {
    const manifest = await loadJSON('./assets/manifest.json');
    const entries = Array.isArray(manifest?.geojson) ? manifest.geojson : [];
    const loaded = [];
    for(const entry of entries){
      if(!entry?.path) continue;
      try {
        const data = await loadJSON(entry.path);
        loaded.push({ entry, data });
      } catch(err){
        console.error('Failed to load dataset', entry?.id || entry?.path, err);
      }
    }
    const project = createSharedProjection(loaded);
    const isSector = entry=>['SECTOR_LOW','SECTOR_HIGH','TMA'].includes(entry.layer);
    const sectorDatasets = loaded.filter(({entry})=>isSector(entry));
    state.air.sectorIndex = createSectorIndex(sectorDatasets.map(({data})=>data), {
      complete:sectorDatasets.length === entries.filter(isSector).length,
    });
    state.air.airspaceIndex=groupAirspace(createAirspaceIndex(state.air.sectorIndex,loaded.find(({entry})=>entry.layer==='FIR')?.data),state.air.sectorisation);
    state.map.project = project;
    state.air.navigationIndex = createNavigationIndex(loaded.filter(({entry})=>['WAYPOINTS','AIRPORTS'].includes(entry.layer)).map(({data})=>data));
    try {
      state.air.airwayResolver = await loadAirways(state.air.navigationIndex);
    } catch(err){
      console.error('Failed to load airway navigation data', err);
    }
    let epwwBounds = null;
    for(const {entry, data} of loaded){
      const features = normalizeGeoJSON(data, project);
      if(!features.length) continue;
      const layerName = entry.layer || 'FIR';
      const layerType = entry.type || features[0]?.type || 'polygon';
      const filtered = features.filter(f=>!layerType || f.type===layerType);
      if(layerName==='TMA'){
        registerLayer(state, 'TMA_LOWER', layerType);
        registerLayer(state, 'TMA_UPPER', layerType);
        const { lower, upper } = splitTmaFeaturesByCeiling(filtered);
        if(lower.length) addFeatures(state, 'TMA_LOWER', lower);
        if(upper.length) addFeatures(state, 'TMA_UPPER', upper);
        continue;
      }
      registerLayer(state, layerName, layerType);
      addFeatures(state, layerName, filtered);
      if(layerName==='FIR'){
        const bounds = boundsForFeatures(filtered, props=>{
          const tag = `${props?.AV_AIRSPAC || props?.name || ''}`.toUpperCase();
          return tag.includes('EPWW');
        });
        if(bounds) epwwBounds = mergeBounds(epwwBounds, bounds);
      }
    }
    try {
      const missingNavigation=entries.filter(e=>['FIR','WAYPOINTS','AIRPORTS'].includes(e.layer)).filter(e=>!loaded.some(d=>d.entry===e));
      if(missingNavigation.length)throw new Error('Required map/navigation files did not load.');
      if(!state.air.airspaceIndex.complete)throw new Error('Required airspace volumes did not load; sector coordination is unavailable.');
      const firData=loaded.find(({entry})=>entry.layer==='FIR')?.data;
      state.air.spawner=await loadAircraftSpawner(state.air.airwayResolver,firData);
      const catalogue=state.air.spawner.catalogue;
      if(catalogue.diagnostics.length)console.info('Traffic route catalogue diagnostics',catalogue.diagnostics);
      console.info(`Traffic catalogue: ${catalogue.validVariants}/${catalogue.totalVariants} routes, ${catalogue.groups.length}/${catalogue.totalGroups} airport pairs.`);
    } catch(error) {
      state.air.spawnError=error.message;
      console.error('Failed to prepare aircraft spawner',error);
    }
    state.bus.emit('spawner:ready');

    fitAll(state, camera, canvasEl);
    if(epwwBounds) fitBounds(camera, canvasEl, epwwBounds, 80);
  } catch(err){
    state.air.spawnError=err.message;
    state.bus.emit('spawner:ready');
    console.error('Failed to load manifest', err);
  }
}

function createSharedProjection(datasets){
  const stats = { sum:0, count:0 };
  const preferredLayers = new Set(['SECTOR_LOW','SECTOR_HIGH','TMA','CTR']);
  for(const {entry, data} of datasets){
    if(entry?.layer && preferredLayers.has(entry.layer)){
      accumulateLatitudes(data, stats);
    }
  }
  if(stats.count===0){
    const fir = datasets.find(d=>d.entry?.layer==='FIR');
    if(fir){
      accumulateLatitudes(fir.data, stats, props=>{
        const tag = `${props?.AV_AIRSPAC || props?.name || ''}`.toUpperCase();
        return tag.includes('EPWW');
      });
    }
  }
  if(stats.count===0){
    for(const {data} of datasets){
      accumulateLatitudes(data, stats);
    }
  }
  const meanLat = stats.count ? stats.sum / stats.count : 0;
  const lonScale = Math.cos(meanLat * Math.PI / 180) || 1;
  const factor = 10000;
  return (lon,lat)=>[lon*lonScale*factor, -lat*factor];
}

function accumulateLatitudes(geojson, stats, predicate){
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  for(const feat of features){
    const props = feat?.properties || {};
    if(predicate && !predicate(props, feat)) continue;
    accumulateGeometryLat(feat?.geometry, stats);
  }
}

function accumulateGeometryLat(geom, stats){
  if(!geom) return;
  const { type, coordinates } = geom;
  if(!coordinates) return;
  if(type==='Polygon'){
    accumulatePolygonLat(coordinates, stats);
  } else if(type==='MultiPolygon'){
    for(const poly of coordinates){
      accumulatePolygonLat(poly, stats);
    }
  } else if(type==='Point'){
    addCoordinateLat(coordinates, stats);
  } else if(type==='MultiPoint'){
    for(const coord of coordinates){
      addCoordinateLat(coord, stats);
    }
  }
}

function accumulatePolygonLat(coords, stats){
  if(!Array.isArray(coords)) return;
  for(const ring of coords){
    if(!Array.isArray(ring)) continue;
    for(const coord of ring){
      addCoordinateLat(coord, stats);
    }
  }
}

function addCoordinateLat(coord, stats){
  if(!Array.isArray(coord) || coord.length<2) return;
  const lat = coord[1];
  if(typeof lat!=='number' || !Number.isFinite(lat)) return;
  stats.sum += lat;
  stats.count += 1;
}

function splitTmaFeaturesByCeiling(features){
  const lower = [];
  const upper = [];
  for(const feature of features){
    const ceiling = getMaxTmaCeilingFl(feature?.props);
    if(ceiling!=null && ceiling >= 95){
      upper.push(feature);
    } else {
      lower.push(feature);
    }
  }
  return { lower, upper };
}

function getMaxTmaCeilingFl(props){
  const bands = Array.isArray(props?.vertical_bands) ? props.vertical_bands : [];
  let max = null;
  for(const band of bands){
    const ceiling = convertAltitudeToFl(band?.ceiling);
    if(ceiling==null) continue;
    if(max==null || ceiling>max) max = ceiling;
  }
  return max;
}

function convertAltitudeToFl(level){
  if(!level) return null;
  const { value, unit } = level;
  if(typeof value !== 'number' || !Number.isFinite(value)) return null;
  if(unit === 'FL') return value;
  if(unit === 'FT') return value / 100;
  return null;
}

function boundsForFeatures(features, predicate){
  let bounds = null;
  for(const feature of features){
    const props = feature?.props || {};
    if(predicate && !predicate(props, feature)) continue;
    const featureBounds = getFeatureBounds(feature);
    if(featureBounds) bounds = mergeBounds(bounds, featureBounds);
  }
  return bounds;
}

function getFeatureBounds(feature){
  if(!feature) return null;
  if(feature.type==='polygon' && Array.isArray(feature.xy)){
    let b = null;
    for(const point of feature.xy){
      if(!Array.isArray(point) || point.length<2) continue;
      const [x,y] = point;
      if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
      b = extendBounds(b, x, y);
    }
    return b;
  }
  if(feature.type==='point' && Number.isFinite(feature.x) && Number.isFinite(feature.y)){
    return { minX: feature.x, maxX: feature.x, minY: feature.y, maxY: feature.y };
  }
  return null;
}

function extendBounds(bounds, x, y){
  if(!bounds) return { minX:x, maxX:x, minY:y, maxY:y };
  return {
    minX: Math.min(bounds.minX, x),
    maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y),
    maxY: Math.max(bounds.maxY, y)
  };
}

function mergeBounds(a, b){
  if(!a) return b;
  if(!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

bootstrap().catch(err=>console.error(err));
