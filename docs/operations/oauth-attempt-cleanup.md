# OAuth attempt cleanup (EGO-150)

The worker deletes expired `oauth_login_attempts` for Google and Telegram.
Attempts already stop authorizing callbacks at their PostgreSQL `expires_at`;
cleanup changes storage use, not authentication eligibility. Both consumed and
unconsumed attempts remain until expiry. Users, social identities, sessions,
audit records and payment history are untouched.

Each worker runs one batch after its first image/notification polling cycle,
then at most once per 60 seconds using a monotonic clock. Each batch deletes
at most 1000 rows, oldest expiry first, using the existing expiry index.
Multiple workers use `FOR UPDATE SKIP LOCKED` to avoid competing for the same
rows. Locked attempts remain for a later batch. The cutoff uses PostgreSQL
statement time; an active attempt cannot be deleted by this query.

The batch is one transaction with a five-second statement timeout and a
one-second lock timeout. These settings are local to the transaction, so they
do not change API or other worker query limits. An interrupted/failed batch
rolls back and releases its connection. SIGINT/SIGTERM waits for an already
running batch before closing the pool; no new batch starts after shutdown.

A successful nonempty batch logs JSON `OAUTH_ATTEMPTS_CLEANED` with only
`deletedAttempts`. Failure logs `OAUTH_ATTEMPT_CLEANUP_FAILED`, without exception
content, hashes, callback URLs or provider data. Image/notification polling
continues and cleanup retries on the next interval, avoiding a fast retry loop.
No new environment variable, API endpoint or schema migration is required.

If expired rows accumulate, check that the deployed worker is running, inspect
these events and check PostgreSQL connectivity/locks. A stopped worker leaves
expired attempts unusable but stored; restarting resumes bounded cleanup.
Each worker can remove at most 1000 rows per minute, and actual throughput is
lower when jobs, locks or outages delay polling. Large backlogs need deliberate
capacity assessment; this implementation does not loop unboundedly to drain
them. PostgreSQL vacuum/reclaimed disk behavior remains an operational concern.

This completes only the OAuth cleanup part of early security hardening.
Login-start rate limiting, cleanup of expired sessions and broader pre-launch
security work remain separate. This does not select a legal retention policy
or implement account deletion.
