# Pricing Engine and Takeover Quote (EGO-97)

## Boundary

PostgreSQL and the backend determine the takeover price. A Quote is an immutable offer snapshot, not a Reservation, Order, payment, or transfer of ownership. Quote creation never mutates Wall, Slot, Placement, or Autograph. Multiple users may quote the same active Placement. The EGO-98 Reservation flow consumes an existing unexpired Quote and validates its target Placement without recomputing the Quote's amount.

The only supported currency is `RUB`. Amounts are integer kopecks in PostgreSQL `BIGINT` and domain `bigint`; the HTTP API serializes every monetary amount as a decimal string. No production amount is seeded by migrations. Without a pinned config, the quote endpoint returns `PRICING_NOT_CONFIGURED`; Free Claim and Wall reads continue normally.

## `takeover_ladder_v1`

Let `count` be the number of all successfully created Placements on the Wall with `source = takeover`, including a currently active takeover Placement. Free Claim and admin Placements do not contribute. Let `lastTakeoverAt` be the maximum `started_at` among those takeover Placements. If `count = 0`, `lastTakeoverAt` is null.

For config values in kopecks:

```text
stepIndex = min(floor(count / takeoverStepSize), dynamicTakeoverLimit)
rawLadder = baseAmountMinor + stepIndex × stepAmountMinor
ladder = clamp(rawLadder, minimumAmountMinor, maximumAmountMinor)

if lastTakeoverAt is null:
    decayIntervals = 0
else:
    decayIntervals = floor(max(0, quotedAt - lastTakeoverAt) / decayIntervalSeconds)

effectiveFloor = min(decayFloorAmountMinor, ladder)
finalAmountMinor = max(effectiveFloor, ladder - decayIntervals × decayAmountMinor)
```

The dynamic limit caps the number of ladder increments, so rising behavior stops after roughly `takeoverStepSize × dynamicTakeoverLimit` successful paid takeovers. It is configuration, never a hardcoded product count. The configured minimum, maximum, floor, and integer/time bounds are checked by the domain and PostgreSQL. A Wall without a previous takeover never decays below its starting ladder amount. The effective floor cannot raise a ladder amount. Negative or future-timestamp history fails closed as inconsistent state. This version's semantics must not change; a material future change requires a new algorithm identifier.

Decay is computed from history and one authoritative PostgreSQL time. No cron rewrites current prices. Quote TTL is 120 seconds by default and constrained to 30–300 seconds in the service; it is separate from the Reservation TTL. Expired Quotes remain immutable historical rows.

## Config versions and Wall pinning

`pricing_config_versions` stores the validated numeric rules, algorithm version, currency, creator User ID, and creation time. An append-only trigger rejects UPDATE and DELETE. Only a platform `admin` may call `POST /admin/pricing/configs`; `moderator`, `finance`, Creator owner, and ordinary User cannot. The admin may set `activateForNewWalls` while creating a version. This transaction changes the singleton `platform_pricing_default` pointer. Creating a version without activation leaves the default unchanged.

The normal Wall creation transaction copies the current default config ID into `walls.pricing_config_id`, if one exists. Existing Walls keep their prior pin when the default changes. An admin may assign a config to a Wall with a null pin via `POST /admin/walls/:wallId/pricing-config`. The API rejects reassignment and any Wall with a prior paid Quote. A database trigger prevents changing or clearing an existing non-null pin, including through direct SQL. Existing unpriced Walls remain usable for Free Claim.

## Quote transaction

`POST /walls/:wallId/slots/:slotId/takeover-quote` requires an active authenticated User and accepts only an empty body. The transaction locks the Wall, Slot, and active Placement with shared locks in Wall → Slot → Placement order. It checks Slot membership. After lock waits, one PostgreSQL read obtains the Wall-wide takeover count, last takeover timestamp, and authoritative `clock_timestamp()`. The same time drives Wall start/end checks, cooldown, decay, `quoted_at`, and `expires_at`.

The Wall must be `live`, with `start_at <= now` and `end_at > now` when those bounds exist. The Slot must contain an active Placement owned by someone else. The pricing config's guaranteed visibility interval applies to active `free_claim`, `takeover`, and `admin` Placements alike. Before `placement.started_at + guaranteedVisibilitySeconds`, the route returns `TAKEOVER_COOLDOWN_ACTIVE` with a safe `availableAt` and creates no Quote. At that instant, it becomes eligible.

`takeover_quotes` binds the User, Wall, Slot, exact active target Placement, pinned config, algorithm, currency, amount, Wall takeover count, last takeover timestamp, ladder step, ladder amount, applied decay intervals, quote time, and expiry. Its append-only trigger rejects UPDATE and DELETE. The config version plus stored input and output snapshot explain historical prices even if the global default later changes. HTTP returns no private User IDs, storage keys, provider fields, or payment data. It uses `Cache-Control: no-store`.

The Quote does not lock a Slot beyond its short transaction. A later Placement change can stale it. EGO-98's [Reservation flow](takeover-reservation.md) consumes the immutable Quote, rejects an expired or displaced target, and snapshots its amount without recalculation.
