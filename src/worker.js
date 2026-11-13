// Un seul Worker : sert /public et l'API. La clé Supabase reste côté serveur.
const json = (value, status = 200) => Response.json(value, { status });
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86400000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function db(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new HttpError(503, 'Supabase non configuré.');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new HttpError(res.status, 'Erreur base de données.'), { detail: text });
  return text ? JSON.parse(text) : null;
}

function range(url) {
  const from = new Date(url.searchParams.get('from'));
  const to = new Date(url.searchParams.get('to'));
  if (isNaN(from) || isNaN(to) || to <= from) throw new HttpError(400, 'Période invalide.');
  return { from, to };
}

async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const hash = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([hash(request.headers.get('x-admin-key') || ''), hash(env.ADMIN_PASSWORD)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// ---------- Studio / e-mail ----------

function studio(env) {
  return {
    name: env.STUDIO_NAME || 'Pilatelia Studio',
    email: env.STUDIO_EMAIL || '',
    phone: env.STUDIO_PHONE || '',
    instagram: env.STUDIO_INSTAGRAM || '',
    address: env.STUDIO_ADDRESS || '',
  };
}

// Paramètres du studio : la ligne en base prime sur les variables d'env.
async function loadStudio(env) {
  const base = studio(env);
  try {
    const rows = await db(env, 'studio_settings?select=name,email,phone,instagram,address&limit=1');
    const r = rows && rows[0];
    if (r) for (const k of ['name', 'email', 'phone', 'instagram', 'address']) if (r[k]) base[k] = r[k];
  } catch { /* table absente avant migration : on garde les valeurs d'env */ }
  return base;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso));

// ---------- Ajouter à un agenda (Google / Apple / iCal) ----------
// Horodatage iCalendar en UTC : 20261116T170000Z
const icsStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (v) => String(v ?? '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');

// Construit un fichier .ics à partir des paramètres d'URL (sans accès base).
function buildIcs(params) {
  const start = new Date(params.get('s'));
  if (isNaN(start)) throw new HttpError(400, 'Date invalide.');
  const dur = Math.min(600, Math.max(5, parseInt(params.get('d') || '55', 10) || 55));
  const end = new Date(start.getTime() + dur * 60000);
  const name = (params.get('n') || 'Pilatelia').slice(0, 120);
  const title = (params.get('t') || 'Pilates').slice(0, 200);
  const loc = (params.get('l') || '').slice(0, 300);
  const uid = `${icsStamp(start)}-${Math.random().toString(36).slice(2, 10)}@pilatelia`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pilatelia//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEsc(`${title} — ${name}`)}`,
    loc ? `LOCATION:${icsEsc(loc)}` : null,
    `DESCRIPTION:${icsEsc(`Séance réservée via ${name}.`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(`Rappel — ${title}`)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

// Deux boutons « ajouter à l'agenda » pour l'e-mail (Google + Apple/iCal via .ics).
function calendarButtons(s, slot, origin) {
  if (!origin) return '';
  const start = new Date(slot.starts_at);
  const dur = slot.duration_minutes || 55;
  const end = new Date(start.getTime() + dur * 60000);
  const gp = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${slot.title || 'Pilates'} — ${s.name || 'Pilatelia'}`,
    dates: `${icsStamp(start)}/${icsStamp(end)}`,
    details: `Séance réservée via ${s.name || 'Pilatelia'}.`,
  });
  if (s.address) gp.set('location', s.address);
  const gcal = `https://calendar.google.com/calendar/render?${gp.toString()}`;
  const ics = `${origin}/api/ics?${new URLSearchParams({ t: slot.title || 'Pilates', s: slot.starts_at, d: String(dur), l: s.address || '', n: s.name || 'Pilatelia' }).toString()}`;
  const base = 'display:inline-block;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:999px;margin:0 8px 8px 0';
  return `<div style="margin:14px 0">
    <div style="font-size:13px;color:#7b6b56;margin-bottom:9px">Ajouter la séance à votre agenda</div>
    <a href="${esc(gcal)}" style="${base};background:#6e4d32;color:#fdf7ec">📅 Google Agenda</a>
    <a href="${esc(ics)}" style="${base};background:#ffffff;color:#6e4d32;border:1px solid #e1d4bf">🍎 Apple Calendar</a>
  </div>`;
}

// Envoi via Resend si configuré (RESEND_API_KEY + EMAIL_FROM), sinon no-op tracé.
async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(`[email non configuré] à ${to} : ${subject}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) console.error(`[email échec ${res.status}] ${await res.text()}`);
}

function emailShell(s, title, bodyHtml) {
  const contact = [s.email && `<a href="mailto:${esc(s.email)}" style="color:#6e4d32">${esc(s.email)}</a>`, s.phone && esc(s.phone)]
    .filter(Boolean).join(' · ');
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f4ebdf;padding:24px 0;color:#3a2e22">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e1d4bf;border-radius:22px;overflow:hidden">
      <div style="background:#ebdfcd;padding:22px 26px">
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#6e4d32;font-weight:700">${esc(s.name || 'Pilatelia')}</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px">${esc(title)}</div>
      </div>
      <div style="padding:24px 26px;font-size:15px;line-height:22px">${bodyHtml}</div>
      <div style="padding:16px 26px;background:#ece0cf;font-size:13px;color:#7b6b56">
        <div style="font-weight:700;color:#3a2e22">${esc(s.name)}</div>
        ${s.address ? `<div style="margin-top:3px">${esc(s.address)}</div>` : ''}
        ${contact ? `<div style="margin-top:3px">${contact}</div>` : ''}
      </div>
    </div>
  </div>`;
}
const venueLine = (s) => s.address
  ? `<div style="background:#e6ecd9;border-radius:16px;padding:14px 16px;margin:14px 0;font-size:14px"><b>Adresse</b><br>${esc(s.address)}</div>`
  : '';

const slotLine = (slot) =>
  `<div style="background:#ebdfcd;border-radius:16px;padding:16px;margin:14px 0">
    <div style="font-size:17px;font-weight:700">${esc(slot.title || 'Pilates')}</div>
    <div style="color:#7b6b56;margin-top:4px">${esc(fmtDate(slot.starts_at))} · ${slot.duration_minutes} min</div>
  </div>`;

const changeNote = (s) => {
  const how = [s.email && `par e-mail (${esc(s.email)})`, s.phone && `par téléphone (${esc(s.phone)})`].filter(Boolean).join(' ou ');
  return `<p style="color:#7b6b56">Pour modifier ou annuler, contactez le studio${how ? ` ${how}` : ''}. Une modification n'est plus possible dans les 24h avant la séance ; l'annulation reste possible à tout moment.</p>`;
};

function confirmationEmail(s, slot, origin) {
  return { subject: `C'est réservé — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'C\'est réservé !', `<p>Votre place est gardée. On a hâte de vous voir au studio.</p>${slotLine(slot)}${calendarButtons(s, slot, origin)}${venueLine(s)}${changeNote(s)}`) };
}
function cancellationEmail(s, slot) {
  return { subject: `Réservation annulée — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'Réservation annulée', `<p>Votre réservation a été annulée.</p>${slotLine(slot)}<p>À très bientôt pour une prochaine séance.</p>`) };
}
function reminderEmail(s, slot) {
  return { subject: `Rappel — ${slot.title || 'Pilates'} demain, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'C\'est pour demain', `<p>Petit rappel de votre séance :</p>${slotLine(slot)}${venueLine(s)}<p>Pensez à une tenue confortable. À demain !</p>`) };
}

// ---------- Public ----------

// Instagram : accepte un @pseudo ou une URL, renvoie une URL propre.
function instagramUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v.replace(/^@/, '')}`;
}

async function config(env) {
  const s = await loadStudio(env);
  return json({ studio_name: s.name, studio_email: s.email, studio_phone: s.phone, studio_instagram: instagramUrl(s.instagram), studio_address: s.address });
}

async function publicSlots(url, env) {
  const { from, to } = range(url);
  const start = new Date(Math.max(from, Date.now())).toISOString();
  const rows = await db(env, `classes?select=id,title,coach,starts_at,duration_minutes,capacity,price_cents,bookings(count)`
    + `&starts_at=gte.${encodeURIComponent(start)}&starts_at=lt.${encodeURIComponent(to.toISOString())}&order=starts_at`);
  return json(rows.map(({ bookings, ...slot }) => ({ ...slot, booked: bookings[0]?.count ?? 0 })));
}

async function book(request, env, ctx) {
  const { slot_id, name, email } = await request.json().catch(() => ({}));
  const cleanName = String(name || '').trim().slice(0, 100);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!UUID.test(slot_id || '') || !cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return json({ error: 'Merci de vérifier votre nom et votre e-mail.' }, 400);
  }
  try {
    const result = await db(env, 'rpc/book_class', { method: 'POST', body: JSON.stringify({ p_class_id: slot_id, p_name: cleanName, p_email: cleanEmail }) });
    const row = Array.isArray(result) ? result[0] : result;
    // Détails de la séance pour l'e-mail + le reçu renvoyé à l'appareil.
    const [slot] = await db(env, `classes?select=id,title,coach,starts_at,duration_minutes&id=eq.${slot_id}`);
    const origin = new URL(request.url).origin;
    if (slot) ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: cleanEmail, ...confirmationEmail(s, slot, origin) }); })());
    return json({ ok: true, id: row?.id, slot }, 201);
  } catch (err) {
    const d = err.detail || '';
    if (d.includes('LIMITE')) return json({ error: 'Vous avez déjà 3 réservations à venir sur cet appareil. Annulez-en une pour réserver.' }, 409);
    if (d.includes('COMPLET')) return json({ error: 'Ce créneau vient d’être complet.' }, 409);
    if (d.includes('duplicate')) return json({ error: 'Vous êtes déjà inscrite à ce créneau.' }, 409);
    if (d.includes('INTROUVABLE')) return json({ error: 'Ce créneau n’est plus disponible.' }, 404);
    throw err;
  }
}

// Réservations de CET appareil (identifiées par leurs ids, stockés localement).
async function myBookings(request, env) {
  const { ids } = await request.json().catch(() => ({}));
  const clean = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => UUID.test(id)).slice(0, 50);
  if (!clean.length) return json([]);
  const rows = await db(env, `bookings?select=id,guest_name,guest_email,classes(id,title,starts_at,duration_minutes)`
    + `&id=in.(${clean.join(',')})`);
  const out = rows
    .filter((r) => r.classes)
    .map((r) => ({ id: r.id, name: r.guest_name, email: r.guest_email, slot: r.classes }))
    .sort((a, b) => new Date(a.slot.starts_at) - new Date(b.slot.starts_at));
  return json(out);
}

// ---------- Admin ----------

async function flaggedEmails(env) {
  const rows = await db(env, 'late_cancellations?select=guest_email');
  const map = {};
  for (const r of rows) map[r.guest_email] = (map[r.guest_email] || 0) + 1;
  return map;
}

async function adminSlots(url, env) {
  const { from, to } = range(url);
  const slots = await db(env, `classes?select=*,bookings(id,guest_name,guest_email)`
    + `&starts_at=gte.${encodeURIComponent(from.toISOString())}&starts_at=lt.${encodeURIComponent(to.toISOString())}&order=starts_at`);
  return json({ slots, flagged: await flaggedEmails(env) });
}

async function createSlots(request, env) {
  const input = await request.json().catch(() => null);
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new HttpError(400, 'Créneaux invalides.');
  const rows = input.map((s) => {
    const starts = new Date(s.starts_at);
    const duration = Number(s.duration_minutes);
    const capacity = Number(s.capacity);
    const price = Math.round(Number(s.price_cents) || 0);
    if (starts < Date.now()) throw new HttpError(400, 'Ce créneau est dans le passé : les clientes ne le verraient pas.');
    if (isNaN(starts) || !Number.isInteger(duration) || duration < 10 || duration > 240
      || !Number.isInteger(capacity) || capacity < 1 || capacity > 100
      || price < 0 || price > 1000000) throw new HttpError(400, 'Créneau invalide.');
    return {
      starts_at: starts.toISOString(), duration_minutes: duration, capacity, price_cents: price,
      title: String(s.title || 'Pilates').trim().slice(0, 80) || 'Pilates',
      coach: String(s.coach || '').trim().slice(0, 80) || null,
    };
  });
  return json(await db(env, 'classes', { method: 'POST', body: JSON.stringify(rows) }), 201);
}

async function removeSlot(url, env) {
  const id = url.searchParams.get('id');
  if (!UUID.test(id || '')) throw new HttpError(400, 'Identifiant invalide.');
  await db(env, `classes?id=eq.${id}`, { method: 'DELETE' });
  return json({ ok: true });
}

// Retrait d'une réservation par le studio : e-mail d'annulation + flag si < 24h.
async function removeBooking(url, env, ctx) {
  const id = url.searchParams.get('id');
  if (!UUID.test(id || '')) throw new HttpError(400, 'Identifiant invalide.');
  const rows = await db(env, `bookings?select=id,guest_name,guest_email,classes(id,title,starts_at,duration_minutes)&id=eq.${id}`);
  const booking = rows[0];
  await db(env, `bookings?id=eq.${id}`, { method: 'DELETE' });
  let late = false;
  if (booking?.classes) {
    const slot = booking.classes;
    const startsAt = new Date(slot.starts_at).getTime();
    late = startsAt > Date.now() && startsAt - Date.now() < DAY;
    if (late) {
      ctx?.waitUntil?.(db(env, 'late_cancellations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        class_id: slot.id, guest_email: booking.guest_email, guest_name: booking.guest_name, starts_at: slot.starts_at,
      }) }).catch((e) => console.error('late flag', e)));
    }
    ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: booking.guest_email, ...cancellationEmail(s, slot) }); })());
  }
  return json({ ok: true, late });
}

async function report(env) {
  // shortcut: agrège en JS sur toutes les réservations ; passer à une vue SQL au-delà de ~10k réservations.
  const [rows, late] = await Promise.all([
    db(env, 'bookings?select=guest_name,guest_email,classes(starts_at)&order=created_at'),
    flaggedEmails(env),
  ]);
  const now = Date.now();
  const clients = new Map();
  for (const r of rows) {
    if (!r.classes) continue;
    const at = new Date(r.classes.starts_at).getTime();
    const c = clients.get(r.guest_email) || { name: r.guest_name, email: r.guest_email, total: 0, upcoming: 0, first: at, last: null, late: late[r.guest_email] || 0 };
    c.name = r.guest_name; // garde le nom le plus récent
    c.total += 1;
    if (at > now) c.upcoming += 1; else c.last = Math.max(c.last ?? 0, at);
    c.first = Math.min(c.first, at);
    clients.set(r.guest_email, c);
  }
  return json({
    clients: [...clients.values()].sort((a, b) => b.total - a.total),
    bookings: rows.filter((r) => r.classes).map((r) => r.classes.starts_at),
  });
}

// ---------- Prestations (catalogue) ----------

async function listServices(env) {
  return json(await db(env, 'services?select=*&order=sort,created_at'));
}

async function createService(request, env) {
  const s = await request.json().catch(() => ({}));
  const name = String(s.name || '').trim().slice(0, 80);
  const duration = Number(s.duration_minutes);
  const capacity = Number(s.capacity);
  const price = Math.round(Number(s.price_cents) || 0);
  if (!name || !Number.isInteger(duration) || duration < 10 || duration > 240
    || !Number.isInteger(capacity) || capacity < 1 || capacity > 100
    || price < 0 || price > 1000000) throw new HttpError(400, 'Prestation invalide.');
  const row = {
    name, duration_minutes: duration, capacity, price_cents: price,
    coach: String(s.coach || '').trim().slice(0, 80) || null,
    sort: Math.round(Number(s.sort) || 0),
  };
  return json(await db(env, 'services', { method: 'POST', body: JSON.stringify(row) }), 201);
}

async function removeService(url, env) {
  const id = url.searchParams.get('id');
  if (!UUID.test(id || '')) throw new HttpError(400, 'Identifiant invalide.');
  await db(env, `services?id=eq.${id}`, { method: 'DELETE' });
  return json({ ok: true });
}

// ---------- Dashboard financier ----------

function weekStartIso(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

async function finance(env) {
  // CA = somme des prix figés des séances, par réservation honorée (séance passée) ou à venir.
  const rows = await db(env, 'bookings?select=created_at,classes(starts_at,price_cents,title)&order=created_at');
  const now = Date.now();
  const weeks = new Map();   // lundi ISO -> { revenue, bookings }
  const services = new Map();
  let revenuePast = 0, revenueUpcoming = 0, bookingsUpcoming = 0;
  for (const r of rows) {
    if (!r.classes) continue;
    const at = new Date(r.classes.starts_at).getTime();
    const price = r.classes.price_cents || 0;
    const wk = weekStartIso(new Date(at));
    const w = weeks.get(wk) || { week: wk, revenue: 0, bookings: 0 };
    w.revenue += price; w.bookings += 1; weeks.set(wk, w);
    const title = r.classes.title || 'Pilates';
    const sv = services.get(title) || { title, revenue: 0, bookings: 0 };
    sv.revenue += price; sv.bookings += 1; services.set(title, sv);
    if (at > now) { revenueUpcoming += price; bookingsUpcoming += 1; } else revenuePast += price;
  }
  const thisWeek = weekStartIso(new Date(now));
  const weekList = [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, 12);
  return json({
    this_week: weeks.get(thisWeek) || { week: thisWeek, revenue: 0, bookings: 0 },
    revenue_past: revenuePast,
    revenue_upcoming: revenueUpcoming,
    bookings_upcoming: bookingsUpcoming,
    weeks: weekList,
    services: [...services.values()].sort((a, b) => b.revenue - a.revenue),
  });
}

// ---------- Studio (paramètres) ----------

async function getStudio(env) {
  return json(await loadStudio(env));
}

async function saveStudio(request, env) {
  const b = await request.json().catch(() => ({}));
  const field = (v, n) => { const s = String(v ?? '').trim().slice(0, n); return s || null; };
  const row = {
    singleton: true,
    name: field(b.name, 120), email: field(b.email, 160), phone: field(b.phone, 60),
    instagram: field(b.instagram, 160), address: field(b.address, 400),
    updated_at: new Date().toISOString(),
  };
  await db(env, 'studio_settings?on_conflict=singleton', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
  return json({ ok: true });
}

// Inscription manuelle d'une personne à un cours (par le studio).
async function addBooking(request, env, ctx) {
  const { class_id, name, email } = await request.json().catch(() => ({}));
  const cleanName = String(name || '').trim().slice(0, 100);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!UUID.test(class_id || '') || !cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new HttpError(400, 'Nom ou e-mail invalide.');
  }
  const [slot] = await db(env, `classes?select=id,title,coach,starts_at,duration_minutes,capacity,bookings(count)&id=eq.${class_id}`);
  if (!slot) throw new HttpError(404, 'Cours introuvable.');
  if ((slot.bookings?.[0]?.count ?? 0) >= slot.capacity) throw new HttpError(409, 'Cours complet : retirez une personne d’abord.');
  try {
    await db(env, 'bookings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ class_id, guest_name: cleanName, guest_email: cleanEmail }) });
  } catch (err) {
    if ((err.detail || '').includes('duplicate')) throw new HttpError(409, 'Cette personne est déjà inscrite à ce cours.');
    throw err;
  }
  ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: cleanEmail, ...confirmationEmail(s, slot) }); })());
  return json({ ok: true }, 201);
}

async function admin(request, url, env, ctx) {
  if (!(await isAdmin(request, env))) return json({ error: 'Mot de passe incorrect.' }, 401);
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/admin/slots') return adminSlots(url, env);
  if (route === 'POST /api/admin/slots') return createSlots(request, env);
  if (route === 'DELETE /api/admin/slots') return removeSlot(url, env);
  if (route === 'POST /api/admin/bookings') return addBooking(request, env, ctx);
  if (route === 'DELETE /api/admin/bookings') return removeBooking(url, env, ctx);
  if (route === 'GET /api/admin/report') return report(env);
  if (route === 'GET /api/admin/services') return listServices(env);
  if (route === 'POST /api/admin/services') return createService(request, env);
  if (route === 'DELETE /api/admin/services') return removeService(url, env);
  if (route === 'GET /api/admin/finance') return finance(env);
  if (route === 'GET /api/admin/studio') return getStudio(env);
  if (route === 'POST /api/admin/studio') return saveStudio(request, env);
  return json({ error: 'Introuvable.' }, 404);
}

// ---------- Rappels de la veille (Cron) ----------

async function sendReminders(env, ctx) {
  const now = Date.now();
  const fromIso = new Date(now + 23 * 3600000).toISOString();
  const toIso = new Date(now + 25 * 3600000).toISOString();
  const rows = await db(env, `bookings?select=id,guest_email,reminder_sent_at,classes!inner(title,starts_at,duration_minutes)`
    + `&reminder_sent_at=is.null&classes.starts_at=gte.${encodeURIComponent(fromIso)}&classes.starts_at=lt.${encodeURIComponent(toIso)}`);
  if (!rows.length) return;
  const s = await loadStudio(env);
  for (const r of rows) {
    await sendEmail(env, { to: r.guest_email, ...reminderEmail(s, r.classes) });
  }
  const ids = rows.map((r) => r.id);
  await db(env, `bookings?id=in.(${ids.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/ics' && request.method === 'GET') {
        return new Response(buildIcs(url.searchParams), { headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'attachment; filename="pilatelia.ics"',
          'cache-control': 'no-store',
        } });
      }
      if (url.pathname === '/api/config' && request.method === 'GET') return await config(env);
      if (url.pathname === '/api/slots' && request.method === 'GET') return await publicSlots(url, env);
      if (url.pathname === '/api/book' && request.method === 'POST') return await book(request, env, ctx);
      if (url.pathname === '/api/my' && request.method === 'POST') return await myBookings(request, env);
      if (url.pathname.startsWith('/api/admin/')) return await admin(request, url, env, ctx);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Introuvable.' }, 404);
    } catch (err) {
      if (err.detail) console.error(err.detail);
      let message = err instanceof HttpError ? err.message : 'Service indisponible.';
      // L'admin est protégée : on lui montre la vraie erreur Supabase pour pouvoir corriger.
      if (err.detail && url.pathname.startsWith('/api/admin/')) {
        try { message += ` (${JSON.parse(err.detail).message})`; } catch { message += ` (${err.detail.slice(0, 200)})`; }
      }
      return json({ error: message }, err.status || 500);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env, ctx).catch((e) => console.error('rappels', e)));
  },
};
