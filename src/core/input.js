export function bindInput(canvas, bus){
  let isPanning = false;
  let last = null;
  let zoom = 1;
  const pointers = new Map();
  let lastCenter = null;
  let lastDistance = null;

  const updatePointer = (id, point)=>{
    pointers.set(id, point);
  };

  const removePointer = (id)=>{
    pointers.delete(id);
    if(pointers.size===0){
      isPanning = false;
      last = null;
      lastCenter = null;
      lastDistance = null;
    }
  };

  const getPointersArray = ()=>Array.from(pointers.values());

  const getCenter = ()=>{
    const pts = getPointersArray();
    if(!pts.length) return null;
    const sum = pts.reduce((acc, p)=>({x:acc.x+p.x, y:acc.y+p.y}), {x:0, y:0});
    return {x:sum.x/pts.length, y:sum.y/pts.length};
  };

  const getDistance = ()=>{
    const pts = getPointersArray();
    if(pts.length<2) return null;
    const [a,b] = pts;
    return Math.hypot(b.x-a.x, b.y-a.y);
  };

  const emitPan = (current, previous)=>{
    if(!current || !previous) return;
    bus.emit('camera:pan', { dx:(current.x-previous.x)/zoom, dy:(current.y-previous.y)/zoom });
  };

  canvas.addEventListener('pointerdown', e=>{
    if(e.button!==undefined && e.button!==0) return;
    canvas.setPointerCapture?.(e.pointerId);
    updatePointer(e.pointerId, {x:e.clientX, y:e.clientY});
    if(pointers.size===1){
      isPanning = true;
      last = {x:e.clientX, y:e.clientY};
      lastCenter = {x:e.clientX, y:e.clientY};
      lastDistance = null;
    } else {
      lastCenter = getCenter();
      lastDistance = getDistance();
    }
    e.preventDefault();
  }, {passive:false});

  window.addEventListener('pointermove', e=>{
    if(!pointers.has(e.pointerId)) return;
    const point = {x:e.clientX, y:e.clientY};
    updatePointer(e.pointerId, point);
    if(pointers.size===1 && isPanning){
      emitPan(point, last);
      last = point;
    } else if(pointers.size>=2){
      const center = getCenter();
      emitPan(center, lastCenter);
      lastCenter = center;
      const distance = getDistance();
      if(distance && lastDistance){
        const scale = distance/lastDistance;
        if(Number.isFinite(scale) && scale>0){
          const rect = canvas.getBoundingClientRect();
          const x = center.x - rect.left;
          const y = center.y - rect.top;
          bus.emit('camera:zoom', { scale, x, y });
          zoom *= scale;
        }
      }
      lastDistance = distance;
    }
  });

  const endPan = e=>{
    if(pointers.has(e.pointerId)){
      canvas.releasePointerCapture?.(e.pointerId);
      removePointer(e.pointerId);
    }
  };

  window.addEventListener('pointerup', endPan);
  window.addEventListener('pointercancel', endPan);

  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    const s = Math.exp(-e.deltaY*0.001);
    bus.emit('camera:zoom', {scale:s, x:e.offsetX, y:e.offsetY});
    zoom *= s;
  }, {passive:false});
}
