-- S4-6: canonical per-user Spanish sentence identity.
-- Apply only to the isolated test project after deploying the matching app code.
-- The transaction remaps custom listening IDs, removes duplicate collection
-- rows, and leaves practice_records and stored sentence text untouched.

begin;

-- Serialize collection, preference, and history writes during the short cutover.
lock table public.personal_sentences in share row exclusive mode;
lock table public.user_settings in share row exclusive mode;
lock table public.practice_records in share mode;

create temporary table s4_practice_records_before on commit drop as
select practice.id, md5(to_jsonb(practice)::text) as row_hash
from public.practice_records practice;

create or replace function public.sentence_identity_key_v1(input_sentence text)
returns text
language plpgsql
immutable
parallel safe
as $function$
declare
  normalized text;
  core text;
  has_question_boundary boolean;
  has_exclamation_boundary boolean;
begin
  normalized := lower(normalize(
    btrim(regexp_replace(
      coalesce(input_sentence, ''),
      U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+',
      ' ',
      'g'
    )),
    NFC
  ));
  normalized := replace(normalized, '...', '…');

  if normalized = '' then
    return '';
  end if;

  has_question_boundary := left(normalized, 1) = '¿' or right(normalized, 1) = '?';
  has_exclamation_boundary := left(normalized, 1) = '¡' or right(normalized, 1) = '!';

  if has_question_boundary and not has_exclamation_boundary then
    core := normalized;
    if left(core, 1) = '¿' then
      core := substring(core from 2);
    end if;
    if right(core, 1) = '?' then
      core := left(core, length(core) - 1);
    end if;
    if core <> '' and position('¿' in core) = 0 and position('?' in core) = 0
      and position('¡' in core) = 0 and position('!' in core) = 0 then
      return 'q:' || core;
    end if;
  end if;

  if has_exclamation_boundary and not has_question_boundary then
    core := normalized;
    if left(core, 1) = '¡' then
      core := substring(core from 2);
    end if;
    if right(core, 1) = '!' then
      core := left(core, length(core) - 1);
    end if;
    if core <> '' and position('¿' in core) = 0 and position('?' in core) = 0
      and position('¡' in core) = 0 and position('!' in core) = 0 then
      return 'e:' || core;
    end if;
  end if;

  -- Mixed or repeated question/exclamation boundary marks remain distinct.
  if position('¿' in normalized) > 0 or position('?' in normalized) > 0
    or position('¡' in normalized) > 0 or position('!' in normalized) > 0 then
    return 'x:' || normalized;
  end if;

  -- Only a single ordinary terminal period is optional. Ellipses were already
  -- converted to a distinct Unicode ellipsis above.
  if right(normalized, 1) = '.' and right(normalized, 2) <> '..' then
    core := left(normalized, length(normalized) - 1);
    if core <> '' and right(core, 1) <> '.' then
      return 's:' || core;
    end if;
  end if;

  return 's:' || normalized;
end;
$function$;

create or replace function public.set_personal_sentence_identity_key_v1()
returns trigger
language plpgsql
as $trigger$
begin
  new.identity_key := public.sentence_identity_key_v1(new.sentence);
  return new;
end;
$trigger$;

drop trigger if exists personal_sentences_identity_key_v1 on public.personal_sentences;
create trigger personal_sentences_identity_key_v1
before insert or update on public.personal_sentences
for each row execute function public.set_personal_sentence_identity_key_v1();

do $assertions$
begin
  if public.sentence_identity_key_v1('  ¿Dónde está la biblioteca?  ')
    <> public.sentence_identity_key_v1('¿DÓNDE está la biblioteca') then
    raise exception 'Question boundary identity assertion failed';
  end if;
  if public.sentence_identity_key_v1(U&'  ¿Dónde\00A0está la biblioteca?  ')
    <> public.sentence_identity_key_v1(U&'¿DÓNDE\3000está la biblioteca') then
    raise exception 'Unicode whitespace identity assertion failed';
  end if;
  if public.sentence_identity_key_v1('Hola') <> public.sentence_identity_key_v1('Hola.') then
    raise exception 'Optional statement period identity assertion failed';
  end if;
  if public.sentence_identity_key_v1('¡Qué bonito!')
    <> public.sentence_identity_key_v1('Qué bonito!') then
    raise exception 'Exclamation boundary identity assertion failed';
  end if;
  if public.sentence_identity_key_v1('¿Dónde?') = public.sentence_identity_key_v1('Dónde')
    or public.sentence_identity_key_v1('Hola…') = public.sentence_identity_key_v1('Hola.')
    or public.sentence_identity_key_v1('Vamos, Ana.') = public.sentence_identity_key_v1('Vamos Ana.') then
    raise exception 'Meaningful punctuation identity assertion failed';
  end if;
end;
$assertions$;

create temporary table s4_sentence_identity_migration_map on commit drop as
with normalized as (
  select
    sentence.id,
    sentence.user_id,
    sentence.sentence,
    sentence.translation,
    sentence.created_at,
    public.sentence_identity_key_v1(sentence.sentence) as canonical_key,
    exists (
      select 1
      from public.user_settings settings
      where settings.user_id = sentence.user_id
        and sentence.id::text = any(settings.listening_custom_selection)
    ) as selected_for_listening
  from public.personal_sentences sentence
), ranked as (
  select
    normalized.*,
    first_value(id) over (
      partition by user_id, canonical_key
      order by selected_for_listening desc, created_at asc, id asc
    ) as survivor_id
  from normalized
)
select id, user_id, canonical_key, survivor_id, selected_for_listening
from ranked;

do $collision_guard$
begin
  if exists (
    select 1
    from public.personal_sentences sentence
    join s4_sentence_identity_migration_map mapping on mapping.id = sentence.id
    group by sentence.user_id, mapping.canonical_key
    having count(*) > 1
      and (
        count(distinct sentence.translation) > 1
        or (count(*) filter (where sentence.translation is null) > 0
          and count(*) filter (where sentence.translation is not null) > 0)
      )
  ) then
    raise exception 'Identity collision has conflicting translations; no rows were changed';
  end if;
end;
$collision_guard$;

-- Remap and de-duplicate each user's custom playlist before removing old IDs.
update public.user_settings settings
set listening_custom_selection = coalesce((
  select array_agg(deduplicated.sentence_id order by deduplicated.first_ordinal)
  from (
    select
      case when mapping.id is not null then mapping.survivor_id::text else item.item_value end as sentence_id,
      min(item.ordinality) as first_ordinal
    from unnest(settings.listening_custom_selection) with ordinality as item(item_value, ordinality)
    left join s4_sentence_identity_migration_map mapping
      on mapping.id::text = item.item_value and mapping.id <> mapping.survivor_id
    group by case when mapping.id is not null then mapping.survivor_id::text else item.item_value end
  ) deduplicated
), array[]::text[]);

delete from public.personal_sentences sentence
using s4_sentence_identity_migration_map mapping
where sentence.id = mapping.id
  and mapping.id <> mapping.survivor_id;

update public.personal_sentences sentence
set identity_key = mapping.canonical_key
from s4_sentence_identity_migration_map mapping
where sentence.id = mapping.id
  and mapping.id = mapping.survivor_id
  and sentence.identity_key is distinct from mapping.canonical_key;

do $postconditions$
begin
  if exists (
    select 1
    from public.personal_sentences sentence
    where sentence.identity_key is distinct from public.sentence_identity_key_v1(sentence.sentence)
  ) then
    raise exception 'Some personal sentence identity keys were not canonicalized';
  end if;
  if exists (
    select 1
    from public.personal_sentences
    group by user_id, identity_key
    having count(*) > 1
  ) then
    raise exception 'Duplicate canonical identity remains after migration';
  end if;
  if exists (
    select 1
    from s4_sentence_identity_migration_map mapping
    where mapping.id <> mapping.survivor_id
      and exists (
        select 1 from public.user_settings settings
        where settings.user_id = mapping.user_id
          and mapping.id::text = any(settings.listening_custom_selection)
      )
  ) then
    raise exception 'A custom listening selection still references a merged sentence ID';
  end if;
  if exists (
    select 1
    from s4_sentence_identity_migration_map mapping
    where mapping.id <> mapping.survivor_id
      and mapping.selected_for_listening
      and not exists (
        select 1 from public.user_settings settings
        where settings.user_id = mapping.user_id
          and mapping.survivor_id::text = any(settings.listening_custom_selection)
      )
  ) then
    raise exception 'A selected sentence ID was not carried over to its survivor';
  end if;
  if exists (
    select id, row_hash from s4_practice_records_before
    except
    select practice.id, md5(to_jsonb(practice)::text) from public.practice_records practice
  ) or exists (
    select practice.id, md5(to_jsonb(practice)::text) from public.practice_records practice
    except
    select id, row_hash from s4_practice_records_before
  ) then
    raise exception 'Practice history changed during identity migration';
  end if;
end;
$postconditions$;

commit;
