-- Pilatelia v4 : paramètres du studio modifiables depuis l'admin (nom, contacts, adresse).
-- Ligne unique (singleton). Les valeurs renseignées ici priment sur les variables d'env.
create table if not exists public.studio_settings (
  singleton boolean primary key default true check (singleton),
  name text,
  email text,
  phone text,
  instagram text,
  address text,
  updated_at timestamptz not null default now()
);

alter table public.studio_settings enable row level security;
revoke all on public.studio_settings from anon, authenticated;
