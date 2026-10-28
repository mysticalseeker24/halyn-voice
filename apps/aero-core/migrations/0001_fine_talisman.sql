ALTER TABLE `accounts` ADD `last4` text DEFAULT '0000' NOT NULL;--> statement-breakpoint
ALTER TABLE `loans` ADD `outstanding_minor` integer DEFAULT 0 NOT NULL;