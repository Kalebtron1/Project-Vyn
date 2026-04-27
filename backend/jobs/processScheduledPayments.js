/**
 * processScheduledPayments.js
 *
 * Job that picks up pending scheduled payments, broadcasts them to Stellar,
 * and updates the DB record with the outcome.
 *
 * Retry logic:
 *   - On failure: increment retry_count, store last_error, revert to 'pending'.
 *   - After MAX_RETRIES failures: set status = 'failed' and stop.
 *   - On success: set status = 'completed', store tx_hash.
 *
 * Duplicate-submission guard:
 *   - Rows are flipped to 'processing' inside a single UPDATE … WHERE status = 'pending'
 *     before any Stellar call, so a concurrent job run cannot pick the same row.
 */

"use strict";

const { createClient } = require("@supabase/supabase-js");
const {
  Keypair,
  rpc,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  Asset,
} = require("@stellar/stellar-sdk");

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RPC_URL = "https://soroban-testnet.stellar.org";

// ─── Clients (initialised lazily so the module can be imported in tests) ──────

let _supabase = null;
let _stellarServer = null;

function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // service-role key — never expose to browser
    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
      );
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

function getStellarServer() {
  if (!_stellarServer) {
    _stellarServer = new rpc.Server(RPC_URL);
  }
  return _stellarServer;
}

// ─── Stellar broadcast ────────────────────────────────────────────────────────

/**
 * Broadcasts a native XLM payment on Stellar testnet.
 *
 * @param {string} destinationAddress  Stellar public key of the recipient.
 * @param {string} amountXlm           Amount as a string (e.g. "10.5000000").
 * @returns {{ success: boolean, hash?: string, error?: string }}
 */
async function broadcastStellarPayment(destinationAddress, amountXlm) {
  try {
    const adminKeypair = Keypair.fromSecret(process.env.SECRET_KEY_ADMIN);
    const stellarServer = getStellarServer();

    const account = await stellarServer.getAccount(adminKeypair.publicKey());

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: destinationAddress,
          asset: Asset.native(),
          amount: String(amountXlm),
        })
      )
      .setTimeout(30)
      .build();

    tx = await stellarServer.prepareTransaction(tx);
    tx.sign(adminKeypair);

    const result = await stellarServer.sendTransaction(tx);
    return { success: true, hash: result.hash };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Atomically claims pending rows by flipping them to 'processing'.
 * Only rows with retry_count < MAX_RETRIES are eligible.
 * Returns the claimed rows.
 */
async function claimPendingPayments(supabase) {
  // We use a two-step approach compatible with the Supabase JS client:
  // 1. SELECT the eligible rows.
  // 2. UPDATE each one to 'processing' with a WHERE that re-checks status,
  //    so a concurrent runner that already claimed the row will simply update 0 rows.
  const { data: rows, error } = await supabase
    .from("scheduled_payments")
    .select("id, wallet_address, amount, retry_count")
    .eq("status", "pending")
    .lt("retry_count", MAX_RETRIES);

  if (error) throw new Error(`DB select failed: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const claimed = [];

  for (const row of rows) {
    const { data: updated, error: updateErr } = await supabase
      .from("scheduled_payments")
      .update({ status: "processing" })
      .eq("id", row.id)
      .eq("status", "pending") // guard: only claim if still pending
      .select("id, wallet_address, amount, retry_count")
      .single();

    if (updateErr || !updated) {
      // Another runner already claimed this row — skip it.
      console.warn(`[scheduler] Row ${row.id} already claimed by another runner, skipping.`);
      continue;
    }

    claimed.push(updated);
  }

  return claimed;
}

/**
 * Marks a payment as successfully completed.
 */
async function markCompleted(supabase, id, txHash) {
  const { error } = await supabase
    .from("scheduled_payments")
    .update({
      status: "completed",
      tx_hash: txHash,
      processed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error(`[scheduler] Failed to mark ${id} as completed: ${error.message}`);
  }
}

/**
 * Handles a failed broadcast attempt.
 * - Increments retry_count and stores last_error.
 * - If retry_count reaches MAX_RETRIES → status = 'failed' (terminal).
 * - Otherwise → status = 'pending' so the next run can retry.
 */
async function markFailed(supabase, id, currentRetryCount, errorMessage) {
  const newRetryCount = currentRetryCount + 1;
  const isTerminal = newRetryCount >= MAX_RETRIES;

  const { error } = await supabase
    .from("scheduled_payments")
    .update({
      status: isTerminal ? "failed" : "pending",
      retry_count: newRetryCount,
      last_error: errorMessage,
      ...(isTerminal ? { processed_at: new Date().toISOString() } : {}),
    })
    .eq("id", id);

  if (error) {
    console.error(`[scheduler] Failed to update retry state for ${id}: ${error.message}`);
  }

  if (isTerminal) {
    console.warn(
      `[scheduler] Payment ${id} permanently failed after ${MAX_RETRIES} attempts. Last error: ${errorMessage}`
    );
  }
}

// ─── Main job ─────────────────────────────────────────────────────────────────

/**
 * Processes all pending scheduled payments.
 * Safe to call concurrently — the 'processing' status acts as a distributed lock.
 */
async function processScheduledPayments() {
  const supabase = getSupabase();

  let claimed;
  try {
    claimed = await claimPendingPayments(supabase);
  } catch (err) {
    console.error(`[scheduler] Could not fetch pending payments: ${err.message}`);
    return;
  }

  if (claimed.length === 0) {
    console.log("[scheduler] No pending payments to process.");
    return;
  }

  console.log(`[scheduler] Processing ${claimed.length} payment(s)...`);

  for (const payment of claimed) {
    const { id, wallet_address, amount, retry_count } = payment;

    console.log(
      `[scheduler] Broadcasting payment ${id} → ${wallet_address} (${amount} XLM), attempt ${retry_count + 1}/${MAX_RETRIES}`
    );

    const result = await broadcastStellarPayment(wallet_address, amount);

    if (result.success) {
      console.log(`[scheduler] ✅ Payment ${id} succeeded. tx_hash: ${result.hash}`);
      await markCompleted(supabase, id, result.hash);
    } else {
      console.error(`[scheduler] ❌ Payment ${id} failed: ${result.error}`);
      await markFailed(supabase, id, retry_count, result.error);
    }
  }

  console.log("[scheduler] Run complete.");
}

module.exports = { processScheduledPayments };
