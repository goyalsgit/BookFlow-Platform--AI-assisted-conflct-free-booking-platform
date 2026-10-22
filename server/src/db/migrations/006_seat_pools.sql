CREATE TABLE seat_pools (
 id SERIAL PRIMARY KEY,
 resource_id INT NOT NULL REFERENCES providers(id),
 service_id INT NOT NULL REFERENCES services(id),
 starts_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL,
 blocked_start TIMESTAMPTZ NOT NULL,
 blocked_end TIMESTAMPTZ NOT NULL,
 request_deadline TIMESTAMPTZ NOT NULL,
 confirmation_hours INT NOT NULL CHECK (confirmation_hours BETWEEN 1 AND 48),
 rows JSONB NOT NULL,
 last_allocated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (request_deadline < starts_at AND blocked_start <= starts_at AND starts_at < ends_at AND ends_at <= blocked_end),
 CONSTRAINT seat_pools_no_overlap EXCLUDE USING gist
 (resource_id WITH =, tstzrange(blocked_start,blocked_end,'[)') WITH &&)
);
CREATE INDEX seat_pools_deadline ON seat_pools(request_deadline,starts_at);

CREATE TABLE seat_pool_requests (
 id SERIAL PRIMARY KEY,
 pool_id INT NOT NULL REFERENCES seat_pools(id),
 customer_id INT NOT NULL REFERENCES customers(id),
 party_size INT NOT NULL CHECK (party_size BETWEEN 1 AND 20),
 status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','confirmed','expired','cancelled')),
 assigned_seats JSONB,
 offer_expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 confirmed_at TIMESTAMPTZ,
 UNIQUE(pool_id,customer_id),
 UNIQUE(pool_id,id),
 CHECK ((status IN ('offered','confirmed')) = (assigned_seats IS NOT NULL)),
 CHECK (status <> 'offered' OR offer_expires_at IS NOT NULL)
);
CREATE INDEX seat_pool_waiting ON seat_pool_requests(pool_id,created_at,id) WHERE status='waiting';

CREATE TABLE seat_pool_assignments (
 pool_id INT NOT NULL,
 seat_key TEXT NOT NULL,
 request_id INT NOT NULL,
 PRIMARY KEY(pool_id,seat_key),
 FOREIGN KEY(pool_id) REFERENCES seat_pools(id),
 FOREIGN KEY(pool_id,request_id) REFERENCES seat_pool_requests(pool_id,id)
);

-- Serialize direct bookings and published pools through the provider row.
CREATE FUNCTION prevent_booking_on_pool() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('held','pending_payment','confirmed','completed') THEN
  PERFORM 1 FROM providers WHERE id=NEW.provider_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM seat_pools p WHERE p.resource_id=NEW.provider_id
    AND NEW.blocked_start<p.blocked_end AND NEW.blocked_end>p.blocked_start) THEN
   RAISE EXCEPTION 'Resource has a published seat pool for this time' USING ERRCODE='23P01';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prevent_booking_on_pool BEFORE INSERT OR UPDATE ON bookings
 FOR EACH ROW EXECUTE FUNCTION prevent_booking_on_pool();

CREATE FUNCTION prevent_pool_on_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM providers WHERE id=NEW.resource_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM bookings b WHERE b.provider_id=NEW.resource_id
   AND b.status IN ('held','pending_payment','confirmed','completed')
   AND (b.status NOT IN ('held','pending_payment') OR b.expires_at>clock_timestamp())
   AND NEW.blocked_start<b.blocked_end AND NEW.blocked_end>b.blocked_start) THEN
  RAISE EXCEPTION 'Resource has a direct booking for this time' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prevent_pool_on_booking BEFORE INSERT OR UPDATE ON seat_pools
 FOR EACH ROW EXECUTE FUNCTION prevent_pool_on_booking();
