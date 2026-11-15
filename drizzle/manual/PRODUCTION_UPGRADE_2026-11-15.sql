-- ============================================================================
-- Math House: bring the LIVE database up to date with the redesigned portals.
-- Made from drizzle/0019 … 0024 + manual fixes, with drizzle's
-- "--> statement-breakpoint" markers removed so phpMyAdmin / mysql can run it.
--
-- 1) BACK UP the live database first (phpMyAdmin → Export).
-- 2) Run this whole file once. Don't run it twice: CREATE TABLE / ADD column fail if they already exist.
-- 3) Restart the backend.
-- ============================================================================


-- ---------------- 0019_teacher_portal.sql ----------------
-- Teacher portal: cover / cancellation requests, weekly availability, session cancellation.
-- Note: drizzle-kit also detected `notes`, `session_package_deductions` and
-- `student_plan_sessions.student_response` as new, because earlier changes were applied with
-- `drizzle-kit push` without a migration. Those already exist in the database, so they are
-- left out here; the 0019 snapshot now includes them.
CREATE TABLE `teacher_availability` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`teacher_id` char(255) NOT NULL,
	`day_of_week` int NOT NULL,
	`time_from` time NOT NULL,
	`time_to` time NOT NULL,
	`shared_at` timestamp DEFAULT (now()),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `teacher_availability_id` PRIMARY KEY(`id`)
);

CREATE TABLE `teacher_requests` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`teacher_id` char(255) NOT NULL,
	`type` enum('cover','cancellation') NOT NULL,
	`session_id` char(36),
	`request_date` date,
	`time_from` time,
	`time_to` time,
	`reason` text NOT NULL,
	`status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
	`admin_reply` text,
	`cover_teacher_id` char(255),
	`responded_by_admin_id` char(36),
	`responded_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `teacher_requests_id` PRIMARY KEY(`id`)
);

ALTER TABLE `sessions` ADD `status` enum('scheduled','cancelled') DEFAULT 'scheduled' NOT NULL;
ALTER TABLE `sessions` ADD `cancel_reason` text;
ALTER TABLE `sessions` ADD `cancelled_by` enum('admin','teacher');
ALTER TABLE `sessions` ADD `cancelled_at` timestamp;
ALTER TABLE `teacher_availability` ADD CONSTRAINT `teacher_availability_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_cover_teacher_id_teachers_id_fk` FOREIGN KEY (`cover_teacher_id`) REFERENCES `teachers`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_responded_by_admin_id_admins_id_fk` FOREIGN KEY (`responded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
CREATE INDEX `teacher_availability_teacher_idx` ON `teacher_availability` (`teacher_id`);
CREATE INDEX `teacher_requests_teacher_idx` ON `teacher_requests` (`teacher_id`);
CREATE INDEX `teacher_requests_status_idx` ON `teacher_requests` (`status`);


-- ---------------- 0020_student_portal.sql ----------------
CREATE TABLE `student_cancel_requests` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`student_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`reason` text NOT NULL,
	`status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
	`admin_reply` text,
	`responded_by_admin_id` char(36),
	`responded_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `student_cancel_requests_id` PRIMARY KEY(`id`)
);

ALTER TABLE `student_cancel_requests` ADD CONSTRAINT `student_cancel_requests_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `student_cancel_requests` ADD CONSTRAINT `student_cancel_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `student_cancel_requests` ADD CONSTRAINT `student_cancel_requests_responded_by_admin_id_admins_id_fk` FOREIGN KEY (`responded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
CREATE INDEX `student_cancel_requests_student_idx` ON `student_cancel_requests` (`student_id`);
CREATE INDEX `student_cancel_requests_session_idx` ON `student_cancel_requests` (`session_id`);
CREATE INDEX `student_cancel_requests_status_idx` ON `student_cancel_requests` (`status`);

-- ---------------- 0021_planner.sql ----------------
ALTER TABLE `sessions` ADD `confirmed_at` timestamp;
ALTER TABLE `sessions` ADD `confirmed_by` char(36);

-- ---------------- 0022_finance.sql ----------------
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

ALTER TABLE `finance_accounts` ADD CONSTRAINT `finance_accounts_payment_method_id_paymentMethod_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `paymentMethod`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `finance_adjustments_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `finance_adjustments_decided_by_admins_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_adjustments` ADD CONSTRAINT `finance_adjustments_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_close_items` ADD CONSTRAINT `finance_close_items_reviewed_by_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_close_items` ADD CONSTRAINT `finance_close_items_approved_by_admins_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_close_versions` ADD CONSTRAINT `finance_close_versions_approved_by_admins_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_expenses` ADD CONSTRAINT `finance_expenses_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_reconciliations` ADD CONSTRAINT `finance_reconciliations_account_id_finance_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `finance_reconciliations` ADD CONSTRAINT `finance_reconciliations_reviewed_by_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_reconciliations` ADD CONSTRAINT `finance_reconciliations_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_refunds` ADD CONSTRAINT `finance_refunds_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_refunds` ADD CONSTRAINT `finance_refunds_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_teacher_contracts` ADD CONSTRAINT `finance_teacher_contracts_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `finance_teacher_contracts` ADD CONSTRAINT `finance_teacher_contracts_updated_by_admins_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_teacher_settlements` ADD CONSTRAINT `finance_teacher_settlements_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `finance_teacher_settlements` ADD CONSTRAINT `finance_teacher_settlements_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_account_id_finance_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_matched_student_id_student_id_fk` FOREIGN KEY (`matched_student_id`) REFERENCES `student`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_resolved_by_admins_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `finance_unmatched` ADD CONSTRAINT `finance_unmatched_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;
CREATE INDEX `finance_adjustments_status_idx` ON `finance_adjustments` (`status`);
CREATE INDEX `finance_expenses_day_idx` ON `finance_expenses` (`spent_on`);
CREATE INDEX `finance_refunds_status_idx` ON `finance_refunds` (`status`);
CREATE INDEX `finance_unmatched_status_idx` ON `finance_unmatched` (`status`);

-- ---------------- 0023_enrolled_price_set_null.sql ----------------
ALTER TABLE `enrolledItems` DROP FOREIGN KEY `enrolledItems_priceId_prices_id_fk`;

ALTER TABLE `enrolledItems` ADD CONSTRAINT `enrolledItems_priceId_prices_id_fk` FOREIGN KEY (`priceId`) REFERENCES `prices`(`id`) ON DELETE set null ON UPDATE no action;

-- ---------------- 0024_popup_active.sql ----------------
ALTER TABLE `popups` ADD `is_active` boolean DEFAULT true NOT NULL;


-- ---------------- manual/2026-11-12_fix_enrolled_items_expires_at.sql ----------------
-- Fix: enrolledItems.expiresAt must be nullable (NULL = permanent access), as declared in
-- src/models/schema/user/enrolledItems.ts.
--
-- The live table was created as
--   `expiresAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
-- (MySQL's legacy timestamp defaults). Effects:
--   * inserting NULL fails  → "Column 'expiresAt' cannot be null"
--     (e.g. admin manual attendance / teacher attendance for sessions without contentAccessDays)
--   * any UPDATE of an enrollment row silently resets expiresAt to the current time.
--
-- This only changes the column definition. Existing rows keep their current values; review
-- them separately if some enrollments were meant to be permanent.
ALTER TABLE `enrolledItems` MODIFY `expiresAt` timestamp NULL DEFAULT NULL;


-- ---------------- Category loop fix (cause of the 502 on /api/admin/category) ----------------
-- "National Learning" must be a top-level category. Check the name first:
--   SELECT id, name, parent_category_id FROM category WHERE id = '163633e4-9bd4-4c8a-a689-abaf5ef27104';
UPDATE category SET parent_category_id = NULL WHERE id = '163633e4-9bd4-4c8a-a689-abaf5ef27104';
