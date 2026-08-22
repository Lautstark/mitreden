/* The Sammlungen down the left: which exist, which you are in, and
 * making, renaming and removing them.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

import { $, api, closeMenus, menuOn, post, say, t } from './core.js';
import { ALL, COLLECTIONS, DECLARED, load, notify } from './state.js';

// The rail. Every declared Sammlung has a row whether or not anything is in
// it yet — that is the point of declaring one: you can start a book before you
// have translated a line of it.
//
// A click goes to a Sammlung, the way bildhaft does it, because that is what
// you do all day. Cmd or Ctrl adds a second one, because here a sentence can
// genuinely be in two at once and that has to be reachable.
export function drawRail(){
  const counts={};
  for(const i of ALL)for(const x of (i.collections||[]))counts[x]=(counts[x]||0)+1;
  const rows=$('rows');
  rows.innerHTML='';

  const row=(name,label,n,on)=>{
    const b=document.createElement('button');
    b.className='row'+(on?' on':'');
    b.innerHTML='<span class="row__name"></span><span class="row__n"></span>';
    b.querySelector('.row__name').textContent=label;
    b.querySelector('.row__n').textContent=n;
    b.onclick=e=>{
      if(name===null){COLLECTIONS.clear()}
      else if(e.metaKey||e.ctrlKey){COLLECTIONS.has(name)?COLLECTIONS.delete(name):COLLECTIONS.add(name)}
      else{COLLECTIONS.clear();COLLECTIONS.add(name)}
      closeRail();notify();
    };
    if(name!==null){
      const m=document.createElement('button');
      m.className='row__more';m.textContent='\u22ef';
      m.setAttribute('aria-haspopup','true');m.setAttribute('aria-expanded','false');
      m.title=t('more_actions');
      m.onclick=e=>{e.stopPropagation();collectionMenu(m,name,label,n)};
      b.appendChild(m);
    }
    rows.appendChild(b);
  };

  $('chint1').textContent=t('compose_hint').replace('Enter ','').replace(/^· /,'');
  for(const c of DECLARED) row(c.key,c.name,c.count,COLLECTIONS.has(c.key));

  // The header names where you are. There is always somewhere to be.
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  // Not while it is being typed in, or the caret jumps to the end mid-word.
  if(document.activeElement!==$('colname'))$('colname').value=here?here.name:'';
}

function collectionMenu(btn,key,label,n){
  menuOn(btn,(m,add)=>{
    add(t('collection_delete'),true,()=>{closeMenus();deleteCollection(key,label,n)});
  });
}

// Renaming happens where the name is, not in a window over it.
async function deleteCollection(key,label,n){
  if(!confirm(t('ask_collection_delete',{name:label,n})))return;
  const r=await post('/api/collection',{mode:'delete',name:key});
  if(!r)return;
  COLLECTIONS.delete(key);
  say(t('done_collection_delete',{name:label}));
  load();
}

function closeRail(){
  if(window.matchMedia('(max-width:820px)').matches){
    $('rail').classList.remove('open');$('scrim').hidden=true;
  }
}
function scheduleRename(){
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  if(!here)return;
  clearTimeout(renameTimer);
  const to=$('colname').value;
  renameTimer=setTimeout(async()=>{
    if(!to.trim()||to===here.name)return;
    await post('/api/collection',{mode:'rename',name:here.key,to});
    load();
  },400);
}
$('railopen').onclick=()=>{$('rail').classList.add('open');$('scrim').hidden=false};
$('railclose').onclick=closeRail;
$('scrim').onclick=closeRail;

// Renaming is typing in the title. Saved a beat after you stop, and again on
// the way out, so nothing is lost by clicking away mid-word.
$('colname').addEventListener('input',scheduleRename);
$('colname').addEventListener('blur',scheduleRename);
$('colname').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur()}};

$('newcol').onclick=()=>{
  const box=$('newcolname');
  box.hidden=false;box.value='';delete box.dataset.rename;box.focus();
};
$('newcolname').onkeydown=async e=>{
  if(e.key==='Escape'){e.target.hidden=true;return}
  if(e.key!=='Enter')return;
  const value=e.target.value.trim();
  const was=e.target.dataset.rename;
  if(!value){e.target.hidden=true;return}
  const r=was
    ? await post('/api/collection',{mode:'rename',name:was,to:value})
    : await post('/api/collection',{mode:'create',name:value});
  if(!r)return;
  e.target.hidden=true;
  say(was?t('done_edit',{text:r.name}):t('done_collection_new',{name:r.name}));
  load();
};


