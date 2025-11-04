import { initCanvas } from './render/canvas.js';
import { createCamera } from './render/camera.js';
import { drawFrame } from './render/draw.js';
import { createBus } from './core/bus.js';
import { createState, loadConfig, saveConfig } from './core/state.js';
import { bindInput } from './core/input.js';
import { createTick } from './core/tick.js';
import { loadJSON } from './data/loader.js';
import { normalizeGeoJSON } from './data/importers/geojson.js';
import { initDefaultLayers } from './map/layers.js';
import { registerLayer, addFeatures } from './render/layers.js';
import { fitAll } from './map/map-store.js';
import { mountTopbar } from './ui/topbar.js';

async function bootstrap(){
  const canvasEl = document.getElementById('radar');
  if(!canvasEl) throw new Error('Missing #radar canvas element');

  const bus = createBus();
  const state = createState(bus);
  loadConfig(state);

  const canvas = initCanvas(canvasEl);
  const camera = createCamera(canvas.el);

  bindInput(canvas.el, bus);
  bus.on('camera:pan', ({dx, dy})=>camera.pan(dx, dy));
  bus.on('camera:zoom', ({scale, x, y})=>camera.zoomAbout(scale, x, y));

  createTick(bus);
  bus.on('tick', ()=>drawFrame(canvas, camera, state));

  initDefaultLayers(state);

  const topbarEl = document.getElementById('topbar');
  if(topbarEl) mountTopbar(topbarEl, state, bus);

  bus.on('ui:changed', ()=>saveConfig(state));

  await loadDatasets(state, camera, canvas.el);
}

async function loadDatasets(state, camera, canvasEl){
  try {
    const manifest = await loadJSON('./assets/manifest.json');
    const entries = Array.isArray(manifest?.geojson) ? manifest.geojson : [];
    for(const entry of entries){
      if(!entry?.path) continue;
      try {
        const data = await loadJSON(entry.path);
        const features = normalizeGeoJSON(data);
        if(!features.length) continue;
        const layerName = entry.layer || 'FIR';
        const layerType = entry.type || features[0]?.type || 'polygon';
        registerLayer(state, layerName, layerType);
        const filtered = features.filter(f=>!layerType || f.type===layerType);
        addFeatures(state, layerName, filtered);
      } catch(err){
        console.error('Failed to load dataset', entry?.id || entry?.path, err);
      }
    }
    fitAll(state, camera, canvasEl);
  } catch(err){
    console.error('Failed to load manifest', err);
  }
}

bootstrap().catch(err=>console.error(err));
