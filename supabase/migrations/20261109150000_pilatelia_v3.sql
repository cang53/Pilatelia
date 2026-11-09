-- Pilatelia v3 : prestations (activités + tarif) et prix sur chaque séance.

-- Catalogue des prestations que la prof propose (modifiable dans l'admin).
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  coach text,
  duration_minutes integer not null default 55 check (duration_minutes between 10 and 240),
  capacity integer not null default 6 check (capacity between 1 and 100),
  price_cents integer not null default 0 check (price_cents between 0 and 1000000),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists services_sort_idx on public.services (sort, created_at);

alter table public.services enable row level security;
revoke all on public.services from anon, authenticated;

-- Prix figé sur la séance (dénormalisé : le CA passé reste juste même si la prestation change).
alter table public.classes add column if not exists price_cents integer not null default 0;
