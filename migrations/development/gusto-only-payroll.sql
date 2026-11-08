-- Development-only, additive repair for the merged Gusto schema.
-- Production schema changes go through versioned migrations; do not run this
-- file in a deployment build or from server startup.
BEGIN;
CREATE TABLE IF NOT EXISTS gusto_integrations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id text, environment text NOT NULL DEFAULT 'demo',
  state text NOT NULL DEFAULT 'not_connected', funding_account_id text,
  funding_status text, encrypted_access_token text, last_error text,
  last_synced_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gusto_employee_mappings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id varchar NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  gusto_employee_id text NOT NULL UNIQUE, company_id text, environment text,
  onboarding_status text NOT NULL DEFAULT 'unknown',
  payment_method_status text NOT NULL DEFAULT 'unknown',
  last_synced_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gusto_payroll_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gusto_payroll_id text UNIQUE, company_id text, environment text,
  period_start date NOT NULL, period_end date NOT NULL, pay_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft', provider_request_state text NOT NULL DEFAULT 'idle',
  expected_debit_date date, check_date date,
  gross_total numeric(14,2) NOT NULL DEFAULT 0,
  net_total numeric(14,2) NOT NULL DEFAULT 0,
  debit_total numeric(14,2) NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  submission_actor_user_id varchar REFERENCES users(id), submitted_at timestamp,
  last_provider_status text, last_error text,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_fingerprint text, can_cancel boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gusto_payroll_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id varchar NOT NULL REFERENCES gusto_payroll_runs(id) ON DELETE CASCADE,
  employee_id varchar NOT NULL REFERENCES employees(id), gusto_employee_id text,
  hours numeric(10,2) NOT NULL DEFAULT 0, days numeric(10,2) NOT NULL DEFAULT 0,
  gross_earnings numeric(14,2) NOT NULL DEFAULT 0, deductions numeric(14,2) NOT NULL DEFAULT 0,
  taxes numeric(14,2) NOT NULL DEFAULT 0, reimbursements numeric(14,2) NOT NULL DEFAULT 0,
  net_pay numeric(14,2) NOT NULL DEFAULT 0, provider_result jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gusto_webhook_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE gusto_integrations ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'demo';
ALTER TABLE gusto_employee_mappings ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE gusto_employee_mappings ADD COLUMN IF NOT EXISTS environment text;
ALTER TABLE gusto_payroll_runs ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE gusto_payroll_runs ADD COLUMN IF NOT EXISTS environment text;
ALTER TABLE gusto_payroll_runs ADD COLUMN IF NOT EXISTS blockers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE gusto_payroll_runs ADD COLUMN IF NOT EXISTS review_fingerprint text;
ALTER TABLE gusto_payroll_runs ADD COLUMN IF NOT EXISTS can_cancel boolean NOT NULL DEFAULT false;
COMMIT;
