import { getVisibleLayers } from './layers.js';

export function drawFrame(canvas, camera, state){
  const {ctx} = canvas;
  const w = canvas.el.width / (window.devicePixelRatio||1);
  const h = canvas.el.height / (window.devicePixelRatio||1);
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.translate(-camera.x*camera.z, -camera.y*camera.z);
  ctx.scale(camera.z, camera.z);

  for(const [name,layer] of getVisibleLayers(state)){
    if(layer.type==='polygon'){
      ctx.lineWidth = 1; ctx.strokeStyle = '#22495e'; ctx.fillStyle = 'rgba(34,73,94,0.2)';
      for(const f of layer.features){ if(!f.xy) continue;
        ctx.beginPath();
        f.xy.forEach(([x,y],i)=> i?ctx.lineTo(x,y):ctx.moveTo(x,y));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }else if(layer.type==='point'){
      ctx.fillStyle = '#9ad1ff';
      for(const f of layer.features){ if(f.x==null) continue;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.5, 0, Math.PI*2); ctx.fill();
      }
    }
  }

  ctx.restore();
}
