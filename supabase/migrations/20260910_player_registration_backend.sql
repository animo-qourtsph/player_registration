begin;

-- ============================================================
-- ANIMO PICKLEBALL CUP 2026
-- PLAYER REGISTRATION BACKEND — DATABASE SUPPORT
-- ============================================================

-- Preserve the tournament-facing display name separately from legal/name fields.
alter table public.players
  add column if not exists display_name text;

-- Preserve the complete consent snapshot submitted by the player.
alter table public.registrations
  add column if not exists consent_payload jsonb
  not null default '{}'::jsonb;

alter table public.registrations
  add column if not exists waiver_version text;

-- Preserve payment metadata currently collected by the Player portal.
alter table public.payments
  add column if not exists payment_reference text;

alter table public.payments
  add column if not exists sender_name text;

alter table public.payments
  add column if not exists payment_date date;

-- Additional indexes used by the public registration service.
create index if not exists players_lower_email_idx
  on public.players (lower(email))
  where email is not null;

create index if not exists players_mobile_lookup_idx
  on public.players (mobile)
  where mobile is not null;

create index if not exists registrations_client_submission_lookup_idx
  on public.registrations (client_submission_id)
  where client_submission_id is not null;

-- Keep all underlying tables locked from direct browser access.
revoke all on table public.registrations from anon, authenticated;
revoke all on table public.players from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.registration_status_history from anon, authenticated;

-- The Edge Function uses the project secret key and service role.
grant all on table public.registrations to service_role;
grant all on table public.players to service_role;
grant all on table public.payments to service_role;
grant all on table public.registration_status_history to service_role;
grant all on table public.divisions to service_role;
grant all on table public.tournaments to service_role;
grant all on table public.audit_logs to service_role;

commit;

-- ============================================================
-- VERIFY
-- ============================================================
select 'Player display name' as item,
       case when exists (
         select 1 from information_schema.columns
         where table_schema='public' and table_name='players' and column_name='display_name'
       ) then 'READY' else 'MISSING' end as status
union all
select 'Registration consent payload',
       case when exists (
         select 1 from information_schema.columns
         where table_schema='public' and table_name='registrations' and column_name='consent_payload'
       ) then 'READY' else 'MISSING' end
union all
select 'Payment metadata',
       case when (
         select count(*) from information_schema.columns
         where table_schema='public' and table_name='payments'
           and column_name in ('payment_reference','sender_name','payment_date')
       )=3 then 'READY' else 'MISSING' end
union all
select 'Private registration tables',
       case when has_table_privilege('anon','public.registrations','select')
              or has_table_privilege('anon','public.players','select')
              or has_table_privilege('anon','public.payments','select')
            then 'CHECK PRIVILEGES' else 'READY' end;
