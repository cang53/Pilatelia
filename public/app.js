const $ = (s) => document.querySelector(s);
const thisWeek = mondayOf(new Date());
let week = thisWeek;
let slots = [];
let selectedDay = null;      // 'AAAA-MM-JJ'
let chosen = null;           // séance choisie
let conf = { studio_name: 'Pilatelia Studio', studio_email: '', studio_phone: '' };
let mine = [];               // réservations de cet appareil

const sheet = $('#sheet');
const form = $('#form');

// Icônes statiques
$('#prev').innerHTML = ic('chevronL');
$('#next').innerHTML = ic('chevronR');
$('#tabBookIc').innerHTML = ic('calendar');
$('#tabMineIc').innerHTML = ic('checkCircle');
$('#noteIc').innerHTML = ic('user');
$('#doneIc').innerHTML = ic('check');
document.querySelectorAll('.studio-access').forEach((el) => { el.innerHTML = ic('lock'); });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

const describe = (s) => `${fmt.day.format(new Date(s.starts_at))} · ${fmt.time.format(new Date(s.starts_at))} · ${s.duration_minutes} min${s.price_cents ? ` · ${euro(s.price_cents)}` : ''}`;
const upcomingCount = () => mine.filter((m) => new Date(m.slot.starts_at) > new Date()).length;

function renderCount() {
  const n = upcomingCount();
  for (const el of [$('#count1'), $('#count2')]) {
    el.hidden = false;
    el.innerHTML = `${ic('check')} ${n} / 3`;
  }
}

// ---------- Réserver ----------

async function loadWeek() {
  $('#monthLabel').textContent = fmt.month.format(week);
  $('#weekLabel').textContent = weekLabel(week);
  $('#prev').disabled = week <= thisWeek;
  $('#slots').innerHTML = '<p class="empty">Chargement…</p>';
  try {
    slots = await api(`/api/slots?${weekQuery(week)}`);
  } catch (err) {
    $('#days').innerHTML = '';
    $('#slots').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const withSlots = new Set(slots.map((s) => ymd(new Date(s.starts_at))));
  const todayKey = ymd(new Date());
  // Jour sélectionné : celui déjà choisi (par défaut aujourd'hui), sinon
  // le premier jour de la semaine qui a des séances.
  if (!selectedDay) {
    const firstDay = [...Array(7)].map((_, i) => ymd(addDays(week, i))).find((k) => withSlots.has(k));
    selectedDay = firstDay || (withSlots.has(todayKey) ? todayKey : ymd(week));
  }
  renderDays(withSlots);
  renderSlots();
}

function renderDays(withSlots) {
  $('#days').innerHTML = [...Array(7)].map((_, i) => {
    const d = addDays(week, i);
    const key = ymd(d);
    const cls = ['day', key === selectedDay ? 'on' : '', withSlots.has(key) ? 'has' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-day="${key}"><span class="dow">${dowShort(d)}</span><span class="num">${d.getDate()}</span></button>`;
  }).join('');
}

function subscribeCard() {
  if (!conf.studio_instagram) return '';
  return `<a class="card sub-card" href="${esc(conf.studio_instagram)}" target="_blank" rel="noopener">
    <span class="sub-ic">${ic('instagram')}</span>
    <span class="sub-body"><span class="sub-title">Abonnements &amp; formules</span><span class="muted small">Nos offres et cartes de séances, c'est sur Instagram.</span></span>
    ${ic('chevronR')}
  </a>`;
}

// Ids des séances où cet appareil est déjà inscrit (pas de double réservation).
const bookedSlotIds = () => new Set(mine.map((m) => m.slot && m.slot.id).filter(Boolean));

function renderSlots() {
  const items = slots.filter((s) => ymd(new Date(s.starts_at)) === selectedDay);
  const d = new Date(`${selectedDay}T12:00`);
  const booked = bookedSlotIds();
  const body = items.length
    ? `<p class="subh">${fmt.day.format(d)} — ${plural(items.length, 'séance')}</p><div class="list">${items.map((s) => slotCard(s, booked.has(s.id))).join('')}</div>`
    : `<p class="subh">${fmt.day.format(d)}</p><p class="empty">Aucune séance ce jour-là.<br>Choisissez un autre jour.</p>`;
  $('#slots').innerHTML = body + subscribeCard();
}

function slotCard(s, isBooked) {
  const left = s.capacity - s.booked;
  const start = new Date(s.starts_at);
  let pill;
  if (isBooked) pill = `<span class="pill booked">${ic('check')} Déjà inscrite</span>`;
  else if (left <= 0) pill = '<span class="pill full">Complet</span>';
  else if (left <= 2) pill = `<span class="pill few">Plus qu'${plural(left, 'place')}</span>`;
  else pill = `<span class="pill free">${plural(left, 'place')}</span>`;
  const disabled = !isBooked && left <= 0; // une séance déjà réservée reste cliquable (→ modifier)
  return `<div class="card slot ${isBooked ? 'booked-card' : (left <= 0 ? 'full-card' : '')}">
    <div class="time"><div class="h">${fmt.time.format(start)}</div><div class="d">${s.duration_minutes} min</div></div>
    <div class="body">
      <div class="name">${esc(s.title)}</div>
      ${s.coach ? `<div class="coach">avec ${esc(s.coach)}</div>` : ''}
      <div class="foot">${pill}${s.price_cents ? `<span class="price">${euro(s.price_cents)}</span>` : ''}</div>
    </div>
    <button class="go" data-id="${s.id}" aria-label="${isBooked ? 'Modifier ma réservation' : 'Réserver'}" ${disabled ? 'disabled' : ''}>${ic(isBooked ? 'edit' : (left <= 0 ? 'close' : 'chevronR'))}</button>
  </div>`;
}

$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  selectedDay = b.dataset.day;
  renderDays(new Set(slots.map((s) => ymd(new Date(s.starts_at)))));
  renderSlots();
});

$('#slots').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  if (bookedSlotIds().has(b.dataset.id)) { switchView('mine'); return; }
  if (upcomingCount() >= 3) { toast('3 réservations maximum sur cet appareil. Annulez-en une pour réserver.'); return; }
  chosen = slots.find((s) => s.id === b.dataset.id);
  openSheet();
});

function openSheet() {
  $('#sheetTitle').textContent = chosen.title;
  $('#sheetMeta').textContent = describe(chosen);
  $('#formError').textContent = '';
  $('#bookStep').hidden = false;
  $('#doneStep').hidden = true;
  try {
    const saved = JSON.parse(localStorage.getItem('pilatelia-me') || '{}');
    if (!form.name.value) form.name.value = saved.name || '';
    if (!form.email.value) form.email.value = saved.email || '';
  } catch {}
  sheet.showModal();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  $('#formError').textContent = '';
  const me = { name: form.name.value.trim(), email: form.email.value.trim() };
  try {
    const res = await api('/api/book', { method: 'POST', body: JSON.stringify({ slot_id: chosen.id, ...me }) });
    try { localStorage.setItem('pilatelia-me', JSON.stringify(me)); } catch {}
    if (res.id) addMyId(res.id);
    showDone();
    await Promise.all([loadMine(), loadWeek()]);
  } catch (err) {
    $('#formError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function showDone() {
  const s = chosen;
  const d = new Date(s.starts_at);
  $('#doneTicket').innerHTML = `
    <div class="main">
      <div class="date"><div class="dow">${dowShort(d)}</div><div class="num">${d.getDate()}</div></div>
      <div><div class="name" style="font-weight:700">${esc(s.title)}</div>
      <div class="muted small">${fmt.time.format(d)} · ${s.duration_minutes} min${s.coach ? ` · avec ${esc(s.coach)}` : ''}</div></div>
    </div>
    ${conf.studio_address ? `<div class="perf" style="background:var(--sage-tint)">${ic('info')}<p><strong>Adresse</strong><br>${esc(conf.studio_address)}</p></div>` : ''}
    <div class="perf">${ic('mail')}<p>Un <strong>e-mail de confirmation</strong> vient de partir. Rappel la veille. Pour changer, répondez à cet e-mail ou appelez le studio.</p></div>`;
  $('#bookStep').hidden = true;
  $('#doneStep').hidden = false;
}

// ---------- Ma réservation ----------

async function loadMine() {
  const ids = myIds();
  if (!ids.length) { mine = []; renderMine(); renderCount(); return; }
  try {
    mine = await api('/api/my', { method: 'POST', body: JSON.stringify({ ids }) });
    saveMyIds(mine.map((m) => m.id)); // oublie les réservations supprimées/annulées
  } catch { /* garde l'état précédent */ }
  renderMine();
  renderCount();
  if (slots.length) renderSlots(); // rafraîchit les marqueurs « déjà inscrite »
}

function contactBlock() {
  const mail = conf.studio_email ? `<a class="btn btn-primary" href="mailto:${esc(conf.studio_email)}?subject=${encodeURIComponent('Ma réservation Pilatelia')}">${ic('mail')} Écrire</a>` : '';
  const tel = conf.studio_phone ? `<a class="btn btn-secondary" href="tel:${esc(conf.studio_phone.replace(/\s/g, ''))}">${ic('phone')} Appeler</a>` : '';
  return `<div class="card">
    <h2 style="font-size:16px;margin-bottom:4px">Un souci ?</h2>
    <p class="muted small" style="margin:0 0 14px">En cas de souci, appelez le studio.</p>
    <div class="actions-2">${mail}${tel}</div>
    ${conf.studio_address ? `<div class="lock" style="color:var(--ink-muted)">${ic('info')} ${esc(conf.studio_address)}</div>` : ''}
  </div>`;
}

function renderMine() {
  const now = new Date();
  const upcoming = mine.filter((m) => new Date(m.slot.starts_at) >= now);
  const past = mine.filter((m) => new Date(m.slot.starts_at) < now);
  if (!upcoming.length) {
    $('#mine').innerHTML = `<div class="empty">Aucune réservation en cours.<br>Rendez-vous dans « Réserver » pour choisir une séance.</div>
      ${(conf.studio_email || conf.studio_phone) ? contactBlock() : ''}`;
    return;
  }
  const card = (m) => {
    const d = new Date(m.slot.starts_at);
    const canModify = d.getTime() - Date.now() > 86400000; // plus de 24h avant
    return `<div class="card" style="margin-bottom:12px">
      <div class="slot" style="align-items:flex-start">
        <div class="time" style="min-width:54px"><div class="date" style="text-align:center"></div>
          <div style="background:var(--brand-tint);border-radius:var(--radius-md);padding:8px 0">
            <div class="dow" style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--brand-strong)">${dowShort(d)}</div>
            <div style="font-family:var(--serif);font-size:22px;font-weight:600;color:var(--brand)">${d.getDate()}</div>
          </div>
        </div>
        <div class="body">
          <div class="name">${esc(m.slot.title)}</div>
          <div class="coach">${fmt.time.format(d)} · ${m.slot.duration_minutes} min</div>
          <span class="status">${ic('check')} Confirmée</span>
        </div>
      </div>
      ${canModify
        ? `<div class="actions-2" style="margin-top:14px">
            <button class="btn btn-secondary" data-move="${m.id}">${ic('repeat')} Déplacer</button>
            <button class="btn btn-ghost" data-cancel="${m.id}">${ic('trash')} Annuler</button>
          </div>`
        : `<div class="lock">${ic('info')} En cas de souci, appelez le studio.</div>`}
    </div>`;
  };
  $('#mine').innerHTML = upcoming.map(card).join('')
    + contactBlock()
    + (past.length ? `<p class="subh" style="margin-top:18px">Déjà passées</p>${past.map((m) => {
        const d = new Date(m.slot.starts_at);
        return `<div class="card slot full-card" style="margin-bottom:10px"><div class="time"><div class="h">${d.getDate()}/${d.getMonth() + 1}</div><div class="d">${fmt.time.format(d)}</div></div><div class="body"><div class="name">${esc(m.slot.title)}</div></div></div>`;
      }).join('')}` : '');
}

// Annulation / déplacement en autonomie (séance à plus de 24h).
async function cancelReservation(id) {
  try {
    await api('/api/cancel', { method: 'POST', body: JSON.stringify({ id }) });
    saveMyIds(myIds().filter((x) => x !== id));
    return true;
  } catch (err) { toast(err.message); return false; }
}

$('#mine').addEventListener('click', async (e) => {
  const cancelBtn = e.target.closest('[data-cancel]');
  const moveBtn = e.target.closest('[data-move]');
  const btn = cancelBtn || moveBtn;
  if (!btn) return;
  const moving = !!moveBtn;
  const msg = moving
    ? 'Pour déplacer, votre place actuelle sera annulée afin d’en choisir une autre. Continuer ?'
    : 'Annuler cette séance ? Votre place sera libérée.';
  if (!confirm(msg)) return;
  btn.disabled = true;
  const ok = await cancelReservation(btn.dataset.cancel || btn.dataset.move);
  if (!ok) { btn.disabled = false; return; }
  await Promise.all([loadMine(), loadWeek()]);
  if (moving) { switchView('book'); toast('Choisissez votre nouveau créneau.'); }
  else toast('Séance annulée.');
});

// ---------- Navigation ----------

function switchView(view) {
  document.querySelectorAll('[data-view]').forEach((t) => t.classList.toggle('on', t.dataset.view === view));
  $('#view-book').hidden = view !== 'book';
  $('#view-mine').hidden = view !== 'mine';
  if (view === 'mine') loadMine();
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const t = e.target.closest('[data-view]');
  if (t) switchView(t.dataset.view);
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) sheet.close();           // clic sur le fond
  if (e.target.closest('[data-close]')) { sheet.close(); switchView('mine'); }
});

$('#prev').addEventListener('click', () => { week = addDays(week, -7); selectedDay = null; loadWeek(); });
$('#next').addEventListener('click', () => { week = addDays(week, 7); selectedDay = null; loadWeek(); });

// ---------- Démarrage ----------
// Par défaut, on ouvre sur la semaine courante avec le jour d'aujourd'hui sélectionné.
week = thisWeek;
selectedDay = ymd(new Date());
api('/api/config').then((c) => { conf = c; }).catch(() => {}).finally(loadMine);
loadWeek();
