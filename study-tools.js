(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
  const htmlCache = new WeakMap();
  function setHTML(element, html) {
    if(htmlCache.get(element)===html)return;
    const focused=element.contains(document.activeElement)?document.activeElement:null;
    const attributes=focused?[...focused.attributes].filter(a=>a.name.startsWith('data-')):[];
    const selector=attributes.length?focused.tagName.toLowerCase()+attributes.map(a=>`[${a.name}="${CSS.escape(a.value)}"]`).join(''):null;
    element.innerHTML=html;htmlCache.set(element,html);
    if(selector)element.querySelector(selector)?.focus({preventScroll:true});
  }
  const integer = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
  const idOK = id => typeof id === 'string' && id.length > 0 && id.length <= 128;
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const stampOK = n => integer(n, 1, 9007199254740991);
  const dayKey = value => {const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value+'T12:00:00').getTime()) && dayKey(new Date(value+'T12:00:00')) === value;
  const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const catalogue = {
    plant: [{id:'tree',name:'小树',at:0},{id:'daisy',name:'雏菊',at:180},{id:'sunflower',name:'向日葵',at:360},{id:'pine',name:'松树',at:600},{id:'cherry',name:'樱花',at:900}],
    pot: [{id:'earth',name:'自然土丘',at:0},{id:'terracotta',name:'陶土花盆',at:240},{id:'porcelain',name:'月白瓷盆',at:600}],
    season: [{id:'spring',name:'春日',at:0},{id:'summer',name:'夏日',at:360},{id:'autumn',name:'秋日',at:900},{id:'winter',name:'冬日',at:1500}]
  };
  const defaults = () => ({tasks:[],reflections:[],selectedTaskId:null,gardenSelection:{plant:'tree',pot:'earth',season:'spring'}});
  function validate(d) {
    if (d.tasks !== undefined && (!Array.isArray(d.tasks) || d.tasks.length > 1000 || !d.tasks.every(t => t && idOK(t.id) && text(t.title,80) && t.title.trim() && text(t.category,24) && text(t.parentTitle,80) && dateOK(t.date) && typeof t.done==='boolean' && typeof t.deleted==='boolean' && integer(t.order,0,1000000000) && stampOK(t.updatedAt)))) return false;
    if (d.reflections !== undefined && (!Array.isArray(d.reflections) || d.reflections.length > 100000 || !d.reflections.every(r => r && idOK(r.id) && text(r.learned,1000) && text(r.next,300) && stampOK(r.updatedAt)))) return false;
    for (const key of ['tasks','reflections']) if (d[key] && new Set(d[key].map(r=>r.id)).size!==d[key].length) return false;
    if (d.selectedTaskId !== undefined && d.selectedTaskId!==null && !idOK(d.selectedTaskId)) return false;
    if (d.gardenSelection!==undefined && (!d.gardenSelection || !Object.keys(catalogue).every(k => catalogue[k].some(c=>c.id===d.gardenSelection[k])))) return false;
    for (const s of [...(d.sessions||[]),...(d.current?[d.current]:[])]) if ((s.category!==undefined && !text(s.category,24)) || (s.taskId!==undefined && s.taskId!==null && !idOK(s.taskId))) return false;
    if (d.reflections) {const sessions=new Set((d.sessions||[]).map(s=>s.id));if(!d.reflections.every(r=>sessions.has(r.id)))return false;}
    return true;
  }
  function mergeRows(local=[], remote=[]) {
    const rows=new Map(local.map(r=>[r.id,r]));
    for (const r of remote) if (!rows.has(r.id) || r.updatedAt>=rows.get(r.id).updatedAt) rows.set(r.id,r);
    return [...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  let api, taskEditorKey, reflectionEditorKey, completionKey, completionSessionId, dragId=null, allTasksExpanded=false, tasksFollowToday=true;
  const updated = row => Math.max(Date.now(), (row?.updatedAt||0)+1);
  const state = () => api.getState();
  function commit(fn) {api.sync(); if(fn(state())===false)return; api.save(); api.render();}
  function visibleTasks() {
    const date=$('tasksDate').value, category=$('tasksCategory').value, carry=$('carryTasks').checked;
    return state().tasks.filter(t=>!t.deleted && (t.date===date || (carry && !t.done && t.date<date)) && (!category||t.category===category)).sort((a,b)=>Number(a.done)-Number(b.done)||a.order-b.order||a.id.localeCompare(b.id));
  }
  function fillCategories(id, values) {
    const select=$(id), selected=select.value;
    const options='<option value="">全部分类</option>'+[...new Set(values.filter(Boolean))].sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if(select.innerHTML!==options){select.innerHTML=options;select.value=[...select.options].some(o=>o.value===selected)?selected:'';}
  }
  function renderTasks() {
    if(tasksFollowToday&&$('tasksDate').value!==dayKey(Date.now()))$('tasksDate').value=dayKey(Date.now());
    fillCategories('tasksCategory',state().tasks.filter(t=>!t.deleted).map(t=>t.category));
    fillCategories('historyCategory',state().sessions.map(s=>s.category));
    setHTML($('taskCategories'),[...new Set(state().tasks.filter(t=>!t.deleted&&t.category).map(t=>t.category))].map(c=>`<option value="${esc(c)}"></option>`).join(''));
    const tasks=visibleTasks(), completed=tasks.filter(t=>t.done).length, rows=allTasksExpanded?tasks:tasks.slice(0,8);
    $('tasksSummary').textContent=tasks.length?`${tasks.length} 件小事 · 已完成 ${completed} 件 · 点击任务开始专注，可拖动或用箭头排序。`:'写下几件想做的小事，就从其中一件开始。';
    setHTML($('tasksList'),rows.length?rows.map(t=>`<article class="planned-task ${t.done?'is-done':''} ${state().current?.taskId===t.id?'is-current':''}" draggable="${!t.done}" data-task-row="${esc(t.id)}"><input type="checkbox" class="task-checkbox" data-task-done="${esc(t.id)}" ${t.done?'checked':''} aria-label="${t.done?'重新打开':'完成'}任务：${esc(t.title)}"><div class="planned-task-main"><button type="button" class="task-start" data-task-start="${esc(t.id)}" ${t.done?'disabled':''}>${esc(t.title)}</button><div class="task-meta">${t.category?`<span class="task-category">${esc(t.category)}</span>`:''}${t.parentTitle?`<span>${esc(t.parentTitle)}</span>`:''}${t.date!==$('tasksDate').value?`<time>${t.date} 的小步</time>`:''}${state().current?.taskId===t.id?'<span>当前计时</span>':''}</div></div><div class="task-row-tools"><button type="button" data-task-move="${esc(t.id)}" data-direction="-1" aria-label="上移任务：${esc(t.title)}" title="上移">↑</button><button type="button" data-task-move="${esc(t.id)}" data-direction="1" aria-label="下移任务：${esc(t.title)}" title="下移">↓</button><button type="button" data-task-edit="${esc(t.id)}" aria-label="编辑任务：${esc(t.title)}" title="编辑">${icon('edit')}</button><button type="button" data-task-delete="${esc(t.id)}" aria-label="删除任务：${esc(t.title)}" title="删除">${icon('close')}</button></div></article>`).join(''):'<p class="tasks-empty">今天的小步，可以从一件很小的事开始。</p>');
    $('showMoreTasks').hidden=tasks.length<=8;$('showMoreTasks').textContent=allTasksExpanded?'收起任务':`展开其余 ${tasks.length-8} 件任务`;
    const sessions=new Map(state().sessions.map(s=>[s.id,s]));let last=null;for(const r of state().reflections)if(r.next.trim()&&(!last||(sessions.get(r.id)?.at||0)>(sessions.get(last.id)?.at||0)))last=r;
    $('resumeNote').hidden=!!state().current||!last;
    if(last)setHTML($('resumeNote'),`<span>上次留给自己的下一步：<strong>${esc(last.next)}</strong></span><button type="button" data-resume-note="${esc(last.id)}">填入目标</button>`);
  }
  function openTask(id='') {
    api.sync();const task=id?state().tasks.find(t=>t.id===id&&!t.deleted):null;if(id&&!task)return;
    taskEditorKey=api.getKey();$('taskForm').reset();$('plannedTaskId').value=id;$('plannedTaskTitle').value=task?.title||'';$('plannedTaskCategory').value=task?.category??$('tasksCategory').value;$('plannedTaskDate').value=task?.date||$('tasksDate').value;
    $('taskDialogTitle').textContent=id?'编辑这件小事':'添加一件小事';$('plannedTaskSubmit').textContent=id?'保存修改':'加入计划';$('taskStepsField').hidden=!!id;$('plannedTaskTitle').setCustomValidity('');api.openDialog('taskDialog');
  }
  function saveTask(e) {
    e.preventDefault();if(taskEditorKey!==api.getKey()){api.toast('账号已变化，请重新打开任务。');$('taskDialog').close();return;}
    const id=$('plannedTaskId').value,title=$('plannedTaskTitle').value.trim(),category=$('plannedTaskCategory').value.trim(),date=$('plannedTaskDate').value,steps=id?[]:$('plannedTaskSteps').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(!title){$('plannedTaskTitle').setCustomValidity('写下一件想做的小事吧。');$('plannedTaskTitle').reportValidity();return;}
    if(title.length>80||category.length>24||!dateOK(date)||steps.length>12||steps.some(s=>s.length>80)){api.toast('任务和每一步最多 80 字，分类最多 24 字，一次最多拆成 12 步，请检查日期和内容。');return;}
    commit(d=>{if(id){const t=d.tasks.find(t=>t.id===id&&!t.deleted);if(!t){api.toast('这件任务已被删除。');return false;}Object.assign(t,{title,category,date,updatedAt:updated(t)});}else{const names=steps.length?steps:[title];if(d.tasks.length+names.length>1000){api.toast('任务记录已达 1000 项，请先导出备份。');return false;}const order=Math.max(0,...d.tasks.map(t=>t.order));for(const [i,name] of names.entries())d.tasks.push({id:newId(),title:name,category,parentTitle:steps.length?title:'',date,done:false,deleted:false,order:order+(i+1)*1024,updatedAt:Date.now()});}$('taskDialog').close();});
  }
  function moveTask(id, direction, targetId) {
    commit(d=>{const rows=visibleTasks(),index=rows.findIndex(t=>t.id===id),target=targetId?rows.findIndex(t=>t.id===targetId):index+direction;if(index<0||target<0||target>=rows.length||rows[index].done!==rows[target].done)return false;const [row]=rows.splice(index,1);rows.splice(target,0,row);const ids=new Set(rows.map(r=>r.id)),others=d.tasks.filter(t=>!ids.has(t.id)).sort((a,b)=>a.order-b.order),ordered=[...rows,...others];ordered.forEach((t,i)=>{const order=(i+1)*1024;if(t.order!==order){t.order=order;t.updatedAt=updated(t);}});});
  }
  function persistReflection(id, learned, next, expectedKey) {
    if(expectedKey!==api.getKey())return false;api.sync();const d=state();if(!d.sessions.some(s=>s.id===id))return false;
    const old=d.reflections.find(r=>r.id===id);if(!old&&!learned&&!next)return true;
    const row={id,learned:learned.slice(0,1000),next:next.slice(0,300),updatedAt:updated(old)};
    if(old)d.reflections[d.reflections.indexOf(old)]=row;else d.reflections.push(row);api.save();api.render();return true;
  }
  function openReflection(id) {
    api.sync();const session=state().sessions.find(s=>s.id===id);if(!session)return;
    reflectionEditorKey=api.getKey();const note=state().reflections.find(r=>r.id===id);$('reflectionSessionId').value=id;$('reflectionLearned').value=note?.learned||'';$('reflectionNext').value=note?.next||'';$('reflectionContext').textContent=`${dayKey(session.at)} · ${session.task} · ${session.minutes} 分钟`;api.openDialog('reflectionDialog');
  }
  function completion(session) {
    completionSessionId=session?.id||null;completionKey=api.getKey();$('completionReflection').hidden=!session;$('completionReflection').open=false;
    const note=state().reflections.find(r=>r.id===session?.id);$('successLearned').value=note?.learned||'';$('successNext').value=note?.next||'';$('successReflectionStatus').textContent='可以留空，填写后自动保存。';
    const task=state().tasks.find(t=>t.id===session?.taskId&&!t.deleted&&!t.done);$('completeLinkedTask').hidden=!task;$('completeLinkedTask').dataset.taskId=task?.id||'';
  }
  let notesRows=null,notesIndex=new Map();
  function noteFor(id){if(notesRows!==state().reflections){notesRows=state().reflections;notesIndex=new Map(notesRows.map(r=>[r.id,r]));}return notesIndex.get(id);}
  function historySearchText(session) {const note=noteFor(session.id);return `${session.task} ${session.category||''} ${note?.learned||''} ${note?.next||''}`;}
  function historyDetail(session) {
    const note=noteFor(session.id);
    return `${session.category?`<span class="task-category history-category">${esc(session.category)}</span>`:''}${note?.learned?`<div class="history-reflection"><strong>学到</strong><p>${esc(note.learned)}</p></div>`:''}${note?.next?`<div class="history-reflection"><strong>下次</strong><p>${esc(note.next)}</p></div>`:''}<button class="reflection-link" type="button" data-reflection="${esc(session.id)}">${icon('edit')}${note&&(note.learned||note.next)?'编辑复盘':'记一句复盘'}</button>`;
  }

  // Garden selections and unlocks are derived from completed focus minutes.
  const totalMinutes=()=>state().sessions.reduce((n,s)=>n+s.minutes,0);
  const palettes={spring:['#f5edd3','#dfe7cf','#d4dfc0','#90a970'],summer:['#f4d99b','#d3e4c9','#bad4b5','#719663'],autumn:['#f0d7ad','#e5ddc3','#d4caab','#c18b55'],winter:['#e4e9ee','#e5e9e6','#d1dcd9','#a7bfb0']};
  function plantDrawing(id,total,color) {
    if(id==='tree'&&total<15)return '<path d="M265 168v-48" stroke="#6b8853" stroke-width="4" stroke-linecap="round"/><path d="M265 140c-29 0-40-17-35-31 24-3 38 12 35 31" fill="#94ae73"/><path d="M265 125c-1-24 16-39 34-33 1 22-12 34-34 33" fill="#77985d"/>';
    if(id==='tree'&&total<45)return '<path d="M265 168V87m0 43-19-16m19-4 17-14" stroke="#79915b" stroke-width="4"/><path d="M247 116c-25 0-34-18-28-31 21-2 34 12 28 31M282 99c-5-20 7-37 26-35 6 21-7 37-26 35M265 90c-19-11-21-32-5-44 20 10 23 29 5 44" fill="#91aa70"/>';
    if(id==='daisy'||id==='sunflower')return `<path d="M265 168V90m0 58c-26 0-39-18-35-29 24-2 37 12 35 29m0-17c21 1 36-17 33-29-23-1-34 13-33 29" stroke="#6d8d5b" stroke-width="4" fill="#91ab72"/><g transform="translate(265 78)">${Array.from({length:id==='daisy'?10:12},(_,i)=>`<ellipse cy="-22" rx="9" ry="20" fill="${id==='daisy'?'#fff9e7':'#e4ba57'}" transform="rotate(${i*(id==='daisy'?36:30)})"/>`).join('')}<circle r="${id==='daisy'?15:21}" fill="${id==='daisy'?'#d7b258':'#866a40'}"/></g>`;
    if(id==='pine')return '<path d="M265 169V66" stroke="#8c8362" stroke-width="7"/><path d="m265 33-36 53h18l-35 40h25l-34 32h124l-34-32h25l-35-40h18Z" fill="#789981"/><path d="m265 33-36 53h72Z" fill="#9bb49a"/>';
    return `<path d="M265 168V91m0 43-22-20m22 7 24-22" stroke="#928363" stroke-width="7" stroke-linecap="round"/><path d="M211 101c-16-20-2-45 17-46-6-29 32-45 49-26 27-6 40 16 34 35 24 10 26 37 6 49-6 19-35 26-50 10-18 17-53 2-56-22Z" fill="${id==='cherry'?'#d6b2bd':color}"/><path d="M232 57c-4-22 29-35 44-21 19-3 29 8 29 22-18 16-50 17-73-1" fill="${id==='cherry'?'#efced6':'#b9ca9c'}" opacity=".65"/>${id==='cherry'?'<g fill="#fff1ed"><circle cx="229" cy="87" r="4"/><circle cx="272" cy="53" r="4"/><circle cx="295" cy="98" r="4"/><circle cx="250" cy="108" r="4"/></g>':''}`;
  }
  function gardenSVG(selection,total) {
    const [sun,hill,ground,leaf]=palettes[selection.season]||palettes.spring;
    const pot=selection.pot==='earth'?'<ellipse cx="265" cy="171" rx="49" ry="8" fill="#c5b799"/>':`<path d="m235 163 7 35h46l7-35Z" fill="${selection.pot==='porcelain'?'#dfe4df':'#b68a68'}"/><rect x="232" y="158" width="66" height="10" rx="4" fill="${selection.pot==='porcelain'?'#eef0e7':'#cd9e79'}"/>`;
    const plots=[107,413,155,365,63,462,204,319].slice(0,Math.max(0,Math.floor((total-90)/600))).map((x,i)=>`<g class="extra-garden-plot" transform="translate(${x} ${187-i%2*7})"><ellipse rx="16" ry="4" fill="#819773" opacity=".2"/><path d="M0 0v-21m0 14c-10 0-15-7-13-12 10-1 15 6 13 12m0-5c8 0 12-6 11-10-9 0-13 5-11 10" stroke="#7d966a" stroke-width="1.7" fill="#a0b286"/><circle cy="-24" r="6" fill="${i%2?'#e3c59a':'#dec2c3'}"/><circle cy="-24" r="2" fill="#b29762"/></g>`).join('');
    return `<svg viewBox="0 0 520 210" xmlns="http://www.w3.org/2000/svg"><circle cx="379" cy="53" r="24" fill="${sun}"/><g fill="#f8f8ef" opacity=".7"><ellipse cx="125" cy="64" rx="28" ry="8"/><ellipse cx="143" cy="59" rx="18" ry="12"/><ellipse cx="335" cy="34" rx="20" ry="6"/></g><path d="M0 161c60-37 108-10 154-15 84-40 125-22 185-2 76-35 140-19 181 3v63H0Z" fill="${hill}"/><path d="M0 185c88-36 144 13 222-6 115-31 177-8 298-9v40H0Z" fill="${ground}"/><ellipse cx="265" cy="177" rx="60" ry="8" fill="#829571" opacity=".2"/>${plantDrawing(selection.plant,total,leaf)}${pot}${plots}${total>=90?'<g fill="#ead7a1"><circle cx="174" cy="168" r="5"/><circle cx="355" cy="167" r="5"/></g><path d="M174 173v8m181-9v10" stroke="#8d9d6e" stroke-width="2"/>':''}${selection.season==='winter'?'<g fill="#fff" opacity=".7"><circle cx="178" cy="90" r="2"/><circle cx="328" cy="112" r="2"/><circle cx="216" cy="43" r="2"/><circle cx="365" cy="139" r="2"/></g>':''}</svg>`;
  }
  function renderGarden() {
    const total=totalMinutes(),selection={...state().gardenSelection};for(const k of Object.keys(catalogue))if(!catalogue[k].some(c=>c.id===selection[k]&&total>=c.at))selection[k]=catalogue[k][0].id;
    const stages=['小芽','新叶','小树','花园'],index=total>=90?3:total>=45?2:total>=15?1:0,unlocks=Object.values(catalogue).flat(),next=unlocks.filter(u=>u.at>total).sort((a,b)=>a.at-b.at)[0];
    $('gardenStage').textContent=total<90?`第 ${index+1} 阶段 · ${stages[index]}`:`第 ${Math.floor((total-90)/600)+1} 片花圃`;
    const nextGrowth=total<15?15:total<45?45:total<90?90:null;
    $('gardenCaption').textContent=nextGrowth?`累计专注 ${total} 分钟 · 再 ${nextGrowth-total} 分钟长成${stages[index+1]}`:next?`累计专注 ${total} 分钟 · 再 ${next.at-total} 分钟解锁${next.name}`:`累计专注 ${total} 分钟 · 再 ${600-((total-90)%600)} 分钟扩展下一片花圃`;
    const previous=nextGrowth?[0,15,45][index]:Math.max(90,...unlocks.filter(u=>u.at<=total).map(u=>u.at)),target=nextGrowth||next?.at||(90+(Math.floor((total-90)/600)+1)*600),base=next?previous:90+Math.floor((total-90)/600)*600;
    $('gardenProgress').style.width=`${Math.max(0,Math.min(100,(total-(nextGrowth?previous:base))/(target-(nextGrowth?previous:base))*100))}%`;
    setHTML($('gardenScenery'),gardenSVG(selection,total));$('gardenCollectionCount').textContent=`布置花园 · 已解锁 ${unlocks.filter(u=>total>=u.at).length}/${unlocks.length}`;
    if($('gardenDialog').open)renderGardenChoices();
  }
  function renderGardenChoices() {
    const total=totalMinutes();$('gardenUnlockSummary').textContent=`已累计专注 ${total} 分钟。选择已经解锁的植物、花盆和季节。`;
    setHTML($('gardenChoices'),Object.entries(catalogue).map(([key,items])=>`<fieldset class="garden-choice-group"><legend>${{plant:'种些什么',pot:'放在哪里',season:'喜欢的季节'}[key]}</legend><div>${items.map(item=>`<button type="button" data-garden-key="${key}" data-garden-value="${item.id}" aria-pressed="${state().gardenSelection[key]===item.id}" ${total<item.at?'disabled':''}><span>${esc(item.name)}</span><small>${total>=item.at?(state().gardenSelection[key]===item.id?'正在使用':'已解锁'):`累计 ${item.at} 分钟解锁`}</small></button>`).join('')}</div></fieldset>`).join(''));
  }

  const AMBIENT_KEY='little-by-little-ambient-v1';
  let ambient={enabled:false,type:'rain',volume:25},ambientContext,ambientNodes=[],ambientGain,ambientGeneration=0,ambientPlaying=false,ambientPending=false,ambientError=false,ambientSignature='',ambientBuffer,ambientBufferType='';
  function loadAmbient(){try{const p=JSON.parse(localStorage.getItem(AMBIENT_KEY)||'null');if(p&&typeof p.enabled==='boolean'&&['rain','stream','white'].includes(p.type)&&integer(p.volume,0,100))ambient=p;}catch{}}
  function stopAmbient(){ambientGeneration++;for(const node of ambientNodes){try{if(node.stop)node.stop();node.disconnect();}catch{}}ambientNodes=[];ambientGain=null;ambientPlaying=false;ambientPending=false;ambientSignature='';if(ambientContext?.state==='running')ambientContext.suspend().catch(()=>{});}
  function ambientEligible(){const c=state().current;return ambient.enabled&&ambient.volume>0&&c?.kind==='focus'&&c.deadline!==null&&c.deadline>Date.now();}
  async function syncAmbient(userGesture=false) {
    if(!ambientEligible()){if(ambientNodes.length||ambientPending)stopAmbient();renderAmbient();return;}
    if(ambientPlaying&&ambientSignature===ambient.type){if(ambientGain)ambientGain.gain.setTargetAtTime(ambient.volume/100*.17,ambientContext.currentTime,.06);renderAmbient();return;}
    if(ambientPending&&!userGesture){renderAmbient();return;}
    stopAmbient();ambientPending=true;const generation=ambientGeneration;ambientError=false;
    try {
      ambientContext=ambientContext||new(window.AudioContext||window.webkitAudioContext)();
      const resume=ambientContext.resume();renderAmbient();await resume;if(generation!==ambientGeneration||!ambientEligible())return;
      const ctx=ambientContext,size=ctx.sampleRate*8;
      if(!ambientBuffer||ambientBufferType!==ambient.type||ambientBuffer.sampleRate!==ctx.sampleRate){
        ambientBuffer=ctx.createBuffer(2,size,ctx.sampleRate);ambientBufferType=ambient.type;
        for(let channel=0;channel<2;channel++){const data=ambientBuffer.getChannelData(channel);let brown=0;for(let i=0;i<size;i++){const white=Math.random()*2-1;brown=(brown+white*.025)/1.025;data[i]=ambient.type==='white'?white*.45:ambient.type==='stream'?brown*4.4:white*.42+brown*.8;}}
      }
      const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();source.buffer=ambientBuffer;source.loop=true;filter.type=ambient.type==='rain'?'highpass':'lowpass';filter.frequency.value=ambient.type==='rain'?650:ambient.type==='stream'?1400:12000;filter.Q.value=.55;source.connect(filter);filter.connect(gain);gain.connect(ctx.destination);gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(ambient.volume/100*.17,ctx.currentTime+.25);ambientNodes=[source,filter,gain];
      if(ambient.type!=='white'){const modulation=ctx.createOscillator(),depth=ctx.createGain();modulation.type='sine';modulation.frequency.value=ambient.type==='stream'?.18:.08;depth.gain.value=ambient.type==='stream'?380:140;modulation.connect(depth);depth.connect(filter.frequency);modulation.start();ambientNodes.push(modulation,depth);}
      source.start();ambientGain=gain;ambientPlaying=true;ambientPending=false;ambientSignature=ambient.type;renderAmbient();
    }catch{if(generation===ambientGeneration){stopAmbient();ambientError=true;renderAmbient();}}
  }
  function renderAmbient() {
    $('ambientEnabled').checked=ambient.enabled;$('ambientType').value=ambient.type;$('ambientVolume').value=ambient.volume;$('ambientVolumeValue').textContent=ambient.volume+'%';$('ambientVolume').setAttribute('aria-valuetext',ambient.volume+'%');
    $('ambientSummary').textContent=ambientPlaying?`${{rain:'轻雨',stream:'溪流',white:'白噪音'}[ambient.type]} · ${ambient.volume}%`:ambient.enabled?'已开启':'已关闭';
    $('ambientStatus').textContent=!ambient.enabled?'暂停和休息时会自动停止，与完成提示音分别控制。':ambient.volume===0?'音量为 0%，当前背景音静音。':ambientPlaying?'正在播放。暂停、休息或计时结束时会自动停止。':ambientError?'暂时无法播放，请检查浏览器声音权限后重试。':ambientEligible()?'点击「播放背景音」继续，计时会照常进行。':'已开启，开始专注计时后播放；暂停和休息时不播放。';
    $('ambientUnlock').hidden=!ambient.enabled||ambient.volume===0||ambientPlaying||!ambientEligible();
  }
  function saveAmbient(){ambient={enabled:$('ambientEnabled').checked,type:$('ambientType').value,volume:+$('ambientVolume').value};try{localStorage.setItem(AMBIENT_KEY,JSON.stringify(ambient));}catch{api.toast('背景音偏好暂时无法保存，当前设置仍可使用。');}syncAmbient(true);}

  function initialize(hooks) {
    api=hooks;loadAmbient();$('tasksDate').value=dayKey(Date.now());
    $('addTaskBtn').addEventListener('click',()=>openTask());$('taskForm').addEventListener('submit',saveTask);$('plannedTaskTitle').addEventListener('input',()=>$('plannedTaskTitle').setCustomValidity(''));
    ['tasksDate','tasksCategory','carryTasks'].forEach(id=>$(id).addEventListener('change',()=>{if(!dateOK($('tasksDate').value))$('tasksDate').value=dayKey(Date.now());if(id==='tasksDate')tasksFollowToday=$('tasksDate').value===dayKey(Date.now());allTasksExpanded=false;renderTasks();}));$('tasksTodayBtn').addEventListener('click',()=>{$('tasksDate').value=dayKey(Date.now());tasksFollowToday=true;allTasksExpanded=false;renderTasks();});$('showMoreTasks').addEventListener('click',()=>{allTasksExpanded=!allTasksExpanded;renderTasks();});
    $('tasksList').addEventListener('change',e=>{const b=e.target.closest('[data-task-done]');if(!b)return;const done=b.checked;commit(d=>{const t=d.tasks.find(t=>t.id===b.dataset.taskDone&&!t.deleted);if(!t)return false;t.done=done;t.updatedAt=updated(t);});});
    $('tasksList').addEventListener('click',e=>{const start=e.target.closest('[data-task-start]'),edit=e.target.closest('[data-task-edit]'),del=e.target.closest('[data-task-delete]'),move=e.target.closest('[data-task-move]');if(start){api.startTask(start.dataset.taskStart);return;}if(edit){openTask(edit.dataset.taskEdit);return;}if(move){moveTask(move.dataset.taskMove,+move.dataset.direction);return;}if(del){const key=api.getKey();api.confirmAction('删除这件小事？','学习记录和复盘会保留。','删除任务',()=>{if(key!==api.getKey())return;commit(d=>{const t=d.tasks.find(t=>t.id===del.dataset.taskDelete);if(t){t.deleted=true;t.updatedAt=updated(t);}if(d.selectedTaskId===del.dataset.taskDelete)d.selectedTaskId=null;});});}});
    $('tasksList').addEventListener('dragstart',e=>{if(e.target.closest('button,input')){e.preventDefault();return;}const row=e.target.closest('[data-task-row]');dragId=row?.dataset.taskRow||null;if(dragId){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);}});$('tasksList').addEventListener('dragover',e=>{if(dragId)e.preventDefault();});$('tasksList').addEventListener('drop',e=>{e.preventDefault();const id=e.target.closest('[data-task-row]')?.dataset.taskRow;if(dragId&&id)moveTask(dragId,0,id);dragId=null;});$('tasksList').addEventListener('dragend',()=>{dragId=null;});
    $('resumeNote').addEventListener('click',e=>{const b=e.target.closest('[data-resume-note]');if(!b)return;api.sync();if(state().current)return;const note=state().reflections.find(r=>r.id===b.dataset.resumeNote);if(note){state().goal=note.next.slice(0,80);state().selectedTaskId=null;api.save();api.render();$('taskInput').focus();}});
    $('historyList').addEventListener('click',e=>{const b=e.target.closest('[data-reflection]');if(b)openReflection(b.dataset.reflection);});$('reflectionForm').addEventListener('submit',e=>{e.preventDefault();if(persistReflection($('reflectionSessionId').value,$('reflectionLearned').value,$('reflectionNext').value,reflectionEditorKey)){$('reflectionDialog').close();api.toast('这次的收获已经保存。');}else api.toast('记录或账号已变化，请重新打开复盘。');});
    ['successLearned','successNext'].forEach(id=>$(id).addEventListener('input',()=>{const ok=persistReflection(completionSessionId,$('successLearned').value,$('successNext').value,completionKey);$('successReflectionStatus').textContent=ok?'复盘已保存，留给下次的自己。':'账号或记录已变化，请从学习记录重新编辑。';}));$('completeLinkedTask').addEventListener('click',()=>{if(completionKey!==api.getKey())return;const id=$('completeLinkedTask').dataset.taskId;commit(d=>{const t=d.tasks.find(t=>t.id===id&&!t.deleted);if(t){t.done=true;t.updatedAt=updated(t);}});$('completeLinkedTask').hidden=true;api.toast('这件小事，完成了。');});
    $('gardenCustomizeBtn').addEventListener('click',()=>{renderGardenChoices();api.openDialog('gardenDialog');});$('gardenChoices').addEventListener('click',e=>{const b=e.target.closest('[data-garden-key]');if(!b)return;const key=b.dataset.gardenKey,value=b.dataset.gardenValue;commit(d=>{const item=catalogue[key]?.find(i=>i.id===value);if(!item||totalMinutes()<item.at)return false;d.gardenSelection={...d.gardenSelection,[key]:value};});});
    ['ambientEnabled','ambientType','ambientVolume'].forEach(id=>$(id).addEventListener('input',saveAmbient));$('ambientUnlock').addEventListener('click',()=>syncAmbient(true));window.addEventListener('pagehide',stopAmbient);
    window.addEventListener('storage',e=>{if(e.key===AMBIENT_KEY){loadAmbient();syncAmbient();}});
  }
  function render(){if(!api)return;renderTasks();syncAmbient();}
  window.StudyGardenTools={defaults,validate,mergeRows,initialize,render,renderGarden,completion,historySearchText,historyDetail,renderTasks,syncAmbient,setHTML,catalogue};
})();
