# persistence

IndexedDB is the primary bank store, partitioned by preset fingerprint. Arrangement insertion is idempotent by canonical signature and progress checkpoints are independent from bank writes. `localStorage` is compatibility-only and never owns the full bank.
