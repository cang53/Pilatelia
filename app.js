const API = '/api';
const state = { dates: [], selected: null, classes: [], booking: null };
const dateStrip = document.querySelector('#dateStrip');
const classesEl = document.querySelector('#classes');
const label = document.querySelector('#selectedDateLabel');
const dialog = document.querySelector('#bookingDialog');
const form = document.querySelector('#bookingForm');

function localDate(date){ return new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'long'}).format(date); }
function ymd(date){ return date.toLocaleDateString('en-CA'); }
function toast(message){ const el=document.querySelector('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3500); }
function seedClasses(date){ const d=ymd(date); return [
  {id:`demo-${d}-1`, starts_at:`${d}T09:30:00`, title:'Pilates doux', coach:'Avec Léa', duration_minutes:50, capacity:8, booked_count:3},
  {id:`demo-${d}-2`, starts_at:`${d}T12:30:00`, title:'Pilates Reformer', coach:'Avec Camille', duration_minutes:50, capacity:6, booked_count:4},
  {id:`demo-${d}-3`, starts_at:`${d}T18:15:00`, title:'Pilates dynamique', coach:'Avec Nour', duration_minutes:55, capacity:10, booked_count:7}
] }
function renderDates(){ dateStrip.innerHTML=state.dates.map(d=>`<button class="day ${ymd(d)===ymd(state.selected)?'active':''}" data-date="${ymd(d)}"><span class="dow">${new Intl.DateTimeFormat('fr-FR',{weekday:'short'}).format(d).replace('.','')}</span><span class="num">${d.getDate()}</span></button>`).join(''); }
function renderClasses(){ label.textContent=localDate(state.selected); if(!state.classes.length){classesEl.innerHTML='<div class="loading">Aucune séance ce jour-ci.</div>';return} classesEl.innerHTML=state.classes.map(c=>{const time=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(c.starts_at));const remaining=c.capacity-c.booked_count;return `<article class="class-card"><div class="time">${time}<small>${c.duration_minutes} min</small></div><div class="class-info"><h3>${c.title}</h3><p>${c.coach}</p><div class="spots">${remaining>0?`${remaining} place${remaining>1?'s':''} restante${remaining>1?'s':''}`:'Complet'}</div></div><button class="book" data-id="${c.id}" ${remaining<1?'disabled':''} aria-label="Réserver ${c.title}">→</button></article>`}).join(''); }
async function loadClasses(){ classesEl.innerHTML='<div class="loading">Chargement des séances…</div>'; try { const r=await fetch(`${API}/classes?date=${ymd(state.selected)}`); if(!r.ok)throw new Error(); state.classes=await r.json(); } catch { state.classes=seedClasses(state.selected); } renderClasses(); }
dateStrip.addEventListener('click', e=>{const b=e.target.closest('[data-date]');if(!b)return;state.selected=new Date(`${b.dataset.date}T12:00:00`);renderDates();loadClasses()});
document.querySelector('#todayBtn').addEventListener('click',()=>{state.selected=state.dates[0];renderDates();loadClasses()});
classesEl.addEventListener('click',e=>{const b=e.target.closest('.book');if(!b)return;state.booking=state.classes.find(c=>c.id===b.dataset.id);const c=state.booking;document.querySelector('#dialogTitle').textContent=c.title;document.querySelector('#dialogMeta').textContent=`${localDate(new Date(c.starts_at))} · ${new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(c.starts_at))} · ${c.coach}`;dialog.showModal()});
form.addEventListener('submit',async e=>{e.preventDefault();if(!state.booking)return;const button=document.querySelector('#submitBooking');button.disabled=true;try{const body=Object.fromEntries(new FormData(form));body.class_id=state.booking.id;const r=await fetch(`${API}/book`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error((await r.json()).error);dialog.close();form.reset();toast('Réservation confirmée. À très vite !');loadClasses()}catch(err){toast(err.message||'Impossible de réserver cette séance.')}finally{button.disabled=false}});
const today=new Date();state.dates=Array.from({length:7},(_,i)=>new Date(today.getFullYear(),today.getMonth(),today.getDate()+i));state.selected=state.dates[0];renderDates();loadClasses();
