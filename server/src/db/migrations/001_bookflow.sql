CREATE TABLE organizations (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
 timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', cancellation_cutoff_min INT NOT NULL DEFAULT 60 CHECK(cancellation_cutoff_min >= 0)
);
INSERT INTO organizations(name,slug) VALUES ('Northstar Campus','northstar');
CREATE TABLE locations (
 id SERIAL PRIMARY KEY, organization_id INT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, address TEXT NOT NULL DEFAULT ''
);
INSERT INTO locations(organization_id,name,address) VALUES (1,'Main campus','North wing · Bengaluru'),(1,'Research centre','East wing · Bengaluru');
ALTER TABLE providers DROP CONSTRAINT providers_business_type_check;
ALTER TABLE providers ADD COLUMN organization_id INT NOT NULL DEFAULT 1 REFERENCES organizations(id);
ALTER TABLE providers ADD COLUMN location_id INT NOT NULL DEFAULT 1 REFERENCES locations(id);
ALTER TABLE providers ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE providers ADD COLUMN capacity INT NOT NULL DEFAULT 1 CHECK(capacity = 1);
ALTER TABLE users ADD COLUMN organization_id INT NOT NULL DEFAULT 1 REFERENCES organizations(id);
ALTER TABLE services ADD COLUMN buffer_before_min INT NOT NULL DEFAULT 0 CHECK(buffer_before_min BETWEEN 0 AND 120);
CREATE TABLE resource_services (
 resource_id INT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE, PRIMARY KEY(resource_id,service_id)
);
INSERT INTO resource_services SELECT provider_id,id FROM services;
CREATE FUNCTION map_resource_service() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO resource_services(resource_id,service_id) VALUES(NEW.provider_id,NEW.id) ON CONFLICT DO NOTHING; RETURN NEW;
END $$;
CREATE TRIGGER map_resource_service AFTER INSERT ON services FOR EACH ROW EXECUTE FUNCTION map_resource_service();
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK(status IN('held','confirmed','completed','cancelled','no_show','expired','pending_payment'));
ALTER TABLE bookings ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN blocked_start TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN blocked_end TIMESTAMPTZ;
-- Preserve old reservations' occupied ranges during the upgrade. New writes include buffers.
UPDATE bookings SET blocked_start=starts_at, blocked_end=ends_at;
ALTER TABLE bookings ALTER COLUMN blocked_start SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN blocked_end SET NOT NULL;
CREATE FUNCTION booking_blocked_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE svc services; BEGIN
 SELECT * INTO svc FROM services WHERE id=NEW.service_id;
 IF NOT EXISTS(SELECT 1 FROM resource_services WHERE resource_id=NEW.provider_id AND service_id=NEW.service_id) THEN
 RAISE EXCEPTION 'Service is not assigned to resource' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
 NEW.blocked_start := NEW.starts_at - make_interval(mins=>svc.buffer_before_min);
 NEW.blocked_end := NEW.ends_at + make_interval(mins=>svc.buffer_min);
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER booking_blocked_range BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION booking_blocked_range();
ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
 provider_id WITH =, tstzrange(blocked_start,blocked_end,'[)') WITH &&
) WHERE(status IN('held','pending_payment','confirmed','completed'));
ALTER TABLE bookings ADD CONSTRAINT held_requires_expiry CHECK(status <> 'held' OR expires_at IS NOT NULL);
CREATE TABLE allocation_requests (
 id SERIAL PRIMARY KEY, customer_id INT NOT NULL REFERENCES customers(id), resource_id INT NOT NULL REFERENCES providers(id),
 service_id INT NOT NULL REFERENCES services(id), date DATE NOT NULL, earliest_time TIME NOT NULL, latest_time TIME NOT NULL,
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN('waiting','offered','confirmed','expired','cancelled')),
 offered_booking_id INT REFERENCES bookings(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(earliest_time <= latest_time)
);
CREATE UNIQUE INDEX allocation_request_live ON allocation_requests(customer_id,resource_id,service_id,date) WHERE status IN('waiting','offered');
CREATE TABLE flow_notifications (
 id SERIAL PRIMARY KEY, customer_id INT NOT NULL REFERENCES customers(id), booking_id INT REFERENCES bookings(id),
 title TEXT NOT NULL, message TEXT NOT NULL, dedupe_key TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), exported_at TIMESTAMPTZ
);
CREATE INDEX allocation_queue ON allocation_requests(resource_id,date,created_at) WHERE status='waiting';
