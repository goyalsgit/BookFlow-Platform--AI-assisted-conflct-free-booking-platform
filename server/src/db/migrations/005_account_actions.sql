ALTER TABLE customers ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
UPDATE customers SET email_verified_at=now() WHERE email_verified_at IS NULL;
UPDATE users SET email_verified_at=now() WHERE email_verified_at IS NULL;
CREATE TABLE account_actions (
  id BIGSERIAL PRIMARY KEY,
  account_kind TEXT NOT NULL CHECK (account_kind IN ('customer','admin')),
  account_id INT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_actions_cleanup ON account_actions(expires_at);
