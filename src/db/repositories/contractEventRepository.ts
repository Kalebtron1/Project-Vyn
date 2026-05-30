/**
 * contractEventRepository.ts
 *
 * Data-access layer for the `contract_events` table.
 * The table schema is assumed to be:
 *   contract_events (
 *     event_id   BIGSERIAL PRIMARY KEY,
 *     payload    JSONB NOT NULL,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   )
 *
 * The `db` parameter is a minimal query interface so the module stays
 * testable without a real database connection.
 */

export interface ContractEvent {
  event_id: number;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Minimal DB interface — pass a real pg.Pool or a test double. */
export interface DbClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Returns all contract_events with event_id > `afterEventId`, ordered
 * ascending, capped at `limit` rows.
 *
 * @param db          - Database client
 * @param afterEventId - Exclusive lower bound (the client's last seen id)
 * @param limit        - Maximum rows to return (replay window cap)
 */
export async function getEventsSince(
  db: DbClient,
  afterEventId: number,
  limit: number
): Promise<ContractEvent[]> {
  const { rows } = await db.query<ContractEvent>(
    `SELECT event_id, payload, created_at
       FROM contract_events
      WHERE event_id > $1
      ORDER BY event_id ASC
      LIMIT $2`,
    [afterEventId, limit]
  );
  return rows;
}
