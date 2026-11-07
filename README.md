# Pilatelia — réservations Pilates

- **`/`** : les clientes voient les créneaux de la semaine et réservent avec nom + e-mail.
- **`/admin.html`** : la prof ajoute ses créneaux semaine par semaine (ou copie la semaine précédente), voit qui est inscrit, retire une réservation, et consulte le rapport clientes (export CSV).

Un seul Cloudflare Worker sert le site et l’API ; la clé Supabase et le mot de passe admin restent côté serveur.

## 1. Base de données (Supabase)

```bash
npx supabase login
npx supabase link --project-ref rhwpgcnqztrtymhoqsev
npx supabase db push
```

Ça applique `supabase/migrations/`. Sans CLI : coller le fichier SQL dans Supabase → SQL Editor.

## 2. Site (Cloudflare Workers)

```bash
npm install
npx wrangler login
npx wrangler secret put SUPABASE_URL          # https://rhwpgcnqztrtymhoqsev.supabase.co
npx wrangler secret put SUPABASE_SECRET_KEY   # Supabase → Settings → API Keys → Secret (sb_secret_…)
npx wrangler secret put ADMIN_PASSWORD        # mot de passe de la page admin
npm run deploy
```

## Dev local

```bash
cp .dev.vars.example .dev.vars   # remplir les 3 valeurs
npm run dev                      # http://localhost:8787
```
