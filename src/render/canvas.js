export function initCanvas(el){
  const ctx = el.getContext('2d');
  function resize(){
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth, h = el.clientHeight;
    el.width = Math.max(1, Math.floor(w*dpr));
    el.height = Math.max(1, Math.floor(h*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();
  new ResizeObserver(resize).observe(el);
  return { el, ctx, resize };
}
