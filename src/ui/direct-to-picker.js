import { assignDirectTo, pointName, remainingPlanPoints, validPoint } from '../radar/routes.js';

const previewPoints = new WeakMap();
export const getDirectToPreviewPoint = panel=>previewPoints.get(panel) || null;

export function buildDirectToPicker(panel, {track,index,onChange,close}){
  panel.dataset.type = 'direct-to';
  const el = (tag,cls,text)=>{ const node=document.createElement(tag); node.className=cls || ''; if(text) node.textContent=text; return node; };
  const button = (label,fn)=>{ const node=el('button','track-picker__option',label); node.type='button'; node.addEventListener('click',fn); return node; };
  const title=el('strong','','Direct to point');
  const list=el('div','track-picker__options direct-to__points');
  const search=el('input','direct-to__input');
  search.type='text'; search.placeholder='Point name'; search.setAttribute('aria-label','Direct-to point');
  search.autocomplete='off'; search.spellcheck=false;
  const matchesList=el('div','track-picker__options direct-to__points');
  matchesList.hidden=true;
  const error=el('div','direct-to__error'); error.setAttribute('role','alert');
  const plan=track.flightPlan;
  const remaining=()=>remainingPlanPoints(track).filter(validPoint);
  const clearPreview=()=>previewPoints.delete(panel);
  panel.addEventListener('pointerleave',clearPreview);
  const guard=fn=>{
    error.textContent='';
    try{
      if(track.flightPlan !== plan) throw new Error('The flight plan changed. Reopen Direct to.');
      fn(); clearPreview(); onChange(); close();
    }catch(err){ error.textContent=err.message; }
  };
  const pointButton=(label,point,options)=>{
    const node=button(label,()=>guard(()=>assignDirectTo(track,point,options)));
    node.addEventListener('pointerenter',()=>previewPoints.set(panel,point));
    node.addEventListener('pointerleave',clearPreview);
    node.addEventListener('focus',()=>previewPoints.set(panel,point));
    node.addEventListener('blur',clearPreview);
    return node;
  };
  for(const p of remaining()){
    const option=pointButton(p.name,p,{planIndex:p.index});
    option.dataset.planIndex=p.index;
    list.append(option);
  }
  if(!list.children.length) list.append(el('div','direct-to__hint','No remaining FPL points'));
  const unique=new Map();
  // Keep the FPL coordinates when navigation sources differ only by rounding.
  for(const p of [...remaining(),...[...(index?.values() || [])].flat()]){
    if(!validPoint(p)) continue;
    const name=pointName(p.name),locations=unique.get(name) || [];
    if(!locations.some(other=>Math.abs(other.lon-p.lon)<1e-7 && Math.abs(other.lat-p.lat)<1e-7)) locations.push(p);
    unique.set(name,locations);
  }
  const points=[...unique.values()].flat().sort((a,b)=>pointName(a.name).localeCompare(pointName(b.name)));
  function renderMatches(){
    clearPreview(); matchesList.replaceChildren();
    const query=pointName(search.value);
    matchesList.hidden=!query;
    if(!query) return;
    const matches=points.filter(p=>pointName(p.name).startsWith(query));
    for(const p of matches.slice(0,12)){
      const duplicate=points.filter(other=>pointName(other.name) === pointName(p.name)).length > 1;
      const option=pointButton(`${p.name}${duplicate ? ` · ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` : ''}`,p);
      option.dataset.pointName=pointName(p.name);
      matchesList.append(option);
    }
    if(!matches.length) matchesList.append(el('div','direct-to__hint','Point not found in loaded navigation data.'));
    else if(matches.length>12) matchesList.append(el('div','direct-to__hint','Keep typing to narrow the list.'));
  }
  search.addEventListener('input',()=>{ error.textContent=''; renderMatches(); });
  function submit(){
    guard(()=>{
      const matches=points.filter(p=>pointName(p.name) === pointName(search.value));
      if(matches.length !== 1) throw new Error(matches.length>1 ? 'This name has multiple locations. Select one from the list.' : 'Enter a known point name or select a matching point.');
      assignDirectTo(track,matches[0]);
    });
  }
  const apply=button('Fly direct',submit); apply.classList.add('direct-to__apply');
  panel.append(title,list,search,matchesList,error,apply);
  panel.addEventListener('keydown',event=>{
    if(event.key === 'Enter' && event.target === search){ event.preventDefault(); submit(); }
    event.stopPropagation();
  });
}
