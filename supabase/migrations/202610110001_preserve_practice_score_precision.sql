-- Preserve the decimal representation of existing REAL values while allowing
-- future Azure scores to be stored exactly. Cast REAL directly to NUMERIC:
-- promoting through DOUBLE PRECISION would expose the REAL value's binary tail.
begin;

alter table public.practice_records
  alter column overall type numeric using overall::numeric,
  alter column accuracy type numeric using accuracy::numeric,
  alter column fluency type numeric using fluency::numeric,
  alter column completeness type numeric using completeness::numeric,
  alter column speaking_rate type numeric using speaking_rate::numeric;

commit;
