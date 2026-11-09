const $ = (s) => document.querySelector(s);
let key = sessionStorage.getItem('pilatelia-admin') || '';
let week = mondayOf(new Date());
let agendaSlots = [];      // séances de la semaine affichée
let flagged = {};          // e-mail -> nb annulations tardives
let services = [];         // catalogue des prestations
let report = null;

// Icônes
$('[data-week="-1"]').innerHTML = ic('chevronL');
$('[data-week="1"]').innerHTML = ic('chevronR');
$('#addBtn').innerHTML = `${ic('plus')} Ajouter un cours`;
$('#exportBtn').innerHTML = `${ic('instagram')} Story`;
$('#presIc').innerHTML = ic('tag');
$('#shareStory').innerHTML = `${ic('share')} Partager la story`;
$('#saveStory').innerHTML = `${ic('download')} Enregistrer la photo`;

async function adminApi(path, opts = {}) {
  try { return await api(path, { ...opts, headers: { 'x-admin-key': key } }); }
  catch (err) { if (err.status === 401) showLogin(err.message); throw err; }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showLogin(msg = '') {
  sessionStorage.removeItem('pilatelia-admin');
  $('#login').hidden = false; $('#app').hidden = true; $('#loginError').textContent = msg;
}

// ---------- Agenda (grille semaine) ----------

async function loadAgenda() {
  $('#agendaLabel').textContent = weekLabel(week);
  const [{ slots, flagged: fl }] = await Promise.all([
    adminApi(`/api/admin/slots?${weekQuery(week)}`),
    services.length ? Promise.resolve() : loadServices().catch(() => {}),
  ]);
  agendaSlots = slots; flagged = fl || {};
  renderGrid();
}

function renderGrid() {
  const byKey = new Map(); // 'col-hour' -> [slots]
  let minH = 8, maxH = 20;
  for (const s of agendaSlots) {
    const d = new Date(s.starts_at);
    const col = (d.getDay() + 6) % 7; // 0 = lundi
    const h = d.getHours();
    const endH = Math.ceil((h * 60 + d.getMinutes() + s.duration_minutes) / 60);
    minH = Math.min(minH, h); maxH = Math.max(maxH, endH);
    const k = `${col}-${h}`;
    byKey.set(k, [...(byKey.get(k) || []), s]);
  }
  const hours = [];
  for (let h = minH; h <= maxH; h++) hours.push(h);
  const head = ['<th class="hcol"></th>'];
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i);
    const today = ymd(d) === ymd(new Date());
    head.push(`<th class="${today ? 'today' : ''}"><span class="dw">${dowShort(d)}</span><span class="dn">${d.getDate()}</span></th>`);
  }
  const body = hours.map((h) => {
    const cells = [`<th class="hcol">${String(h).padStart(2, '0')}h</th>`];
    for (let col = 0; col < 7; col++) {
      const items = byKey.get(`${col}-${h}`) || [];
      cells.push(`<td>${items.map(cellSess).join('')}</td>`);
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
  $('#grid').innerHTML = `<div class="grid-wrap"><table class="timetable">
    <thead><tr>${head.join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function cellSess(s) {
  const n = s.bookings.length;
  const full = n >= s.capacity;
  return `<button class="cell-sess${full ? ' full' : ''}" data-id="${s.id}">
    <span class="cs-t">${fmt.time.format(new Date(s.starts_at))}</span>
    <span class="cs-n">${esc(s.title)}</span>
    <span class="cs-c">${n}/${s.capacity}${s.price_cents ? ` · ${euro(s.price_cents)}` : ''}</span>
  </button>`;
}

// Détail d'un cours (feuille)
function openSession(id) {
  const s = agendaSlots.find((x) => x.id === id);
  if (!s) return;
  const d = new Date(s.starts_at);
  const n = s.bookings.length;
  const people = n ? s.bookings.map((b) => `<div class="person">
      <span class="av">${esc(initials(b.guest_name))}</span>
      <span class="who"><div>${esc(b.guest_name)}</div><a href="mailto:${esc(b.guest_email)}">${esc(b.guest_email)}</a></span>
      ${flagged[b.guest_email] ? `<span class="flag">${ic('flag')} &lt; 24h</span>` : ''}
      <button class="rm" data-del-booking="${b.id}" data-name="${esc(b.guest_name)}">Retirer</button>
    </div>`).join('') : '<p class="muted">Personne d\'inscrite pour l\'instant.</p>';
  $('#sessionBody').innerHTML = `
    <h2>${esc(s.title)}</h2>
    <p class="meta">${fmt.day.format(d)} · ${fmt.time.format(d)} · ${s.duration_minutes} min${s.coach ? ` · ${esc(s.coach)}` : ''}${s.price_cents ? ` · ${euro(s.price_cents)}` : ''}</p>
    <div class="session-cap"><span class="scap ${full(s) ? 'few' : ''}">${n}/${s.capacity} inscrite${n > 1 ? 's' : ''}</span></div>
    <div class="att">${people}</div>
    <button class="btn btn-secondary btn-block" style="margin-top:16px;color:var(--danger)" data-del-slot="${s.id}" data-count="${n}">${ic('trash')} Supprimer ce cours</button>
    <button class="btn btn-ghost btn-block" data-close style="margin-top:4px">Fermer</button>`;
  $('#sessionSheet').showModal();
}
const full = (s) => s.bookings.length >= s.capacity;

$('#grid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-id]');
  if (c) openSession(c.dataset.id);
});

$('#sessionSheet').addEventListener('click', async (e) => {
  const slot = e.target.closest('[data-del-slot]');
  const booking = e.target.closest('[data-del-booking]');
  try {
    if (slot) {
      const n = Number(slot.dataset.count);
      if (!confirm(n ? `Supprimer ce cours et ses ${plural(n, 'réservation')} ?` : 'Supprimer ce cours ?')) return;
      await adminApi(`/api/admin/slots?id=${slot.dataset.delSlot}`, { method: 'DELETE' });
      $('#sessionSheet').close(); toast('Cours supprimé'); loadAgenda();
    } else if (booking) {
      if (!confirm(`Retirer ${booking.dataset.name} ? Elle recevra un e-mail d'annulation.`)) return;
      const res = await adminApi(`/api/admin/bookings?id=${booking.dataset.delBooking}`, { method: 'DELETE' });
      toast(res.late ? 'Retirée · annulation tardive signalée' : 'Réservation retirée');
      const current = $('#sessionBody [data-del-slot]')?.dataset.delSlot;
      await loadAgenda();
      if (current) openSession(current); else $('#sessionSheet').close();
    }
  } catch (err) { toast(err.message); }
});

// ---------- Ajouter un cours ----------

function fillServiceSelect() {
  const sel = $('#svcSelect');
  sel.innerHTML = `<option value="">— Saisie libre —</option>` + services.map((s, i) =>
    `<option value="${i}">${esc(s.name)}${s.price_cents ? ` · ${euro(s.price_cents)}` : ''}</option>`).join('');
}

$('#svcSelect').addEventListener('change', (e) => {
  const s = services[e.target.value];
  if (!s) return;
  const f = $('#add');
  f.title.value = s.name;
  f.duration_minutes.value = s.duration_minutes;
  f.capacity.value = s.capacity;
  f.price.value = (s.price_cents / 100);
  f.coach.value = s.coach || '';
});

$('#addBtn').addEventListener('click', () => {
  const f = $('#add');
  const today = ymd(new Date());
  f.date.min = today;                       // pas de passé, mais AUCUNE limite haute
  f.date.value = ymd(week) > today ? ymd(week) : today;
  f.until.min = f.date.value;
  $('#addError').textContent = '';
  if (services.length) { fillServiceSelect(); $('#svcSelect').closest('label').hidden = false; }
  else $('#svcSelect').closest('label').hidden = true;
  $('#addSheet').showModal();
});

$('#add').date.addEventListener('change', (e) => { e.target.form.until.min = e.target.value; });

$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#addError').textContent = '';
  const first = new Date(`${f.date.value}T${f.time.value}`);
  const until = f.until.value ? new Date(`${f.until.value}T23:59`) : first;
  const base = {
    duration_minutes: Number(f.duration_minutes.value),
    capacity: Number(f.capacity.value),
    price_cents: Math.round(Number(f.price.value || 0) * 100),
    title: f.title.value, coach: f.coach.value,
  };
  const rows = [];
  for (let d = first; d <= until && rows.length < 100; d = addDays(d, 7)) rows.push({ ...base, starts_at: d.toISOString() });
  if (!rows.length) { $('#addError').textContent = 'La date de fin est avant le premier jour.'; return; }
  try {
    await adminApi('/api/admin/slots', { method: 'POST', body: JSON.stringify(rows) });
    $('#addSheet').close();
    toast(rows.length > 1 ? `${rows.length} séances ajoutées` : 'Cours ajouté');
    // Se place sur la semaine du premier cours ajouté pour qu'elle le voie.
    week = mondayOf(first); loadAgenda();
  } catch (err) { $('#addError').textContent = err.message; }
});

$('#copyBtn').addEventListener('click', async () => {
  try {
    const { slots: previous } = await adminApi(`/api/admin/slots?${weekQuery(addDays(week, -7))}`);
    const upcoming = previous.filter((s) => addDays(new Date(s.starts_at), 7) > new Date());
    if (!upcoming.length) return toast('Rien à copier : semaine précédente vide ou passée.');
    if (agendaSlots.length && !confirm('Cette semaine a déjà des cours. Ajouter aussi ceux de la semaine précédente ?')) return;
    await adminApi('/api/admin/slots', { method: 'POST', body: JSON.stringify(upcoming.map((s) => ({
      starts_at: addDays(new Date(s.starts_at), 7).toISOString(),
      duration_minutes: s.duration_minutes, capacity: s.capacity, title: s.title, coach: s.coach, price_cents: s.price_cents,
    }))) });
    toast(upcoming.length > 1 ? `${upcoming.length} cours copiés` : '1 cours copié');
    loadAgenda();
  } catch (err) { toast(err.message); }
});

// ---------- Prestations ----------

async function loadServices() {
  services = await adminApi('/api/admin/services');
  $('#svcList').innerHTML = services.length ? services.map((s) => `<div class="card svc">
      <div class="svc-main"><div class="svc-name">${esc(s.name)}</div>
        <div class="muted small">${s.duration_minutes} min · ${plural(s.capacity, 'place')}${s.coach ? ` · ${esc(s.coach)}` : ''}</div></div>
      <div class="svc-price">${euro(s.price_cents)}</div>
      <button class="rm" data-del-svc="${s.id}" data-name="${esc(s.name)}">${ic('trash')}</button>
    </div>`).join('') : '<p class="empty">Aucune prestation pour l\'instant.</p>';
}

$('#svcForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await adminApi('/api/admin/services', { method: 'POST', body: JSON.stringify({
      name: f.name.value, coach: f.coach.value,
      duration_minutes: Number(f.duration_minutes.value), capacity: Number(f.capacity.value),
      price_cents: Math.round(Number(f.price.value || 0) * 100), sort: services.length,
    }) });
    f.reset(); f.price.value = 20; f.duration_minutes.value = 55; f.capacity.value = 6;
    toast('Prestation ajoutée'); loadServices();
  } catch (err) { toast(err.message); }
});

$('#svcList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del-svc]');
  if (!b) return;
  if (!confirm(`Supprimer la prestation « ${b.dataset.name} » ? (les cours déjà programmés ne changent pas)`)) return;
  try { await adminApi(`/api/admin/services?id=${b.dataset.delSvc}`, { method: 'DELETE' }); toast('Prestation supprimée'); loadServices(); }
  catch (err) { toast(err.message); }
});

// ---------- Finances ----------

async function loadFinance() {
  const f = await adminApi('/api/admin/finance');
  $('#finStats').innerHTML = [
    [euro(f.this_week.revenue), 'CA cette semaine'],
    [f.this_week.bookings, 'réservations cette semaine'],
    [euro(f.revenue_upcoming), 'CA à venir'],
    [euro(f.revenue_past), 'CA encaissé (passé)'],
  ].map(([v, l]) => `<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join('');

  const weekName = (iso) => fmt.short.format(new Date(`${iso}T12:00`));
  $('#finWeeks').innerHTML = f.weeks.length
    ? `<thead><tr><th>Semaine du</th><th class="num">Résas</th><th class="num">CA</th></tr></thead><tbody>${
        f.weeks.map((w) => `<tr><td>${weekName(w.week)}</td><td class="num">${w.bookings}</td><td class="num">${euro(w.revenue)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">Pas encore de données.</td></tr></tbody>';

  $('#finServices').innerHTML = f.services.length
    ? `<thead><tr><th>Prestation</th><th class="num">Résas</th><th class="num">CA</th></tr></thead><tbody>${
        f.services.map((s) => `<tr><td>${esc(s.title)}</td><td class="num">${s.bookings}</td><td class="num">${euro(s.revenue)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">—</td></tr></tbody>';
}

// ---------- Clientes ----------

async function loadReport() {
  report = await adminApi('/api/admin/report');
  const now = new Date();
  const active = report.clients.filter((c) => c.last && now - c.last < 30 * 864e5).length;
  $('#stats').innerHTML = [
    [report.clients.length, 'clientes au total'],
    [active, 'venues ces 30 jours'],
    [report.clients.reduce((n, c) => n + c.upcoming, 0), 'réservations à venir'],
    [report.clients.reduce((n, c) => n + (c.late || 0), 0), 'annulations tardives'],
  ].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');

  const date = (t) => (t ? fmt.date.format(new Date(t)) : '—');
  $('#clientTable').innerHTML = report.clients.length
    ? `<thead><tr><th>Nom</th><th>E-mail</th><th class="num">Séances</th><th class="num">À venir</th><th>Dernière</th><th class="num">&lt;24h</th></tr></thead>
       <tbody>${report.clients.map((c) => `<tr>
         <td>${esc(c.name)}</td><td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
         <td class="num">${c.total}</td><td class="num">${c.upcoming}</td><td>${date(c.last)}</td>
         <td class="num">${c.late ? `<span class="flag" style="padding:2px 8px">${c.late}</span>` : '—'}</td>
       </tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">Pas encore de réservations.</td></tr></tbody>';
}

$('#csv').addEventListener('click', () => {
  if (!report) return;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t ? ymd(new Date(t)) : '');
  const lines = [['Nom', 'E-mail', 'Séances', 'À venir', 'Dernière venue', 'Annulations tardives'],
    ...report.clients.map((c) => [c.name, c.email, c.total, c.upcoming, iso(c.last), c.late || 0])];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(';')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clientes-${ymd(new Date())}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
});

// ---------- Export story (canvas 1080 x 1920) ----------

const STORY = { bg: '#faf6f1', band: '#f6e7ec', ink: '#2c2420', muted: '#6f645b', brand: '#8f4a63', brandStrong: '#78384f', sage: '#6f8a72', sageTint: '#e8efe6' };

async function drawStory() {
  const g = $('#storyCanvas').getContext('2d');
  const W = 1080, H = 1920;
  try { await document.fonts.load('600 92px Fraunces'); await document.fonts.load('600 34px Figtree'); await document.fonts.ready; } catch {}
  g.fillStyle = STORY.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = STORY.band; g.fillRect(0, 0, W, 470);
  g.fillStyle = STORY.sageTint; g.beginPath(); g.arc(950, 150, 150, 0, 7); g.fill();
  g.textBaseline = 'alphabetic';
  g.fillStyle = STORY.brand; g.font = '600 30px Fraunces'; g.fillText('P I L A T E L I A', 80, 150);
  g.fillStyle = STORY.ink; g.font = '600 96px Fraunces';
  g.fillText('Les dispos', 80, 290); g.fillText('de la semaine', 80, 390);
  g.fillStyle = STORY.muted; g.font = '600 34px Figtree';
  g.fillText(`${fmt.short.format(week)} — ${fmt.short.format(addDays(week, 6))}`, 82, 445);
  const days = byDay(agendaSlots);
  let y = 600, any = false;
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i);
    const items = (days.get(ymd(d)) || []).slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    if (!items.length) continue;
    any = true;
    g.fillStyle = STORY.brandStrong; g.font = '700 30px Figtree';
    g.fillText(fmt.day.format(d).split(' ').slice(0, 2).join(' ').toUpperCase(), 82, y); y += 50;
    for (const s of items) {
      g.fillStyle = STORY.ink; g.font = '600 40px Figtree'; g.fillText(fmt.time.format(new Date(s.starts_at)), 82, y);
      g.fillStyle = STORY.muted; g.font = '500 40px Figtree'; g.fillText(s.title, 250, y); y += 58;
    }
    y += 26; if (y > 1680) break;
  }
  if (!any) { g.fillStyle = STORY.muted; g.font = '500 40px Figtree'; g.fillText('Planning à venir — écrivez-nous !', 82, 640); }
  g.fillStyle = STORY.sageTint; g.fillRect(0, H - 150, W, 150);
  g.fillStyle = STORY.brandStrong; g.font = '700 36px Figtree'; g.fillText('Réservez depuis l\'app · lien en bio', 80, H - 60);
}
const storyBlob = () => new Promise((res) => $('#storyCanvas').toBlob(res, 'image/png'));

$('#exportBtn').addEventListener('click', async () => { $('#story').showModal(); await drawStory(); });
$('#saveStory').addEventListener('click', async () => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await storyBlob()), download: `pilatelia-dispos-${ymd(week)}.png` });
  a.click(); URL.revokeObjectURL(a.href);
});
$('#shareStory').addEventListener('click', async () => {
  const file = new File([await storyBlob()], `pilatelia-dispos-${ymd(week)}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Dispos de la semaine' }); } catch {} return; }
  toast('Partage direct indisponible : utilisez « Enregistrer la photo ».');
});

// ---------- Navigation ----------

const loaders = { agenda: loadAgenda, prestations: loadServices, finances: loadFinance, clients: loadReport };
document.querySelector('.seg').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b === t));
  for (const name of Object.keys(loaders)) $(`#${name}`).hidden = name !== t.dataset.tab;
  loaders[t.dataset.tab]().catch((err) => toast(err.message));
});
document.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => {
  week = addDays(week, Number(b.dataset.week) * 7); loadAgenda().catch((err) => toast(err.message));
}));
document.querySelectorAll('.sheet').forEach((dlg) => dlg.addEventListener('click', (e) => {
  if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
}));

async function enter() {
  await loadAgenda();
  sessionStorage.setItem('pilatelia-admin', key);
  $('#login').hidden = true; $('#app').hidden = false;
}
$('#login').addEventListener('submit', (e) => {
  e.preventDefault(); key = e.target.password.value;
  enter().catch((err) => { if (err.status !== 401) $('#loginError').textContent = err.message; });
});
if (key) enter().catch(() => {});
