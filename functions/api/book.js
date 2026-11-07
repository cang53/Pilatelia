export async function onRequestPost({ request, env }) {
  try {
    const { class_id, name, email } = await request.json();
    if (!class_id || !name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '')) return Response.json({ error: 'Informations invalides.' }, { status: 400 });
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/book_class`, { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_class_id: class_id, p_name: name.trim(), p_email: email.trim().toLowerCase() }) });
    if (!response.ok) { const detail = await response.text(); return Response.json({ error: detail.includes('complet') ? 'Cette séance vient d’être complète.' : 'Réservation impossible.' }, { status: response.status }); }
    return Response.json(await response.json(), { status: 201 });
  } catch { return Response.json({ error: 'Requête invalide.' }, { status: 400 }); }
}
