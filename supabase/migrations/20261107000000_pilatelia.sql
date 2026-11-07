-- Pilatelia : créneaux + réservations. Tables accessibles uniquement via le Worker (clé secrète).
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Pilates',
  coach text,
  starts_at timestamptz not null,
  duration_minutes integer not null default 50,
  capacity integer not null check (capacity > 0),
  created_at timestamptz not null default now()
);
alter table public.classes alter column coach drop not null;
alter table public.classes alter column title set default 'Pilates';

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  guest_name text not null,
  guest_email text not null,
  created_at timestamptz not null default now(),
  unique (class_id, guest_email)
);

create index if not exists classes_starts_at_idx on public.classes (starts_at);
create index if not exists bookings_class_id_idx on public.bookings (class_id);
create index if not exists bookings_email_idx on public.bookings (guest_email);

alter table public.classes enable row level security;
alter table public.bookings enable row level security;
revoke all on public.classes, public.bookings from anon, authenticated;

-- Ancienne vue cassée (colonne "date" inexistante).
drop view if exists public.class_availability;

-- Réservation atomique : le verrou sur la séance empêche de dépasser la capacité.
create or replace function public.book_class(p_class_id uuid, p_name text, p_email text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  slot public.classes;
  result public.bookings;
begin
  select * into slot from classes where id = p_class_id and starts_at > now() for update;
  if not found then raise exception 'INTROUVABLE'; end if;
  if (select count(*) from bookings where class_id = p_class_id) >= slot.capacity then
    raise exception 'COMPLET';
  end if;
  insert into bookings (class_id, guest_name, guest_email)
  values (p_class_id, p_name, p_email) returning * into result;
  return result;
end; $$;

revoke execute on function public.book_class(uuid, text, text) from public, anon, authenticated;
grant execute on function public.book_class(uuid, text, text) to service_role;
