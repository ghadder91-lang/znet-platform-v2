CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_network_created` ON `audit` (`network_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`category_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_batches_network_request` ON `batches` (`network_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `idx_batches_network_created` ON `batches` (`network_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`data_mb` integer NOT NULL,
	`hours` integer NOT NULL,
	`valid_days` integer NOT NULL,
	`low_threshold` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_network_name` ON `categories` (`network_id`,`name`);--> statement-breakpoint
CREATE TABLE `networks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`province` text NOT NULL,
	`district` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_networks_owner_created` ON `networks` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`category_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`sealed` text NOT NULL,
	`suffix` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vouchers_network_fingerprint` ON `vouchers` (`network_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_vouchers_category_status` ON `vouchers` (`category_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vouchers_batch` ON `vouchers` (`batch_id`);