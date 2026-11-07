// Un seul Worker : sert /public et l'API. La clé Supabase reste côté serveur.
const json = (value, status = 200) => Response.json(value, { status });
const UUID = /^[0-9a-f-]{36}$/i;

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

// ---------- Public ----------

async function publicSlots(url, env) {
  const { from, to } = range(url);
  const start = new Date(Math.max(from, Date.now())).toISOString();
  const rows = await db(env, `classes?select=id,title,starts_at,duration_minutes,capacity,bookings(count)`
    + `&starts_at=gte.${encodeURIComponent(start)}&starts_at=lt.${encodeURIComponent(to.toISOString())}&order=starts_at`);
  return json(rows.map(({ bookings, ...slot }) => ({ ...slot, booked: bookings[0]?.count ?? 0 })));
}

async function book(request, env) {
  const { slot_id, name, email } = await request.json().catch(() => ({}));
  const cleanName = String(name || '').trim().slice(0, 100);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!UUID.test(slot_id || '') || !cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return json({ error: 'Merci de vérifier votre nom et votre e-mail.' }, 400);
  }
  try {
    await db(env, 'rpc/book_class', { method: 'POST', body: JSON.stringify({ p_class_id: slot_id, p_name: cleanName, p_email: cleanEmail }) });
    return json({ ok: true }, 201);
  } catch (err) {
    const d = err.detail || '';
    if (d.includes('COMPLET')) return json({ error: 'Ce créneau vient d’être complet.' }, 409);
    if (d.includes('duplicate')) return json({ error: 'Vous êtes déjà inscrite à ce créneau.' }, 409);
    if (d.includes('INTROUVABLE')) return json({ error: 'Ce créneau n’est plus disponible.' }, 404);
    throw err;
  }
}

// ---------- Admin ----------

async function adminSlots(url, env) {
  const { from, to } = range(url);
  return json(await db(env, `classes?select=*,bookings(id,guest_name,guest_email)`
    + `&starts_at=gte.${encodeURIComponent(from.toISOString())}&starts_at=lt.${encodeURIComponent(to.toISOString())}&order=starts_at`));
}

async function createSlots(request, env) {
  const input = await request.json().catch(() => null);
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new HttpError(400, 'Créneaux invalides.');
  const rows = input.map((s) => {
    const starts = new Date(s.starts_at);
    const duration = Number(s.duration_minutes);
    const capacity = Number(s.capacity);
    if (isNaN(starts) || !Number.isInteger(duration) || duration < 10 || duration > 240
      || !Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new HttpError(400, 'Créneau invalide.');
    return { starts_at: starts.toISOString(), duration_minutes: duration, capacity, title: String(s.title || 'Pilates').trim().slice(0, 80) || 'Pilates' };
  });
  return json(await db(env, 'classes', { method: 'POST', body: JSON.stringify(rows) }), 201);
}

async function remove(table, url, env) {
  const id = url.searchParams.get('id');
  if (!UUID.test(id || '')) throw new HttpError(400, 'Identifiant invalide.');
  await db(env, `${table}?id=eq.${id}`, { method: 'DELETE' });
  return json({ ok: true });
}

async function report(env) {
  // shortcut: agrège en JS sur toutes les réservations ; passer à une vue SQL au-delà de ~10k réservations.
  const rows = await db(env, 'bookings?select=guest_name,guest_email,classes(starts_at)&order=created_at');
  const now = Date.now();
  const clients = new Map();
  for (const r of rows) {
    const at = new Date(r.classes.starts_at).getTime();
    const c = clients.get(r.guest_email) || { name: r.guest_name, email: r.guest_email, total: 0, upcoming: 0, first: at, last: null };
    c.name = r.guest_name; // garde le nom le plus récent
    c.total += 1;
    if (at > now) c.upcoming += 1; else c.last = Math.max(c.last ?? 0, at);
    c.first = Math.min(c.first, at);
    clients.set(r.guest_email, c);
  }
  return json({
    clients: [...clients.values()].sort((a, b) => b.total - a.total),
    bookings: rows.map((r) => r.classes.starts_at),
  });
}

async function admin(request, url, env) {
  if (!(await isAdmin(request, env))) return json({ error: 'Mot de passe incorrect.' }, 401);
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/admin/slots') return adminSlots(url, env);
  if (route === 'POST /api/admin/slots') return createSlots(request, env);
  if (route === 'DELETE /api/admin/slots') return remove('classes', url, env);
  if (route === 'DELETE /api/admin/bookings') return remove('bookings', url, env);
  if (route === 'GET /api/admin/report') return report(env);
  return json({ error: 'Introuvable.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/slots' && request.method === 'GET') return await publicSlots(url, env);
      if (url.pathname === '/api/book' && request.method === 'POST') return await book(request, env);
      if (url.pathname.startsWith('/api/admin/')) return await admin(request, url, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Introuvable.' }, 404);
    } catch (err) {
      if (err.detail) console.error(err.detail);
      return json({ error: err instanceof HttpError ? err.message : 'Service indisponible.' }, err.status || 500);
    }
    return env.ASSETS.fetch(request);
  },
};
