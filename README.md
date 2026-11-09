# Pilatelia — réservations Pilates

Studio réservé aux femmes. Interface mobile, **sans compte** : la cliente réserve en 2–3 taps, reçoit un e-mail de confirmation (+ rappel la veille), et gère tout changement avec le studio.

- **`/`** — Réserver : planning de la semaine, sélection du jour, réservation (nom + e-mail). Onglet **Ma réservation** : les réservations de l'appareil (3 max), règle des 24h, boutons Écrire / Appeler. Aucune annulation en autonomie.
- **`/admin.html`** — Espace studio (gros caractères) :
  - **Agenda** de la semaine : qui est inscrit, retrait d'une réservation (e-mail d'annulation à la cliente), **flag « annulation < 24h »**, et **export d'une image 1080×1920** pour la story Instagram.
  - **Disponibilités** : ajout de cours semaine par semaine, répétition hebdo, copie de la semaine précédente.
  - **Clientes** : stats, tableau (dont annulations tardives), export CSV.

Un seul Cloudflare Worker sert le site et l'API ; la clé Supabase et le mot de passe admin restent côté serveur.

### Règles métier

- **Sans compte** : réservations liées à l'appareil (ids en `localStorage`), **3 à venir maximum** — limite aussi appliquée côté serveur par e-mail.
- **Modification/annulation** : uniquement via le studio (e-mail ou téléphone). Modification bloquée dans les 24h ; annulation toujours possible. Une annulation faite par le studio à moins de 24h **flague** la cliente.
- **E-mails** : confirmation à la réservation, annulation quand le studio retire une place, rappel la veille (cron horaire).

## 1. Base de données (Supabase)

```bash
npx supabase login
npx supabase link --project-ref rhwpgcnqztrtymhoqsev
npx supabase db push
```

Applique `supabase/migrations/` (dont `..._pilatelia_v2.sql` : limite 3/e-mail, flag annulation tardive, champ de rappel). Sans CLI : coller les fichiers SQL dans Supabase → SQL Editor.

## 2. Site (Cloudflare Workers)

```bash
npm install
npx wrangler login
npx wrangler secret put SUPABASE_URL          # https://rhwpgcnqztrtymhoqsev.supabase.co
npx wrangler secret put SUPABASE_SECRET_KEY   # Supabase → Settings → API Keys → Secret (sb_secret_…)
npx wrangler secret put ADMIN_PASSWORD        # mot de passe de la page admin
# E-mail (recommandé) :
npx wrangler secret put RESEND_API_KEY        # https://resend.com → API Keys
npx wrangler secret put EMAIL_FROM            # "Pilatelia <reservations@votre-domaine.fr>" (domaine vérifié chez Resend)
npx wrangler secret put STUDIO_NAME           # Pilatelia Studio
npx wrangler secret put STUDIO_EMAIL          # contact affiché aux clientes
npx wrangler secret put STUDIO_PHONE          # contact affiché aux clientes
npm run deploy
```

Le rappel de la veille tourne via un **Cron Trigger** (`wrangler.toml`, toutes les heures). Sans `RESEND_API_KEY`/`EMAIL_FROM`, tout fonctionne mais les e-mails ne sont pas envoyés (ils sont tracés dans les logs `wrangler tail`).

## Dev local

```bash
cp .dev.vars.example .dev.vars   # remplir les valeurs
npm run dev                      # http://localhost:8787
```
