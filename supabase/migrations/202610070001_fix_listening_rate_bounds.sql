-- Stage 3 Task 4: accept the documented 1.2x listening rate.
-- A REAL value of 1.2 is slightly above a double-precision 1.2 when promoted
-- for comparison by the original CHECK constraint.

alter table public.user_settings
  drop constraint user_settings_listening_rate_check,
  add constraint user_settings_listening_rate_check
    check (listening_rate between 0.6::real and 1.2::real);
