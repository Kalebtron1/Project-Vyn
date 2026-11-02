-- Tablas y funciones atómicas para on-ramp, off-ramp, faucet y sesiones. Solo agrega: el
-- código sigue usando las tablas viejas hasta que cada PR cambie a estas.
--
-- Los montos son enteros en centavos. Las funciones hacen verificación y escritura en una
-- transacción, porque "leer y luego escribir" permite pagar dos veces con llamadas paralelas.

create type public.reservation_status as enum ('reserved', 'sent', 'failed');
create type public.payout_status as enum ('verified', 'submitted', 'completed', 'failed', 'refunded');

create table public.ramp_customers (
  wallet_address text primary key check (wallet_address ~ '^G[A-Z2-7]{55}$'),
  blindpay_receiver_id text not null,
  blindpay_blockchain_wallet_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ramp_payins (
  payin_id text primary key,
  wallet_address text not null references public.ramp_customers (wallet_address),
  sender_mxn_cents bigint not null check (sender_mxn_cents > 0),
  receiver_usd_cents bigint not null check (receiver_usd_cents > 0),
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ramp_payins_wallet_created_idx on public.ramp_payins (wallet_address, created_at desc);

-- Sin llave foránea a ramp_payins: incluye liquidaciones anteriores a esa tabla.
create table public.ramp_settlements (
  payin_id text primary key,
  wallet_address text not null,
  amount_usd_cents bigint not null check (amount_usd_cents > 0),
  status public.reservation_status not null default 'reserved',
  tx_hash text unique,
  error text,
  reserved_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ramp_settlements_wallet_reserved_idx on public.ramp_settlements (wallet_address, reserved_at);

create table public.ramp_payouts (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  funding_tx_hash text not null unique,
  amount_usd_cents bigint not null check (amount_usd_cents >= 1000),
  blindpay_quote_id text,
  blindpay_payout_id text unique,
  status public.payout_status not null default 'verified',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.faucet_grants (
  wallet_address text primary key,
  ip_hash text not null,
  amount_cents bigint not null check (amount_cents > 0),
  status public.reservation_status not null default 'reserved',
  tx_hash text unique,
  granted_at timestamptz not null default now()
);
create index faucet_grants_ip_granted_idx on public.faucet_grants (ip_hash, granted_at);

create table public.daily_budgets (
  budget text not null,
  day date not null,
  spent_cents bigint not null default 0 check (spent_cents >= 0),
  primary key (budget, day)
);

create table public.webhook_events (
  svix_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.used_auth_challenges (
  challenge_hash text primary key,
  expires_at timestamptz not null
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Suma al presupuesto del día si no pasa del tope. Devuelve false si lo pasaría.
create function public.spend_daily_budget(p_budget text, p_cents bigint, p_cap_cents bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  insert into public.daily_budgets (budget, day) values (p_budget, v_day)
    on conflict do nothing;
  update public.daily_budgets
     set spent_cents = spent_cents + p_cents
   where budget = p_budget and day = v_day
     and spent_cents + p_cents <= p_cap_cents;
  return found;
end $$;

create function public.refund_daily_budget(p_budget text, p_day date, p_cents bigint)
returns void
language sql
set search_path = ''
as $$
  update public.daily_budgets
     set spent_cents = greatest(spent_cents - p_cents, 0)
   where budget = p_budget and day = p_day;
$$;

-- Reserva la liquidación de un payin antes de enviar el USDC.
-- Devuelve 'reserved' | 'already_reserved' | 'wallet_cap' | 'global_cap'.
-- Solo un fallo declarado se puede reintentar. Una reserva sin terminar se queda bloqueada:
-- pudo haberse enviado el USDC, y pagar de nuevo sería peor que revisarla a mano.
create function public.reserve_settlement(
  p_payin_id text,
  p_wallet text,
  p_amount_cents bigint,
  p_wallet_daily_cap_cents bigint,
  p_global_daily_cap_cents bigint
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_today timestamptz := ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';
  v_status public.reservation_status;
  v_wallet_today bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('settle:' || p_wallet, 0));
  perform pg_advisory_xact_lock(hashtextextended('settle-payin:' || p_payin_id, 0));

  select status into v_status from public.ramp_settlements where payin_id = p_payin_id;
  if v_status is not null and v_status <> 'failed' then
    return 'already_reserved';
  end if;

  select coalesce(sum(amount_usd_cents), 0) into v_wallet_today
    from public.ramp_settlements
   where wallet_address = p_wallet and status <> 'failed' and reserved_at >= v_today;
  if v_wallet_today + p_amount_cents > p_wallet_daily_cap_cents then
    return 'wallet_cap';
  end if;

  if not public.spend_daily_budget('settlement', p_amount_cents, p_global_daily_cap_cents) then
    return 'global_cap';
  end if;

  insert into public.ramp_settlements (payin_id, wallet_address, amount_usd_cents)
    values (p_payin_id, p_wallet, p_amount_cents)
    on conflict (payin_id) do update
      set wallet_address = excluded.wallet_address,
          amount_usd_cents = excluded.amount_usd_cents,
          status = 'reserved',
          tx_hash = null,
          error = null,
          reserved_at = now(),
          finished_at = null;
  return 'reserved';
end $$;

-- Cierra una reserva: con hash quedó enviada; sin hash falló y devuelve el presupuesto.
create function public.finish_settlement(p_payin_id text, p_tx_hash text, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.ramp_settlements;
begin
  update public.ramp_settlements
     set status = case when p_tx_hash is null then 'failed'::public.reservation_status else 'sent' end,
         tx_hash = p_tx_hash,
         error = p_error,
         finished_at = now()
   where payin_id = p_payin_id and status = 'reserved'
   returning * into v_row;
  if found and p_tx_hash is null then
    perform public.refund_daily_budget(
      'settlement', (v_row.reserved_at at time zone 'utc')::date, v_row.amount_usd_cents
    );
  end if;
end $$;

-- Reserva el faucet: una vez por wallet, tope por IP al día y presupuesto global del día.
-- Devuelve 'reserved' | 'already_claimed' | 'ip_cap' | 'global_cap'.
create function public.reserve_faucet(
  p_wallet text,
  p_ip_hash text,
  p_amount_cents bigint,
  p_ip_daily_max integer,
  p_global_daily_cap_cents bigint
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_today timestamptz := ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';
  v_status public.reservation_status;
begin
  perform pg_advisory_xact_lock(hashtextextended('faucet-ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('faucet-wallet:' || p_wallet, 0));

  select status into v_status from public.faucet_grants where wallet_address = p_wallet;
  if v_status is not null and v_status <> 'failed' then
    return 'already_claimed';
  end if;

  if (select count(*) from public.faucet_grants
       where ip_hash = p_ip_hash and status <> 'failed' and granted_at >= v_today) >= p_ip_daily_max then
    return 'ip_cap';
  end if;

  if not public.spend_daily_budget('faucet', p_amount_cents, p_global_daily_cap_cents) then
    return 'global_cap';
  end if;

  insert into public.faucet_grants (wallet_address, ip_hash, amount_cents)
    values (p_wallet, p_ip_hash, p_amount_cents)
    on conflict (wallet_address) do update
      set ip_hash = excluded.ip_hash,
          amount_cents = excluded.amount_cents,
          status = 'reserved',
          tx_hash = null,
          granted_at = now();
  return 'reserved';
end $$;

create function public.finish_faucet(p_wallet text, p_tx_hash text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.faucet_grants;
begin
  update public.faucet_grants
     set status = case when p_tx_hash is null then 'failed'::public.reservation_status else 'sent' end,
         tx_hash = p_tx_hash
   where wallet_address = p_wallet and status = 'reserved'
   returning * into v_row;
  if found and p_tx_hash is null then
    perform public.refund_daily_budget(
      'faucet', (v_row.granted_at at time zone 'utc')::date, v_row.amount_cents
    );
  end if;
end $$;

-- Límite por ventana fija. Devuelve true si la petición entra.
create function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_window, 1)
    on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Marca un desafío de sesión como usado. Devuelve false si ya se había usado.
create function public.consume_auth_challenge(p_challenge_hash text, p_expires_at timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  insert into public.used_auth_challenges (challenge_hash, expires_at)
    values (p_challenge_hash, p_expires_at)
    on conflict do nothing;
  return found;
end $$;

create function public.delete_expired_records()
returns void
language sql
set search_path = ''
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.used_auth_challenges where expires_at < now();
$$;

-- Solo el backend entra: RLS sin políticas, sin permisos para anon ni authenticated, y lo
-- mismo por defecto para lo que se cree después.
alter table public.ramp_customers enable row level security;
alter table public.ramp_payins enable row level security;
alter table public.ramp_settlements enable row level security;
alter table public.ramp_payouts enable row level security;
alter table public.faucet_grants enable row level security;
alter table public.daily_budgets enable row level security;
alter table public.webhook_events enable row level security;
alter table public.used_auth_challenges enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant execute on function
  public.reserve_settlement(text, text, bigint, bigint, bigint),
  public.finish_settlement(text, text, text),
  public.reserve_faucet(text, text, bigint, integer, bigint),
  public.finish_faucet(text, text),
  public.hit_rate_limit(text, integer, integer),
  public.consume_auth_challenge(text, timestamptz),
  public.delete_expired_records(),
  public.spend_daily_budget(text, bigint, bigint),
  public.refund_daily_budget(text, date, bigint)
to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
