// basic kinematics placeholder
export function step(ac, dt){
  // heading deg, gs kt
  const sp = (ac.gs||250) * 0.514444; // m/s
  const hdg = ((ac.hdg||0) * Math.PI/180);
  ac.x += Math.cos(hdg)*sp*dt;
  ac.y -= Math.sin(hdg)*sp*dt;
}
