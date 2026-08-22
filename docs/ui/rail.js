/* The Sammlungen down the left: which exist, which you are in, and
 * making, renaming and removing them.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

import { $, post, say, t } from './core.js';
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
    b.className='list__item'+(on?' on':'');
    b.innerHTML='<span class="list__name"></span><span class="list__count"></span>';
    b.querySelector('.list__name').textContent=label;
    b.querySelector('.list__count').textContent=n;
    b.onclick=e=>{
      if(name===null){COLLECTIONS.clear()}
      else if(e.metaKey||e.ctrlKey){COLLECTIONS.has(name)?COLLECTIONS.delete(name):COLLECTIONS.add(name)}
      else{COLLECTIONS.clear();COLLECTIONS.add(name)}
      closeRail();notify();
    };
    rows.appendChild(b);
  };

  // "Enter nimmt auf · Shift + Enter neue Zeile", with both keys drawn as keys.
  $('chint1').textContent=t('compose_records');
  $('chint2').textContent=t('compose_newline');
  for(const c of DECLARED) row(c.key,c.name,c.count,COLLECTIONS.has(c.key));

  // The header names where you are. There is always somewhere to be.
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  // Not while it is being typed in, or the caret jumps to the end mid-word.
  if(document.activeElement!==$('colname'))$('colname').value=here?here.name:'';
}

// Renaming happens where the name is, not in a window over it.
export async function deleteCollection(key,label,n){
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

$('newcol').onclick=async()=>{
  const r=await post('/api/collection',{mode:'create'});
  if(!r)return;
  COLLECTIONS.clear();COLLECTIONS.add(r.key);
  closeRail();
  say(t('done_collection_new',{name:r.name}));
  await load();
  // Straight into the name, selected: typing replaces the date it was given.
  // Set here rather than left to drawRail, which deliberately leaves the field
  // alone while it has focus — otherwise making a second one in a row shows
  // the first one's name over the new one's sentences.
  const title=$('colname');title.value=r.name;title.focus();title.select();
};


