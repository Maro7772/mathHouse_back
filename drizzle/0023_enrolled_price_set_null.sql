ALTER TABLE `enrolledItems` DROP FOREIGN KEY `enrolledItems_priceId_prices_id_fk`;
--> statement-breakpoint
ALTER TABLE `enrolledItems` ADD CONSTRAINT `enrolledItems_priceId_prices_id_fk` FOREIGN KEY (`priceId`) REFERENCES `prices`(`id`) ON DELETE set null ON UPDATE no action;