-- Migration: 001_create_scheduled_payments
-- Creates the scheduled_payments table with retry tracking columns.

CREATE TABLE IF NOT EXISTS public.scheduled_payments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT       NOT NULL,
  amount        NUMERIC     NOT NULL CHECK (amount > 0),
  -- 'pending' → ready to process
  -- 'processing' → job has picked it up (prevents duplicate submissions)
  -- 'completed' → Stellar tx confirmed
  -- 'failed' → exceeded MAX_RETRIES
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  tx_hash       TEXT,                          -- set on success
  retry_count   INT         NOT NULL DEFAULT 0,
  last_error    TEXT,                          -- last failure message
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,                   -- set on terminal state (completed / failed)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index so the job can efficiently fetch only actionable rows.
CREATE INDEX IF NOT EXISTS idx_scheduled_payments_status
  ON public.scheduled_payments (status)
  WHERE status IN ('pending', 'failed');

-- Auto-update updated_at on every row change.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_payments_updated_at ON public.scheduled_payments;
CREATE TRIGGER trg_scheduled_payments_updated_at
  BEFORE UPDATE ON public.scheduled_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
