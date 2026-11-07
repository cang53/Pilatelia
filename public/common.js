// Helpers partagés par la page publique et l'admin.
const fmt = {
  day: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
  short: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }),
  date: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
  month: new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }),
  time: new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }),
};
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = (d) => d.toLocaleDateString('en-CA'); // AAAA-MM-JJ en heure locale
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const weekLabel = (monday) => `${fmt.short.format(monday)} – ${fmt.short.format(addDays(monday, 6))}`;
const weekQuery = (monday) => `from=${monday.toISOString()}&to=${addDays(monday, 7).toISOString()}`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'Erreur réseau, réessayez.'), { status: res.status });
  return body;
}

function byDay(slots) {
  const days = new Map();
  for (const s of slots) {
    const key = ymd(new Date(s.starts_at));
    days.set(key, [...(days.get(key) || []), s]);
  }
  return days;
}
