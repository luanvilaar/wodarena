ALTER TABLE users
ADD COLUMN IF NOT EXISTS service_valid_until DATE;

CREATE INDEX IF NOT EXISTS idx_users_service_valid_until
ON users(service_valid_until);
