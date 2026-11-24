-- Общий график для приложения «Мои смены».
-- Supabase → SQL Editor → New query → вставить всё → Run.
-- Хранится только график: смены, замены, ночные, часы. Документы и заметки сюда не попадают.

create table if not exists public.shared_schedules (
  id text primary key,
  key_hash text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Напрямую таблицу не читает и не пишет никто — только через функции ниже.
alter table public.shared_schedules enable row level security;
revoke all on table public.shared_schedules from anon, authenticated;

-- Сохранить график. Первый вызов создаёт его, дальше менять может только тот, у кого ключ.
create or replace function public.put_schedule(p_id text, p_key text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  v_old text;
begin
  if p_id !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'bad id'; end if;
  if char_length(coalesce(p_key, '')) < 24 then raise exception 'bad key'; end if;
  if pg_column_size(p_data) > 300000 then raise exception 'too big'; end if;

  select key_hash into v_old from shared_schedules where id = p_id;
  if not found then
    insert into shared_schedules (id, key_hash, data) values (p_id, v_hash, p_data);
  elsif v_old <> v_hash then
    raise exception 'forbidden';
  else
    update shared_schedules set data = p_data, updated_at = now() where id = p_id;
  end if;
  return now();
end;
$$;

-- Прочитать график по ссылке.
create or replace function public.get_schedule(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('data', data, 'updated_at', updated_at)
  from shared_schedules
  where id = p_id;
$$;

-- Закрыть доступ (удалить график из облака).
create or replace function public.delete_schedule(p_id text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from shared_schedules
  where id = p_id and key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  return found;
end;
$$;

revoke all on function public.put_schedule(text, text, jsonb) from public;
revoke all on function public.get_schedule(text) from public;
revoke all on function public.delete_schedule(text, text) from public;
grant execute on function public.put_schedule(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_schedule(text) to anon, authenticated;
grant execute on function public.delete_schedule(text, text) to anon, authenticated;
