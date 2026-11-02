-- Base: las tablas que ya existen en producción, y el cierre de acceso aplicado a mano el
-- 2 de noviembre de 2026. Se puede correr varias veces.

create table if not exists public.onramp_users (
  wallet_address text primary key,
  email text,
  blindpay_receiver_id text,
  blindpay_blockchain_wallet_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.faucet_claims (
  wallet_address text primary key,
  claimed_at timestamptz not null default now()
);

create table if not exists public.onramp_settlements (
  payin_id text primary key,
  wallet_address text,
  amount_usd numeric,
  hash text,
  settled_at timestamptz not null default now()
);

alter table public.onramp_users enable row level security;
alter table public.faucet_claims enable row level security;
alter table public.onramp_settlements enable row level security;

drop policy if exists "onramp_users backend access" on public.onramp_users;
drop policy if exists "faucet_claims backend access" on public.faucet_claims;
drop policy if exists "onramp_settlements backend access" on public.onramp_settlements;

revoke all on public.onramp_users, public.faucet_claims, public.onramp_settlements from anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
