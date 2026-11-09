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
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso));

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

function emailShell(env, title, bodyHtml) {
  const s = studio(env);
  const contact = [s.email && `<a href="mailto:${esc(s.email)}" style="color:#8f4a63">${esc(s.email)}</a>`, s.phone && esc(s.phone)]
    .filter(Boolean).join(' · ');
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#faf6f1;padding:24px 0;color:#2c2420">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e7dccf;border-radius:22px;overflow:hidden">
      <div style="background:#f6e7ec;padding:22px 26px">
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#8f4a63;font-weight:700">Pilatelia</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px">${esc(title)}</div>
      </div>
      <div style="padding:24px 26px;font-size:15px;line-height:22px">${bodyHtml}</div>
      <div style="padding:16px 26px;background:#f3ebe2;font-size:13px;color:#6f645b">
        ${s.name}${contact ? ` — ${contact}` : ''}
      </div>
    </div>
  </div>`;
}

const slotLine = (slot) =>
  `<div style="background:#f6e7ec;border-radius:16px;padding:16px;margin:14px 0">
    <div style="font-size:17px;font-weight:700">${esc(slot.title || 'Pilates')}</div>
    <div style="color:#6f645b;margin-top:4px">${esc(fmtDate(slot.starts_at))} · ${slot.duration_minutes} min</div>
  </div>`;

const changeNote = (env) => {
  const s = studio(env);
  const how = [s.email && `par e-mail (${esc(s.email)})`, s.phone && `par téléphone (${esc(s.phone)})`].filter(Boolean).join(' ou ');
  return `<p style="color:#6f645b">Pour modifier ou annuler, contactez le studio${how ? ` ${how}` : ''}. Une modification n'est plus possible dans les 24h avant la séance ; l'annulation reste possible à tout moment.</p>`;
};

function confirmationEmail(env, slot) {
  return { subject: `C'est réservé — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(env, 'C\'est réservé !', `<p>Votre place est gardée. On a hâte de vous voir au studio.</p>${slotLine(slot)}${changeNote(env)}`) };
}
function cancellationEmail(env, slot) {
  return { subject: `Réservation annulée — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(env, 'Réservation annulée', `<p>Votre réservation a été annulée.</p>${slotLine(slot)}<p>À très bientôt pour une prochaine séance.</p>`) };
}
function reminderEmail(env, slot) {
  return { subject: `Rappel — ${slot.title || 'Pilates'} demain, ${fmtDate(slot.starts_at)}`,
    html: emailShell(env, 'C\'est pour demain', `<p>Petit rappel de votre séance :</p>${slotLine(slot)}<p>Pensez à une tenue confortable. À demain !</p>`) };
}

// ---------- Public ----------

async function config(env) {
  const s = studio(env);
  return json({ studio_name: s.name, studio_email: s.email, studio_phone: s.phone });
}

async function publicSlots(url, env) {
  const { from, to } = range(url);
  const start = new Date(Math.max(from, Date.now())).toISOString();
  const rows = await db(env, `classes?select=id,title,starts_at,duration_minutes,capacity,bookings(count)`
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
    const [slot] = await db(env, `classes?select=id,title,starts_at,duration_minutes&id=eq.${slot_id}`);
    if (slot) ctx?.waitUntil?.(sendEmail(env, { to: cleanEmail, ...confirmationEmail(env, slot) }));
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
    if (starts < Date.now()) throw new HttpError(400, 'Ce créneau est dans le passé : les clientes ne le verraient pas.');
    if (isNaN(starts) || !Number.isInteger(duration) || duration < 10 || duration > 240
      || !Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new HttpError(400, 'Créneau invalide.');
    return { starts_at: starts.toISOString(), duration_minutes: duration, capacity, title: String(s.title || 'Pilates').trim().slice(0, 80) || 'Pilates' };
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
    ctx?.waitUntil?.(sendEmail(env, { to: booking.guest_email, ...cancellationEmail(env, slot) }));
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

async function admin(request, url, env, ctx) {
  if (!(await isAdmin(request, env))) return json({ error: 'Mot de passe incorrect.' }, 401);
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/admin/slots') return adminSlots(url, env);
  if (route === 'POST /api/admin/slots') return createSlots(request, env);
  if (route === 'DELETE /api/admin/slots') return removeSlot(url, env);
  if (route === 'DELETE /api/admin/bookings') return removeBooking(url, env, ctx);
  if (route === 'GET /api/admin/report') return report(env);
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
  for (const r of rows) {
    await sendEmail(env, { to: r.guest_email, ...reminderEmail(env, r.classes) });
  }
  const ids = rows.map((r) => r.id);
  await db(env, `bookings?id=in.(${ids.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
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
