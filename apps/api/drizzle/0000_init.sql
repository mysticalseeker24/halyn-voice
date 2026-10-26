CREATE TABLE `action_requests` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`call_id` varchar(64),
	`run_id` varchar(128) NOT NULL,
	`customer_id` varchar(64),
	`action` varchar(48) NOT NULL,
	`params` json NOT NULL,
	`params_hash` char(64) NOT NULL,
	`readback_confirmed` boolean NOT NULL,
	`caller_quotes` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `action_requests_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`),
	CONSTRAINT `action_requests_idempotency` UNIQUE(`tenant_id`,`run_id`,`params_hash`)
);
--> statement-breakpoint
CREATE TABLE `calls` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`bolna_execution_id` varchar(128),
	`run_id` varchar(128) NOT NULL,
	`agent` varchar(32) NOT NULL,
	`channel` varchar(8) NOT NULL,
	`from_number_last4` char(4),
	`started_at` datetime(3) NOT NULL,
	`ended_at` datetime(3),
	`transcript_ref` varchar(255),
	`recording_url` varchar(512),
	`purpose` varchar(32),
	CONSTRAINT `calls_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`),
	CONSTRAINT `calls_run` UNIQUE(`tenant_id`,`run_id`)
);
--> statement-breakpoint
CREATE TABLE `confirmations` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`channel` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`answer` varchar(16),
	`bolna_execution_id` varchar(128),
	`answered_at` datetime(3),
	CONSTRAINT `confirmations_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`region` char(2) NOT NULL,
	`language` varchar(8) NOT NULL,
	`registered_number_hash` char(64) NOT NULL,
	`registered_number_last4` char(4) NOT NULL,
	`passkey_credential` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `customers_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`),
	CONSTRAINT `customers_number` UNIQUE(`tenant_id`,`region`,`registered_number_hash`)
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`outcome` varchar(8) NOT NULL,
	`final_outcome` varchar(8),
	`tier` int,
	`base_tier` int,
	`reasons` json NOT NULL,
	`signals` json NOT NULL,
	`coaching` json NOT NULL,
	`decided_at` datetime(3) NOT NULL,
	CONSTRAINT `decisions_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`),
	CONSTRAINT `decisions_request` UNIQUE(`tenant_id`,`request_id`)
);
--> statement-breakpoint
CREATE TABLE `grants` (
	`jti` char(26) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`params_hash` char(64) NOT NULL,
	`issued_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	CONSTRAINT `grants_tenant_id_jti_pk` PRIMARY KEY(`tenant_id`,`jti`)
);
--> statement-breakpoint
CREATE TABLE `handoffs` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`call_id` varchar(64),
	`reason` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL,
	`note` text,
	`created_at` datetime(3) NOT NULL,
	`resolved_at` datetime(3),
	CONSTRAINT `handoffs_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`seq` bigint NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`type` varchar(32) NOT NULL,
	`ref_id` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`prev_hash` char(64) NOT NULL,
	`hash` char(64) NOT NULL,
	`created_at` varchar(30) NOT NULL,
	CONSTRAINT `ledger_entries_tenant_id_seq_pk` PRIMARY KEY(`tenant_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `pass_codes` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`pass_id` varchar(64) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`bound_number` varchar(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	CONSTRAINT `pass_codes_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `passes` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`assistant_name` varchar(80) NOT NULL,
	`assistant_numbers` json NOT NULL,
	`scopes` json NOT NULL,
	`issued_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`status` varchar(16) NOT NULL,
	`customer_sig` text NOT NULL,
	`issuer_sig` text NOT NULL,
	`failures` int NOT NULL DEFAULT 0,
	`revoked_at` datetime(3),
	CONSTRAINT `passes_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `policy_packs` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`region` char(2) NOT NULL,
	`version` int NOT NULL,
	`compiled_json` json NOT NULL,
	`source_sha` char(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `policy_packs_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`),
	CONSTRAINT `policy_packs_region_version` UNIQUE(`tenant_id`,`region`,`version`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`default_region` char(2) NOT NULL,
	`signing_key_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`run_id` varchar(64) NOT NULL,
	`scenario_id` varchar(4) NOT NULL,
	`outcome` varchar(16) NOT NULL,
	`expected` varchar(16) NOT NULL,
	`passed` boolean NOT NULL,
	`metrics` json,
	`evidence_ref` varchar(255),
	CONSTRAINT `test_results_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `test_runs` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`suite` varchar(32) NOT NULL,
	`mode` varchar(8) NOT NULL,
	`agent_version` varchar(64),
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`summary` json,
	CONSTRAINT `test_runs_tenant_id_id_pk` PRIMARY KEY(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `confirmations_request` ON `confirmations` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `grants_request` ON `grants` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `handoffs_status` ON `handoffs` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `pass_codes_pass` ON `pass_codes` (`tenant_id`,`pass_id`);--> statement-breakpoint
CREATE INDEX `passes_customer` ON `passes` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `test_results_run` ON `test_results` (`tenant_id`,`run_id`);