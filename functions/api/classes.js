export async function onRequestGet({ request, env }) {
  const date = new URL(request.url).searchParams.get('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return Response.json({ error: 'Date invalide' }, { status: 400 });
  const url = `${env.SUPABASE_URL}/rest/v1/class_availability?date=eq.${date}&order=starts_at.asc`;
  const response = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } });
}
