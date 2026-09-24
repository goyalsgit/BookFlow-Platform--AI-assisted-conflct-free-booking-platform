-- Shared fixed-window rate limits work across API instances.
CREATE TABLE request_limits (
 key TEXT PRIMARY KEY, hits INT NOT NULL, resets_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX request_limits_expiry ON request_limits(resets_at);
ALTER TABLE flow_notifications ADD COLUMN email_sent_at TIMESTAMPTZ;
ALTER TABLE flow_notifications ADD COLUMN email_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE flow_notifications ADD COLUMN email_next_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE flow_notifications ADD COLUMN email_last_error TEXT;
CREATE INDEX flow_notifications_email_pending ON flow_notifications(email_next_at) WHERE email_sent_at IS NULL;
CREATE INDEX bookings_customer_created ON bookings(customer_id, created_at DESC, id DESC);
CREATE INDEX bookings_expired_holds ON bookings(expires_at) WHERE status='held';
