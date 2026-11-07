# Élan — réservations Pilates

Application mobile-first gratuite à héberger sur Cloudflare Pages, avec Supabase comme base de données. Le site est 100 % statique, sauf deux petites fonctions Cloudflare qui gardent la clé Supabase hors du téléphone de vos clients.

## Mise en ligne (environ 10 minutes)

1. Créez un projet gratuit sur [Supabase](https://supabase.com), ouvrez **SQL Editor** et exécutez `supabase/schema.sql`.
2. Créez un dépôt GitHub, poussez ces fichiers, puis importez-le dans **Cloudflare Pages**. Build command : aucune. Output directory : `/`.
3. Dans Cloudflare Pages → Settings → Environment variables, ajoutez `SUPABASE_URL` et `SUPABASE_SECRET_KEY` (la clé **Secret** `sb_secret_…`, jamais dans le navigateur). Ajoutez-les en Production et Preview.
4. Créez les séances dans la table `classes` de Supabase. La page est prête.

Pour travailler localement : `cp .dev.vars.example .dev.vars`, complétez les deux valeurs, puis `npm install` et `npm run dev`.

Le projet utilise uniquement les offres gratuites : Cloudflare Pages/Functions et Supabase Free.
