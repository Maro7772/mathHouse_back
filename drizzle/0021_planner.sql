ALTER TABLE `sessions` ADD `confirmed_at` timestamp;--> statement-breakpoint
ALTER TABLE `sessions` ADD `confirmed_by` char(36);