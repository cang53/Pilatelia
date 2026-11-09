-- Pilatelia v2 : sans compte (limite 3 réservations à venir par e-mail),
-- rappel e-mail, et flag d'annulation tardive (< 24h) côté studio.

-- Rappel : on marque chaque réservation une fois le rappel de la veille envoyé.
alter table public.bookings add column if not exists reminder_sent_at timestamptz;

-- Flag "annulation tardive" : quand le studio retire une réservation à moins de
-- 24h du cours, on garde une trace pour repérer les habituées qui annulent tard.
create table if not exists public.late_cancellations (
  id uuid primary key default gen_random_uuid(),
  class_id uuid,
  guest_email text not null,
  guest_name text,
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists late_cancellations_email_idx on public.late_cancellations (guest_email);

alter table public.late_cancellations enable row level security;
revoke all on public.late_cancellations from anon, authenticated;

-- Réservation atomique + limite de 3 réservations À VENIR par e-mail (sans compte).
create or replace function public.book_class(p_class_id uuid, p_name text, p_email text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  slot public.classes;
  result public.bookings;
  upcoming integer;
begin
  select * into slot from classes where id = p_class_id and starts_at > now() for update;
  if not found then raise exception 'INTROUVABLE'; end if;

  select count(*) into upcoming
  from bookings b join classes c on c.id = b.class_id
  where b.guest_email = p_email and c.starts_at > now();
  if upcoming >= 3 then raise exception 'LIMITE'; end if;

  if (select count(*) from bookings where class_id = p_class_id) >= slot.capacity then
    raise exception 'COMPLET';
  end if;

  insert into bookings (class_id, guest_name, guest_email)
  values (p_class_id, p_name, p_email) returning * into result;
  return result;
end; $$;

revoke execute on function public.book_class(uuid, text, text) from public, anon, authenticated;
grant execute on function public.book_class(uuid, text, text) to service_role;
