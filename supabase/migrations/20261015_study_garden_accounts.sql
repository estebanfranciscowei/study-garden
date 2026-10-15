-- Account records are private. Only the authenticated owner can read a row.
create table if not exists public.study_garden_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.study_garden_state enable row level security;
revoke all on table public.study_garden_state from public, anon, authenticated;
grant select on table public.study_garden_state to authenticated;
create policy "study_garden_owner_reads" on public.study_garden_state
  for select to authenticated using ((select auth.uid()) = user_id);

-- All writes pass through one transaction. This prevents two devices from
-- overwriting each other's completed sessions and redemption records.
create or replace function public.study_garden_merge(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_old jsonb;
  v_next jsonb;
  v_default jsonb := '{"version":1,"coins":0,"sessions":[],"redemptions":[],"customRewards":[],"quickGoals":["看懂一条汇编指令","读两页课件，记下一句话","独立做一道练习题"],"goal":"看懂一条汇编指令","selectedMinutes":5,"fieldClock":{"quickGoals":0,"customRewards":0,"goal":0,"selectedMinutes":0},"current":null,"sound":false}'::jsonb;
  v_revision bigint;
  v_field text;
  v_row jsonb;
  v_rows jsonb;
  v_coins bigint;
  v_clock bigint;
begin
  if v_user is null then
    raise exception 'Sign in before syncing.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
     or octet_length(p_state::text) > 5000000
     or p_state->>'version' is distinct from '1' then
    raise exception 'Invalid study record.' using errcode = '22023';
  end if;
  foreach v_field in array array['sessions','redemptions','customRewards','quickGoals'] loop
    if jsonb_typeof(p_state->v_field) is distinct from 'array' then
      raise exception 'Invalid record collection.' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(p_state->'sessions') > 100000
     or jsonb_array_length(p_state->'redemptions') > 100000
     or jsonb_array_length(p_state->'customRewards') > 50
     or jsonb_array_length(p_state->'quickGoals') > 8
     or jsonb_typeof(p_state->'goal') is distinct from 'string'
     or length(p_state->>'goal') > 80
     or coalesce(p_state->>'selectedMinutes','') !~ '^[0-9]{1,3}$'
     or (p_state->>'selectedMinutes')::integer not between 1 and 120
     or jsonb_typeof(p_state->'fieldClock') is distinct from 'object' then
    raise exception 'Invalid preferences.' using errcode = '22023';
  end if;
  foreach v_field in array array['quickGoals','customRewards','goal','selectedMinutes'] loop
    if coalesce(p_state->'fieldClock'->>v_field,'') !~ '^[0-9]{1,16}$' then
      raise exception 'Invalid preference revision.' using errcode = '22023';
    end if;
    v_clock := (p_state->'fieldClock'->>v_field)::bigint;
    if v_clock > 9007199254740991 then
      raise exception 'Invalid preference revision.' using errcode = '22023';
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(p_state->'quickGoals') loop
    if jsonb_typeof(v_row) is distinct from 'string'
       or length(btrim(v_row #>> '{}')) not between 1 and 80 then
      raise exception 'Invalid quick goal.' using errcode = '22023';
    end if;
  end loop;
  foreach v_field in array array['sessions','redemptions','customRewards'] loop
    for v_row in select value from jsonb_array_elements(p_state->v_field) loop
      if jsonb_typeof(v_row) is distinct from 'object'
         or jsonb_typeof(v_row->'id') is distinct from 'string'
         or length(v_row->>'id') not between 1 and 128
         or coalesce(v_row->>'minutes','') !~ '^[0-9]{1,3}$'
         or (v_row->>'minutes')::integer not between 1 and (case when v_field='sessions' then 120 else 180 end) then
        raise exception 'Invalid record item.' using errcode = '22023';
      end if;
      if v_field = 'sessions' then
        if jsonb_typeof(v_row->'task') is distinct from 'string' or length(v_row->>'task') > 80 then
          raise exception 'Invalid study task.' using errcode = '22023';
        end if;
      else
        if jsonb_typeof(v_row->'name') is distinct from 'string'
           or length(btrim(v_row->>'name')) not between 1 and 30
           or coalesce(v_row->>'cost','') !~ '^[0-9]{1,4}$'
           or (v_row->>'cost')::integer not between 1 and 9999 then
          raise exception 'Invalid reward.' using errcode = '22023';
        end if;
      end if;
      if v_field = 'customRewards' then
        if v_row->>'id' !~ '^custom-[A-Za-z0-9_-]+$' then
          raise exception 'Invalid reward identifier.' using errcode = '22023';
        end if;
      elsif coalesce(v_row->>'at','') !~ '^[0-9]{1,16}$'
         or (v_row->>'at')::bigint not between 1 and 8640000000000000 then
        raise exception 'Invalid record time.' using errcode = '22023';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_state->v_field)) <>
       (select count(distinct value->>'id') from jsonb_array_elements(p_state->v_field)) then
      raise exception 'Duplicate record identifiers.' using errcode = '22023';
    end if;
  end loop;

  insert into public.study_garden_state(user_id,state)
  values (v_user,v_default)
  on conflict (user_id) do nothing;
  select s.state,s.revision into v_old,v_revision
    from public.study_garden_state s where s.user_id=v_user for update;
  v_next := v_old;
  foreach v_field in array array['sessions','redemptions'] loop
    with combined as (
      select value as item,0 as priority from jsonb_array_elements(v_old->v_field)
      union all
      select value,1 as priority from jsonb_array_elements(p_state->v_field)
    ), unique_items as (
      select distinct on (item->>'id') item from combined
      order by item->>'id',priority
    )
    select coalesce(jsonb_agg(item order by item->>'id'),'[]'::jsonb)
      into v_rows from unique_items;
    if jsonb_array_length(v_rows) > 100000 then
      raise exception 'Record limit reached. Export a backup before continuing.' using errcode = '22023';
    end if;
    v_next := jsonb_set(v_next,array[v_field],v_rows);
  end loop;
  foreach v_field in array array['quickGoals','customRewards','goal','selectedMinutes'] loop
    v_clock := (p_state->'fieldClock'->>v_field)::bigint;
    if v_revision=0 or v_clock > (v_old->'fieldClock'->>v_field)::bigint then
      v_next := jsonb_set(v_next,array[v_field],p_state->v_field);
      v_next := jsonb_set(v_next,array['fieldClock',v_field],to_jsonb(v_clock));
    end if;
  end loop;
  select greatest(0,
    coalesce((select sum((value->>'minutes')::bigint*2) from jsonb_array_elements(v_next->'sessions')),0)
    - coalesce((select sum((value->>'cost')::bigint) from jsonb_array_elements(v_next->'redemptions')),0)
  ) into v_coins;
  v_next := jsonb_set(v_next,'{coins}',to_jsonb(v_coins));
  if v_next is distinct from v_old then
    update public.study_garden_state set state=v_next,revision=revision+1,updated_at=now()
      where user_id=v_user returning revision into v_revision;
  end if;
  return jsonb_build_object('state',v_next,'revision',v_revision);
end;
$function$;
revoke all on function public.study_garden_merge(jsonb) from public, anon;
grant execute on function public.study_garden_merge(jsonb) to authenticated;
comment on table public.study_garden_state is 'Private, per-account progress for the study garden. Active timers stay on each device.';
