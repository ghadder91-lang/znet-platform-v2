CREATE TABLE `stock_alerts` (
	`category_id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`stock` integer NOT NULL,
	`threshold` integer NOT NULL,
	`status` text NOT NULL,
	`opened_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stock_alerts_network_status` ON `stock_alerts` (`network_id`,`status`);--> statement-breakpoint
ALTER TABLE `networks` ADD `review_note` text DEFAULT '' NOT NULL;