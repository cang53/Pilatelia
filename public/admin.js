const $ = (s) => document.querySelector(s);
let key = sessionStorage.getItem('pilatelia-admin') || '';
let week = mondayOf(new Date());
let report = null;

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
  toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

function showLogin(msg = '') {
  sessionStorage.removeItem('pilatelia-admin');
  $('#login').hidden = false;
  $('#app').hidden = $('#logout').hidden = true;
  $('#loginError').textContent = msg;
}

// ---------- Planning ----------

async function loadWeek() {
  $('#weekLabel').textContent = weekLabel(week);
  const form = $('#add');
  form.date.min = ymd(week);
  form.date.max = ymd(addDays(week, 6));
  if (!form.date.value || form.date.value < form.date.min || form.date.value > form.date.max) form.date.value = ymd(week);
  const slots = await adminApi(`/api/admin/slots?${weekQuery(week)}`);
  const days = byDay(slots);
  $('#week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(week, i);
    const items = days.get(ymd(day)) || [];
    return `<section class="day">
      <h2>${fmt.day.format(day)}</h2>
      ${items.length ? items.map(slotCard).join('') : '<p class="muted small">Aucun créneau</p>'}
    </section>`;
  }).join('');
  $('#week').dataset.count = slots.length;
}

function slotCard(s) {
  const start = new Date(s.starts_at);
  const end = new Date(start.getTime() + s.duration_minutes * 60000);
  const n = s.bookings.length;
  return `<div class="slot slot-admin">
    <div class="slot-head">
      <p class="slot-time">${fmt.time.format(start)}<small>→ ${fmt.time.format(end)}</small></p>
      <div class="slot-info"><strong>${esc(s.title)}</strong><span class="${n >= s.capacity ? 'full' : 'muted'}">${n} / ${s.capacity} inscrite${n > 1 ? 's' : ''}</span></div>
      <button class="link danger" data-del-slot="${s.id}" data-count="${n}">Supprimer</button>
    </div>
    ${n ? `<ul class="people">${s.bookings.map((b) => `<li>
      <span>${esc(b.guest_name)} <a href="mailto:${esc(b.guest_email)}" class="muted">${esc(b.guest_email)}</a></span>
      <button class="link danger" data-del-booking="${b.id}" data-name="${esc(b.guest_name)}">Retirer</button>
    </li>`).join('')}</ul>` : ''}
  </div>`;
}

$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await adminApi('/api/admin/slots', { method: 'POST', body: JSON.stringify([{
      starts_at: new Date(`${f.date.value}T${f.time.value}`).toISOString(),
      duration_minutes: Number(f.duration_minutes.value),
      capacity: Number(f.capacity.value),
      title: f.title.value,
    }]) });
    toast('Créneau ajouté');
    loadWeek();
  } catch (err) { toast(err.message); }
});

$('#copy').addEventListener('click', async () => {
  try {
    const previous = await adminApi(`/api/admin/slots?${weekQuery(addDays(week, -7))}`);
    if (!previous.length) return toast('La semaine précédente est vide.');
    if (Number($('#week').dataset.count) && !confirm('Cette semaine a déjà des créneaux. Ajouter quand même ceux de la semaine précédente ?')) return;
    await adminApi('/api/admin/slots', { method: 'POST', body: JSON.stringify(previous.map((s) => ({
      starts_at: addDays(new Date(s.starts_at), 7).toISOString(), // garde l'heure locale même au changement d'heure
      duration_minutes: s.duration_minutes, capacity: s.capacity, title: s.title,
    }))) });
    toast(previous.length > 1 ? `${previous.length} créneaux copiés` : '1 créneau copié');
    loadWeek();
  } catch (err) { toast(err.message); }
});

$('#week').addEventListener('click', async (e) => {
  const slot = e.target.closest('[data-del-slot]');
  const booking = e.target.closest('[data-del-booking]');
  try {
    if (slot) {
      const n = Number(slot.dataset.count);
      if (!confirm(n ? `Supprimer ce créneau et ses ${plural(n, 'réservation')} ?` : 'Supprimer ce créneau ?')) return;
      await adminApi(`/api/admin/slots?id=${slot.dataset.delSlot}`, { method: 'DELETE' });
      toast('Créneau supprimé');
    } else if (booking) {
      if (!confirm(`Retirer ${booking.dataset.name} de ce créneau ?`)) return;
      await adminApi(`/api/admin/bookings?id=${booking.dataset.delBooking}`, { method: 'DELETE' });
      toast('Réservation retirée');
    } else return;
    loadWeek();
  } catch (err) { toast(err.message); }
});

$('#prev').addEventListener('click', () => { week = addDays(week, -7); loadWeek().catch((e) => toast(e.message)); });
$('#next').addEventListener('click', () => { week = addDays(week, 7); loadWeek().catch((e) => toast(e.message)); });

// ---------- Clientes ----------

async function loadReport() {
  report = await adminApi('/api/admin/report');
  const now = new Date();
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months = new Map();
  for (const at of report.bookings) {
    const k = monthKey(new Date(at));
    months.set(k, (months.get(k) || 0) + 1);
  }
  const active = report.clients.filter((c) => c.last && now - c.last < 30 * 864e5).length;
  $('#stats').innerHTML = [
    [report.clients.length, 'clientes au total'],
    [active, 'venues ces 30 derniers jours'],
    [months.get(monthKey(now)) || 0, 'réservations ce mois-ci'],
    [report.clients.reduce((n, c) => n + c.upcoming, 0), 'réservations à venir'],
  ].map(([n, label]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('');

  const date = (t) => (t ? fmt.date.format(new Date(t)) : '—');
  $('#clientTable').innerHTML = report.clients.length
    ? `<thead><tr><th>Nom</th><th>E-mail</th><th class="num">Séances</th><th class="num">À venir</th><th>Dernière venue</th><th>Depuis</th></tr></thead>
       <tbody>${report.clients.map((c) => `<tr>
         <td>${esc(c.name)}</td><td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
         <td class="num">${c.total}</td><td class="num">${c.upcoming}</td><td>${date(c.last)}</td><td>${date(c.first)}</td>
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
  const lines = [['Nom', 'E-mail', 'Séances', 'À venir', 'Dernière venue', 'Depuis'],
    ...report.clients.map((c) => [c.name, c.email, c.total, c.upcoming, iso(c.last), iso(c.first)])];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(';')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clientes-${ymd(new Date())}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Navigation ----------

document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  document.querySelectorAll('[data-tab]').forEach((t) => {
    t.setAttribute('aria-selected', t === tab);
    $(`#${t.dataset.tab}`).hidden = t !== tab;
  });
  (tab.dataset.tab === 'clients' ? loadReport() : loadWeek()).catch((err) => toast(err.message));
});

async function enter() {
  await loadWeek();
  sessionStorage.setItem('pilatelia-admin', key);
  $('#login').hidden = true;
  $('#app').hidden = $('#logout').hidden = false;
}

$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  key = e.target.password.value;
  enter().catch((err) => { if (err.status !== 401) $('#loginError').textContent = err.message; });
});
$('#logout').addEventListener('click', () => { key = ''; showLogin(); });

if (key) enter().catch(() => {});
