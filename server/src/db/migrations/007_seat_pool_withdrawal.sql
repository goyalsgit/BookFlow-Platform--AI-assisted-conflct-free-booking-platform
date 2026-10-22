ALTER TABLE seat_pools ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled'));
ALTER TABLE seat_pools DROP CONSTRAINT seat_pools_no_overlap;
ALTER TABLE seat_pools ADD CONSTRAINT seat_pools_no_overlap EXCLUDE USING gist
 (resource_id WITH =, tstzrange(blocked_start,blocked_end,'[)') WITH &&) WHERE (status='open');

CREATE OR REPLACE FUNCTION prevent_booking_on_pool() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('held','pending_payment','confirmed','completed') THEN
  PERFORM 1 FROM providers WHERE id=NEW.provider_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM seat_pools p WHERE p.resource_id=NEW.provider_id AND p.status='open'
    AND NEW.blocked_start<p.blocked_end AND NEW.blocked_end>p.blocked_start) THEN
   RAISE EXCEPTION 'Resource has a published seat pool for this time' USING ERRCODE='23P01';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_pool_on_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='open' THEN
  PERFORM 1 FROM providers WHERE id=NEW.resource_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM bookings b WHERE b.provider_id=NEW.resource_id
    AND b.status IN ('held','pending_payment','confirmed','completed')
    AND (b.status NOT IN ('held','pending_payment') OR b.expires_at>clock_timestamp())
    AND NEW.blocked_start<b.blocked_end AND NEW.blocked_end>b.blocked_start) THEN
   RAISE EXCEPTION 'Resource has a direct booking for this time' USING ERRCODE='23P01';
  END IF;
 END IF;
 RETURN NEW;
END $$;
