ALTER TABLE organizations ADD COLUMN business_type TEXT NOT NULL DEFAULT 'Other'
  CHECK (length(trim(business_type)) BETWEEN 2 AND 80);
