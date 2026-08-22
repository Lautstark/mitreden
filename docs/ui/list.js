/* The sentences themselves: the rows, what you can do to one, and what
 * you can do to a selection.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

/* How much of the list is on screen. This is the view's own business —
 * it is not data, nothing else reads it, and the view assigns to it, which
 * an imported binding cannot allow. */
let SHOW_ALL=false, ALL_TAGS=false, ALL_VOICES=false;

import { $, api, applyLang, closeMenus, loadStrings, menuOn, post, say, t, tn } from './core.js';
import { ALL, CAP, CHIP_CAP, COLLECTIONS, DECLARED, SEL, VOICES, found, load, shown, stateText } from './state.js';

function chip(label,n,collection,set,where){
  const b=document.createElement('button');
  b.className='chip'+((collection===null?!set.size:set.has(collection))?' on':'');
  b.textContent=label;
  const s=document.createElement('span');s.className='n';s.textContent=n;
  b.appendChild(s);
  b.onclick=()=>{
    if(collection===null)set.clear();
    else if(set.has(collection))set.delete(collection);
    else set.add(collection);
    draw();
  };
  $(where).appendChild(b);
}

// Which voices are picked. NOCHNICHT stands for "not recorded at all" — the
// same question ("what does this sound like?") with the answer "nothing yet".
function drawVoiceChips(hits){
  const counts={};
  for(const i of hits){
    const key=i.state==='missing'?NOCHNICHT:(i.voice||NOCHNICHT);
    counts[key]=(counts[key]||0)+1;
  }
  for(const v of VOICES)if(!(v in counts))counts[v]=0;
  const names=Object.keys(counts).sort((a,b)=>
    a===NOCHNICHT?1:b===NOCHNICHT?-1:a.localeCompare(b,'de'));
  $('vchips').innerHTML='';
  // One voice and nothing missing is no choice at all — the row stays away.
  $('vrow').hidden=names.length<2&&!VOICES.size;
  if($('vrow').hidden)return;
  chip(t('chip_all'),hits.length,null,VOICES,'vchips');
  // Same cap as the collections: a wall of pills is not a filter any more.
  let vis=names;
  if(!ALL_VOICES&&names.length>CHIP_CAP){
    const top=names.slice(0,CHIP_CAP);
    vis=top.concat([...VOICES].filter(v=>!top.includes(v)));
  }
  for(const n of vis)
    chip(n===NOCHNICHT?t('chip_not_recorded'):n,counts[n],n,VOICES,'vchips');
  if(names.length>vis.length||ALL_VOICES&&names.length>CHIP_CAP){
    const b=document.createElement('button');
    b.className='chip fold';
    b.textContent=ALL_VOICES?t('chip_less'):t('chip_more',{n:names.length-vis.length});
    b.onclick=()=>{ALL_VOICES=!ALL_VOICES;draw()};
    $('vchips').appendChild(b);
  }
}

// The rail. Every declared Sammlung has a row whether or not anything is in
// it yet — that is the point of declaring one: you can start a book before you
// have translated a line of it.
//
// A click goes to a Sammlung, the way bildhaft does it, because that is what
// you do all day. Cmd or Ctrl adds a second one, because here a sentence can
// genuinely be in two at once and that has to be reachable.
export function draw(){
  const hits=found(), items=shown().slice().reverse();  // newest first

  // Chips count within the current search, so they stay useful while typing.
  drawVoiceChips(hits);

  const pending=items.filter(i=>i.state!=='ok').length;
  // How much is in the Sammlung you are in. A fraction of everything made
  // sense when a Sammlung was a filter over one long list; now it is a place,
  // and "0 von 3" in an empty one reads as an error rather than as empty.
  // Searching is the one thing that genuinely narrows, so it keeps a fraction.
  const searching=$('q').value.trim().length>0;
  $('count').textContent = searching
    ? t('count_filtered',{n:items.length,all:ALL.length})
    : !items.length ? t('count_none')
      : tn('count',items.length)+
        (pending?t('count_open',{n:pending}):t('count_all_recorded'));


  $('list').innerHTML='';
  if(!items.length){
    const p=document.createElement('p');p.className='empty';
    p.textContent=ALL.length?t('empty_no_match'):t('empty_start');
    $('list').appendChild(p);
    refreshSel();
    return;
  }
  for(const it of (SHOW_ALL?items:items.slice(0,CAP))){
    const d=document.createElement('div');d.className='item '+it.state;
    d.innerHTML='<input type="checkbox" aria-label="'+t('select_one')+'">'+
      '<div class="txt"><div class="line"></div>'+
      '<div class="meta">'+
      '<span class="st"><span class="dot"></span><span class="state"></span></span>'+
      '</div></div>'+
      // The player's own ⋮ menu offers a playback speed that only affects
      // listening here, never the rendered file — and a download of the preview
      // rather than the device files. Both mislead, so both are switched off.
      (it.state==='missing'?'':'<audio controls controlsList="nodownload noplaybackrate" '+
        'disableRemotePlayback preload="none" src="'+api.audio(it.id)+'"></audio>')+
      '<div class="menuwrap"><button class="dots" aria-haspopup="true" '+
      'aria-expanded="false" title="'+t('more_actions')+'" aria-label="'+
      t('more_actions')+'">\u22ee</button></div>';
    const box=d.querySelector('input[type=checkbox]');
    box.checked=SEL.has(it.id);
    box.onchange=()=>{box.checked?SEL.add(it.id):SEL.delete(it.id);refreshSel()};
    d.querySelector('.line').textContent=it.text;
    d.querySelector('.state').textContent=stateText(it);
    const meta=d.querySelector('.meta');
    for(const collection of (it.collections||[])){
      const b=document.createElement('button');
      b.className='collection';b.textContent=collection;b.title=t('collection_title');
      b.onclick=()=>{COLLECTIONS.clear();COLLECTIONS.add(collection);draw()};
      meta.appendChild(b);
    }
    d.querySelector('.dots').onclick=ev=>openMenu(ev.currentTarget,it);
    $('list').appendChild(d);
  }
  if(!SHOW_ALL&&items.length>CAP){
    const b=document.createElement('button');
    b.className='more';b.textContent=t('show_all',{n:items.length});
    b.onclick=()=>{SHOW_ALL=true;draw()};
    $('list').appendChild(b);
  }
  refreshSel();
}

// The row menu answers "what can I do with this phrase". This is the same
// question for several of them, so it is the same menu — not a bar that grows
// another control for every new action.
function refreshSel(){
  const vis=shown(), ids=vis.map(i=>i.id);
  const picked=ids.filter(i=>SEL.has(i)).length;
  const all=$('selall');
  all.checked=ids.length>0&&picked===ids.length;
  all.indeterminate=picked>0&&picked<ids.length;
  // The button acts on the whole selection, so the label has to name it —
  // including what a filter is currently hiding, or you press a button that
  // touches a phrase you cannot see.
  const versteckt=SEL.size-picked;
  $('selalltxt').textContent=!SEL.size?t('select_all')
    :versteckt?t('selected_hidden',{n:SEL.size,hidden:versteckt})
    :t('selected',{n:SEL.size});
  // Everything you can do with a selection lives behind one button. What the
  // search and the pills do is filter, nothing else.
  $('doing').hidden=!SEL.size;
}
function openMenu(btn,it){
  menuOn(btn,(m,add)=>{
    add(t('menu_edit_text'),false,()=>{closeMenus();editText(it)});
    if(it.state!=='missing'){
      add(t('download_mp3'),false,()=>{closeMenus();grab(it,'mp3')});
      add(t('download_wav'),false,()=>{closeMenus();grab(it,'wav')});
    }
    add(t('menu_change_voice'),false,
        mm=>voiceMenu(mm,(id,label)=>switchTo([it.id],id,label)));
    add((it.collections||[]).length?t('menu_change_collections'):t('menu_add_to_collection'),
        false,()=>{closeMenus();editTags(it)});
    add(t('menu_delete_one'),true,()=>{closeMenus();del(it)});
  });
}
addEventListener('click',e=>{if(!e.target.closest('.menuwrap'))closeMenus()});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});

// Second level in the same popup: seventeen voices have no place in a bar,
// but they are fine in a list you opened on purpose.
async function voiceMenu(m,apply){
  m.innerHTML='';
  for(const v of await (await api.get('/api/voices')).json()){
    const b=document.createElement('button');
    b.textContent=t('switch_to',{voice:v.label});
    b.onclick=()=>{closeMenus();apply(v.id,v.label)};
    m.appendChild(b);
  }
}

async function switchTo(ids,id,label){
  if(!ids.length)return;
  if(!confirm(tn('ask_switch',ids.length,{voice:label})))return;
  say(t('busy_switch',{voice:label}));
  const r=await post('/api/build',{force:true,ids,voice:id});
  if(r){say(t('done_switch',{n:r.rendered,voice:label}));load()}
}

async function recordMany(ids){
  if(!ids.length){say(t('nothing_to_record'));return}
  say(t('busy_build',{n:ids.length}));
  const d=await post('/api/build',{ids});   // no force: only what is missing
  if(!d)return;
  say(t('done_build',{n:d.rendered}));
  load();
}

async function grabMany(ids,fmt){
  if(!ids.length){say(t('nothing_recorded'));return}
  say(t('busy_pack',{n:ids.length}));
  const r=await api.post('/api/download',{ids,format:fmt});
  if(!r.ok){say(t('failed',{error:await r.text()}));return}
  const url=URL.createObjectURL(await r.blob());
  const a=document.createElement('a');
  a.href=url;a.download='mitreden-'+ids.length+'-'+fmt+'.zip';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  say(t('done_pack',{n:ids.length,format:fmt.toUpperCase()}));
}

async function tagsMany(ids,mode){
  const rein=mode==='add';
  const v=prompt(t(rein?'ask_collections_add':'ask_collections_remove',{n:ids.length}),'');
  if(v===null)return;
  const collections=v.split(',').map(t=>t.trim()).filter(Boolean);
  if(!collections.length){say(t('no_collection_named'));return}
  say(t(rein?'busy_collection_add':'busy_collection_remove'));
  const r=await post('/api/collections',{ids,collections,mode});
  if(r){say(t(rein?'done_collection_add':'done_collection_remove',
                {n:r.ids.length,collections:collections.join(', ')}));load()}
}

async function delMany(ids){
  if(!confirm(tn('ask_delete',ids.length)))return;
  say(t('busy_delete'));
  // One request, and the count comes back from the server. Deleting them one
  // by one meant a failure half way through still reported the full number.
  const r=await post('/api/delete',{ids});
  if(!r)return;
  SEL.clear();
  say(t('done_delete',{n:r.ids.length}));load();
}

async function grab(it,fmt){
  const url=await api.fileURL(it.id,fmt);
  if(!url){say(t('nothing_recorded'));return}
  const a=document.createElement('a');
  a.href=url;a.download=it.id+'.'+fmt;
  document.body.appendChild(a);a.click();a.remove();
  // A blob URL holds its blob until it is let go of; a path costs nothing.
  if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function editText(it){
  const v=prompt(t('ask_edit_text',{text:'\u201E'+it.text+'\u201C',id:it.id}),it.text);
  if(v===null)return;
  if(v.trim()===it.text)return;                 // nichts angefasst
  say(t('busy_record'));
  const r=await post('/api/edit',{id:it.id,text:v});
  if(r){const bad=r.failed||[];
        say(t('done_edit',{text:'\u201E'+r.text+'\u201C'})+
            (bad.length?' '+tn('not_recorded',bad.length,{why:bad[0]}):''));
        load()}
}
async function editTags(it){
  const v=prompt(t('ask_collections_one',{text:'\u201E'+it.text+'\u201C'}),
                 (it.collections||[]).join(', '));
  if(v===null)return;
  const collections=v.split(',');
  const r=await post('/api/collections',{ids:[it.id],collections,mode:'set'});
  if(r){const rest=collections.map(t=>t.trim()).filter(Boolean);
        say(rest.length?t('done_collections_one',{groups:rest.join(', ')})
                       :t('done_collections_none'));load()}
}
async function del(it){
  if(!confirm(t('ask_delete_this',{text:'\u201E'+it.text+'\u201C'})))return;
  say(t('busy_delete'));
  const r=await post('/api/delete',{id:it.id});
  if(r){say(t('done_delete_one',{text:it.text}));load()}
}
// --- Einstellungen ----------------------------------------------------
$('dlall').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const ids=shown().filter(i=>i.state!=='missing').map(i=>i.id);
  add(t('download_mp3'),false,()=>{closeMenus();grabMany(ids,'mp3')});
  add(t('download_wav'),false,()=>{closeMenus();grabMany(ids,'wav')});
});

$('colmore').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  if(!here)return;
  add(t('collection_export'),false,()=>{closeMenus();exportCollection(here)});
  add(t('collection_delete'),true,()=>{closeMenus();deleteCollection(here.key,here.name,here.count)});
});

// One Sammlung as a file, named after it and dated, the way bildhaft names its
// exports — so a folder of them sorts and reads sensibly a year later.
$('dlmp3').onclick=()=>grabMany(
  ALL.filter(i=>SEL.has(i.id)&&i.state!=='missing').map(i=>i.id),'mp3');
$('bulk').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const ids=[...SEL];
  const fertig=ALL.filter(i=>SEL.has(i.id)&&i.state!=='missing').map(i=>i.id);
  if(fertig.length)
    add(t('download_wav'),false,()=>{closeMenus();grabMany(fertig,'wav')});
  // Sentences that were imported, or whose recording failed, have no audio.
  // Without this there is no way back to one — every other entry here either
  // needs a recording or replaces one.
  const offen=ALL.filter(i=>SEL.has(i.id)&&i.state!=='ok').map(i=>i.id);
  if(offen.length)
    add(t('menu_record'),false,()=>{closeMenus();recordMany(offen)});
  add(t('menu_change_voice'),false,
      mm=>voiceMenu(mm,(id,label)=>switchTo(ids,id,label)));
  add(t('menu_add_collection'),false,()=>{closeMenus();tagsMany(ids,'add')});
  add(t('menu_remove_collection'),false,()=>{closeMenus();tagsMany(ids,'remove')});
  add(tn('menu_delete',ids.length),true,()=>{closeMenus();delMany(ids)});
});

$('q').oninput=draw;
$('selall').onchange=e=>{
  for(const i of shown()) e.target.checked?SEL.add(i.id):SEL.delete(i.id);
  draw();
};
