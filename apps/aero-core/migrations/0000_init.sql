CREATE TABLE `accounts` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`region` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`balance_minor` integer NOT NULL,
	`is_primary` integer NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	CONSTRAINT "accounts_balance_non_negative" CHECK(balance_minor >= 0),
	CONSTRAINT "accounts_status" CHECK(status IN ('active', 'blocked')),
	CONSTRAINT "accounts_currency" CHECK(currency IN ('INR', 'USD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_customer_type` ON `accounts` (`tenant_id`,`customer_ref`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_customer_primary` ON `accounts` (`tenant_id`,`customer_ref`,`currency`) WHERE is_primary = 1;--> statement-breakpoint
CREATE TABLE `cards` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`account_id` text NOT NULL,
	`last4` text NOT NULL,
	`status` text NOT NULL,
	`frozen_at` text,
	`updated_by_grant` text,
	PRIMARY KEY(`tenant_id`, `id`),
	CONSTRAINT "cards_status" CHECK(status IN ('active', 'frozen')),
	CONSTRAINT "cards_last4" CHECK(length(last4) = 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_customer_last4` ON `cards` (`tenant_id`,`customer_ref`,`last4`);--> statement-breakpoint
CREATE TABLE `fees` (
	`tenant_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`charged_at` text NOT NULL,
	`waived_at` text,
	`waived_by_grant` text,
	PRIMARY KEY(`tenant_id`, `customer_ref`, `id`),
	CONSTRAINT "fees_amount_positive" CHECK(amount_minor > 0),
	CONSTRAINT "fees_status" CHECK(status IN ('due', 'waived')),
	CONSTRAINT "fees_currency" CHECK(currency IN ('INR', 'USD'))
);
--> statement-breakpoint
CREATE TABLE `loans` (
	`tenant_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`description` text NOT NULL,
	`emi_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`emi_day` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_grant` text,
	PRIMARY KEY(`tenant_id`, `customer_ref`, `id`),
	CONSTRAINT "loans_emi_positive" CHECK(emi_minor > 0),
	CONSTRAINT "loans_emi_day" CHECK(emi_day BETWEEN 1 AND 28),
	CONSTRAINT "loans_status" CHECK(status IN ('active', 'closed')),
	CONSTRAINT "loans_currency" CHECK(currency IN ('INR', 'USD'))
);
--> statement-breakpoint
CREATE TABLE `payees` (
	`tenant_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`id` text NOT NULL,
	`name` text,
	`account_last4` text NOT NULL,
	`ifsc` text,
	`routing_last4` text,
	`saved` integer NOT NULL,
	`added_at` text NOT NULL,
	`added_by_grant` text,
	PRIMARY KEY(`tenant_id`, `customer_ref`, `id`),
	CONSTRAINT "payees_account_last4" CHECK(length(account_last4) = 4)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`description` text NOT NULL,
	`payee_id` text,
	`fee_id` text,
	`reference` text,
	`grant_jti` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	CONSTRAINT "transactions_amount_positive" CHECK(amount_minor > 0),
	CONSTRAINT "transactions_kind" CHECK(kind IN ('credit', 'debit')),
	CONSTRAINT "transactions_currency" CHECK(currency IN ('INR', 'USD'))
);
--> statement-breakpoint
CREATE INDEX `transactions_account_time` ON `transactions` (`tenant_id`,`account_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_fee_waived_once` ON `transactions` (`tenant_id`,`customer_ref`,`fee_id`) WHERE category = 'fee_waiver';--> statement-breakpoint
CREATE TABLE `used_grants` (
	`jti` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`action` text NOT NULL,
	`request_id` text NOT NULL,
	`used_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `used_grants_customer` ON `used_grants` (`tenant_id`,`customer_ref`,`used_at`);