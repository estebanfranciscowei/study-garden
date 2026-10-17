-- Version matches the migration applied to the connected Supabase project.
-- Extend account sync without changing the original endpoint used by older pages.
-- The owner-bound v1 merge locks the same row; all v2 changes share its transaction.
create or replace function public.study_garden_merge_v2(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_base jsonb;
  v_old jsonb;
  v_next jsonb;
  v_revision bigint;
  v_field text;
  v_row jsonb;
  v_rows jsonb;
  v_clock bigint;
begin
  if v_user is null then
    raise exception 'Sign in before syncing.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
     or octet_length(p_state::text) > 5000000 then
    raise exception 'Invalid study record.' using errcode = '22023';
  end if;
  foreach v_field in array array['tasks','reflections'] loop
    if jsonb_typeof(p_state->v_field) is distinct from 'array'
       or jsonb_array_length(p_state->v_field) > (case when v_field='tasks' then 1000 else 100000 end) then
      raise exception 'Invalid study tools collection.' using errcode = '22023';
    end if;
    for v_row in select value from jsonb_array_elements(p_state->v_field) loop
      if jsonb_typeof(v_row) is distinct from 'object'
         or jsonb_typeof(v_row->'id') is distinct from 'string'
         or length(v_row->>'id') not between 1 and 128
         or jsonb_typeof(v_row->'updatedAt') is distinct from 'number'
         or coalesce(v_row->>'updatedAt','') !~ '^[0-9]{1,16}$'
         or (v_row->>'updatedAt')::bigint not between 1 and 9007199254740991 then
        raise exception 'Invalid study tools item.' using errcode = '22023';
      end if;
      if v_field='tasks' then
        if jsonb_typeof(v_row->'title') is distinct from 'string'
           or length(btrim(v_row->>'title')) not between 1 and 80
           or jsonb_typeof(v_row->'category') is distinct from 'string'
           or length(v_row->>'category') > 24
           or jsonb_typeof(v_row->'parentTitle') is distinct from 'string'
           or length(v_row->>'parentTitle') > 80
           or jsonb_typeof(v_row->'date') is distinct from 'string'
           or coalesce(v_row->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           or jsonb_typeof(v_row->'done') is distinct from 'boolean'
           or jsonb_typeof(v_row->'deleted') is distinct from 'boolean'
           or jsonb_typeof(v_row->'order') is distinct from 'number'
           or coalesce(v_row->>'order','') !~ '^[0-9]{1,10}$'
           or (v_row->>'order')::bigint not between 0 and 1000000000 then
          raise exception 'Invalid planned task.' using errcode = '22023';
        end if;
        if ((v_row->>'date')::date)::text <> v_row->>'date' then
          raise exception 'Invalid task date.' using errcode = '22023';
        end if;
      else
        if jsonb_typeof(v_row->'learned') is distinct from 'string'
           or length(v_row->>'learned') > 1000
           or jsonb_typeof(v_row->'next') is distinct from 'string'
           or length(v_row->>'next') > 300 then
          raise exception 'Invalid session reflection.' using errcode = '22023';
        end if;
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_state->v_field)) <>
       (select count(distinct value->>'id') from jsonb_array_elements(p_state->v_field)) then
      raise exception 'Duplicate study tools identifiers.' using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_state->'gardenSelection') is distinct from 'object'
     or coalesce(p_state->'gardenSelection'->>'plant','') not in ('tree','daisy','sunflower','pine','cherry')
     or coalesce(p_state->'gardenSelection'->>'pot','') not in ('earth','terracotta','porcelain')
     or coalesce(p_state->'gardenSelection'->>'season','') not in ('spring','summer','autumn','winter')
     or coalesce(p_state->'fieldClock'->>'gardenSelection','') !~ '^[0-9]{1,16}$' then
    raise exception 'Invalid garden preferences.' using errcode = '22023';
  end if;
  v_clock := (p_state->'fieldClock'->>'gardenSelection')::bigint;
  if v_clock > 9007199254740991 then
    raise exception 'Invalid garden revision.' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_state->'sessions') loop
    if (v_row ? 'category' and (jsonb_typeof(v_row->'category') is distinct from 'string' or length(v_row->>'category') > 24))
       or (v_row ? 'taskId' and v_row->'taskId' <> 'null'::jsonb and (jsonb_typeof(v_row->'taskId') is distinct from 'string' or length(v_row->>'taskId') not between 1 and 128)) then
      raise exception 'Invalid session task snapshot.' using errcode = '22023';
    end if;
  end loop;

  v_base := public.study_garden_merge(p_state);
  v_old := v_base->'state';
  v_next := v_old;
  v_revision := (v_base->>'revision')::bigint;
  foreach v_field in array array['tasks','reflections'] loop
    with combined as (
      select value as item,0 as priority from jsonb_array_elements(coalesce(v_old->v_field,'[]'::jsonb))
      union all
      select value,1 from jsonb_array_elements(p_state->v_field)
    ), unique_items as (
      select distinct on (item->>'id') item from combined
      order by item->>'id',(item->>'updatedAt')::bigint desc,priority
    )
    select coalesce(jsonb_agg(item order by item->>'id'),'[]'::jsonb) into v_rows from unique_items;
    if jsonb_array_length(v_rows) > (case when v_field='tasks' then 1000 else 100000 end) then
      raise exception 'Study tools record limit reached.' using errcode = '22023';
    end if;
    v_next := jsonb_set(v_next,array[v_field],v_rows);
  end loop;
  if exists (
    select 1 from jsonb_array_elements(v_next->'reflections') r
    where not exists (select 1 from jsonb_array_elements(v_next->'sessions') s where s->>'id'=r->>'id')
  ) then
    raise exception 'A reflection must belong to a completed session.' using errcode = '22023';
  end if;
  if not (v_old ? 'gardenSelection') or v_clock > coalesce((v_old->'fieldClock'->>'gardenSelection')::bigint,0) then
    v_next := jsonb_set(v_next,'{gardenSelection}',p_state->'gardenSelection');
    v_next := jsonb_set(v_next,'{fieldClock,gardenSelection}',to_jsonb(v_clock));
  end if;
  if v_next is distinct from v_old then
    update public.study_garden_state set state=v_next,revision=revision+1,updated_at=now()
      where user_id=v_user returning revision into v_revision;
  end if;
  return jsonb_build_object('state',v_next,'revision',v_revision);
end;
$function$;
revoke all on function public.study_garden_merge_v2(jsonb) from public, anon, authenticated;
grant execute on function public.study_garden_merge_v2(jsonb) to authenticated;
comment on function public.study_garden_merge_v2(jsonb) is 'Owner-bound atomic merge of progress, task tombstones, session reflections and garden choices; validates auth.uid and all client input. Audio and active timers stay on each device.';
