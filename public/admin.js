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
$('#clearBtn').innerHTML = `${ic('trash')} Vider la semaine`;
$('#pwdIc').innerHTML = ic('key');
$('#presIc').innerHTML = ic('tag');
$('#studioIc').innerHTML = ic('edit');
$('#shareStory').innerHTML = `${ic('share')} Partager la story`;
$('#saveStory').innerHTML = `${ic('download')} Enregistrer la photo`;
$('#bgLabel').insertAdjacentHTML('afterbegin', ic('edit'));

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
      <span class="who"><div>${esc(b.guest_name)}</div><a href="mailto:${esc(b.guest_email)}">${esc(b.guest_email)}</a>${b.guest_phone
        ? `<span class="phone-links"><a href="${esc(telLink(b.guest_phone))}">${ic('phone')} ${esc(b.guest_phone)}</a><a class="wa" href="${esc(waLink(b.guest_phone))}" target="_blank" rel="noopener">${ic('whatsapp')} WhatsApp</a></span>` : ''}</span>
      ${flagged[b.guest_email] ? `<span class="flag">${ic('flag')} &lt; 24h</span>` : ''}
      <button class="rm" data-del-booking="${b.id}" data-name="${esc(b.guest_name)}">Retirer</button>
    </div>`).join('') : '<p class="muted">Personne d\'inscrite pour l\'instant.</p>';
  $('#sessionBody').innerHTML = `
    <h2>${esc(s.title)}</h2>
    <p class="meta">${fmt.day.format(d)} · ${fmt.time.format(d)} · ${s.duration_minutes} min${s.coach ? ` · ${esc(s.coach)}` : ''}${s.price_cents ? ` · ${euro(s.price_cents)}` : ''}</p>
    <div class="session-cap"><span class="scap ${full(s) ? 'few' : ''}">${n}/${s.capacity} inscrite${n > 1 ? 's' : ''}</span></div>
    <div class="att">${people}</div>
    <form id="addPersonForm" data-class="${s.id}" class="addperson">
      <div class="grid2">
        <label>Prénom et nom <input name="name" required maxlength="100" /></label>
        <label>E-mail <input name="email" type="email" required maxlength="160" /></label>
        <label class="span2">Téléphone <input name="phone" type="tel" required maxlength="40" placeholder="0470 12 34 56" /></label>
      </div>
      <p class="error" id="addPersonError"></p>
      <button class="btn btn-secondary btn-block" type="submit">${ic('plus')} Inscrire cette personne</button>
    </form>
    ${new Date(s.starts_at) > new Date() ? `<details class="move">
      <summary>${ic('move')} Déplacer / modifier ce cours</summary>
      <form id="moveForm" data-class="${s.id}">
        <div class="grid2">
          <label>Jour <input type="date" name="date" required min="${ymd(new Date())}" value="${ymd(d)}" /></label>
          <label>Heure <input type="time" name="time" required step="300" value="${hhmm(d)}" /></label>
          <label>Durée (min) <input type="number" name="duration_minutes" required min="10" max="240" value="${s.duration_minutes}" /></label>
          <label>Places <input type="number" name="capacity" required min="${Math.max(1, n)}" max="100" value="${s.capacity}" /></label>
        </div>
        ${n ? `<p class="muted small" style="margin:0 0 10px">Si l'horaire change, ${n > 1 ? `les ${n} inscrites recevront` : 'l\'inscrite recevra'} un e-mail avec le nouvel horaire.</p>` : ''}
        <p class="error" id="moveError"></p>
        <button class="btn btn-primary btn-block" type="submit">Enregistrer</button>
      </form>
    </details>` : ''}
    <button class="btn btn-ghost btn-block" style="margin-top:14px;color:var(--danger)" data-del-slot="${s.id}" data-count="${n}">${ic('trash')} Supprimer ce cours</button>
    <button class="btn btn-ghost btn-block" data-close style="margin-top:4px">Fermer</button>`;
  $('#sessionSheet').showModal();
}
const full = (s) => s.bookings.length >= s.capacity;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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

// Déplacer / modifier un cours depuis son détail.
$('#sessionSheet').addEventListener('submit', async (e) => {
  const f = e.target.closest('#moveForm');
  if (!f) return;
  e.preventDefault();
  $('#moveError').textContent = '';
  const starts = new Date(`${f.date.value}T${f.time.value}`);
  try {
    const res = await adminApi('/api/admin/slots', { method: 'PATCH', body: JSON.stringify({
      id: f.dataset.class, starts_at: starts.toISOString(),
      duration_minutes: Number(f.duration_minutes.value), capacity: Number(f.capacity.value),
    }) });
    toast(res.notified ? `Cours déplacé · ${plural(res.notified, 'cliente')} prévenue${res.notified > 1 ? 's' : ''}` : 'Cours mis à jour');
    week = mondayOf(starts);
    await loadAgenda();
    openSession(f.dataset.class);
  } catch (err) { $('#moveError').textContent = err.message; }
});

// Inscription manuelle d'une personne depuis le détail de cours.
$('#sessionSheet').addEventListener('submit', async (e) => {
  const f = e.target.closest('#addPersonForm');
  if (!f) return;
  e.preventDefault();
  $('#addPersonError').textContent = '';
  const classId = f.dataset.class;
  try {
    await adminApi('/api/admin/bookings', { method: 'POST', body: JSON.stringify({
      class_id: classId,
      name: f.querySelector('[name="name"]').value.trim(),
      email: f.querySelector('[name="email"]').value.trim(),
      phone: f.querySelector('[name="phone"]').value.trim(),
    }) });
    toast('Personne inscrite · e-mail envoyé');
    await loadAgenda();
    openSession(classId);
  } catch (err) { $('#addPersonError').textContent = err.message; }
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

// Vider la semaine affichée (cours à venir uniquement) pour repartir de zéro.
$('#clearBtn').addEventListener('click', async () => {
  const now = new Date();
  const upcoming = agendaSlots.filter((s) => new Date(s.starts_at) > now);
  if (!upcoming.length) return toast('Aucun cours à venir à supprimer cette semaine.');
  const people = upcoming.reduce((n, s) => n + s.bookings.length, 0);
  const msg = `Supprimer les ${plural(upcoming.length, 'cours')} à venir de la semaine du ${weekLabel(week)} ?`
    + (people ? `\n\n${plural(people, 'réservation')} ser${people > 1 ? 'ont annulées' : 'a annulée'} et les clientes recevront un e-mail d'annulation.` : '')
    + '\n\nLes cours déjà passés sont conservés.';
  if (!confirm(msg)) return;
  try {
    const res = await adminApi(`/api/admin/slots?${weekQuery(week)}`, { method: 'DELETE' });
    toast(`Semaine vidée · ${plural(res.deleted, 'cours')} supprimé${res.deleted > 1 ? 's' : ''}`);
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
    ? `<thead><tr><th>Nom</th><th>Téléphone</th><th>E-mail</th><th class="num">Séances</th><th class="num">À venir</th><th>Dernière</th><th class="num">&lt;24h</th></tr></thead>
       <tbody>${report.clients.map((c) => `<tr>
         <td>${esc(c.name)}</td>
         <td>${c.phone ? `<a href="${esc(telLink(c.phone))}">${esc(c.phone)}</a> <a class="wa-mini" href="${esc(waLink(c.phone))}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('whatsapp')}</a>` : '<span class="muted">—</span>'}</td>
         <td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
         <td class="num">${c.total}</td><td class="num">${c.upcoming}</td><td>${date(c.last)}</td>
         <td class="num">${c.late ? `<span class="flag" style="padding:2px 8px">${c.late}</span>` : '—'}</td>
       </tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">Pas encore de réservations.</td></tr></tbody>';
}

$('#csv').addEventListener('click', () => {
  if (!report) return;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t ? ymd(new Date(t)) : '');
  const lines = [['Nom', 'Téléphone', 'E-mail', 'Séances', 'À venir', 'Dernière venue', 'Annulations tardives'],
    ...report.clients.map((c) => [c.name, c.phone || '', c.email, c.total, c.upcoming, iso(c.last), c.late || 0])];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(';')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clientes-${ymd(new Date())}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
});

// ---------- Export story (canvas 1080 x 1920) ----------

// Reprend la DA de l'affiche « Nos Horaires » du studio : mur sauge, vague beige,
// arche lumineuse, jours en colonnes (lun→jeu puis ven→dim), heures centrées.
const STORY = {
  wallTop: '#97a37c', wallBottom: '#7e8a64', wave: '#b5a189', waveLine: '#e9dcc6',
  archFill: 'rgba(176,152,124,.86)', archFill2: 'rgba(150,126,100,.9)', glow: '#ffd24a',
  mirror: 'rgba(214,180,110,.55)', floorTop: '#b8916a', floorBottom: '#8f6c4b', text: '#fffaf1', line: 'rgba(255,250,241,.85)',
};
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const storyTime = (d) => `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
let storyStudio = null;
let storyBg;               // undefined = pas encore chargé, null = fond par défaut, sinon <img>

const loadImage = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });

async function loadStoryBg() {
  try {
    const { image } = await adminApi('/api/admin/story-bg');
    storyBg = image ? await loadImage(image) : null;
  } catch { storyBg = null; }
}

// Dessine une image en « cover » (remplit tout le cadre, recadrée au centre).
function drawCover(g, img, W, H) {
  const k = Math.max(W / img.width, H / img.height);
  const w = img.width * k, h = img.height * k;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function archPath(g, x, y, w, h, close = true) {
  const r = w / 2;
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y + r);
  g.arc(x + r, y + r, r, Math.PI, 0);
  g.lineTo(x + w, y + h);
  if (close) g.closePath();
}

// Plus grande taille (≤ max) pour que chaque texte tienne dans `width`.
function fitSize(g, texts, font, max, width) {
  let size = max;
  for (const t of texts) {
    g.font = font(max);
    const w = g.measureText(t).width;
    if (w > width) size = Math.min(size, Math.floor(max * width / w));
  }
  return size;
}

// Icônes du pied (tracés SVG 24×24 mis à l'échelle).
function storyIcon(g, name, x, y, size) {
  const k = size / 24;
  g.save(); g.translate(x, y); g.scale(k, k);
  g.strokeStyle = STORY.text; g.fillStyle = STORY.text; g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
  if (name === 'pin') {
    g.fill(new Path2D('M12 23s8-7 8-13.5a8 8 0 1 0-16 0C4 16 12 23 12 23z'));
    g.fillStyle = STORY.floorBottom; g.beginPath(); g.arc(12, 9.5, 3, 0, 7); g.fill();
  } else if (name === 'instagram') {
    g.stroke(new Path2D('M7 2.5h10A4.5 4.5 0 0 1 21.5 7v10a4.5 4.5 0 0 1-4.5 4.5H7A4.5 4.5 0 0 1 2.5 17V7A4.5 4.5 0 0 1 7 2.5z'));
    g.beginPath(); g.arc(12, 12, 4.3, 0, 7); g.stroke();
    g.beginPath(); g.arc(17.4, 6.6, 1.2, 0, 7); g.fill();
  } else if (name === 'whatsapp') {
    g.stroke(new Path2D('M3.2 20.8 4.6 16A9.3 9.3 0 1 1 8 19.5z'));
    g.fill(new Path2D('M8.6 7.4c.4-.4 1-.4 1.3 0l1.1 1.9c.2.4.1.8-.2 1.1l-.6.6c.6 1.3 1.6 2.3 2.9 2.9l.6-.6c.3-.3.7-.4 1.1-.2l1.9 1.1c.4.3.4.9 0 1.3l-.7.8c-.6.6-1.5.8-2.3.5-2.7-1-4.8-3.1-5.8-5.8-.3-.8-.1-1.7.5-2.3z'));
  }
  g.restore();
}

async function drawStory() {
  const g = $('#storyCanvas').getContext('2d');
  const W = 1080, H = 1920;
  try {
    await Promise.all(['600 60px Fredoka', '500 60px Quicksand', '700 60px Quicksand', '160px "Great Vibes"'].map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {}
  if (!storyStudio) storyStudio = await adminApi('/api/admin/studio').catch(() => ({}));
  if (storyBg === undefined) await loadStoryBg();
  $('#resetBg').hidden = !storyBg;
  g.save();
  g.clearRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  const floorY = 1655;

  if (storyBg) {
    // Fond du studio (son visuel vierge) : on n'ajoute que les textes par-dessus.
    drawCover(g, storyBg, W, H);
  } else {

  // Mur sauge
  let grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, STORY.wallTop); grad.addColorStop(1, STORY.wallBottom);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);

  // Vague beige en haut à gauche (+ filet clair)
  g.fillStyle = STORY.wave;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(860, 0);
  g.bezierCurveTo(700, 40, 560, 200, 360, 250); g.bezierCurveTo(200, 290, 70, 330, 0, 470); g.closePath(); g.fill();
  g.strokeStyle = STORY.waveLine; g.lineWidth = 4;
  g.beginPath(); g.moveTo(950, 0); g.bezierCurveTo(780, 70, 620, 250, 400, 300); g.bezierCurveTo(230, 340, 90, 380, 0, 540); g.stroke();

  // Sol en bois
  grad = g.createLinearGradient(0, floorY, 0, H);
  grad.addColorStop(0, STORY.floorTop); grad.addColorStop(1, STORY.floorBottom);
  g.fillStyle = grad; g.fillRect(0, floorY, W, H - floorY);
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, floorY, W, 6);

  // Arche : remplissage, miroir, puis halo lumineux
  const AX = 120, AY = 400, AW = 840, AH = floorY - AY;
  grad = g.createLinearGradient(0, AY, 0, floorY);
  grad.addColorStop(0, STORY.archFill); grad.addColorStop(1, STORY.archFill2);
  archPath(g, AX, AY, AW, AH); g.fillStyle = grad; g.fill();
  archPath(g, AX + 150, AY + 180, AW - 300, AH - 220); g.strokeStyle = STORY.mirror; g.lineWidth = 5; g.stroke();
  g.save();
  g.shadowColor = STORY.glow; g.lineCap = 'round';
  for (const [blur, width, alpha] of [[90, 26, 0.35], [45, 14, 0.6], [16, 7, 1]]) {
    g.shadowBlur = blur; g.globalAlpha = alpha; g.lineWidth = width; g.strokeStyle = STORY.glow;
    archPath(g, AX, AY, AW, AH, false); g.stroke();
  }
  g.restore();
  }

  // Textes (blanc cassé, légère ombre pour la lisibilité)
  g.fillStyle = STORY.text;
  g.shadowColor = storyBg ? 'rgba(40,28,16,.6)' : 'rgba(60,40,20,.35)';
  g.shadowBlur = storyBg ? 12 : 8; g.shadowOffsetY = 2;
  g.textAlign = 'center';
  g.font = '500 64px Quicksand'; g.fillText('Semaine', 190, 100);
  g.fillText(ddmm(week), 190, 178);

  // « Nos Horaires » : script + capitale, centrés ensemble
  g.font = '160px "Great Vibes"'; const wNos = g.measureText('Nos').width;
  g.font = '500 76px Quicksand'; const wHor = g.measureText('Horaires').width;
  const gap = 22, tx = 600 - (wNos + gap + wHor) / 2;
  g.textAlign = 'left';
  g.font = '160px "Great Vibes"'; g.fillText('Nos', tx, 330);
  g.font = '500 76px Quicksand'; g.fillText('Horaires', tx + wNos + gap, 318);

  // Séances par jour
  const days = byDay(agendaSlots);
  const cols = DAY_NAMES.map((name, i) => {
    const d = addDays(week, i);
    const items = (days.get(ymd(d)) || []).map((s) => new Date(s.starts_at)).sort((a, b) => a - b);
    return { name, date: ddmm(d), lines: items.length ? items.map(storyTime) : ['Day', 'OFF'], off: !items.length };
  });
  const rows = [cols.slice(0, 4), cols.slice(4)];
  const left = 170, right = 910, innerW = right - left;
  const headH = 128, rowGap = 64, top = 600, bottom = floorY - 50;
  const counts = rows.map((r) => Math.max(...r.map((c) => c.lines.length)));
  const lineH = Math.min(86, (bottom - top - headH * 2 - rowGap) / (counts[0] + counts[1]));

  // Tailles UNIQUES pour toute l'image : toutes les heures s'alignent sur la même grille.
  const colW = innerW / 4;
  const headSize = fitSize(g, cols.flatMap((c) => [c.name, c.date]), (s) => `700 ${s}px Quicksand`, 46, colW - 16);
  const timeSize = fitSize(g, cols.flatMap((c) => c.lines), (s) => `600 ${s}px Fredoka`, Math.min(64, Math.round(lineH * 0.75)), colW - 44);

  let y = top;
  rows.forEach((row, ri) => {
    const cw = innerW / row.length;
    const rowEnd = y + headH + counts[ri] * lineH;
    g.textAlign = 'center';
    row.forEach((c, ci) => {
      const cx = left + cw * ci + cw / 2;
      g.font = `700 ${headSize}px Quicksand`;
      g.fillText(c.name, cx, y + headSize);
      g.fillText(c.date, cx, y + headSize * 2 + 8);
      g.font = `600 ${timeSize}px Fredoka`;
      c.lines.forEach((t, li) => g.fillText(t, cx, y + headH + li * lineH + timeSize * 0.85));
      if (ci > 0) { // séparateur vertical entre colonnes
        g.save(); g.shadowBlur = 0; g.shadowOffsetY = 0; g.fillStyle = STORY.line;
        g.fillRect(Math.round(left + cw * ci) - 1.5, y + headH - 12, 3, rowEnd - (y + headH) + 4);
        g.restore();
      }
    });
    y = rowEnd + rowGap;
  });

  // Pied : adresse, Instagram, WhatsApp
  const st = storyStudio || {};
  g.textAlign = 'left';
  const footFont = (s) => `700 ${s}px Quicksand`;
  let fy = floorY + 78;
  if (st.address) {
    const parts = st.address.includes(',') ? [st.address.slice(0, st.address.indexOf(',') + 1), st.address.slice(st.address.indexOf(',') + 1).trim()] : [st.address];
    const size = fitSize(g, parts, footFont, 44, 860);
    storyIcon(g, 'pin', 110, fy - 46, 54);
    g.font = footFont(size);
    parts.forEach((p, i) => g.fillText(p, 180, fy + i * 52));
    fy += parts.length * 52 + 34;
  }
  const insta = String(st.instagram || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '');
  const items = [insta && ['instagram', insta], st.phone && ['whatsapp', st.phone]].filter(Boolean);
  if (items.length) {
    const size = fitSize(g, [items.map((i) => i[1]).join('      ')], footFont, 44, 800);
    g.font = footFont(size);
    let fx = 110;
    for (const [icon, label] of items) {
      storyIcon(g, icon, fx, fy - size + 2, size + 6);
      g.fillText(label, fx + size + 22, fy);
      fx += size + 22 + g.measureText(label).width + 60;
    }
  }
  g.restore();
}
const storyBlob = () => new Promise((res) => $('#storyCanvas').toBlob(res, 'image/png'));

$('#exportBtn').addEventListener('click', async () => { storyStudio = null; storyBg = undefined; $('#story').showModal(); await drawStory(); });

// Fond personnalisé : l'image est recadrée en 1080×1920 et compressée avant l'envoi.
$('#bgInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    const c = Object.assign(document.createElement('canvas'), { width: 1080, height: 1920 });
    drawCover(c.getContext('2d'), img, 1080, 1920);
    let data = c.toDataURL('image/jpeg', 0.85);
    if (data.length > 3_500_000) data = c.toDataURL('image/jpeg', 0.7);
    await adminApi('/api/admin/story-bg', { method: 'POST', body: JSON.stringify({ image: data }) });
    storyBg = await loadImage(data);
    await drawStory();
    toast('Fond enregistré');
  } catch (err) { toast(err.message || 'Image illisible.'); }
});
$('#resetBg').addEventListener('click', async () => {
  if (!confirm('Revenir au fond dessiné par défaut ?')) return;
  try {
    await adminApi('/api/admin/story-bg', { method: 'POST', body: JSON.stringify({ image: null }) });
    storyBg = null; await drawStory(); toast('Fond par défaut rétabli');
  } catch (err) { toast(err.message); }
});
$('#saveStory').addEventListener('click', async () => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await storyBlob()), download: `pilatelia-horaires-${ymd(week)}.png` });
  a.click(); URL.revokeObjectURL(a.href);
});
$('#shareStory').addEventListener('click', async () => {
  const file = new File([await storyBlob()], `pilatelia-horaires-${ymd(week)}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Nos horaires' }); } catch {} return; }
  toast('Partage direct indisponible : utilisez « Enregistrer la photo ».');
});

// ---------- Navigation ----------

// ---------- Studio (paramètres) ----------

async function loadStudioSettings() {
  const s = await adminApi('/api/admin/studio');
  const f = $('#studioForm');
  f.name.value = s.name || '';
  f.address.value = s.address || '';
  f.email.value = s.email || '';
  f.phone.value = s.phone || '';
  f.instagram.value = s.instagram || '';
}

$('#studioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#studioError').textContent = '';
  try {
    await adminApi('/api/admin/studio', { method: 'POST', body: JSON.stringify({
      name: f.name.value, address: f.address.value, email: f.email.value, phone: f.phone.value, instagram: f.instagram.value,
    }) });
    toast('Infos studio enregistrées');
  } catch (err) { $('#studioError').textContent = err.message; }
});

// Changer le mot de passe de l'espace studio.
$('#pwdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#pwdError').textContent = '';
  if (f.next.value !== f.confirm.value) { $('#pwdError').textContent = 'Les deux nouveaux mots de passe ne correspondent pas.'; return; }
  try {
    await adminApi('/api/admin/password', { method: 'POST', body: JSON.stringify({ current: f.current.value, next: f.next.value }) });
    key = f.next.value;
    sessionStorage.setItem('pilatelia-admin', key);
    f.reset();
    toast('Mot de passe modifié');
  } catch (err) { $('#pwdError').textContent = err.message; }
});

const loaders = { agenda: loadAgenda, prestations: loadServices, finances: loadFinance, clients: loadReport, studio: loadStudioSettings };
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
