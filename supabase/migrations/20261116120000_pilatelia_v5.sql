-- Pilatelia v5 : téléphone obligatoire à la réservation + mot de passe admin modifiable.

-- Numéro de téléphone de la cliente (obligatoire côté app ; nullable pour les anciennes réservations).
alter table public.bookings add column if not exists guest_phone text;

-- Mot de passe de l'espace studio, modifiable depuis l'admin (hash PBKDF2, jamais en clair).
-- Tant qu'il est vide, c'est la variable d'env ADMIN_PASSWORD qui fait foi.
-- Mot de passe oublié : `update public.studio_settings set admin_password_hash = null;`
alter table public.studio_settings add column if not exists admin_password_hash text;

-- Réservation atomique avec téléphone (remplace la version à 3 paramètres).
drop function if exists public.book_class(uuid, text, text);
create or replace function public.book_class(p_class_id uuid, p_name text, p_email text, p_phone text)
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

  insert into bookings (class_id, guest_name, guest_email, guest_phone)
  values (p_class_id, p_name, p_email, p_phone) returning * into result;
  return result;
end; $$;

revoke execute on function public.book_class(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.book_class(uuid, text, text, text) to service_role;
