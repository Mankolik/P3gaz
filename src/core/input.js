export function bindInput(canvas, bus){
  let isPanning=false, last=null, zoom=1;
  canvas.addEventListener('mousedown', e=>{ isPanning=true; last={x:e.clientX,y:e.clientY}; });
  window.addEventListener('mouseup', ()=>{ isPanning=false; });
  window.addEventListener('mousemove', e=>{
    if(!isPanning) return;
    bus.emit('camera:pan', {dx:(e.clientX-last.x)/zoom, dy:(e.clientY-last.y)/zoom});
    last={x:e.clientX,y:e.clientY};
  });
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    const s = Math.exp(-e.deltaY*0.001);
    bus.emit('camera:zoom', {scale:s, x:e.offsetX, y:e.offsetY});
    zoom *= s;
  }, {passive:false});
}
