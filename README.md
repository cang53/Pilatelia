# Pilatelia — réservations Pilates

Studio réservé aux femmes. Interface mobile, thème clair, **sans compte** : la cliente réserve en 2–3 taps, reçoit un e-mail de confirmation (boutons Google Agenda / Apple Calendar, + rappel la veille), et peut déplacer ou annuler sa séance en ligne jusqu'à 24h avant.

- **`/`** — Réserver : s'ouvre sur la semaine la plus proche qui a une séance ; sélection du jour, réservation (nom + e-mail + **téléphone obligatoire**). Une séance déjà réservée depuis l'appareil s'affiche « Déjà inscrite » et renvoie vers sa gestion. Onglet **Ma réservation** : les réservations du navigateur (sans limite), boutons **Déplacer / Annuler** à plus de 24h, sinon « appelez le studio ou écrivez sur WhatsApp ». Bloc **« Retrouver mes réservations »** : la cliente saisit son e-mail et reçoit un lien qui rattache ses séances à venir au navigateur qui l'ouvre (cas d'une réservation faite depuis le navigateur intégré d'Instagram, qui ne partage pas sa mémoire avec Safari / Chrome). Bloc contact : boutons **WhatsApp** (ouvre directement la conversation avec un message pré-rempli) et **Appeler**. Icône cadenas en haut à droite → espace studio.
- **`/admin.html`** — Espace studio (gros caractères, utilisable aussi sur ordinateur) :
  - **Agenda** — vraie grille semaine (jours × heures, créneaux vides visibles). Un créneau s'ouvre pour voir les inscrites, retirer une réservation (e-mail d'annulation), **flag « annulation < 24h »**, **déplacer / modifier le cours** (jour, heure, durée, places — les inscrites reçoivent un e-mail avec le nouvel horaire). Téléphone + lien WhatsApp de chaque inscrite. Ajout de cours **à n'importe quelle date** (plus de limite d'une semaine), avec répétition hebdo et copie de la semaine précédente, **« Vider la semaine »** (supprime les cours à venir de la semaine, prévient les inscrites ; les cours passés restent pour les finances) et **export story Instagram « Nos Horaires »** (1080×1920, reprend l'affiche du studio : arche lumineuse, jours en colonnes, heures alignées, adresse / Instagram / WhatsApp en pied ; bouton **« Utiliser mon fond »** pour importer son propre visuel sans texte, recadré en 9:16 et gardé en base).
  - **Prestations** — catalogue des activités avec **tarif**, durée, places ; sélectionnable à l'ajout d'un cours. Le tarif s'affiche côté cliente.
  - **Finances** — dashboard : CA de la semaine, à venir, encaissé, par semaine et par prestation.
  - **Clientes** — stats, tableau avec **téléphone** (+ lien WhatsApp) et annulations tardives, export CSV.
  - **Studio** — nom, **adresse**, e-mail, téléphone (sert aussi pour WhatsApp ; un numéro en 0… est considéré belge, +32), Instagram, modifiables directement (priment sur les variables d'env). L'adresse apparaît côté cliente et dans les e-mails.
    **Changer le mot de passe** de l'espace studio (stocké haché en base ; tant qu'il n'a jamais été changé, c'est `ADMIN_PASSWORD` qui fait foi). Mot de passe oublié : dans Supabase → SQL Editor, `update public.studio_settings set admin_password_hash = null;` → on revient à `ADMIN_PASSWORD`.
  - **Inscription manuelle** — depuis le détail d'un cours, la prof peut inscrire une personne (nom + e-mail + téléphone) ; la cliente reçoit l'e-mail de confirmation.

Un seul Cloudflare Worker sert le site et l'API ; la clé Supabase et le mot de passe admin restent côté serveur.

### Règles métier

- **Sans compte** : réservations liées au navigateur (ids en `localStorage`), **sans limite** de réservations à venir (une seule place par séance). Les e-mails (confirmation, déplacement, rappel) contiennent un bouton **« Modifier ou annuler ma réservation »** qui ouvre le site sur `/?r=<id>` et rattache la réservation au navigateur qui l'ouvre.
- **Modification/annulation** : en ligne par la cliente jusqu'à 24h avant (`POST /api/cancel`, règle vérifiée côté serveur) ; en deçà, via le studio. Une annulation faite par le studio à moins de 24h **flague** la cliente.
- **E-mails** : confirmation à la réservation (avec ajout à l'agenda via `/api/ics`), annulation, rappel la veille (cron horaire). Envoyés en HTML + texte.

## 1. Base de données (Supabase)

```bash
npx supabase login
npx supabase link --project-ref rhwpgcnqztrtymhoqsev
npx supabase db push
```

Applique `supabase/migrations/` (dont `..._pilatelia_v2.sql` : limite 3/e-mail, flag annulation tardive, rappel ; `..._pilatelia_v3.sql` : prestations + tarif par séance ; `..._pilatelia_v4.sql` : paramètres studio modifiables ; `..._pilatelia_v5.sql` : téléphone des clientes + mot de passe admin modifiable ; `..._pilatelia_v6.sql` : suppression de la limite de 3 réservations — **à appliquer avant de déployer le Worker**, sinon les réservations échouent). Sans CLI : coller les fichiers SQL dans Supabase → SQL Editor.

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
npx wrangler secret put STUDIO_ADDRESS        # adresse (affichée aux clientes + e-mails) — modifiable dans l'admin
npx wrangler secret put STUDIO_INSTAGRAM      # @pseudo ou URL (bouton "Abonnements")
npx wrangler secret put SITE_URL              # https://adresse-du-site (bouton « Voir ma réservation » dans le rappel de la veille)
npm run deploy
```

Le rappel de la veille tourne via un **Cron Trigger** (`wrangler.toml`, toutes les heures). Sans `RESEND_API_KEY`/`EMAIL_FROM`, tout fonctionne mais les e-mails ne sont pas envoyés (ils sont tracés dans les logs `wrangler tail`).

## Dev local

```bash
cp .dev.vars.example .dev.vars   # remplir les valeurs
npm run dev                      # http://localhost:8787
```
