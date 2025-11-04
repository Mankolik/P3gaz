export function createTick(bus, fps=30){
  let running = true, last = performance.now(), acc = 0, dt = 1000/fps;
  function loop(now){
    if(!running) return;
    const diff = now - last; last = now; acc += diff;
    while(acc >= dt){ bus.emit('tick', dt/1000); acc -= dt; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  return { stop(){ running=false; }, start(){ if(!running){ running=true; last=performance.now(); requestAnimationFrame(loop);} } };
}
