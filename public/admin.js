const $ = (s) => document.querySelector(s);
let key = sessionStorage.getItem('pilatelia-admin') || '';
let report = null;
const weeks = { agenda: mondayOf(new Date()), dispos: mondayOf(new Date()) };
let agendaSlots = [];      // séances de la semaine agenda (pour l'export story)
let flagged = {};          // e-mail -> nb d'annulations tardives

// Icônes
$('[data-week="agenda"][data-dir="-1"]').innerHTML = ic('chevronL');
$('[data-week="agenda"][data-dir="1"]').innerHTML = ic('chevronR');
$('[data-week="dispos"][data-dir="-1"]').innerHTML = ic('chevronL');
$('[data-week="dispos"][data-dir="1"]').innerHTML = ic('chevronR');
$('#repeatIc').innerHTML = ic('repeat');
$('#exportBtn').innerHTML = `${ic('instagram')} Exporter la semaine en image`;
$('#shareStory').innerHTML = `${ic('share')} Partager la story`;
$('#saveStory').innerHTML = `${ic('download')} Enregistrer la photo`;

async function adminApi(path, opts = {}) {
  try {
    return await api(path, { ...opts, headers: { 'x-admin-key': key } });
  } catch (err) {
    if (err.status === 401) showLogin(err.message);
    throw err;
  }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showLogin(msg = '') {
  sessionStorage.removeItem('pilatelia-admin');
  $('#login').hidden = false;
  $('#app').hidden = true;
  $('#loginError').textContent = msg;
}

// ---------- Agenda ----------

async function loadAgenda() {
  const week = weeks.agenda;
  $('#agendaLabel').textContent = weekLabel(week);
  $('#agendaList').innerHTML = '<p class="empty">Chargement…</p>';
  const { slots, flagged: fl } = await adminApi(`/api/admin/slots?${weekQuery(week)}`);
  agendaSlots = slots;
  flagged = fl || {};
  const days = byDay(slots);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i);
    const items = days.get(ymd(d)) || [];
    if (!items.length) continue;
    parts.push(`<div class="day-head"><span class="num">${d.getDate()}</span><span class="dow">${fmt.day.format(d).split(' ')[0]}</span><span class="line"></span></div>`
      + items.map(agendaCard).join(''));
  }
  $('#agendaList').innerHTML = parts.length ? parts.join('') : '<p class="empty">Aucune séance cette semaine.<br>Ajoutez vos disponibilités.</p>';
}

function agendaCard(s) {
  const start = new Date(s.starts_at);
  const n = s.bookings.length;
  const capCls = n >= s.capacity ? 'few' : '';
  const past = start < new Date();
  const people = s.bookings.map((b) => `<div class="person">
      <span class="av">${esc(initials(b.guest_name))}</span>
      <span class="who"><div>${esc(b.guest_name)}</div><a href="mailto:${esc(b.guest_email)}">${esc(b.guest_email)}</a></span>
      ${flagged[b.guest_email] ? `<span class="flag">${ic('flag')} Annulation &lt; 24h</span>` : ''}
      <button class="rm" data-del-booking="${b.id}" data-name="${esc(b.guest_name)}">Retirer</button>
    </div>`).join('');
  return `<div class="sess ${past ? 'past' : ''}">
    <div class="srow">
      <span class="st">${fmt.time.format(start)}</span>
      <span class="sn">${esc(s.title)}</span>
      <span class="scap ${capCls}">${n}/${s.capacity}${n >= s.capacity ? ' · complet' : ''}</span>
      <button class="rm" data-del-slot="${s.id}" data-count="${n}" style="margin-left:10px">Supprimer</button>
    </div>
    ${n ? `<div class="att">${people}</div>` : ''}
  </div>`;
}

$('#agendaList').addEventListener('click', async (e) => {
  const slot = e.target.closest('[data-del-slot]');
  const booking = e.target.closest('[data-del-booking]');
  try {
    if (slot) {
      const n = Number(slot.dataset.count);
      if (!confirm(n ? `Supprimer ce cours et ses ${plural(n, 'réservation')} ?` : 'Supprimer ce cours ?')) return;
      await adminApi(`/api/admin/slots?id=${slot.dataset.delSlot}`, { method: 'DELETE' });
      toast('Cours supprimé');
    } else if (booking) {
      if (!confirm(`Retirer ${booking.dataset.name} de ce cours ? Elle recevra un e-mail d'annulation.`)) return;
      const res = await adminApi(`/api/admin/bookings?id=${booking.dataset.delBooking}`, { method: 'DELETE' });
      toast(res.late ? 'Retirée · annulation tardive signalée' : 'Réservation retirée');
    } else return;
    loadAgenda();
  } catch (err) { toast(err.message); }
});

// ---------- Disponibilités ----------

async function loadDispos() {
  const week = weeks.dispos;
  $('#disposLabel').textContent = weekLabel(week);
  const form = $('#add');
  const today = ymd(new Date());
  form.date.min = ymd(week) > today ? ymd(week) : today;
  form.date.max = ymd(addDays(week, 6));
  if (!form.date.value || form.date.value < form.date.min || form.date.value > form.date.max) form.date.value = form.date.min;
  form.until.min = form.date.value;
  const { slots } = await adminApi(`/api/admin/slots?${weekQuery(week)}`);
  const days = byDay(slots);
  $('#disposList').innerHTML = [...Array(7)].map((_, i) => {
    const d = addDays(week, i);
    const items = days.get(ymd(d)) || [];
    return `<div class="day-head"><span class="num">${d.getDate()}</span><span class="dow">${fmt.day.format(d).split(' ')[0]}</span><span class="line"></span></div>`
      + (items.length ? items.map(disposCard).join('') : '<p class="muted small" style="margin:0 2px 8px">Fermé</p>');
  }).join('');
  $('#disposList').dataset.count = slots.length;
}

function disposCard(s) {
  const start = new Date(s.starts_at);
  const end = new Date(start.getTime() + s.duration_minutes * 60000);
  const n = s.bookings.length;
  const past = start < new Date();
  return `<div class="sess ${past ? 'past' : ''}">
    <div class="srow">
      <span class="st">${fmt.time.format(start)}</span>
      <span class="sn">${esc(s.title)}</span>
      <span class="scap">${n}/${s.capacity}</span>
      <button class="rm" data-del-slot="${s.id}" data-count="${n}" style="margin-left:10px">Supprimer</button>
    </div>
    <div class="muted small" style="margin-top:6px">→ ${fmt.time.format(end)}${past ? ' · passé, invisible pour les clientes' : ''}</div>
  </div>`;
}

$('#add').date.addEventListener('change', (e) => { e.target.form.until.min = e.target.value; });

$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const first = new Date(`${f.date.value}T${f.time.value}`);
  const until = f.until.value ? new Date(`${f.until.value}T23:59`) : first;
  const rows = [];
  for (let d = first; d <= until && rows.length < 52; d = addDays(d, 7)) {
    rows.push({ starts_at: d.toISOString(), duration_minutes: Number(f.duration_minutes.value), capacity: Number(f.capacity.value), title: f.title.value });
  }
  if (!rows.length) return toast('La date de fin est avant le premier jour.');
  try {
    await adminApi('/api/admin/slots', { method: 'POST', body: JSON.stringify(rows) });
    toast(rows.length > 1 ? `${rows.length} séances ajoutées` : 'Cours ajouté');
    f.until.value = '';
    loadDispos();
  } catch (err) { toast(err.message); }
});

$('#copy').addEventListener('click', async () => {
  try {
    const { slots: previous } = await adminApi(`/api/admin/slots?${weekQuery(addDays(weeks.dispos, -7))}`);
    const upcoming = previous.filter((s) => addDays(new Date(s.starts_at), 7) > new Date());
    if (!upcoming.length) return toast('Rien à copier : semaine précédente vide ou passée.');
    if (Number($('#disposList').dataset.count) && !confirm('Cette semaine a déjà des cours. Ajouter aussi ceux de la semaine précédente ?')) return;
    await adminApi('/api/admin/slots', { method: 'POST', body: JSON.stringify(upcoming.map((s) => ({
      starts_at: addDays(new Date(s.starts_at), 7).toISOString(),
      duration_minutes: s.duration_minutes, capacity: s.capacity, title: s.title,
    }))) });
    toast(upcoming.length > 1 ? `${upcoming.length} cours copiés` : '1 cours copié');
    loadDispos();
  } catch (err) { toast(err.message); }
});

// ---------- Clientes ----------

async function loadReport() {
  report = await adminApi('/api/admin/report');
  const now = new Date();
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months = new Map();
  for (const at of report.bookings) months.set(monthKey(new Date(at)), (months.get(monthKey(new Date(at))) || 0) + 1);
  const active = report.clients.filter((c) => c.last && now - c.last < 30 * 864e5).length;
  $('#stats').innerHTML = [
    [report.clients.length, 'clientes au total'],
    [active, 'venues ces 30 jours'],
    [months.get(monthKey(now)) || 0, 'réservations ce mois-ci'],
    [report.clients.reduce((n, c) => n + c.upcoming, 0), 'réservations à venir'],
  ].map(([n, label]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('');

  const date = (t) => (t ? fmt.date.format(new Date(t)) : '—');
  $('#clientTable').innerHTML = report.clients.length
    ? `<thead><tr><th>Nom</th><th>E-mail</th><th class="num">Séances</th><th class="num">À venir</th><th>Dernière</th><th class="num">Annul. &lt;24h</th></tr></thead>
       <tbody>${report.clients.map((c) => `<tr>
         <td>${esc(c.name)}</td><td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
         <td class="num">${c.total}</td><td class="num">${c.upcoming}</td><td>${date(c.last)}</td>
         <td class="num">${c.late ? `<span class="flag" style="padding:2px 8px">${c.late}</span>` : '—'}</td>
       </tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">Pas encore de réservations.</td></tr></tbody>';

  const rows = [...months].sort(([a], [b]) => b.localeCompare(a)).slice(0, 12);
  $('#monthTable').innerHTML = rows.length
    ? `<tbody>${rows.map(([k, n]) => `<tr><td>${fmt.month.format(new Date(`${k}-01T12:00`))}</td><td class="num">${n}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">—</td></tr></tbody>';
}

$('#csv').addEventListener('click', () => {
  if (!report) return;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t ? ymd(new Date(t)) : '');
  const lines = [['Nom', 'E-mail', 'Séances', 'À venir', 'Dernière venue', 'Annulations tardives'],
    ...report.clients.map((c) => [c.name, c.email, c.total, c.upcoming, iso(c.last), c.late || 0])];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(';')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clientes-${ymd(new Date())}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Export story (canvas 1080 x 1920) ----------

const STORY = { bg: '#faf6f1', band: '#f6e7ec', ink: '#2c2420', muted: '#6f645b', brand: '#8f4a63', brandStrong: '#78384f', sage: '#6f8a72', sageTint: '#e8efe6' };

async function drawStory() {
  const canvas = $('#storyCanvas');
  const g = canvas.getContext('2d');
  const W = 1080, H = 1920;
  try { await document.fonts.load('600 92px Fraunces'); await document.fonts.load('600 34px Figtree'); await document.fonts.ready; } catch {}
  g.fillStyle = STORY.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = STORY.band; g.fillRect(0, 0, W, 470);
  // décor
  g.fillStyle = STORY.sageTint; g.beginPath(); g.arc(950, 150, 150, 0, 7); g.fill();
  // en-tête
  g.textBaseline = 'alphabetic';
  g.fillStyle = STORY.brand; g.font = '600 30px Fraunces';
  g.save(); g.translate(80, 150); g.scale(1, 1);
  g.fillText('P I L A T E L I A', 0, 0); g.restore();
  g.fillStyle = STORY.ink; g.font = '600 96px Fraunces';
  g.fillText('Les dispos', 80, 290);
  g.fillText('de la semaine', 80, 390);
  const monday = weeks.agenda;
  g.fillStyle = STORY.muted; g.font = '600 34px Figtree';
  g.fillText(`${fmt.short.format(monday)} — ${fmt.short.format(addDays(monday, 6))}`, 82, 445);

  // liste des jours avec créneaux
  const days = byDay(agendaSlots);
  let y = 600;
  let any = false;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const items = days.get(ymd(d)) || [];
    if (!items.length) continue;
    any = true;
    g.fillStyle = STORY.brandStrong; g.font = '700 30px Figtree';
    g.fillText(fmt.day.format(d).split(' ').slice(0, 2).join(' ').toUpperCase(), 82, y);
    y += 50;
    for (const s of items) {
      const t = fmt.time.format(new Date(s.starts_at));
      g.fillStyle = STORY.ink; g.font = '600 40px Figtree';
      g.fillText(t, 82, y);
      g.fillStyle = STORY.muted; g.font = '500 40px Figtree';
      g.fillText(s.title, 250, y);
      y += 58;
    }
    y += 26;
    if (y > 1680) break;
  }
  if (!any) { g.fillStyle = STORY.muted; g.font = '500 40px Figtree'; g.fillText('Planning à venir — écrivez-nous !', 82, 640); }

  // pied sauge
  g.fillStyle = STORY.sageTint; g.fillRect(0, H - 150, W, 150);
  g.fillStyle = STORY.brandStrong; g.font = '700 36px Figtree';
  g.fillText('Réservez depuis l\'app · lien en bio', 80, H - 60);
}

function storyBlob() { return new Promise((res) => $('#storyCanvas').toBlob(res, 'image/png')); }

$('#exportBtn').addEventListener('click', async () => {
  $('#story').showModal();
  await drawStory();
});
$('#saveStory').addEventListener('click', async () => {
  const blob = await storyBlob();
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `pilatelia-dispos-${ymd(weeks.agenda)}.png` });
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#shareStory').addEventListener('click', async () => {
  const blob = await storyBlob();
  const file = new File([blob], `pilatelia-dispos-${ymd(weeks.agenda)}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Dispos de la semaine' }); return; } catch { return; }
  }
  toast('Partage direct indisponible : utilisez « Enregistrer la photo ».');
});

// ---------- Navigation ----------

const loaders = { agenda: loadAgenda, dispos: loadDispos, clients: loadReport };

document.querySelector('.seg').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b === t));
  for (const name of Object.keys(loaders)) $(`#${name}`).hidden = name !== t.dataset.tab;
  loaders[t.dataset.tab]().catch((err) => toast(err.message));
});

document.querySelectorAll('[data-week]').forEach((btn) => btn.addEventListener('click', () => {
  const w = btn.dataset.week;
  weeks[w] = addDays(weeks[w], Number(btn.dataset.dir) * 7);
  (w === 'agenda' ? loadAgenda() : loadDispos()).catch((err) => toast(err.message));
}));

document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $('#story').close()));
$('#story').addEventListener('click', (e) => { if (e.target === $('#story')) $('#story').close(); });

async function enter() {
  await loadAgenda();
  sessionStorage.setItem('pilatelia-admin', key);
  $('#login').hidden = true;
  $('#app').hidden = false;
}

$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  key = e.target.password.value;
  enter().catch((err) => { if (err.status !== 401) $('#loginError').textContent = err.message; });
});

if (key) enter().catch(() => {});
