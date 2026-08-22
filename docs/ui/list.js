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
import { ALL, CAP, CHIP_CAP, COLLECTIONS, DECLARED, NOCHNICHT, VOICES, found, load, shown, stateText } from './state.js';
import { deleteCollection } from './rail.js';

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
  drawDownload();                       // its labels are words, so they follow the language
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
    // "Nothing matches" is only true when something is narrowing the list. An
    // empty Sammlung is not a failed search, and saying so made a new one look
    // broken the moment it was made.
    if(searching||VOICES.size)p.textContent=t('empty_no_match');
    else{
      // bildhaft's line, with the key drawn as a key.
      const [before,after]=t('empty_start').split('{key}');
      const kbd=document.createElement('kbd');kbd.textContent='Enter';
      p.append(before,kbd,after);
    }
    $('list').appendChild(p);
    return;
  }
  for(const it of (SHOW_ALL?items:items.slice(0,CAP))){
    const d=document.createElement('div');d.className='item '+it.state;
    d.innerHTML='<div class="txt"><div class="line"></div>'+
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
    const line=d.querySelector('.line');
    line.textContent=it.text;
    line.title=t('menu_edit_text');
    line.onclick=()=>editLine(line,it);
    d.querySelector('.state').textContent=stateText(it);
    d.querySelector('.dots').onclick=ev=>openMenu(ev.currentTarget,it);
    $('list').appendChild(d);
  }
  if(!SHOW_ALL&&items.length>CAP){
    const b=document.createElement('button');
    b.className='more';b.textContent=t('show_all',{n:items.length});
    b.onclick=()=>{SHOW_ALL=true;draw()};
    $('list').appendChild(b);
  }
}

function openMenu(btn,it){
  menuOn(btn,(m,add)=>{
    if(it.state!=='missing'){
      add(t('download_mp3'),false,()=>{closeMenus();grab(it,'mp3')});
      add(t('download_wav'),false,()=>{closeMenus();grab(it,'wav')});
    }else{
      // A recording that failed — no voice yet, or the cloud said no — was
      // otherwise stuck: the only way back was to retype the sentence.
      add(t('menu_record'),false,()=>{closeMenus();record(it)});
    }
    add(t('menu_delete_one'),true,()=>{closeMenus();del(it)});
  });
}

async function record(it){
  say(t('busy_record'));
  const r=await post('/api/build',{ids:[it.id]});
  if(!r)return;
  const bad=r.failed||[];
  say(bad.length?tn('not_recorded',bad.length,{why:bad[0]}):t('done_edit',{text:it.text}));
  load();
}
addEventListener('click',e=>{if(!e.target.closest('.menuwrap'))closeMenus()});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});







async function grab(it,fmt){
  const url=await api.fileURL(it.id,fmt);
  if(!url){say(t('nothing_recorded'));return}
  const a=document.createElement('a');
  a.href=url;a.download=it.id+'.'+fmt;
  document.body.appendChild(a);a.click();a.remove();
  // A blob URL holds its blob until it is let go of; a path costs nothing.
  if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),2000);
}
// Editing a sentence happens on the sentence, the same way a Sammlung is
// renamed by typing in its title. Clicking away commits it and records again;
// Escape puts the old text back. The id never moves — it is a file name, and
// the file may already be on a device.
function editLine(el,it){
  if(el.isContentEditable)return;
  el.contentEditable='plaintext-only';
  el.spellcheck=false;
  el.focus();
  const range=document.createRange();range.selectNodeContents(el);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);

  const stop=()=>{el.contentEditable='false';el.onblur=el.onkeydown=null};
  el.onkeydown=e=>{
    if(e.key==='Escape'){el.textContent=it.text;stop();el.blur()}
    if(e.key==='Enter'){e.preventDefault();el.blur()}
  };
  el.onblur=async()=>{
    const text=el.textContent.trim();
    stop();
    if(!text||text===it.text){el.textContent=it.text;return}
    say(t('busy_record'));
    const r=await post('/api/edit',{id:it.id,text});
    if(!r){el.textContent=it.text;return}
    say(t('done_edit',{text:r.text})+
        (r.failed&&r.failed.length?' '+tn('not_recorded',1,{why:r.failed[0]}):''));
    load();
  };
}
async function del(it){
  if(!confirm(t('ask_delete_this',{text:'\u201E'+it.text+'\u201C'})))return;
  say(t('busy_delete'));
  const r=await post('/api/delete',{id:it.id});
  if(r){say(t('done_delete_one',{text:it.text}));load()}
}
// --- Einstellungen ----------------------------------------------------
// The button does the usual thing; the chevron offers the other one. Almost
// every device wants mp3, so making that the click and wav the second step is
// the honest ordering.
const recorded=()=>shown().filter(i=>i.state!=='missing').map(i=>i.id);
// The first option is the control's own name, so the closed select reads
// "Download" rather than pretending a format is already chosen. Picking one
// starts the download and the label comes straight back.
function drawDownload(){
  const sel=$('dlall'), was=document.activeElement===sel;
  sel.innerHTML='';
  sel.appendChild(new Option(t('download_all'),''));
  sel.appendChild(new Option(t('download_mp3'),'mp3'));
  sel.appendChild(new Option(t('download_wav'),'wav'));
  sel.value='';
  if(was)sel.focus();
}
$('dlall').onchange=e=>{
  const fmt=e.target.value;
  e.target.value='';
  if(fmt)packMany(recorded(),fmt);
};

// A whole Sammlung as one zip.
async function packMany(ids,fmt){
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

$('colmore').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  if(!here)return;
  add(t('collection_export'),false,()=>{closeMenus();exportCollection(here)});
  add(t('collection_delete'),true,()=>{closeMenus();deleteCollection(here.key,here.name,here.count)});
});

// One Sammlung as a file, named after it and dated, the way bildhaft names its
// exports — so a folder of them sorts and reads sensibly a year later.
$('q').oninput=draw;
