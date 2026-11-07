const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

function credentials(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('Supabase non configuré');
  return { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` };
}

async function listClasses(request, env) {
  const date = new URL(request.url).searchParams.get('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return json({ error: 'Date invalide' }, 400);
  try {
    const endpoint = `${env.SUPABASE_URL}/rest/v1/class_availability?date=eq.${date}&order=starts_at.asc`;
    const result = await fetch(endpoint, { headers: credentials(env) });
    return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
  } catch { return json({ error: 'Service temporairement indisponible.' }, 503); }
}

async function bookClass(request, env) {
  try {
    const { class_id, name, email } = await request.json();
    if (!class_id || !name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '')) return json({ error: 'Informations invalides.' }, 400);
    const result = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/book_class`, {
      method: 'POST', headers: { ...credentials(env), 'content-type': 'application/json' },
      body: JSON.stringify({ p_class_id: class_id, p_name: name.trim(), p_email: email.trim().toLowerCase() })
    });
    if (!result.ok) {
      const detail = await result.text();
      return json({ error: detail.includes('complet') ? 'Cette séance vient d’être complète.' : 'Réservation impossible.' }, result.status);
    }
    return json(await result.json(), 201);
  } catch { return json({ error: 'Requête invalide ou service indisponible.' }, 400); }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/classes' && request.method === 'GET') return listClasses(request, env);
    if (pathname === '/api/book' && request.method === 'POST') return bookClass(request, env);
    return env.ASSETS.fetch(request);
  }
};
