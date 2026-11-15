CREATE TABLE `finance_accounts` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`number` varchar(255),
	`type` enum('Bank','Wallet','Cash') NOT NULL,
	`owner` varchar(255),
	`opening_balance` int NOT NULL DEFAULT 0,
	`payment_method_id` char(36),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_adjustments` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`student_id` char(36),
	`student_name` varchar(255) NOT NULL,
	`package_label` varchar(255),
	`type` enum('Discount','Price change','Extension','Session waiver','Package change') NOT NULL,
	`before_value` varchar(255) NOT NULL,
	`after_value` varchar(255) NOT NULL,
	`reason` text NOT NULL,
	`requested_by` varchar(255) NOT NULL,
	`impact` varchar(255),
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`approved_by` varchar(255),
	`approval_ref` varchar(255),
	`decision_note` text,
	`implemented_on` date,
	`decided_by` char(36),
	`decided_at` timestamp,
	`log` json,
	`created_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_close_items` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`period` char(7) NOT NULL,
	`item_key` varchar(50) NOT NULL,
	`evidence` text,
	`reviewed_by` char(36),
	`reviewed_at` timestamp,
	`approved_by` char(36),
	`approved_at` timestamp,
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_close_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_close_item_period_key` UNIQUE(`period`,`item_key`)
);
--> statement-breakpoint
CREATE TABLE `finance_close_versions` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`period` char(7) NOT NULL,
	`version` int NOT NULL,
	`totals` json,
	`note` text,
	`approved_by` char(36),
	`approved_at` timestamp DEFAULT (now()),
	CONSTRAINT `finance_close_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_close_period_version` UNIQUE(`period`,`version`)
);
--> statement-breakpoint
CREATE TABLE `finance_expenses` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`spent_on` date NOT NULL,
	`branch` varchar(255) NOT NULL,
	`category` varchar(100) NOT NULL,
	`amount` int NOT NULL,
	`payee` varchar(255) NOT NULL,
	`method` varchar(100) NOT NULL,
	`approved_by` varchar(255),
	`document` varchar(500),
	`notes` text,
	`corrects_id` char(36),
	`created_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_reconciliations` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`account_id` char(36) NOT NULL,
	`day` date NOT NULL,
	`opening` int NOT NULL DEFAULT 0,
	`system_receipts` int NOT NULL DEFAULT 0,
	`statement_receipts` int NOT NULL DEFAULT 0,
	`payments` int NOT NULL DEFAULT 0,
	`action` text,
	`status` enum('open','reconciled') NOT NULL DEFAULT 'open',
	`reviewed_by` char(36),
	`reviewed_at` timestamp,
	`created_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_reconciliations_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_recon_account_day` UNIQUE(`account_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `finance_refunds` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`student_id` char(36),
	`student_name` varchar(255) NOT NULL,
	`parent_name` varchar(255),
	`type` enum('Refund','Session dispute','Discount dispute','Package cancellation') NOT NULL,
	`requested_on` date NOT NULL,
	`amount` varchar(255) NOT NULL,
	`policy` varchar(255),
	`evidence` text,
	`reviewer` varchar(255),
	`decision` text,
	`financial_effect` varchar(255),
	`notified_on` date,
	`status` enum('review','decided','closed') NOT NULL DEFAULT 'review',
	`closed_at` timestamp,
	`log` json,
	`created_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_teacher_contracts` (
	`teacher_id` char(255) NOT NULL,
	`kind` enum('per_session','percent') NOT NULL,
	`rate_per_session` int,
	`percent` decimal(5,2),
	`basis` enum('gross','net'),
	`contract_ref` varchar(255) NOT NULL,
	`notes` text,
	`updated_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_teacher_contracts_teacher_id` PRIMARY KEY(`teacher_id`)
);
--> statement-breakpoint
CREATE TABLE `finance_teacher_settlements` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`teacher_id` char(255) NOT NULL,
	`period` char(7) NOT NULL,
	`sessions` int NOT NULL DEFAULT 0,
	`base` int,
	`due` int NOT NULL,
	`contract_snapshot` json,
	`paid_on` date,
	`payment_ref` varchar(255),
	`proof` varchar(500),
	`created_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_teacher_settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_settlement_teacher_period` UNIQUE(`teacher_id`,`period`)
);
--> statement-breakpoint
CREATE TABLE `finance_unmatched` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`received_on` date NOT NULL,
	`amount` int NOT NULL,
	`account_id` char(36),
	`payer` varchar(255) NOT NULL,
	`possible_student` varchar(255),
	`evidence` text,
	`issue` text NOT NULL,
	`owner` varchar(255),
	`due_on` date,
	`resolution` text,
	`matched_student_id` char(36),
	`status` enum('open','resolved') NOT NULL DEFAULT 'open',
	`resolved_by` char(36),
	`resolved_at` timestamp,
	`created_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_unmatched_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `finance_accounts` ADD CONSTRAINT `finance_accounts_payment_method_id_paymentMethod_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `paymentMethod`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `finance_adjustments_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `finance_adjustments_decided_by_admins_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `finance_adjustments_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_close_items` ADD CONSTRAINT `finance_close_items_reviewed_by_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_close_items` ADD CONSTRAINT `finance_close_items_approved_by_admins_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_close_versions` ADD CONSTRAINT `finance_close_versions_approved_by_admins_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_expenses` ADD CONSTRAINT `finance_expenses_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_reconciliations` ADD CONSTRAINT `finance_reconciliations_account_id_finance_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_reconciliations` ADD CONSTRAINT `finance_reconciliations_reviewed_by_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_reconciliations` ADD CONSTRAINT `finance_reconciliations_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_refunds` ADD CONSTRAINT `finance_refunds_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_refunds` ADD CONSTRAINT `finance_refunds_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_teacher_contracts` ADD CONSTRAINT `finance_teacher_contracts_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_teacher_contracts` ADD CONSTRAINT `finance_teacher_contracts_updated_by_admins_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_teacher_settlements` ADD CONSTRAINT `finance_teacher_settlements_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_teacher_settlements` ADD CONSTRAINT `finance_teacher_settlements_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_account_id_finance_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_matched_student_id_student_id_fk` FOREIGN KEY (`matched_student_id`) REFERENCES `student`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_resolved_by_admins_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `finance_adjustments_status_idx` ON `finance_adjustments` (`status`);--> statement-breakpoint
CREATE INDEX `finance_expenses_day_idx` ON `finance_expenses` (`spent_on`);--> statement-breakpoint
CREATE INDEX `finance_refunds_status_idx` ON `finance_refunds` (`status`);--> statement-breakpoint
CREATE INDEX `finance_unmatched_status_idx` ON `finance_unmatched` (`status`);