-- Pilatelia v7 : corbeille des réservations supprimées (gardées 7 jours, restaurables
-- depuis l'admin) + téléphone dans les annulations tardives.

alter table public.late_cancellations add column if not exists guest_phone text;

-- Copie de chaque réservation supprimée, avec le cours tel qu'il était.
-- L'id est celui de la réservation : une restauration la recrée à l'identique
-- (le lien « Modifier ma réservation » des e-mails reste valable).
create table if not exists public.deleted_bookings (
  id uuid primary key,
  class_id uuid,
  guest_name text,
  guest_email text,
  guest_phone text,
  booked_at timestamptz,
  reminder_sent_at timestamptz,
  class_title text,
  class_starts_at timestamptz,
  class_duration_minutes integer,
  class_price_cents integer,
  reason text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_bookings_deleted_at_idx on public.deleted_bookings (deleted_at desc);

alter table public.deleted_bookings enable row level security;
revoke all on public.deleted_bookings from anon, authenticated;

-- Le motif est passé par le Worker (delete_booking / delete_classes) ; une suppression
-- faite à la main dans Supabase est archivée quand même, avec un motif par défaut.
create or replace function public.archive_deleted_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into deleted_bookings (id, class_id, guest_name, guest_email, guest_phone, booked_at, reminder_sent_at,
    class_title, class_starts_at, class_duration_minutes, class_price_cents, reason)
  select old.id, old.class_id, old.guest_name, old.guest_email, old.guest_phone, old.created_at, old.reminder_sent_at,
    c.title, c.starts_at, c.duration_minutes, c.price_cents,
    coalesce(nullif(current_setting('pilatelia.delete_reason', true), ''), 'Supprimée dans Supabase')
  from (select 1) one left join classes c on c.id = old.class_id
  on conflict (id) do update set
    class_id = excluded.class_id, guest_name = excluded.guest_name, guest_email = excluded.guest_email,
    guest_phone = excluded.guest_phone, booked_at = excluded.booked_at, reminder_sent_at = excluded.reminder_sent_at,
    class_title = excluded.class_title, class_starts_at = excluded.class_starts_at,
    class_duration_minutes = excluded.class_duration_minutes, class_price_cents = excluded.class_price_cents,
    reason = excluded.reason, deleted_at = now();
  return old;
end; $$;

drop trigger if exists bookings_archive_on_delete on public.bookings;
create trigger bookings_archive_on_delete before delete on public.bookings
  for each row execute function public.archive_deleted_booking();

-- Avant de supprimer un cours, on supprime ses réservations nous-mêmes : le cours existe
-- encore, donc la corbeille garde son intitulé et son horaire (sinon perdus avec le cascade).
create or replace function public.archive_class_bookings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(current_setting('pilatelia.delete_reason', true), '') is null then
    perform set_config('pilatelia.delete_reason', 'Cours supprimé dans Supabase', true);
  end if;
  delete from bookings where class_id = old.id;
  return old;
end; $$;

drop trigger if exists classes_archive_bookings_on_delete on public.classes;
create trigger classes_archive_bookings_on_delete before delete on public.classes
  for each row execute function public.archive_class_bookings();

-- Suppressions appelées par le Worker, avec le motif affiché dans le journal.
create or replace function public.delete_booking(p_id uuid, p_reason text)
returns setof public.bookings language plpgsql security definer set search_path = public as $$
begin
  perform set_config('pilatelia.delete_reason', p_reason, true);
  return query delete from bookings where id = p_id returning *;
end; $$;

create or replace function public.delete_classes(p_ids uuid[], p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('pilatelia.delete_reason', p_reason, true);
  delete from classes where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end; $$;

-- Restauration : recrée la réservation à l'identique si le cours existe encore et a de la
-- place, retire le flag « annulation tardive » posé par la suppression, vide la corbeille.
create or replace function public.restore_booking(p_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  d public.deleted_bookings;
  slot public.classes;
  result public.bookings;
begin
  select * into d from deleted_bookings where id = p_id for update;
  if not found then raise exception 'INTROUVABLE'; end if;
  select * into slot from classes where id = d.class_id for update;
  if not found then raise exception 'COURS_SUPPRIME'; end if;
  if exists (select 1 from bookings where class_id = d.class_id and guest_email = d.guest_email) then
    raise exception 'DEJA_INSCRITE';
  end if;
  if (select count(*) from bookings where class_id = d.class_id) >= slot.capacity then
    raise exception 'COMPLET';
  end if;
  insert into bookings (id, class_id, guest_name, guest_email, guest_phone, created_at, reminder_sent_at)
  values (d.id, d.class_id, d.guest_name, d.guest_email, d.guest_phone, coalesce(d.booked_at, now()), d.reminder_sent_at)
  returning * into result;
  delete from late_cancellations
    where class_id = d.class_id and guest_email = d.guest_email and created_at >= d.deleted_at - interval '1 minute';
  delete from deleted_bookings where id = p_id;
  return result;
end; $$;

revoke execute on function public.delete_booking(uuid, text) from public, anon, authenticated;
revoke execute on function public.delete_classes(uuid[], text) from public, anon, authenticated;
revoke execute on function public.restore_booking(uuid) from public, anon, authenticated;
grant execute on function public.delete_booking(uuid, text) to service_role;
grant execute on function public.delete_classes(uuid[], text) to service_role;
grant execute on function public.restore_booking(uuid) to service_role;
