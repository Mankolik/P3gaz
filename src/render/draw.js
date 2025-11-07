import { getVisibleLayers } from './layers.js';
import { drawTrackSymbols, projectTracksToScreen, syncTrackLabels, drawTrackConnectors } from './tracks.js';

const LAYER_STYLES = {
  FIR: { stroke: '#6c757d' },
  SECTOR_LOW: { stroke: '#2f9b46' },
  SECTOR_HIGH: { stroke: '#7a1f3d' },
  TMA_LOWER: { stroke: '#22495e' },
  TMA_UPPER: { stroke: '#1b6078' },
  ZONES: { stroke: '#ff0000' }
};

function getStrokeColor(name){
  return LAYER_STYLES[name]?.stroke || '#22495e';
}

export function drawFrame(canvas, camera, state, overlay){
  const {ctx} = canvas;
  const w = canvas.el.width / (window.devicePixelRatio||1);
  const h = canvas.el.height / (window.devicePixelRatio||1);
  const pixelScale = window.devicePixelRatio || 1;
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.translate(-camera.x*camera.z, -camera.y*camera.z);
  ctx.scale(camera.z, camera.z);

  const visibleLayers = [...getVisibleLayers(state)].reverse();
  let isTopLayer = true;
  for(const [name,layer] of visibleLayers){
    ctx.globalCompositeOperation = isTopLayer ? 'source-over' : 'destination-over';
    isTopLayer = false;
    if(layer.type==='polygon'){
      // Keep polygon outlines at a consistent screen-space thickness by
      // compensating for the current zoom level.
      const desiredScreenWidth = 1;
      ctx.lineWidth = (desiredScreenWidth / pixelScale) / Math.max(camera.z, 1e-6);
      ctx.strokeStyle = getStrokeColor(name);
      for(const f of layer.features){ if(!f.xy) continue;
        ctx.beginPath();
        f.xy.forEach(([x,y],i)=> i?ctx.lineTo(x,y):ctx.moveTo(x,y));
        ctx.closePath(); ctx.stroke();
      }
    }else if(layer.type==='point'){
      if(name==='WAYPOINTS'){
        const invZoom = 1 / Math.max(camera.z, 1e-6);
        const color = '#9c9c9c';
        const symbolSize = 5 * invZoom;
        const textOffset = 7 * invZoom;
        const fontSize = 8 * invZoom;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * invZoom;
        ctx.lineJoin = 'miter';
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `${fontSize}px "Inter", "Roboto", "Helvetica Neue", sans-serif`;
        for(const f of layer.features){
          const { x, y, props } = f || {};
          if(x==null || y==null) continue;
          const label = `${props?.name || ''}`.trim();
          if(!label) continue;
          ctx.beginPath();
          ctx.moveTo(x, y - symbolSize);
          ctx.lineTo(x + symbolSize, y + symbolSize);
          ctx.lineTo(x - symbolSize, y + symbolSize);
          ctx.closePath();
          ctx.stroke();
          ctx.fillText(label, x + textOffset, y);
        }
        ctx.restore();
      } else if(name==='AIRPORTS'){
        const invZoom = 1 / Math.max(camera.z, 1e-6);
        const color = '#ffffff';
        const fontSize = 9 * invZoom;
        ctx.save();
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${fontSize}px "Inter", "Roboto", "Helvetica Neue", sans-serif`;
        for(const f of layer.features){
          const { x, y, props } = f || {};
          if(x==null || y==null) continue;
          const label = `${props?.icao || props?.name || ''}`.trim();
          if(!label) continue;
          ctx.fillText(label, x, y);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#9ad1ff';
        for(const f of layer.features){ if(f.x==null) continue;
          ctx.beginPath(); ctx.arc(f.x, f.y, 2.5, 0, Math.PI*2); ctx.fill();
        }
      }
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  const tracks = state?.air?.tracks || [];
  if(tracks.length){
    drawTrackSymbols(ctx, camera, tracks);
  }
  ctx.restore();

  if(tracks.length){
    const projected = projectTracksToScreen(tracks, camera);
    const anchors = overlay ? syncTrackLabels(overlay, projected) : new Map();
    drawTrackConnectors(ctx, projected, anchors);
  } else if(overlay){
    // Remove any stale labels if tracks have been cleared.
    syncTrackLabels(overlay, []);
  }
}
