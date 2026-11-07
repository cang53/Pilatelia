# Élan — réservations Pilates

Application mobile-first gratuite à héberger sur Cloudflare Workers, avec Supabase comme base de données. Un unique Worker sert le site et les deux routes API, en gardant la clé Supabase hors du téléphone de vos clients.

## Mise en ligne (environ 10 minutes)

1. Créez un projet gratuit sur [Supabase](https://supabase.com), ouvrez **SQL Editor** et exécutez `supabase/schema.sql`.
2. Créez un Worker Cloudflare nommé `pilatelia` relié à ce dépôt. Commande de déploiement : `npm run deploy`.
3. Dans Cloudflare Workers → `pilatelia` → Settings → Variables and Secrets, ajoutez `SUPABASE_URL` et `SUPABASE_SECRET_KEY` (la clé **Secret** `sb_secret_…`, jamais dans le navigateur).
4. Créez les séances dans la table `classes` de Supabase. La page est prête.

Pour travailler localement : `cp .dev.vars.example .dev.vars`, complétez les deux valeurs, puis `npm install` et `npm run dev`.

Le projet utilise uniquement les offres gratuites : Cloudflare Workers et Supabase Free.
