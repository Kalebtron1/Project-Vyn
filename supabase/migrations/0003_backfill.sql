-- Copia lo útil de las tablas viejas. El correo de onramp_users no se copia: BlindPay ya lo
-- tiene y Vyn no lo necesita. Se puede correr varias veces.

insert into public.ramp_customers (wallet_address, blindpay_receiver_id, blindpay_blockchain_wallet_id, created_at)
select wallet_address, blindpay_receiver_id, blindpay_blockchain_wallet_id, created_at
  from public.onramp_users
 where blindpay_receiver_id is not null
   and blindpay_blockchain_wallet_id is not null
   and wallet_address ~ '^G[A-Z2-7]{55}$'
on conflict do nothing;

insert into public.ramp_settlements (payin_id, wallet_address, amount_usd_cents, status, tx_hash, reserved_at, finished_at)
select payin_id, wallet_address, round(amount_usd * 100)::bigint, 'sent', hash, settled_at, settled_at
  from public.onramp_settlements
 where wallet_address is not null and amount_usd > 0
on conflict do nothing;

-- Sin IP ni monto guardados: se conserva solo que esa wallet ya lo usó.
insert into public.faucet_grants (wallet_address, ip_hash, amount_cents, status, granted_at)
select wallet_address, 'legacy', 200, 'sent', claimed_at
  from public.faucet_claims
on conflict do nothing;
