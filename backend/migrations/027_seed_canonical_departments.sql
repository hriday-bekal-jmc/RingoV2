-- Migration 027: canonical departments are reference data, not optional seed data.
--
-- Fresh deploys must have the department list even when no sample users/routes
-- are seeded. Keep this idempotent so it is safe on existing databases.

INSERT INTO departments (name, code) VALUES
  ('JMC', 'JMC'),
  ('DX事業推進室', 'DX'),
  ('企画推進室', 'KIKAKU'),
  ('保健情報部', 'HOKEN'),
  ('総務部', 'SOUMU'),
  ('美容決済部', 'BIYOU')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name;

