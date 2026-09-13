import { assignDirectTo, assignHeading, navigationTarget, pointName, remainingPlanPoints, validPoint } from '../radar/routes.js';

export function buildDirectToPicker(panel, {track,index,onChange,close}){
  panel.dataset.type = 'direct-to';
  const el = (tag,cls,text)=>{ const node=document.createElement(tag); node.className=cls || ''; if(text) node.textContent=text; return node; };
  const button = (label,fn)=>{ const node=el('button','track-picker__option',label); node.type='button'; node.addEventListener('click',fn); return node; };
  const title=el('strong','','Direct to point');
  const search=el('input','direct-to__input');
  search.type='text'; search.placeholder='Point name'; search.setAttribute('aria-label','Direct-to point');
  search.autocomplete='off'; search.spellcheck=false;
  search.value=track.directTo?.target.name || '';
  const listTitle=el('div','direct-to__hint');
  const list=el('div','track-picker__options direct-to__points');
  const after=el('fieldset','direct-to__after');
  after.append(el('legend','','After this point'));
  const error=el('div','direct-to__error'); error.setAttribute('role','alert');
  const plan = track.flightPlan;
  let selected = track.directTo?.target || null;
  let rejoinIndex = track.directTo?.rejoinIndex ?? null;
  let returnToPlan = rejoinIndex != null;
  const remaining=()=>remainingPlanPoints(track).filter(validPoint);
  const guard = fn=>{
    error.textContent='';
    try{ fn(); onChange(); close(); }catch(err){ error.textContent=err.message; }
  };
  const catalog=()=>{
    const points=[...[...(index?.values() || [])].flat(),...remaining()];
    const unique=new Map();
    for(const p of points) if(validPoint(p)) unique.set(`${pointName(p.name)}:${p.lon}:${p.lat}`,p);
    return [...unique.values()].sort((a,b)=>pointName(a.name).localeCompare(pointName(b.name)));
  };
  const points=catalog();
  function renderPoints(){
    list.replaceChildren();
    const query=pointName(search.value);
    listTitle.textContent=query ? 'Matching points' : remaining().length ? 'Next FPL points · select to shortcut' : 'No flight plan · type a point name';
    if(!query){
      for(const p of remaining()){
        const option=button(`${p.index+1}. ${p.name}`,()=>guard(()=>{
          if(track.flightPlan !== plan) throw new Error('The flight plan changed. Reopen Direct to.');
          assignDirectTo(track,p,{planIndex:p.index});
        }));
        option.dataset.planIndex=p.index;
        list.append(option);
      }
      return;
    }
    const matches=points.filter(p=>pointName(p.name).startsWith(query));
    for(const p of matches.slice(0,12)){
      const duplicate=points.filter(other=>pointName(other.name) === pointName(p.name)).length > 1;
      const option=button(`${p.name}${duplicate ? ` · ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` : ''}`,()=>{
        selected=p; search.value=pointName(p.name); error.textContent=''; renderPoints(); search.focus({preventScroll:true}); search.select();
      });
      option.dataset.pointName=pointName(p.name);
      option.classList.toggle('selected',selected?.name === p.name && selected?.lon === p.lon && selected?.lat === p.lat);
      list.append(option);
    }
    if(!matches.length) list.append(el('div','direct-to__hint','Point not found in loaded navigation data.'));
    else if(matches.length>12) list.append(el('div','direct-to__hint','Keep typing to narrow the list.'));
  }
  search.addEventListener('input',()=>{ selected=null; error.textContent=''; renderPoints(); });
  const choice = (value,label,checked)=>{
    const row=el('label','direct-to__choice'); const radio=el('input');
    radio.type='radio'; radio.name='direct-to-after'; radio.value=value; radio.checked=checked;
    row.append(radio,document.createTextNode(label)); after.append(row); return radio;
  };
  const heading=choice('heading','End here · continue present heading',!returnToPlan);
  const rejoin=el('div','direct-to__rejoin');
  const returnInput=el('input','direct-to__input');
  returnInput.type='text'; returnInput.placeholder='Return to FPL point'; returnInput.autocomplete='off';
  returnInput.setAttribute('aria-label','Return to FPL point');
  const returnList=el('div','track-picker__options direct-to__return-points');
  const defaultReturn=remaining().find(p=>p.index === rejoinIndex) || remaining()[0];
  returnInput.value=defaultReturn?.name || '';
  if(returnToPlan && defaultReturn) rejoinIndex=defaultReturn.index;
  function renderReturn(){
    returnList.replaceChildren();
    for(const p of remaining().filter(p=>pointName(p.name).startsWith(pointName(returnInput.value)))){
      const option=button(`${p.index+1}. ${p.name}`,()=>{
        rejoinIndex=p.index; returnInput.value=p.name; renderReturn(); returnInput.focus({preventScroll:true}); returnInput.select();
      });
      option.dataset.rejoinIndex=p.index;
      option.classList.toggle('selected',p.index === rejoinIndex);
      returnList.append(option);
    }
  }
  returnInput.addEventListener('input',()=>{ rejoinIndex=null; renderReturn(); });
  if(remaining().length){
    const resume=choice('rejoin','Return to FPL point',returnToPlan);
    resume.addEventListener('change',()=>{
      returnToPlan=true; rejoin.hidden=false;
      if(rejoinIndex == null){ rejoinIndex=remaining()[0]?.index ?? null; returnInput.value=remaining()[0]?.name || ''; }
      renderReturn(); returnInput.focus({preventScroll:true}); returnInput.select();
    });
    rejoin.append(returnInput,returnList); after.append(rejoin);
  }
  rejoin.hidden=!returnToPlan;
  heading.addEventListener('change',()=>{ returnToPlan=false; rejoin.hidden=true; search.focus({preventScroll:true}); search.select(); });
  function submit(){
    guard(()=>{
      const name=pointName(search.value);
      const matches=points.filter(p=>pointName(p.name) === name);
      const target=selected && pointName(selected.name) === name ? selected : matches.length === 1 ? matches[0] : null;
      if(!target) throw new Error(matches.length>1 ? 'This name has multiple locations. Select one from the list.' : 'Enter a known point name or select a matching point.');
      let rejoinPoint=null;
      if(returnToPlan){
        if(track.flightPlan !== plan) throw new Error('The flight plan changed. Reopen Direct to.');
        const options=remaining().filter(p=>pointName(p.name) === pointName(returnInput.value));
        rejoinPoint=options.find(p=>p.index === rejoinIndex) || (options.length === 1 ? options[0] : null);
        if(!rejoinPoint) throw new Error('Select a remaining FPL point to return to.');
      }
      assignDirectTo(track,target,{rejoinIndex:rejoinPoint?.index ?? null});
    });
  }
  const actions=el('div','direct-to__actions');
  const apply=button('Fly direct',submit); apply.classList.add('direct-to__apply');
  actions.append(apply);
  if(navigationTarget(track)) actions.append(button('Cancel route · hold heading',()=>guard(()=>assignHeading(track))));
  panel.append(title,search,listTitle,list,after,error,actions);
  panel.addEventListener('keydown',event=>{
    if(event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type === 'text'){
      event.preventDefault(); submit();
    }
    event.stopPropagation();
  });
  renderPoints(); renderReturn();
}
