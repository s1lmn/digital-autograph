# New-operation incident controls (EGO-149)

The API has two independent server-only startup settings. Each accepts only the
exact string `true` or `false`; omission defaults to `false`. Invalid values stop
startup. They do not authorize payments or enable an unconfigured provider.

| Setting                | Requests stopped when `true`                                                | Response                    |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------- |
| `DISABLE_NEW_PAYMENTS` | POST takeover quote, POST `/takeover-reservations`, POST `/payments/orders` | 503 `NEW_PAYMENTS_DISABLED` |
| `DISABLE_FREE_CLAIMS`  | POST `/walls/:wallId/slots/:slotId/free-claim`                              | 503 `FREE_CLAIMS_DISABLED`  |

The guard runs after current-session and Origin checks and before the handler,
database mutation or provider call. Anonymous/revoked sessions still receive 401;
unsafe cookie requests with a missing/foreign Origin still receive 403. Responses
are `Cache-Control: no-store`. Request bodies, headers and query strings cannot
override a switch. Malformed JSON/body-limit violations retain parser errors.

An exact retry on a stopped create endpoint also receives 503. For an existing
Order, use its owner-only status/refresh routes; for an existing claim, read the
Wall or personal history. Never create a replacement Order or provider key to
recover a stopped request.

## Preserved recovery and reads

Both switches leave account/login/logout, public Wall/media/history, personal
history, health, existing reservation reads/cancellation and owner-only Order
status/refresh available. Webhooks and `payments:reconcile` continue through the
same verified, idempotent fulfillment path. A persisted attempt whose provider
response was lost may repeat its original provider POST with its original key
and payload, subject to the existing recovery deadline. Therefore the payment
switch stops **new checkout admission**, not all provider traffic or fulfillment
of already-admitted work. Keep provider configuration and credentials available.

Settings are captured at startup. Already-admitted/in-flight requests may finish.
Changing a file does not update running APIs; all API replicas must be recreated
before shutdown is considered effective. These controls introduce no dynamic
admin endpoint, DB flag, cancellation of existing financial work or global
maintenance/Wall/upload control. A database outage can still prevent auth and
recovery. Existing Wall pause remains an independent domain operation.

## Operator procedure

For local development, set the desired values in the ignored `.env` and restart
the API. Do not include these settings in browser configuration or worker config.

For a deployed VM running an image with EGO-149 and its matching Compose file,
`deploy/compose.yaml` reads an optional, administrator-owned file
`/etc/digital-autograph/env/incident.env` **after** the Lockbox-derived `api.env`.
Only the API reads it. This persistent override is not rewritten by release,
Lockbox refresh or rollback scripts, so a later release does not clear an
incident shutdown. Without this file, existing API payload settings/defaults
apply. Rolling back to an older image that lacks these guards cannot preserve
their protection; verify version compatibility before rollback.

1. The authorized environment operator records the incident, affected operation,
   current image SHA and chosen switch values. Keep production's existing
   operator/review gate; the release runner has no new sudo permissions.
2. Create/update `incident.env` using an administrator session, ownership
   `root:root`, mode `0600`, with only these two nonsecret settings. For example,
   stopping both operations requires:

   ```dotenv
   DISABLE_NEW_PAYMENTS=true
   DISABLE_FREE_CLAIMS=true
   ```

3. Validate/recreate only the API with the VM's existing release context. Do not
   print resolved Compose configuration, `api.env`, provider credentials or
   cookies. These commands do not pull/build images, migrate or change volumes:

   ```sh
   # Production VM: use only this environment's files.
   sudo docker compose --env-file /opt/digital-autograph/release.env \
     -f /opt/digital-autograph/compose.yaml config --quiet
   sudo docker compose --env-file /opt/digital-autograph/release.env \
     -f /opt/digital-autograph/compose.yaml \
     up -d --no-deps --force-recreate --pull never api

   # Staging VM: include its database/network override in both commands.
   sudo docker compose --env-file /opt/digital-autograph/release.env \
     -f /opt/digital-autograph/compose.yaml \
     -f /opt/digital-autograph/compose.staging.yaml config --quiet
   sudo docker compose --env-file /opt/digital-autograph/release.env \
     -f /opt/digital-autograph/compose.yaml \
     -f /opt/digital-autograph/compose.staging.yaml \
     up -d --no-deps --force-recreate --pull never api
   ```

4. Verify the unchanged image, API readiness, public/history/account reads and
   the authenticated stopped-route 503 codes with an authorized synthetic/test
   account. Do not test a stopped operation with a real payment. Monitor/drain
   previously admitted work and preserve callback/reconciliation scheduling.
   Repeat for every replica; stale replicas can still admit new requests.
5. To restore admission after resolving the incident, explicitly set the chosen
   values to `false`, repeat validation/recreation and verify the intended
   independent behavior. Retain the incident record. Removing the override may
   restore different values from `api.env`; explicit `false` is unambiguous.

This change performs no deployed VM/Lockbox edits, release dispatch or real
provider requests. Local PostgreSQL tests verify rejected concurrent admission,
unbound-attempt recovery, duplicate fulfillment and preserved history/ownership.
An operator staging rehearsal remains necessary before relying on these controls
for a live Drop. Alert delivery, backups/restore, RPO/RTO and the rest of EGO-111
remain separate work.
