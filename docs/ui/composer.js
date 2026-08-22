/* Typing a sentence, and which voice records it.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

import { $, api, post, say, t, tn } from './core.js';
import { COLLECTIONS, load, notify } from './state.js';

let VOICE_NAMES=[];
export async function loadVoices(current){
  const list=await (await api.get('/api/voices')).json();
  VOICE_NAMES=list.map(v=>v.backend==='azure'?'azure':v.label.split(' \u00b7 ')[0]);
  const sel=$('voice'), keep=sel.value;
  sel.innerHTML='';
  if(!list.length){                      // nothing usable: just show it
    sel.appendChild(new Option(current||'\u2014',''));
    sel.disabled=true;
  }else{
    sel.disabled=false;
    for(const v of list){
      const o=new Option(v.label,v.id);
      if(v.id===keep||(!keep&&v.active))o.selected=true;
      sel.appendChild(o);
    }
  }
  $('voice').dataset.was=$('voice').value;
}
// Picking a voice records nothing. It is the voice the next recording gets —
// existing phrases keep theirs until you record them again.
// Picking a voice records nothing. It is the voice the next recording gets —
// existing phrases keep theirs until you record them again.
$('voice').onchange=async e=>{
  const sel=e.target, id=sel.value, was=sel.dataset.was;
  const r=await post('/api/voice',{id});
  if(!r){sel.value=was;return}
  sel.dataset.was=id;
  say(t('voice_now',{voice:r.label}));
  notify();                                 // labels name the voice
};
$('t').onkeydown=e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('add').click()}
};
$('add').onclick=async()=>{
  const lines=$('t').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){say(t('type_first'));return}
  // A sentence goes into the Sammlung you are in. There is no field for it,
  // because there is nothing to decide: you opened a Sammlung, you typed, it
  // belongs there. Naming it again in a box beside the text was the old
  // labels-on-a-phrase idea wearing the new word.
  //
  // With several open, or with none, it goes in uncollected. Guessing which of
  // two you meant would be worse than asking nothing.
  const collections=COLLECTIONS.size===1?[...COLLECTIONS]:[];
  say(t('busy_add'));
  const res=await post('/api/phrases',{lines,collections});
  if(res){
    $('t').value='';
    // A phrase that could not be recorded was still added, so the list has to
    // be reloaded either way — and the reason has to be said out loud, or the
    // row just sits there as "not recorded" with nothing explaining why.
    const bad=res.failed||[];
    say(t('done_add',{added:res.added,rendered:res.rendered})+
        (res.merged?t('done_add_twins',{n:res.merged}):'')+'.'+
        (bad.length?' '+tn('not_recorded',bad.length,{why:bad[0]}):''));
    load();
  }
};
