-- À exécuter dans Supabase > SQL Editor. Les tables ne sont accessibles que via l'API Cloudflare.
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(), title text not null, coach text not null,
  starts_at timestamptz not null, duration_minutes integer not null default 50,
  capacity integer not null check (capacity > 0), created_at timestamptz not null default now()
);
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
  guest_name text not null, guest_email text not null, created_at timestamptz not null default now(),
  unique(class_id, guest_email)
);
alter table public.classes enable row level security;
alter table public.bookings enable row level security;
create or replace view public.class_availability with (security_invoker = true) as
select c.*, (select count(*)::int from public.bookings b where b.class_id=c.id) as booked_count
from public.classes c;
create or replace function public.book_class(p_class_id uuid, p_name text, p_email text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare result public.bookings;
begin
  perform 1 from classes where id=p_class_id and starts_at > now() for update;
  if not found then raise exception 'Séance introuvable'; end if;
  if (select count(*) from bookings where class_id=p_class_id) >= (select capacity from classes where id=p_class_id) then raise exception 'Séance complète'; end if;
  insert into bookings(class_id, guest_name, guest_email) values (p_class_id,p_name,p_email) returning * into result;
  return result;
end; $$;
revoke all on public.classes, public.bookings from anon, authenticated;
grant execute on function public.book_class(uuid,text,text) to service_role;

-- Exemple : créer vos séances depuis l'éditeur Supabase.
-- insert into classes(title,coach,starts_at,duration_minutes,capacity) values ('Pilates doux','Léa','2026-11-08 09:30+01',50,8);
