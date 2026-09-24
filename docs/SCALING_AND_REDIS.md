# Business accounts, scaling, and Redis in BookFlow

## The two account paths

- **Book a slot:** customer signup or login. Customer accounts can hold and confirm bookings.
- **Publish slots:** business owner signup or login. Signup creates an organization and a main location. The owner adds resources, sessions, and weekly hours in Business setup. The API checks the owner's organization before any management action.

Customer and business credentials are stored separately. A customer account does not grant access to business settings. Business owners can sign in directly after signup. A business account created this way starts with no resources; it does not inherit the demo business's slots.

## Scaling already used by the app

- The API uses a bounded PostgreSQL connection pool (`DB_POOL_MAX`). Each server instance can use the same database.
- Rate limits live in PostgreSQL, so multiple API instances share the same counters. The maintenance worker deletes expired counters.
- The maintenance worker uses a PostgreSQL advisory lock so only one instance performs cleanup at a time.
- Booking transactions lock the specific resource being booked, then recheck availability. A PostgreSQL exclusion constraint also rejects overlapping bookings. Running more API instances does not weaken this guarantee.
- The customer catalog currently returns all active resources. Before a large public launch, add pagination and indexes based on measured query plans. Do not cache bookable slots without a short expiry and authoritative revalidation during booking.

## Redis basics in 20 minutes

Redis is an in-memory key/value store. It is useful for disposable data such as short-lived cache entries and rate-limit counters. PostgreSQL remains the source of truth for accounts, schedules, and bookings.

Start the optional local Redis service:

```sh
docker compose --profile learn-redis up -d redis
docker compose exec redis redis-cli
```

Try these commands in `redis-cli`:

```text
SET greeting hello
GET greeting
SET temporary yes EX 30
TTL temporary
INCR page-views
GET page-views
DEL greeting
```

`EX 30` expires a key after 30 seconds. `INCR` changes a numeric value atomically. A basic rate limiter combines `INCR` with an expiry, but production code must set both atomically (for example, with a Lua script) so a crash cannot leave a counter without an expiry.

The Redis service is an **exercise**, not a runtime dependency. The app continues to use its shared PostgreSQL rate limiter. This lets you experiment without risking logins or bookings if Redis is stopped.

To stop the exercise:

```sh
docker compose --profile learn-redis stop redis
```
