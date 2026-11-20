-- Pilatelia v6 : suppression de la limite de 3 réservations à venir par e-mail.
-- Une cliente peut réserver autant de séances qu'elle veut (une seule place par séance).

create or replace function public.book_class(p_class_id uuid, p_name text, p_email text, p_phone text)
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

  insert into bookings (class_id, guest_name, guest_email, guest_phone)
  values (p_class_id, p_name, p_email, p_phone) returning * into result;
  return result;
end; $$;

revoke execute on function public.book_class(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.book_class(uuid, text, text, text) to service_role;
