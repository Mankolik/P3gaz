// simplistic horizontal check placeholder
export function conflict2D(a,b, sepNm=5){
  const dx=a.x-b.x, dy=a.y-b.y; const d=Math.hypot(dx,dy)/1852; return d<sepNm;
}
