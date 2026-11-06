CREATE TABLE "bank_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"entity_type" text DEFAULT 'business' NOT NULL,
	"entity_id" varchar,
	"plaid_item_id" text NOT NULL,
	"plaid_access_token" text NOT NULL,
	"plaid_account_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"account_name" text NOT NULL,
	"account_mask" text NOT NULL,
	"account_type" text,
	"routing_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"general_contractor_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"job_id" varchar NOT NULL,
	"assigned_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_deductions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"label" text NOT NULL,
	"deduction_type" text DEFAULT 'fixed' NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"day_rate" numeric(10, 2) NOT NULL,
	"position" text,
	"hire_date" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"employment_type" text DEFAULT 'w2',
	"pay_type" text DEFAULT 'hourly',
	"annual_salary" numeric(10, 2),
	"filing_status" text DEFAULT 'single',
	"tax_allowances" integer DEFAULT 0,
	"state_code" text DEFAULT 'CA',
	"taxpayer_id_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"direct_deposit_token" text,
	"direct_deposit_token_expiry" timestamp,
	"direct_deposit_link_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "google_docs_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"google_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_docs_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "google_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"gmail_email" text,
	"sync_labels" text[] DEFAULT ARRAY['INBOX'] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "gusto_employee_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"gusto_employee_id" text NOT NULL,
	"company_id" text,
	"environment" text,
	"onboarding_status" text DEFAULT 'unknown' NOT NULL,
	"payment_method_status" text DEFAULT 'unknown' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gusto_employee_mappings_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "gusto_employee_mappings_gusto_employee_id_unique" UNIQUE("gusto_employee_id")
);
--> statement-breakpoint
CREATE TABLE "gusto_integrations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" text,
	"environment" text DEFAULT 'demo' NOT NULL,
	"state" text DEFAULT 'not_connected' NOT NULL,
	"funding_account_id" text,
	"funding_status" text,
	"encrypted_access_token" text,
	"last_error" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gusto_integrations_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "gusto_payroll_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"gusto_employee_id" text,
	"hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"days" numeric(10, 2) DEFAULT '0' NOT NULL,
	"gross_earnings" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxes" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reimbursements" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(14, 2) DEFAULT '0' NOT NULL,
	"provider_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gusto_payroll_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gusto_payroll_id" text,
	"company_id" text,
	"environment" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider_request_state" text DEFAULT 'idle' NOT NULL,
	"expected_debit_date" date,
	"check_date" date,
	"gross_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"debit_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"idempotency_key" text NOT NULL,
	"submission_actor_user_id" varchar,
	"submitted_at" timestamp,
	"last_provider_status" text,
	"last_error" text,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_fingerprint" text,
	"can_cancel" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gusto_payroll_runs_gusto_payroll_id_unique" UNIQUE("gusto_payroll_id"),
	CONSTRAINT "gusto_payroll_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "gusto_webhook_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gusto_webhook_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "inbox_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"email_id" text NOT NULL,
	"subject" text DEFAULT '(No subject)' NOT NULL,
	"sender" text NOT NULL,
	"sender_email" text,
	"snippet" text,
	"received_at" timestamp NOT NULL,
	"is_read" boolean DEFAULT true,
	"is_done" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp,
	"permanently_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp,
	"used_by_user_id" varchar,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"client_id" varchar NOT NULL,
	"job_id" varchar,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"tax_amount" numeric(10, 2) DEFAULT '0',
	"total" numeric(10, 2) NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0',
	"balance" numeric(10, 2) NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp NOT NULL,
	"notes" text,
	"terms_and_conditions" text,
	"last_reminder_sent" timestamp,
	"reminder_count" integer DEFAULT 0,
	"reminders_paused" boolean DEFAULT false NOT NULL,
	"pay_token" text,
	"pay_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_pay_token_unique" UNIQUE("pay_token")
);
--> statement-breakpoint
CREATE TABLE "job_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_data" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_materials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"purchase_date" date NOT NULL,
	"vendor" text,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"address" text,
	"status" text DEFAULT 'quoted' NOT NULL,
	"square_footage" numeric(10, 2),
	"start_date" timestamp,
	"end_date" timestamp,
	"estimated_total" numeric(10, 2),
	"reference_codes" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar,
	"invoice_id" varchar,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"is_change_order" boolean DEFAULT false,
	"change_order_reason" text,
	"section" text,
	"refs" text
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "onboarding_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"label" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_date" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"payment_date" timestamp DEFAULT now() NOT NULL,
	"reference_number" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "payroll_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_hours" numeric(10, 2) NOT NULL,
	"regular_hours" numeric(10, 2) DEFAULT '0',
	"overtime_hours" numeric(10, 2) DEFAULT '0',
	"day_rate" numeric(10, 2) NOT NULL,
	"regular_pay" numeric(10, 2) DEFAULT '0',
	"overtime_pay" numeric(10, 2) DEFAULT '0',
	"gross_pay" numeric(10, 2) NOT NULL,
	"tax_withheld" numeric(10, 2) DEFAULT '0',
	"deductions" numeric(10, 2) DEFAULT '0',
	"deductions_breakdown" jsonb DEFAULT '[]'::jsonb,
	"net_pay" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_frequency" text DEFAULT 'biweekly' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_worksheets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"days_worked" numeric(10, 2) NOT NULL,
	"daily_gross" numeric(12, 2) NOT NULL,
	"gross_pay" numeric(12, 2) NOT NULL,
	"gusto_deductions_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_deductions" numeric(12, 2) NOT NULL,
	"net_pay" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"exported_at" timestamp,
	"gusto_confirmation_reference" text,
	"gusto_confirmed_at" timestamp,
	"gusto_confirmation_notes" text,
	"created_by_user_id" varchar NOT NULL,
	"confirmed_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"plaid_account_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"name" text NOT NULL,
	"merchant_name" text,
	"pending" boolean DEFAULT false NOT NULL,
	"matched_payment_id" varchar,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "reminder_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"stage" integer NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text,
	"company_email" text,
	"company_phone" text,
	"company_address" text,
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"invoice_prefix" text DEFAULT 'INV',
	"invoice_terms" text,
	"reminder_intervals" jsonb DEFAULT '[7,14,30]'::jsonb,
	"email_settings" jsonb,
	"last_inbox_sync" timestamp,
	"inbox_sync_hour" integer DEFAULT 8,
	"collections_enabled" boolean DEFAULT true NOT NULL,
	"reminder_tones" jsonb
);
--> statement-breakpoint
CREATE TABLE "sms_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_phone" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"employee_id" varchar,
	"employee_name" text,
	"hours_requested" numeric(5, 2),
	"reply_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"job_id" varchar,
	"date" timestamp NOT NULL,
	"hours_worked" numeric(5, 2) NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"company_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"display_name" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"reset_token" text,
	"reset_token_expiry" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_deductions" ADD CONSTRAINT "employee_deductions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_docs_tokens" ADD CONSTRAINT "google_docs_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_tokens" ADD CONSTRAINT "google_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_employee_mappings" ADD CONSTRAINT "gusto_employee_mappings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_integrations" ADD CONSTRAINT "gusto_integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_payroll_items" ADD CONSTRAINT "gusto_payroll_items_run_id_gusto_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."gusto_payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_payroll_items" ADD CONSTRAINT "gusto_payroll_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_payroll_runs" ADD CONSTRAINT "gusto_payroll_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_payroll_runs" ADD CONSTRAINT "gusto_payroll_runs_submission_actor_user_id_users_id_fk" FOREIGN KEY ("submission_actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_tasks" ADD CONSTRAINT "inbox_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_documents" ADD CONSTRAINT "job_documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_materials" ADD CONSTRAINT "job_materials_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_worksheets" ADD CONSTRAINT "payroll_worksheets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_worksheets" ADD CONSTRAINT "payroll_worksheets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_worksheets" ADD CONSTRAINT "payroll_worksheets_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_matched_payment_id_payments_id_fk" FOREIGN KEY ("matched_payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_attempts" ADD CONSTRAINT "sms_attempts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;