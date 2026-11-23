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

// Suppressions via les fonctions SQL v7 : la réservation part dans la corbeille
// (deleted_bookings, 7 jours) avec le motif affiché dans le journal de l'admin.
const deleteBookingRow = (env, id, reason) => db(env, 'rpc/delete_booking', { method: 'POST', body: JSON.stringify({ p_id: id, p_reason: reason }) });
const deleteClassRows = (env, ids, reason) => db(env, 'rpc/delete_classes', { method: 'POST', body: JSON.stringify({ p_ids: ids, p_reason: reason }) });
const KEEP_DELETED_DAYS = 7;

function range(url) {
  const from = new Date(url.searchParams.get('from'));
  const to = new Date(url.searchParams.get('to'));
  if (isNaN(from) || isNaN(to) || to <= from) throw new HttpError(400, 'Période invalide.');
  return { from, to };
}

// ---------- Mot de passe admin ----------
// Le mot de passe modifié depuis l'admin est stocké haché (PBKDF2) dans studio_settings.
// Tant qu'aucun n'est enregistré, c'est la variable d'env ADMIN_PASSWORD qui fait foi.
const PBKDF2_ITER = 20000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha256 = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));

async function pbkdf2(password, salt, iter) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}

// Cache mémoire des vérifications réussies (évite de recalculer PBKDF2 à chaque appel).
const verified = new Map(); // stored hash -> empreinte SHA-256 du mot de passe saisi

async function checkPassword(password, stored) {
  const [, iter, salt, expected] = String(stored).split('$');
  if (!iter || !salt || !expected) return false;
  const fp = b64(await sha256(password));
  if (verified.get(stored) === fp) return true;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(expected).buffer;
  const ok = got.byteLength === want.byteLength && crypto.subtle.timingSafeEqual(got, want);
  if (ok) { verified.clear(); verified.set(stored, fp); }
  return ok;
}

async function storedPasswordHash(env) {
  try {
    const rows = await db(env, 'studio_settings?select=admin_password_hash&limit=1');
    return rows?.[0]?.admin_password_hash || null;
  } catch { return null; } // colonne absente avant migration v5
}

async function passwordMatches(password, env) {
  const stored = await storedPasswordHash(env);
  if (stored) return checkPassword(password, stored);
  if (!env.ADMIN_PASSWORD) return false;
  const [a, b] = await Promise.all([sha256(password), sha256(env.ADMIN_PASSWORD)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const isAdmin = (request, env) => passwordMatches(request.headers.get('x-admin-key') || '', env);

async function changePassword(request, env) {
  const { current, next } = await request.json().catch(() => ({}));
  const pwd = String(next || '');
  if (!(await passwordMatches(String(current || ''), env))) throw new HttpError(400, 'Mot de passe actuel incorrect.');
  if (pwd.length < 6 || pwd.length > 200) throw new HttpError(400, 'Le nouveau mot de passe doit faire au moins 6 caractères.');
  await db(env, 'studio_settings?on_conflict=singleton', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ singleton: true, admin_password_hash: await hashPassword(pwd), updated_at: new Date().toISOString() }),
  });
  verified.clear();
  return json({ ok: true });
}

// ---------- Téléphone / WhatsApp ----------
const cleanPhone = (v) => String(v || '').trim().slice(0, 40);
const validPhone = (v) => /^\+?[\d\s.\-/()]+$/.test(v) && v.replace(/\D/g, '').length >= 8 && v.replace(/\D/g, '').length <= 15;
// Numéro international pour wa.me (sans +). Numéro national (0…) → Belgique (+32).
function waNumber(raw) {
  const v = String(raw || '').trim();
  const d = v.replace(/\D/g, '');
  if (!d) return '';
  if (v.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return `32${d.slice(1)}`;
  return d;
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
// Version texte brut (améliore la délivrabilité : e-mail multipart, moins de spam).
const htmlToText = (html) => String(html)
  .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>(?=)/gi, '\n')
  .replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(`[email non configuré] à ${to} : ${subject}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text: htmlToText(html) }),
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
const payLine = `<div style="background:#e6ecd9;border-radius:16px;padding:14px 16px;margin:14px 0;font-size:14px"><b>💳 Paiement sur place</b><br>Rien à payer en ligne : vous réglez au studio, le jour de la séance.</div>`;

const venueLine = (s) => s.address
  ? `<div style="background:#e6ecd9;border-radius:16px;padding:14px 16px;margin:14px 0;font-size:14px"><b>Adresse</b><br>${esc(s.address)}</div>`
  : '';

const slotLine = (slot) =>
  `<div style="background:#ebdfcd;border-radius:16px;padding:16px;margin:14px 0">
    <div style="font-size:17px;font-weight:700">${esc(slot.title || 'Pilates')}</div>
    <div style="color:#7b6b56;margin-top:4px">${esc(fmtDate(slot.starts_at))} · ${slot.duration_minutes} min</div>
  </div>`;

// Adresse du site : SITE_URL (utile pour le cron, qui n'a pas de requête), sinon l'origine de la requête.
const siteUrl = (env, request) => (env.SITE_URL || (request ? new URL(request.url).origin : '')).replace(/\/+$/, '');

// Lien « magique » : ouvre le site sur « Ma réservation » et rattache la/les réservation(s)
// au navigateur qui l'ouvre (utile quand la cliente a réservé depuis Instagram, dont le
// navigateur intégré ne partage pas sa mémoire avec Safari / Chrome).
const manageUrl = (origin, ids) => `${origin}/?r=${[].concat(ids).join(',')}`;
const manageButton = (origin, ids, label = 'Modifier ou annuler ma réservation') => (origin && ids && [].concat(ids).length)
  ? `<div style="margin:18px 0 6px;text-align:center">
      <a href="${esc(manageUrl(origin, ids))}" style="display:inline-block;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:999px;background:#6e4d32;color:#fdf7ec">✏️ ${esc(label)}</a>
    </div>`
  : '';

const changeNote = (s, canManage) => {
  const wa = waNumber(s.phone);
  const how = s.phone
    ? ` au ${esc(s.phone)} ou écrivez-nous sur <a href="https://wa.me/${wa}" style="color:#25a55f;font-weight:700">WhatsApp</a>`
    : '';
  const where = canManage ? 'avec le bouton ci-dessus' : 'depuis le site';
  return `<p style="color:#7b6b56">Vous pouvez modifier ou annuler votre séance ${where} jusqu'à 24h avant. En cas de souci, appelez le studio${how}.</p>`;
};

function confirmationEmail(s, slot, origin, id) {
  return { subject: `C'est réservé — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'C\'est réservé !', `<p>Votre place est gardée. On a hâte de vous voir au studio.</p>${slotLine(slot)}${payLine}${calendarButtons(s, slot, origin)}${venueLine(s)}${manageButton(origin, id)}${changeNote(s, !!(origin && id))}`) };
}
function cancellationEmail(s, slot) {
  return { subject: `Réservation annulée — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'Réservation annulée', `<p>Votre réservation a été annulée.</p>${slotLine(slot)}<p>À très bientôt pour une prochaine séance.</p>`) };
}
function movedEmail(s, slot, oldStart, origin, id) {
  return { subject: `Séance déplacée — ${slot.title || 'Pilates'}, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'Votre séance a été déplacée', `<p>Le studio a déplacé votre séance initialement prévue ${esc(fmtDate(oldStart))}. Votre place est gardée au nouvel horaire :</p>${slotLine(slot)}${venueLine(s)}${manageButton(origin, id)}${changeNote(s, !!(origin && id))}`) };
}
function reminderEmail(s, slot, origin, id) {
  return { subject: `Rappel — ${slot.title || 'Pilates'} demain, ${fmtDate(slot.starts_at)}`,
    html: emailShell(s, 'C\'est pour demain', `<p>Petit rappel de votre séance :</p>${slotLine(slot)}${venueLine(s)}<p>Pensez à une tenue confortable. À demain !</p>${manageButton(origin, id, 'Voir ma réservation')}`) };
}
function recoverEmail(s, rows, origin) {
  const list = rows.map((r) => slotLine(r.classes)).join('');
  return { subject: `Vos réservations — ${s.name || 'Pilatelia'}`,
    html: emailShell(s, 'Vos réservations', `<p>Voici vos séances à venir. Appuyez sur le bouton pour les retrouver sur ce téléphone et les modifier si besoin.</p>${list}${manageButton(origin, rows.map((r) => r.id), 'Voir mes réservations')}${changeNote(s, true)}`) };
}

// ---------- Public ----------

// Instagram : accepte un @pseudo ou une URL, renvoie une URL propre.
function instagramUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.replace(/^(https?:\/\/)(instagram\.com)/i, '$1www.$2');
  return `https://www.instagram.com/${v.replace(/^@/, '')}`;
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
  const { slot_id, name, email, phone } = await request.json().catch(() => ({}));
  const cleanName = String(name || '').trim().slice(0, 100);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const phoneNum = cleanPhone(phone);
  if (!UUID.test(slot_id || '') || !cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return json({ error: 'Merci de vérifier votre nom et votre e-mail.' }, 400);
  }
  if (!validPhone(phoneNum)) return json({ error: 'Merci d’indiquer un numéro de téléphone valide.' }, 400);
  try {
    const result = await db(env, 'rpc/book_class', { method: 'POST', body: JSON.stringify({ p_class_id: slot_id, p_name: cleanName, p_email: cleanEmail, p_phone: phoneNum }) });
    const row = Array.isArray(result) ? result[0] : result;
    // Détails de la séance pour l'e-mail + le reçu renvoyé à l'appareil.
    const [slot] = await db(env, `classes?select=id,title,coach,starts_at,duration_minutes&id=eq.${slot_id}`);
    const origin = siteUrl(env, request);
    if (slot) ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: cleanEmail, ...confirmationEmail(s, slot, origin, row?.id) }); })());
    return json({ ok: true, id: row?.id, slot }, 201);
  } catch (err) {
    const d = err.detail || '';
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

// « Retrouver mes réservations » : la cliente saisit son e-mail, on lui envoie un lien
// qui rattache ses séances à venir au navigateur qui l'ouvre. Réponse toujours identique
// (on ne révèle pas si l'e-mail a des réservations).
async function recoverBookings(request, env, ctx) {
  const { email } = await request.json().catch(() => ({}));
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return json({ error: 'Merci de vérifier votre e-mail.' }, 400);
  const rows = await db(env, `bookings?select=id,classes!inner(title,starts_at,duration_minutes)`
    + `&guest_email=eq.${encodeURIComponent(cleanEmail)}&classes.starts_at=gte.${encodeURIComponent(new Date().toISOString())}`);
  rows.sort((a, b) => new Date(a.classes.starts_at) - new Date(b.classes.starts_at));
  const origin = siteUrl(env, request);
  if (rows.length) ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: cleanEmail, ...recoverEmail(s, rows.slice(0, 40), origin) }); })());
  return json({ ok: true });
}

// Annulation / déplacement en autonomie depuis l'appareil : autorisé seulement
// à plus de 24h de la séance. En deçà, il faut passer par le studio.
async function cancelBooking(request, env, ctx) {
  const { id } = await request.json().catch(() => ({}));
  if (!UUID.test(id || '')) return json({ error: 'Identifiant invalide.' }, 400);
  const rows = await db(env, `bookings?select=id,guest_name,guest_email,classes(id,title,starts_at,duration_minutes)&id=eq.${id}`);
  const booking = rows[0];
  if (!booking) return json({ error: 'Réservation introuvable.' }, 404);
  const slot = booking.classes;
  if (slot && new Date(slot.starts_at).getTime() - Date.now() < DAY) {
    return json({ error: 'Modification possible en ligne jusqu’à 24h avant la séance. En cas de souci, appelez le studio ou écrivez-nous sur WhatsApp.' }, 409);
  }
  await deleteBookingRow(env, id, 'Annulée par la cliente');
  if (slot) ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: booking.guest_email, ...cancellationEmail(s, slot) }); })());
  return json({ ok: true });
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
  const slots = await db(env, `classes?select=*,bookings(id,guest_name,guest_email,guest_phone)`
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
  await deleteClassRows(env, [id], 'Cours supprimé par le studio');
  return json({ ok: true });
}

// Déplacer / modifier un cours. Les inscrites sont prévenues par e-mail si l'horaire change.
async function updateSlot(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  if (!UUID.test(b.id || '')) throw new HttpError(400, 'Identifiant invalide.');
  const [slot] = await db(env, `classes?select=*,bookings(id,guest_email)&id=eq.${b.id}`);
  const origin = siteUrl(env, request);
  if (!slot) throw new HttpError(404, 'Cours introuvable.');
  const patch = {};
  if (b.starts_at !== undefined) {
    const starts = new Date(b.starts_at);
    if (isNaN(starts)) throw new HttpError(400, 'Date invalide.');
    if (starts < Date.now()) throw new HttpError(400, 'Impossible de déplacer un cours dans le passé.');
    patch.starts_at = starts.toISOString();
  }
  if (b.duration_minutes !== undefined) {
    const d = Number(b.duration_minutes);
    if (!Number.isInteger(d) || d < 10 || d > 240) throw new HttpError(400, 'Durée invalide.');
    patch.duration_minutes = d;
  }
  if (b.capacity !== undefined) {
    const c = Number(b.capacity);
    if (!Number.isInteger(c) || c < 1 || c > 100) throw new HttpError(400, 'Nombre de places invalide.');
    if (c < slot.bookings.length) throw new HttpError(400, `Déjà ${slot.bookings.length} inscrites : impossible de descendre à ${c} places.`);
    patch.capacity = c;
  }
  if (!Object.keys(patch).length) return json({ ok: true });
  const moved = patch.starts_at && new Date(patch.starts_at).getTime() !== new Date(slot.starts_at).getTime();
  await db(env, `classes?id=eq.${b.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  if (moved && slot.bookings.length) {
    // Le rappel de la veille doit repartir pour le nouvel horaire.
    await db(env, `bookings?class_id=eq.${b.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ reminder_sent_at: null }) });
    const updated = { ...slot, ...patch };
    ctx?.waitUntil?.((async () => {
      const s = await loadStudio(env);
      for (const bk of slot.bookings) await sendEmail(env, { to: bk.guest_email, ...movedEmail(s, updated, slot.starts_at, origin, bk.id) });
    })());
  }
  return json({ ok: true, notified: moved ? slot.bookings.length : 0 });
}

// Vider une semaine : supprime les cours À VENIR de la période (les cours passés restent
// pour l'historique et les finances). Les inscrites reçoivent un e-mail d'annulation.
async function clearSlots(url, env, ctx) {
  const { from, to } = range(url);
  const start = new Date(Math.max(from, Date.now())).toISOString();
  const slots = await db(env, `classes?select=id,title,starts_at,duration_minutes,bookings(guest_email)`
    + `&starts_at=gte.${encodeURIComponent(start)}&starts_at=lt.${encodeURIComponent(to.toISOString())}`);
  if (!slots.length) return json({ ok: true, deleted: 0, notified: 0 });
  await deleteClassRows(env, slots.map((s) => s.id), 'Semaine vidée par le studio');
  const notices = slots.flatMap((s) => s.bookings.map((b) => ({ to: b.guest_email, slot: s })));
  if (notices.length) ctx?.waitUntil?.((async () => {
    const s = await loadStudio(env);
    for (const n of notices) await sendEmail(env, { to: n.to, ...cancellationEmail(s, n.slot) });
  })());
  return json({ ok: true, deleted: slots.length, notified: notices.length });
}

// Retrait d'une réservation par le studio : e-mail d'annulation + flag si < 24h.
async function removeBooking(url, env, ctx) {
  const id = url.searchParams.get('id');
  if (!UUID.test(id || '')) throw new HttpError(400, 'Identifiant invalide.');
  const rows = await db(env, `bookings?select=id,guest_name,guest_email,guest_phone,classes(id,title,starts_at,duration_minutes)&id=eq.${id}`);
  const booking = rows[0];
  await deleteBookingRow(env, id, 'Retirée par le studio');
  let late = false;
  if (booking?.classes) {
    const slot = booking.classes;
    const startsAt = new Date(slot.starts_at).getTime();
    late = startsAt > Date.now() && startsAt - Date.now() < DAY;
    if (late) {
      ctx?.waitUntil?.(db(env, 'late_cancellations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        class_id: slot.id, guest_email: booking.guest_email, guest_name: booking.guest_name, guest_phone: booking.guest_phone || null, starts_at: slot.starts_at,
      }) }).catch((e) => console.error('late flag', e)));
    }
    ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: booking.guest_email, ...cancellationEmail(s, slot) }); })());
  }
  return json({ ok: true, late });
}

async function report(env) {
  // shortcut: agrège en JS sur toutes les réservations ; passer à une vue SQL au-delà de ~10k réservations.
  const [rows, late] = await Promise.all([
    db(env, 'bookings?select=guest_name,guest_email,guest_phone,classes(starts_at)&order=created_at'),
    flaggedEmails(env),
  ]);
  const now = Date.now();
  const clients = new Map();
  for (const r of rows) {
    if (!r.classes) continue;
    const at = new Date(r.classes.starts_at).getTime();
    const c = clients.get(r.guest_email) || { name: r.guest_name, email: r.guest_email, phone: '', total: 0, upcoming: 0, first: at, last: null, late: late[r.guest_email] || 0 };
    c.name = r.guest_name; // garde le nom le plus récent
    if (r.guest_phone) c.phone = r.guest_phone; // et le dernier numéro connu
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

// Fond de la story Instagram (image JPEG redimensionnée côté navigateur, stockée en data URL).
async function getStoryBg(env) {
  const rows = await db(env, 'studio_settings?select=story_bg&limit=1');
  return json({ image: rows?.[0]?.story_bg || null });
}

async function saveStoryBg(request, env) {
  const { image } = await request.json().catch(() => ({}));
  if (image !== null && !(typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) && image.length < 4_000_000)) {
    throw new HttpError(400, 'Image invalide ou trop lourde.');
  }
  await db(env, 'studio_settings?on_conflict=singleton', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ singleton: true, story_bg: image, updated_at: new Date().toISOString() }),
  });
  return json({ ok: true });
}

// Inscription manuelle d'une personne à un cours (par le studio).
async function addBooking(request, env, ctx) {
  const { class_id, name, email, phone } = await request.json().catch(() => ({}));
  const cleanName = String(name || '').trim().slice(0, 100);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const phoneNum = cleanPhone(phone);
  if (!UUID.test(class_id || '') || !cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new HttpError(400, 'Nom ou e-mail invalide.');
  }
  if (!validPhone(phoneNum)) throw new HttpError(400, 'Numéro de téléphone invalide.');
  const [slot] = await db(env, `classes?select=id,title,coach,starts_at,duration_minutes,capacity,bookings(count)&id=eq.${class_id}`);
  if (!slot) throw new HttpError(404, 'Cours introuvable.');
  if ((slot.bookings?.[0]?.count ?? 0) >= slot.capacity) throw new HttpError(409, 'Cours complet : retirez une personne d’abord.');
  let created;
  try {
    [created] = await db(env, 'bookings', { method: 'POST', body: JSON.stringify({ class_id, guest_name: cleanName, guest_email: cleanEmail, guest_phone: phoneNum }) });
  } catch (err) {
    if ((err.detail || '').includes('duplicate')) throw new HttpError(409, 'Cette personne est déjà inscrite à ce cours.');
    throw err;
  }
  const origin = siteUrl(env, request);
  ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: cleanEmail, ...confirmationEmail(s, slot, origin, created?.id) }); })());
  return json({ ok: true }, 201);
}

// ---------- Journal des suppressions (corbeille 7 jours) ----------

async function deletedLog(env) {
  const since = new Date(Date.now() - KEEP_DELETED_DAYS * DAY).toISOString();
  const rows = await db(env, `deleted_bookings?select=*&deleted_at=gte.${encodeURIComponent(since)}&order=deleted_at.desc&limit=300`);
  const ids = [...new Set(rows.map((r) => r.class_id).filter(Boolean))];
  const alive = ids.length ? await db(env, `classes?select=id,capacity,bookings(count)&id=in.(${ids.join(',')})`) : [];
  const byId = new Map(alive.map((c) => [c.id, c]));
  return json({ keep_days: KEEP_DELETED_DAYS, items: rows.map((r) => {
    const c = byId.get(r.class_id);
    return { ...r, class_exists: !!c, class_full: !!c && (c.bookings?.[0]?.count ?? 0) >= c.capacity };
  }) });
}

async function restoreBooking(request, env, ctx) {
  const { id } = await request.json().catch(() => ({}));
  if (!UUID.test(id || '')) throw new HttpError(400, 'Identifiant invalide.');
  let row;
  try {
    row = await db(env, 'rpc/restore_booking', { method: 'POST', body: JSON.stringify({ p_id: id }) });
  } catch (err) {
    const d = err.detail || '';
    if (d.includes('INTROUVABLE')) throw new HttpError(404, 'Cette réservation n’est plus dans la corbeille.');
    if (d.includes('COURS_SUPPRIME')) throw new HttpError(409, 'Le cours a été supprimé : recréez-le dans l’agenda puis inscrivez la cliente.');
    if (d.includes('DEJA_INSCRITE')) throw new HttpError(409, 'Cette cliente est déjà réinscrite à ce cours.');
    if (d.includes('COMPLET')) throw new HttpError(409, 'Le cours est complet : libérez une place d’abord.');
    throw err;
  }
  const booking = Array.isArray(row) ? row[0] : row;
  const [slot] = await db(env, `classes?select=id,title,coach,starts_at,duration_minutes&id=eq.${booking.class_id}`);
  // Elle a reçu un e-mail d'annulation : on lui renvoie la confirmation (si le cours est à venir).
  const notify = slot && new Date(slot.starts_at) > Date.now();
  if (notify) {
    const origin = siteUrl(env, request);
    ctx?.waitUntil?.((async () => { const s = await loadStudio(env); await sendEmail(env, { to: booking.guest_email, ...confirmationEmail(s, slot, origin, booking.id) }); })());
  }
  return json({ ok: true, notified: !!notify, starts_at: slot?.starts_at });
}

async function purgeDeleted(env) {
  const before = new Date(Date.now() - KEEP_DELETED_DAYS * DAY).toISOString();
  await db(env, `deleted_bookings?deleted_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

async function admin(request, url, env, ctx) {
  if (!(await isAdmin(request, env))) return json({ error: 'Mot de passe incorrect.' }, 401);
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/admin/slots') return adminSlots(url, env);
  if (route === 'POST /api/admin/slots') return createSlots(request, env);
  if (route === 'PATCH /api/admin/slots') return updateSlot(request, env, ctx);
  if (route === 'DELETE /api/admin/slots') return url.searchParams.has('id') ? removeSlot(url, env) : clearSlots(url, env, ctx);
  if (route === 'POST /api/admin/password') return changePassword(request, env);
  if (route === 'GET /api/admin/story-bg') return getStoryBg(env);
  if (route === 'POST /api/admin/story-bg') return saveStoryBg(request, env);
  if (route === 'POST /api/admin/bookings') return addBooking(request, env, ctx);
  if (route === 'DELETE /api/admin/bookings') return removeBooking(url, env, ctx);
  if (route === 'GET /api/admin/report') return report(env);
  if (route === 'GET /api/admin/deleted') return deletedLog(env);
  if (route === 'POST /api/admin/deleted/restore') return restoreBooking(request, env, ctx);
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
  const origin = siteUrl(env); // pas de requête dans le cron : bouton seulement si SITE_URL est défini
  for (const r of rows) {
    await sendEmail(env, { to: r.guest_email, ...reminderEmail(s, r.classes, origin, r.id) });
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
      if (url.pathname === '/api/cancel' && request.method === 'POST') return await cancelBooking(request, env, ctx);
      if (url.pathname === '/api/recover' && request.method === 'POST') return await recoverBookings(request, env, ctx);
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
    ctx.waitUntil(purgeDeleted(env).catch((e) => console.error('corbeille', e)));
  },
};
