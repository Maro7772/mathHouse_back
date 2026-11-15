-- ============================================================================
-- Math House LIVE database fix: for MariaDB 10.3. Safe to run more than once.
-- Adds ONLY what your check showed is missing:
--   11 tables (10 finance_* + student_cancel_requests), sessions.confirmed_at / confirmed_by,
--   popups.is_active, enrolledItems.expiresAt -> nullable, enrolment price key CASCADE -> SET NULL,
--   category loop fix (National Learning becomes top-level).
-- Before running: BACK UP the database (phpMyAdmin -> Export).
-- Run with phpMyAdmin -> Import (live database selected). The last result is a re-check:
-- it should say "zero rows" (= nothing is missing any more).
-- ============================================================================

-- 1) New tables (foreign key checks off only while creating them, so the order doesn't matter)
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `finance_accounts` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `name` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `number` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `type` enum('Bank','Wallet','Cash') COLLATE utf8mb4_general_ci NOT NULL,
  `owner` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `opening_balance` int NOT NULL DEFAULT '0',
  `payment_method_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `finance_accounts_payment_method_id_paymentMethod_id_fk` (`payment_method_id`),
  CONSTRAINT `finance_accounts_payment_method_id_paymentMethod_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `paymentMethod` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_adjustments` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `student_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `student_name` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `package_label` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `type` enum('Discount','Price change','Extension','Session waiver','Package change') COLLATE utf8mb4_general_ci NOT NULL,
  `before_value` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `after_value` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `reason` text COLLATE utf8mb4_general_ci NOT NULL,
  `requested_by` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `impact` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `approved_by` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `approval_ref` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `decision_note` text COLLATE utf8mb4_general_ci,
  `implemented_on` date DEFAULT NULL,
  `decided_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `decided_at` timestamp NULL DEFAULT NULL,
  `log` json DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `finance_adjustments_student_id_student_id_fk` (`student_id`),
  KEY `finance_adjustments_decided_by_admins_id_fk` (`decided_by`),
  KEY `finance_adjustments_created_by_admins_id_fk` (`created_by`),
  KEY `finance_adjustments_status_idx` (`status`),
  CONSTRAINT `finance_adjustments_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_adjustments_decided_by_admins_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_adjustments_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_close_items` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `period` char(7) COLLATE utf8mb4_general_ci NOT NULL,
  `item_key` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `evidence` text COLLATE utf8mb4_general_ci,
  `reviewed_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `approved_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `finance_close_item_period_key` (`period`,`item_key`),
  KEY `finance_close_items_reviewed_by_admins_id_fk` (`reviewed_by`),
  KEY `finance_close_items_approved_by_admins_id_fk` (`approved_by`),
  CONSTRAINT `finance_close_items_approved_by_admins_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_close_items_reviewed_by_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_close_versions` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `period` char(7) COLLATE utf8mb4_general_ci NOT NULL,
  `version` int NOT NULL,
  `totals` json DEFAULT NULL,
  `note` text COLLATE utf8mb4_general_ci,
  `approved_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `finance_close_period_version` (`period`,`version`),
  KEY `finance_close_versions_approved_by_admins_id_fk` (`approved_by`),
  CONSTRAINT `finance_close_versions_approved_by_admins_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_expenses` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `spent_on` date NOT NULL,
  `branch` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `amount` int NOT NULL,
  `payee` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `method` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `approved_by` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `document` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `corrects_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `finance_expenses_created_by_admins_id_fk` (`created_by`),
  KEY `finance_expenses_day_idx` (`spent_on`),
  CONSTRAINT `finance_expenses_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_reconciliations` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `account_id` char(36) COLLATE utf8mb4_general_ci NOT NULL,
  `day` date NOT NULL,
  `opening` int NOT NULL DEFAULT '0',
  `system_receipts` int NOT NULL DEFAULT '0',
  `statement_receipts` int NOT NULL DEFAULT '0',
  `payments` int NOT NULL DEFAULT '0',
  `action` text COLLATE utf8mb4_general_ci,
  `status` enum('open','reconciled') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `reviewed_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `finance_recon_account_day` (`account_id`,`day`),
  KEY `finance_reconciliations_reviewed_by_admins_id_fk` (`reviewed_by`),
  KEY `finance_reconciliations_created_by_admins_id_fk` (`created_by`),
  CONSTRAINT `finance_reconciliations_account_id_finance_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `finance_accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `finance_reconciliations_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_reconciliations_reviewed_by_admins_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_refunds` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `student_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `student_name` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `parent_name` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `type` enum('Refund','Session dispute','Discount dispute','Package cancellation') COLLATE utf8mb4_general_ci NOT NULL,
  `requested_on` date NOT NULL,
  `amount` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `policy` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `evidence` text COLLATE utf8mb4_general_ci,
  `reviewer` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `decision` text COLLATE utf8mb4_general_ci,
  `financial_effect` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notified_on` date DEFAULT NULL,
  `status` enum('review','decided','closed') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'review',
  `closed_at` timestamp NULL DEFAULT NULL,
  `log` json DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `finance_refunds_student_id_student_id_fk` (`student_id`),
  KEY `finance_refunds_created_by_admins_id_fk` (`created_by`),
  KEY `finance_refunds_status_idx` (`status`),
  CONSTRAINT `finance_refunds_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_refunds_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_teacher_contracts` (
  `teacher_id` char(255) COLLATE utf8mb4_general_ci NOT NULL,
  `kind` enum('per_session','percent') COLLATE utf8mb4_general_ci NOT NULL,
  `rate_per_session` int DEFAULT NULL,
  `percent` decimal(5,2) DEFAULT NULL,
  `basis` enum('gross','net') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contract_ref` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `updated_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`teacher_id`),
  KEY `finance_teacher_contracts_updated_by_admins_id_fk` (`updated_by`),
  CONSTRAINT `finance_teacher_contracts_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `finance_teacher_contracts_updated_by_admins_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_teacher_settlements` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `teacher_id` char(255) COLLATE utf8mb4_general_ci NOT NULL,
  `period` char(7) COLLATE utf8mb4_general_ci NOT NULL,
  `sessions` int NOT NULL DEFAULT '0',
  `base` int DEFAULT NULL,
  `due` int NOT NULL,
  `contract_snapshot` json DEFAULT NULL,
  `paid_on` date DEFAULT NULL,
  `payment_ref` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `proof` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `finance_settlement_teacher_period` (`teacher_id`,`period`),
  KEY `finance_teacher_settlements_created_by_admins_id_fk` (`created_by`),
  CONSTRAINT `finance_teacher_settlements_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_teacher_settlements_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `finance_unmatched` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `received_on` date NOT NULL,
  `amount` int NOT NULL,
  `account_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payer` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `possible_student` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `evidence` text COLLATE utf8mb4_general_ci,
  `issue` text COLLATE utf8mb4_general_ci NOT NULL,
  `owner` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `due_on` date DEFAULT NULL,
  `resolution` text COLLATE utf8mb4_general_ci,
  `matched_student_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('open','resolved') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `resolved_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `finance_unmatched_account_id_finance_accounts_id_fk` (`account_id`),
  KEY `finance_unmatched_matched_student_id_student_id_fk` (`matched_student_id`),
  KEY `finance_unmatched_resolved_by_admins_id_fk` (`resolved_by`),
  KEY `finance_unmatched_created_by_admins_id_fk` (`created_by`),
  KEY `finance_unmatched_status_idx` (`status`),
  CONSTRAINT `finance_unmatched_account_id_finance_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `finance_accounts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_unmatched_created_by_admins_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_unmatched_matched_student_id_student_id_fk` FOREIGN KEY (`matched_student_id`) REFERENCES `student` (`id`) ON DELETE SET NULL,
  CONSTRAINT `finance_unmatched_resolved_by_admins_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `student_cancel_requests` (
  `id` char(36) COLLATE utf8mb4_general_ci NOT NULL DEFAULT (uuid()),
  `student_id` char(36) COLLATE utf8mb4_general_ci NOT NULL,
  `session_id` char(36) COLLATE utf8mb4_general_ci NOT NULL,
  `reason` text COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('pending','accepted','rejected') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `admin_reply` text COLLATE utf8mb4_general_ci,
  `responded_by_admin_id` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `responded_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT (now()),
  `updated_at` timestamp NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `student_cancel_requests_responded_by_admin_id_admins_id_fk` (`responded_by_admin_id`),
  KEY `student_cancel_requests_student_idx` (`student_id`),
  KEY `student_cancel_requests_session_idx` (`session_id`),
  KEY `student_cancel_requests_status_idx` (`status`),
  CONSTRAINT `student_cancel_requests_responded_by_admin_id_admins_id_fk` FOREIGN KEY (`responded_by_admin_id`) REFERENCES `admins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `student_cancel_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `student_cancel_requests_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- 2) New columns on existing tables
ALTER TABLE `sessions`
  ADD COLUMN IF NOT EXISTS `confirmed_at` timestamp NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `confirmed_by` char(36) COLLATE utf8mb4_general_ci DEFAULT NULL;
ALTER TABLE `popups` ADD COLUMN IF NOT EXISTS `is_active` tinyint(1) NOT NULL DEFAULT 1;

-- 3) Enrolment expiry: NULL = permanent access, and no more auto-reset to "now" on every update
ALTER TABLE `enrolledItems` MODIFY `expiresAt` timestamp NULL DEFAULT NULL;

-- 4) Category loop (cause of the 502 on /api/admin/category): "National Learning" becomes top-level
UPDATE `category` SET `parent_category_id` = NULL WHERE `id` = '163633e4-9bd4-4c8a-a689-abaf5ef27104';

-- 5) IMPORTANT: editing a price must not delete students' enrolments (CASCADE -> SET NULL)
ALTER TABLE `enrolledItems` DROP FOREIGN KEY IF EXISTS `enrolledItems_priceId_prices_id_fk`;
ALTER TABLE `enrolledItems` ADD CONSTRAINT `enrolledItems_priceId_prices_id_fk`
  FOREIGN KEY (`priceId`) REFERENCES `prices` (`id`) ON DELETE SET NULL;

-- 6) Re-check: lists anything still missing. "Zero rows" = done.
SET SESSION group_concat_max_len = 100000;
SELECT x.tb AS `table`,
       IF(t.TABLE_NAME IS NULL, '(whole table missing)', GROUP_CONCAT(x.col ORDER BY x.col SEPARATOR ', ')) AS missing_columns
FROM (
SELECT 'adaptive_exam' AS tb, 'id' AS col
UNION ALL SELECT 'adaptive_exam', 'exam_id'
UNION ALL SELECT 'adaptive_exam', 'created_at'
UNION ALL SELECT 'adaptive_exam', 'updated_at'
UNION ALL SELECT 'admin_availability_slots', 'id'
UNION ALL SELECT 'admin_availability_slots', 'day_of_week'
UNION ALL SELECT 'admin_availability_slots', 'time_from'
UNION ALL SELECT 'admin_availability_slots', 'time_to'
UNION ALL SELECT 'admin_availability_slots', 'is_active'
UNION ALL SELECT 'admin_availability_slots', 'created_by'
UNION ALL SELECT 'admin_availability_slots', 'created_at'
UNION ALL SELECT 'admin_availability_slots', 'updated_at'
UNION ALL SELECT 'admins', 'id'
UNION ALL SELECT 'admins', 'name'
UNION ALL SELECT 'admins', 'email'
UNION ALL SELECT 'admins', 'type'
UNION ALL SELECT 'admins', 'phone_number'
UNION ALL SELECT 'admins', 'password'
UNION ALL SELECT 'admins', 'role_id'
UNION ALL SELECT 'admins', 'permissions'
UNION ALL SELECT 'admins', 'status'
UNION ALL SELECT 'admins', 'created_at'
UNION ALL SELECT 'admins', 'updated_at'
UNION ALL SELECT 'category', 'id'
UNION ALL SELECT 'category', 'name'
UNION ALL SELECT 'category', 'description'
UNION ALL SELECT 'category', 'image'
UNION ALL SELECT 'category', 'parent_category_id'
UNION ALL SELECT 'category', 'created_at'
UNION ALL SELECT 'category', 'updated_at'
UNION ALL SELECT 'chapters', 'id'
UNION ALL SELECT 'chapters', 'name'
UNION ALL SELECT 'chapters', 'category_id'
UNION ALL SELECT 'chapters', 'semester_id'
UNION ALL SELECT 'chapters', 'course_id'
UNION ALL SELECT 'chapters', 'description'
UNION ALL SELECT 'chapters', 'image'
UNION ALL SELECT 'chapters', 'teacher_id'
UNION ALL SELECT 'chapters', 'order'
UNION ALL SELECT 'chapters', 'pre_requisition'
UNION ALL SELECT 'chapters', 'what_you_gain'
UNION ALL SELECT 'chapters', 'created_at'
UNION ALL SELECT 'chapters', 'updated_at'
UNION ALL SELECT 'conversion_rate', 'id'
UNION ALL SELECT 'conversion_rate', 'from_currency_id'
UNION ALL SELECT 'conversion_rate', 'to_currency_id'
UNION ALL SELECT 'conversion_rate', 'rate'
UNION ALL SELECT 'conversion_rate', 'fetched_at'
UNION ALL SELECT 'course_teachers', 'course_id'
UNION ALL SELECT 'course_teachers', 'teacher_id'
UNION ALL SELECT 'course_teachers', 'role'
UNION ALL SELECT 'course_teachers', 'created_at'
UNION ALL SELECT 'courses', 'id'
UNION ALL SELECT 'courses', 'name'
UNION ALL SELECT 'courses', 'category_id'
UNION ALL SELECT 'courses', 'description'
UNION ALL SELECT 'courses', 'image'
UNION ALL SELECT 'courses', 'pre_requisition'
UNION ALL SELECT 'courses', 'what_you_gain'
UNION ALL SELECT 'courses', 'is_have_semester'
UNION ALL SELECT 'courses', 'created_at'
UNION ALL SELECT 'courses', 'updated_at'
UNION ALL SELECT 'currency', 'id'
UNION ALL SELECT 'currency', 'name'
UNION ALL SELECT 'currency', 'symbol'
UNION ALL SELECT 'currency', 'code'
UNION ALL SELECT 'currency', 'exchange_rate'
UNION ALL SELECT 'currency', 'is_base'
UNION ALL SELECT 'currency', 'created_at'
UNION ALL SELECT 'currency', 'updated_at'
UNION ALL SELECT 'diagnostic_exam', 'id'
UNION ALL SELECT 'diagnostic_exam', 'title'
UNION ALL SELECT 'diagnostic_exam', 'description'
UNION ALL SELECT 'diagnostic_exam', 'duration'
UNION ALL SELECT 'diagnostic_exam', 'total_score'
UNION ALL SELECT 'diagnostic_exam', 'pass_score'
UNION ALL SELECT 'diagnostic_exam', 'raw_score_id'
UNION ALL SELECT 'diagnostic_exam', 'number_of_questions'
UNION ALL SELECT 'diagnostic_exam', 'is_active'
UNION ALL SELECT 'diagnostic_exam', 'course_id'
UNION ALL SELECT 'diagnostic_exam', 'calculators'
UNION ALL SELECT 'diagnostic_exam', 'created_at'
UNION ALL SELECT 'diagnostic_exam', 'updated_at'
UNION ALL SELECT 'diagnostic_exam_attempt', 'id'
UNION ALL SELECT 'diagnostic_exam_attempt', 'studentId'
UNION ALL SELECT 'diagnostic_exam_attempt', 'diagnosticExamId'
UNION ALL SELECT 'diagnostic_exam_attempt', 'score'
UNION ALL SELECT 'diagnostic_exam_attempt', 'is_completed'
UNION ALL SELECT 'diagnostic_exam_attempt', 'startedAt'
UNION ALL SELECT 'diagnostic_exam_attempt', 'endedAt'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'id'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'attempt_id'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'question_id'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'student_answer_id'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'student_grid_in_answer'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'is_correct'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'created_at'
UNION ALL SELECT 'diagnostic_exam_attempt_answers', 'updated_at'
UNION ALL SELECT 'diagnostic_exam_questions', 'id'
UNION ALL SELECT 'diagnostic_exam_questions', 'diagnostic_exam_id'
UNION ALL SELECT 'diagnostic_exam_questions', 'question_id'
UNION ALL SELECT 'diagnostic_exam_questions', 'score'
UNION ALL SELECT 'diagnostic_exam_questions', 'created_at'
UNION ALL SELECT 'diagnostic_exam_questions', 'updated_at'
UNION ALL SELECT 'drive_assets', 'id'
UNION ALL SELECT 'drive_assets', 'title'
UNION ALL SELECT 'drive_assets', 'type'
UNION ALL SELECT 'drive_assets', 'status'
UNION ALL SELECT 'drive_assets', 'folder_id'
UNION ALL SELECT 'drive_assets', 'bunny_guid'
UNION ALL SELECT 'drive_assets', 'source_url'
UNION ALL SELECT 'drive_assets', 'created_at'
UNION ALL SELECT 'drive_assets', 'updated_at'
UNION ALL SELECT 'drive_folders', 'id'
UNION ALL SELECT 'drive_folders', 'name'
UNION ALL SELECT 'drive_folders', 'parent_folder_id'
UNION ALL SELECT 'drive_folders', 'created_at'
UNION ALL SELECT 'drive_folders', 'updated_at'
UNION ALL SELECT 'enrolleditems', 'id'
UNION ALL SELECT 'enrolleditems', 'studentId'
UNION ALL SELECT 'enrolleditems', 'courseId'
UNION ALL SELECT 'enrolleditems', 'semesterId'
UNION ALL SELECT 'enrolleditems', 'chapterId'
UNION ALL SELECT 'enrolleditems', 'lessonId'
UNION ALL SELECT 'enrolleditems', 'paymentId'
UNION ALL SELECT 'enrolleditems', 'priceId'
UNION ALL SELECT 'enrolleditems', 'expiresAt'
UNION ALL SELECT 'enrolleditems', 'status'
UNION ALL SELECT 'enrolleditems', 'createdAt'
UNION ALL SELECT 'exam_attempts', 'id'
UNION ALL SELECT 'exam_attempts', 'student_id'
UNION ALL SELECT 'exam_attempts', 'exam_id'
UNION ALL SELECT 'exam_attempts', 'started_at'
UNION ALL SELECT 'exam_attempts', 'ended_at'
UNION ALL SELECT 'exam_attempts', 'score'
UNION ALL SELECT 'exam_attempts', 'is_passed'
UNION ALL SELECT 'exam_attempts', 'status'
UNION ALL SELECT 'exam_attempts', 'created_at'
UNION ALL SELECT 'exam_attempts', 'updated_at'
UNION ALL SELECT 'exam_codes', 'id'
UNION ALL SELECT 'exam_codes', 'code'
UNION ALL SELECT 'exam_codes', 'created_at'
UNION ALL SELECT 'exam_codes', 'updated_at'
UNION ALL SELECT 'exam_sections', 'id'
UNION ALL SELECT 'exam_sections', 'section_id'
UNION ALL SELECT 'exam_sections', 'section_order'
UNION ALL SELECT 'exam_sections', 'exam_id'
UNION ALL SELECT 'exam_sections', 'duration'
UNION ALL SELECT 'exam_sections', 'break_limited'
UNION ALL SELECT 'exam_sections', 'max_break_duration'
UNION ALL SELECT 'exam_sections', 'created_at'
UNION ALL SELECT 'exam_sections', 'updated_at'
UNION ALL SELECT 'exams', 'id'
UNION ALL SELECT 'exams', 'title'
UNION ALL SELECT 'exams', 'description'
UNION ALL SELECT 'exams', 'duration'
UNION ALL SELECT 'exams', 'total_score'
UNION ALL SELECT 'exams', 'pass_score'
UNION ALL SELECT 'exams', 'raw_score_id'
UNION ALL SELECT 'exams', 'is_active'
UNION ALL SELECT 'exams', 'exam_type'
UNION ALL SELECT 'exams', 'course_id'
UNION ALL SELECT 'exams', 'year'
UNION ALL SELECT 'exams', 'month'
UNION ALL SELECT 'exams', 'code_id'
UNION ALL SELECT 'exams', 'calculators'
UNION ALL SELECT 'exams', 'created_at'
UNION ALL SELECT 'exams', 'updated_at'
UNION ALL SELECT 'exams', 'session_pdf'
UNION ALL SELECT 'exams', 'session_answers_pdf'
UNION ALL SELECT 'extra_homework', 'id'
UNION ALL SELECT 'extra_homework', 'title'
UNION ALL SELECT 'extra_homework', 'description'
UNION ALL SELECT 'extra_homework', 'pdf_url'
UNION ALL SELECT 'extra_homework', 'link'
UNION ALL SELECT 'extra_homework', 'due_date'
UNION ALL SELECT 'extra_homework', 'target_type'
UNION ALL SELECT 'extra_homework', 'target_category_id'
UNION ALL SELECT 'extra_homework', 'target_grade_id'
UNION ALL SELECT 'extra_homework', 'target_group_id'
UNION ALL SELECT 'extra_homework', 'created_by'
UNION ALL SELECT 'extra_homework', 'created_at'
UNION ALL SELECT 'extra_homework', 'updated_at'
UNION ALL SELECT 'extra_homework_students', 'id'
UNION ALL SELECT 'extra_homework_students', 'homework_id'
UNION ALL SELECT 'extra_homework_students', 'student_id'
UNION ALL SELECT 'extra_homework_students', 'status'
UNION ALL SELECT 'extra_homework_students', 'submitted_pdf'
UNION ALL SELECT 'extra_homework_students', 'submitted_at'
UNION ALL SELECT 'extra_homework_students', 'student_notes'
UNION ALL SELECT 'extra_homework_students', 'score'
UNION ALL SELECT 'extra_homework_students', 'feedback'
UNION ALL SELECT 'extra_homework_students', 'reviewed_at'
UNION ALL SELECT 'extra_homework_students', 'reviewed_by'
UNION ALL SELECT 'extra_homework_students', 'created_at'
UNION ALL SELECT 'extra_homework_students', 'updated_at'
UNION ALL SELECT 'finance_accounts', 'id'
UNION ALL SELECT 'finance_accounts', 'name'
UNION ALL SELECT 'finance_accounts', 'number'
UNION ALL SELECT 'finance_accounts', 'type'
UNION ALL SELECT 'finance_accounts', 'owner'
UNION ALL SELECT 'finance_accounts', 'opening_balance'
UNION ALL SELECT 'finance_accounts', 'payment_method_id'
UNION ALL SELECT 'finance_accounts', 'is_active'
UNION ALL SELECT 'finance_accounts', 'created_at'
UNION ALL SELECT 'finance_accounts', 'updated_at'
UNION ALL SELECT 'finance_adjustments', 'id'
UNION ALL SELECT 'finance_adjustments', 'student_id'
UNION ALL SELECT 'finance_adjustments', 'student_name'
UNION ALL SELECT 'finance_adjustments', 'package_label'
UNION ALL SELECT 'finance_adjustments', 'type'
UNION ALL SELECT 'finance_adjustments', 'before_value'
UNION ALL SELECT 'finance_adjustments', 'after_value'
UNION ALL SELECT 'finance_adjustments', 'reason'
UNION ALL SELECT 'finance_adjustments', 'requested_by'
UNION ALL SELECT 'finance_adjustments', 'impact'
UNION ALL SELECT 'finance_adjustments', 'status'
UNION ALL SELECT 'finance_adjustments', 'approved_by'
UNION ALL SELECT 'finance_adjustments', 'approval_ref'
UNION ALL SELECT 'finance_adjustments', 'decision_note'
UNION ALL SELECT 'finance_adjustments', 'implemented_on'
UNION ALL SELECT 'finance_adjustments', 'decided_by'
UNION ALL SELECT 'finance_adjustments', 'decided_at'
UNION ALL SELECT 'finance_adjustments', 'log'
UNION ALL SELECT 'finance_adjustments', 'created_by'
UNION ALL SELECT 'finance_adjustments', 'created_at'
UNION ALL SELECT 'finance_adjustments', 'updated_at'
UNION ALL SELECT 'finance_close_items', 'id'
UNION ALL SELECT 'finance_close_items', 'period'
UNION ALL SELECT 'finance_close_items', 'item_key'
UNION ALL SELECT 'finance_close_items', 'evidence'
UNION ALL SELECT 'finance_close_items', 'reviewed_by'
UNION ALL SELECT 'finance_close_items', 'reviewed_at'
UNION ALL SELECT 'finance_close_items', 'approved_by'
UNION ALL SELECT 'finance_close_items', 'approved_at'
UNION ALL SELECT 'finance_close_items', 'updated_at'
UNION ALL SELECT 'finance_close_versions', 'id'
UNION ALL SELECT 'finance_close_versions', 'period'
UNION ALL SELECT 'finance_close_versions', 'version'
UNION ALL SELECT 'finance_close_versions', 'totals'
UNION ALL SELECT 'finance_close_versions', 'note'
UNION ALL SELECT 'finance_close_versions', 'approved_by'
UNION ALL SELECT 'finance_close_versions', 'approved_at'
UNION ALL SELECT 'finance_expenses', 'id'
UNION ALL SELECT 'finance_expenses', 'spent_on'
UNION ALL SELECT 'finance_expenses', 'branch'
UNION ALL SELECT 'finance_expenses', 'category'
UNION ALL SELECT 'finance_expenses', 'amount'
UNION ALL SELECT 'finance_expenses', 'payee'
UNION ALL SELECT 'finance_expenses', 'method'
UNION ALL SELECT 'finance_expenses', 'approved_by'
UNION ALL SELECT 'finance_expenses', 'document'
UNION ALL SELECT 'finance_expenses', 'notes'
UNION ALL SELECT 'finance_expenses', 'corrects_id'
UNION ALL SELECT 'finance_expenses', 'created_by'
UNION ALL SELECT 'finance_expenses', 'created_at'
UNION ALL SELECT 'finance_expenses', 'updated_at'
UNION ALL SELECT 'finance_reconciliations', 'id'
UNION ALL SELECT 'finance_reconciliations', 'account_id'
UNION ALL SELECT 'finance_reconciliations', 'day'
UNION ALL SELECT 'finance_reconciliations', 'opening'
UNION ALL SELECT 'finance_reconciliations', 'system_receipts'
UNION ALL SELECT 'finance_reconciliations', 'statement_receipts'
UNION ALL SELECT 'finance_reconciliations', 'payments'
UNION ALL SELECT 'finance_reconciliations', 'action'
UNION ALL SELECT 'finance_reconciliations', 'status'
UNION ALL SELECT 'finance_reconciliations', 'reviewed_by'
UNION ALL SELECT 'finance_reconciliations', 'reviewed_at'
UNION ALL SELECT 'finance_reconciliations', 'created_by'
UNION ALL SELECT 'finance_reconciliations', 'created_at'
UNION ALL SELECT 'finance_reconciliations', 'updated_at'
UNION ALL SELECT 'finance_refunds', 'id'
UNION ALL SELECT 'finance_refunds', 'student_id'
UNION ALL SELECT 'finance_refunds', 'student_name'
UNION ALL SELECT 'finance_refunds', 'parent_name'
UNION ALL SELECT 'finance_refunds', 'type'
UNION ALL SELECT 'finance_refunds', 'requested_on'
UNION ALL SELECT 'finance_refunds', 'amount'
UNION ALL SELECT 'finance_refunds', 'policy'
UNION ALL SELECT 'finance_refunds', 'evidence'
UNION ALL SELECT 'finance_refunds', 'reviewer'
UNION ALL SELECT 'finance_refunds', 'decision'
UNION ALL SELECT 'finance_refunds', 'financial_effect'
UNION ALL SELECT 'finance_refunds', 'notified_on'
UNION ALL SELECT 'finance_refunds', 'status'
UNION ALL SELECT 'finance_refunds', 'closed_at'
UNION ALL SELECT 'finance_refunds', 'log'
UNION ALL SELECT 'finance_refunds', 'created_by'
UNION ALL SELECT 'finance_refunds', 'created_at'
UNION ALL SELECT 'finance_refunds', 'updated_at'
UNION ALL SELECT 'finance_teacher_contracts', 'teacher_id'
UNION ALL SELECT 'finance_teacher_contracts', 'kind'
UNION ALL SELECT 'finance_teacher_contracts', 'rate_per_session'
UNION ALL SELECT 'finance_teacher_contracts', 'percent'
UNION ALL SELECT 'finance_teacher_contracts', 'basis'
UNION ALL SELECT 'finance_teacher_contracts', 'contract_ref'
UNION ALL SELECT 'finance_teacher_contracts', 'notes'
UNION ALL SELECT 'finance_teacher_contracts', 'updated_by'
UNION ALL SELECT 'finance_teacher_contracts', 'created_at'
UNION ALL SELECT 'finance_teacher_contracts', 'updated_at'
UNION ALL SELECT 'finance_teacher_settlements', 'id'
UNION ALL SELECT 'finance_teacher_settlements', 'teacher_id'
UNION ALL SELECT 'finance_teacher_settlements', 'period'
UNION ALL SELECT 'finance_teacher_settlements', 'sessions'
UNION ALL SELECT 'finance_teacher_settlements', 'base'
UNION ALL SELECT 'finance_teacher_settlements', 'due'
UNION ALL SELECT 'finance_teacher_settlements', 'contract_snapshot'
UNION ALL SELECT 'finance_teacher_settlements', 'paid_on'
UNION ALL SELECT 'finance_teacher_settlements', 'payment_ref'
UNION ALL SELECT 'finance_teacher_settlements', 'proof'
UNION ALL SELECT 'finance_teacher_settlements', 'created_by'
UNION ALL SELECT 'finance_teacher_settlements', 'created_at'
UNION ALL SELECT 'finance_teacher_settlements', 'updated_at'
UNION ALL SELECT 'finance_unmatched', 'id'
UNION ALL SELECT 'finance_unmatched', 'received_on'
UNION ALL SELECT 'finance_unmatched', 'amount'
UNION ALL SELECT 'finance_unmatched', 'account_id'
UNION ALL SELECT 'finance_unmatched', 'payer'
UNION ALL SELECT 'finance_unmatched', 'possible_student'
UNION ALL SELECT 'finance_unmatched', 'evidence'
UNION ALL SELECT 'finance_unmatched', 'issue'
UNION ALL SELECT 'finance_unmatched', 'owner'
UNION ALL SELECT 'finance_unmatched', 'due_on'
UNION ALL SELECT 'finance_unmatched', 'resolution'
UNION ALL SELECT 'finance_unmatched', 'matched_student_id'
UNION ALL SELECT 'finance_unmatched', 'status'
UNION ALL SELECT 'finance_unmatched', 'resolved_by'
UNION ALL SELECT 'finance_unmatched', 'resolved_at'
UNION ALL SELECT 'finance_unmatched', 'created_by'
UNION ALL SELECT 'finance_unmatched', 'created_at'
UNION ALL SELECT 'finance_unmatched', 'updated_at'
UNION ALL SELECT 'grade', 'id'
UNION ALL SELECT 'grade', 'name'
UNION ALL SELECT 'grade', 'name_ar'
UNION ALL SELECT 'grade', 'category_id'
UNION ALL SELECT 'grade', 'parent_category_id'
UNION ALL SELECT 'grade', 'created_at'
UNION ALL SELECT 'grade', 'updated_at'
UNION ALL SELECT 'group_students', 'id'
UNION ALL SELECT 'group_students', 'group_id'
UNION ALL SELECT 'group_students', 'student_id'
UNION ALL SELECT 'group_students', 'created_at'
UNION ALL SELECT 'groups', 'id'
UNION ALL SELECT 'groups', 'name'
UNION ALL SELECT 'groups', 'is_active'
UNION ALL SELECT 'groups', 'created_at'
UNION ALL SELECT 'groups', 'updated_at'
UNION ALL SELECT 'lesson_ideas', 'id'
UNION ALL SELECT 'lesson_ideas', 'idea'
UNION ALL SELECT 'lesson_ideas', 'lesson_id'
UNION ALL SELECT 'lesson_ideas', 'idea_order'
UNION ALL SELECT 'lesson_ideas', 'pdf'
UNION ALL SELECT 'lesson_ideas', 'video'
UNION ALL SELECT 'lesson_ideas', 'bunny_guid'
UNION ALL SELECT 'lesson_ideas', 'created_at'
UNION ALL SELECT 'lesson_ideas', 'updated_at'
UNION ALL SELECT 'lessons', 'id'
UNION ALL SELECT 'lessons', 'name'
UNION ALL SELECT 'lessons', 'category_id'
UNION ALL SELECT 'lessons', 'course_id'
UNION ALL SELECT 'lessons', 'chapter_id'
UNION ALL SELECT 'lessons', 'description'
UNION ALL SELECT 'lessons', 'image'
UNION ALL SELECT 'lessons', 'teacher_id'
UNION ALL SELECT 'lessons', 'order'
UNION ALL SELECT 'lessons', 'pre_requisition'
UNION ALL SELECT 'lessons', 'what_you_gain'
UNION ALL SELECT 'lessons', 'created_at'
UNION ALL SELECT 'lessons', 'updated_at'
UNION ALL SELECT 'lessons', 'session_pdf'
UNION ALL SELECT 'lessons', 'session_answers_pdf'
UNION ALL SELECT 'notes', 'id'
UNION ALL SELECT 'notes', 'student_id'
UNION ALL SELECT 'notes', 'title'
UNION ALL SELECT 'notes', 'content'
UNION ALL SELECT 'notes', 'created_at'
UNION ALL SELECT 'notes', 'updated_at'
UNION ALL SELECT 'notification_parents', 'id'
UNION ALL SELECT 'notification_parents', 'notification_id'
UNION ALL SELECT 'notification_parents', 'parent_id'
UNION ALL SELECT 'notification_parents', 'is_read'
UNION ALL SELECT 'notification_parents', 'created_at'
UNION ALL SELECT 'notification_students', 'id'
UNION ALL SELECT 'notification_students', 'notification_id'
UNION ALL SELECT 'notification_students', 'student_id'
UNION ALL SELECT 'notification_students', 'is_read'
UNION ALL SELECT 'notification_students', 'created_at'
UNION ALL SELECT 'notification_teachers', 'id'
UNION ALL SELECT 'notification_teachers', 'notification_id'
UNION ALL SELECT 'notification_teachers', 'teacher_id'
UNION ALL SELECT 'notification_teachers', 'is_read'
UNION ALL SELECT 'notification_teachers', 'created_at'
UNION ALL SELECT 'notifications', 'id'
UNION ALL SELECT 'notifications', 'material_link'
UNION ALL SELECT 'notifications', 'material_file'
UNION ALL SELECT 'notifications', 'date_time'
UNION ALL SELECT 'notifications', 'notification'
UNION ALL SELECT 'notifications', 'send_to_all'
UNION ALL SELECT 'notifications', 'created_at'
UNION ALL SELECT 'notifications', 'updated_at'
UNION ALL SELECT 'packages', 'id'
UNION ALL SELECT 'packages', 'name'
UNION ALL SELECT 'packages', 'type'
UNION ALL SELECT 'packages', 'category_id'
UNION ALL SELECT 'packages', 'course_id'
UNION ALL SELECT 'packages', 'number'
UNION ALL SELECT 'packages', 'price'
UNION ALL SELECT 'packages', 'duration'
UNION ALL SELECT 'packages', 'created_at'
UNION ALL SELECT 'packages', 'updated_at'
UNION ALL SELECT 'packages', 'has_answers'
UNION ALL SELECT 'packages', 'answers_price'
UNION ALL SELECT 'parallel_question_options', 'id'
UNION ALL SELECT 'parallel_question_options', 'question_id'
UNION ALL SELECT 'parallel_question_options', 'answer'
UNION ALL SELECT 'parallel_question_options', 'is_correct'
UNION ALL SELECT 'parallel_question_options', 'order'
UNION ALL SELECT 'parallel_question_options', 'created_at'
UNION ALL SELECT 'parallel_question_options', 'updated_at'
UNION ALL SELECT 'parallel_questions', 'id'
UNION ALL SELECT 'parallel_questions', 'question_id'
UNION ALL SELECT 'parallel_questions', 'question'
UNION ALL SELECT 'parallel_questions', 'answerType'
UNION ALL SELECT 'parallel_questions', 'difficulty'
UNION ALL SELECT 'parallel_questions', 'lesson_id'
UNION ALL SELECT 'parallel_questions', 'created_at'
UNION ALL SELECT 'parallel_questions', 'updated_at'
UNION ALL SELECT 'parents', 'id'
UNION ALL SELECT 'parents', 'name'
UNION ALL SELECT 'parents', 'email'
UNION ALL SELECT 'parents', 'phone_number'
UNION ALL SELECT 'parents', 'password'
UNION ALL SELECT 'parents', 'status'
UNION ALL SELECT 'parents', 'created_at'
UNION ALL SELECT 'parents', 'updated_at'
UNION ALL SELECT 'payment', 'id'
UNION ALL SELECT 'payment', 'amount'
UNION ALL SELECT 'payment', 'paymentMethodId'
UNION ALL SELECT 'payment', 'studentId'
UNION ALL SELECT 'payment', 'parentId'
UNION ALL SELECT 'payment', 'status'
UNION ALL SELECT 'payment', 'receiptImg'
UNION ALL SELECT 'payment', 'source'
UNION ALL SELECT 'payment', 'purpose'
UNION ALL SELECT 'payment', 'packageId'
UNION ALL SELECT 'payment', 'reason'
UNION ALL SELECT 'payment', 'createdAt'
UNION ALL SELECT 'payment', 'includedAnswers'
UNION ALL SELECT 'payment', 'isDeleted'
UNION ALL SELECT 'payment', 'deletedAt'
UNION ALL SELECT 'payment', 'promoCodeId'
UNION ALL SELECT 'paymentmethod', 'id'
UNION ALL SELECT 'paymentmethod', 'name'
UNION ALL SELECT 'paymentmethod', 'description'
UNION ALL SELECT 'paymentmethod', 'type'
UNION ALL SELECT 'paymentmethod', 'logo'
UNION ALL SELECT 'paymentmethod', 'isActive'
UNION ALL SELECT 'paymentmethod', 'createdAt'
UNION ALL SELECT 'paymentmethod', 'updatedAt'
UNION ALL SELECT 'paymentmethodcurrency', 'id'
UNION ALL SELECT 'paymentmethodcurrency', 'paymentMethodId'
UNION ALL SELECT 'paymentmethodcurrency', 'currencyId'
UNION ALL SELECT 'paymentmethodcurrency', 'createdAt'
UNION ALL SELECT 'paymentmethodcurrency', 'updatedAt'
UNION ALL SELECT 'popups', 'id'
UNION ALL SELECT 'popups', 'name'
UNION ALL SELECT 'popups', 'image'
UNION ALL SELECT 'popups', 'destination'
UNION ALL SELECT 'popups', 'start_date'
UNION ALL SELECT 'popups', 'end_date'
UNION ALL SELECT 'popups', 'created_at'
UNION ALL SELECT 'popups', 'updated_at'
UNION ALL SELECT 'popups', 'is_active'
UNION ALL SELECT 'prices', 'id'
UNION ALL SELECT 'prices', 'target_type'
UNION ALL SELECT 'prices', 'target_id'
UNION ALL SELECT 'prices', 'duration_label'
UNION ALL SELECT 'prices', 'duration_days'
UNION ALL SELECT 'prices', 'price_egp'
UNION ALL SELECT 'prices', 'price_usd'
UNION ALL SELECT 'prices', 'has_discount'
UNION ALL SELECT 'prices', 'discount_egp'
UNION ALL SELECT 'prices', 'discount_usd'
UNION ALL SELECT 'prices', 'total_price_egp'
UNION ALL SELECT 'prices', 'total_price_usd'
UNION ALL SELECT 'prices', 'is_default'
UNION ALL SELECT 'prices', 'created_at'
UNION ALL SELECT 'promocodes', 'id'
UNION ALL SELECT 'promocodes', 'promoName'
UNION ALL SELECT 'promocodes', 'code'
UNION ALL SELECT 'promocodes', 'discountAmount'
UNION ALL SELECT 'promocodes', 'startDate'
UNION ALL SELECT 'promocodes', 'endDate'
UNION ALL SELECT 'promocodes', 'numberOfUsages'
UNION ALL SELECT 'promocodes', 'createdAt'
UNION ALL SELECT 'promocodes', 'updatedAt'
UNION ALL SELECT 'promocodes', 'type'
UNION ALL SELECT 'promocodesallowedstudents', 'id'
UNION ALL SELECT 'promocodesallowedstudents', 'promoCodeId'
UNION ALL SELECT 'promocodesallowedstudents', 'studentId'
UNION ALL SELECT 'promocodesallowedstudents', 'createdAt'
UNION ALL SELECT 'promocodeschapters', 'id'
UNION ALL SELECT 'promocodeschapters', 'promoCodeId'
UNION ALL SELECT 'promocodeschapters', 'chapterId'
UNION ALL SELECT 'promocodeschapters', 'createdAt'
UNION ALL SELECT 'promocodescourses', 'id'
UNION ALL SELECT 'promocodescourses', 'promoCodeId'
UNION ALL SELECT 'promocodescourses', 'courseId'
UNION ALL SELECT 'promocodescourses', 'createdAt'
UNION ALL SELECT 'promocodescurrency', 'id'
UNION ALL SELECT 'promocodescurrency', 'promoCodeId'
UNION ALL SELECT 'promocodescurrency', 'currencyId'
UNION ALL SELECT 'promocodescurrency', 'createdAt'
UNION ALL SELECT 'promocodeslessons', 'id'
UNION ALL SELECT 'promocodeslessons', 'promoCodeId'
UNION ALL SELECT 'promocodeslessons', 'lessonId'
UNION ALL SELECT 'promocodeslessons', 'createdAt'
UNION ALL SELECT 'promocodespackages', 'id'
UNION ALL SELECT 'promocodespackages', 'promoCodeId'
UNION ALL SELECT 'promocodespackages', 'packageId'
UNION ALL SELECT 'promocodespackages', 'createdAt'
UNION ALL SELECT 'promocodesusers', 'id'
UNION ALL SELECT 'promocodesusers', 'promoCodeId'
UNION ALL SELECT 'promocodesusers', 'userId'
UNION ALL SELECT 'promocodesusers', 'createdAt'
UNION ALL SELECT 'promocodesusers', 'updatedAt'
UNION ALL SELECT 'question_answers', 'id'
UNION ALL SELECT 'question_answers', 'question_id'
UNION ALL SELECT 'question_answers', 'answer_pdf'
UNION ALL SELECT 'question_answers', 'answer_video'
UNION ALL SELECT 'question_answers', 'answer_image'
UNION ALL SELECT 'question_answers', 'answer_text'
UNION ALL SELECT 'question_answers', 'created_at'
UNION ALL SELECT 'question_answers', 'updated_at'
UNION ALL SELECT 'question_options', 'id'
UNION ALL SELECT 'question_options', 'question_id'
UNION ALL SELECT 'question_options', 'answer'
UNION ALL SELECT 'question_options', 'is_correct'
UNION ALL SELECT 'question_options', 'order'
UNION ALL SELECT 'question_options', 'created_at'
UNION ALL SELECT 'question_options', 'updated_at'
UNION ALL SELECT 'questions', 'id'
UNION ALL SELECT 'questions', 'question'
UNION ALL SELECT 'questions', 'image'
UNION ALL SELECT 'questions', 'answerType'
UNION ALL SELECT 'questions', 'difficulty'
UNION ALL SELECT 'questions', 'questionType'
UNION ALL SELECT 'questions', 'lesson_id'
UNION ALL SELECT 'questions', 'year'
UNION ALL SELECT 'questions', 'month'
UNION ALL SELECT 'questions', 'section_id'
UNION ALL SELECT 'questions', 'code_id'
UNION ALL SELECT 'questions', 'created_at'
UNION ALL SELECT 'questions', 'updated_at'
UNION ALL SELECT 'quiz_attempts', 'id'
UNION ALL SELECT 'quiz_attempts', 'student_id'
UNION ALL SELECT 'quiz_attempts', 'quiz_id'
UNION ALL SELECT 'quiz_attempts', 'started_at'
UNION ALL SELECT 'quiz_attempts', 'ended_at'
UNION ALL SELECT 'quiz_attempts', 'score'
UNION ALL SELECT 'quiz_attempts', 'is_passed'
UNION ALL SELECT 'quiz_attempts', 'status'
UNION ALL SELECT 'quiz_attempts', 'created_at'
UNION ALL SELECT 'quiz_attempts', 'updated_at'
UNION ALL SELECT 'quiz_questions', 'id'
UNION ALL SELECT 'quiz_questions', 'quiz_id'
UNION ALL SELECT 'quiz_questions', 'question_id'
UNION ALL SELECT 'quiz_questions', 'question_order'
UNION ALL SELECT 'quiz_questions', 'created_at'
UNION ALL SELECT 'quizzes', 'id'
UNION ALL SELECT 'quizzes', 'title'
UNION ALL SELECT 'quizzes', 'description'
UNION ALL SELECT 'quizzes', 'duration_hours'
UNION ALL SELECT 'quizzes', 'duration_minutes'
UNION ALL SELECT 'quizzes', 'total_score'
UNION ALL SELECT 'quizzes', 'pass_score'
UNION ALL SELECT 'quizzes', 'quiz_order'
UNION ALL SELECT 'quizzes', 'is_active'
UNION ALL SELECT 'quizzes', 'category_id'
UNION ALL SELECT 'quizzes', 'course_id'
UNION ALL SELECT 'quizzes', 'chapter_id'
UNION ALL SELECT 'quizzes', 'lesson_id'
UNION ALL SELECT 'quizzes', 'created_at'
UNION ALL SELECT 'quizzes', 'updated_at'
UNION ALL SELECT 'raw_score', 'id'
UNION ALL SELECT 'raw_score', 'name'
UNION ALL SELECT 'raw_score', 'course_id'
UNION ALL SELECT 'raw_score', 'score'
UNION ALL SELECT 'raw_score', 'is_gift'
UNION ALL SELECT 'raw_score', 'gifting_score'
UNION ALL SELECT 'raw_score', 'created_at'
UNION ALL SELECT 'raw_score', 'updated_at'
UNION ALL SELECT 'roles', 'id'
UNION ALL SELECT 'roles', 'name'
UNION ALL SELECT 'roles', 'permissions'
UNION ALL SELECT 'roles', 'status'
UNION ALL SELECT 'roles', 'created_at'
UNION ALL SELECT 'roles', 'updated_at'
UNION ALL SELECT 'section_attempts', 'id'
UNION ALL SELECT 'section_attempts', 'attempt_id'
UNION ALL SELECT 'section_attempts', 'exam_section_id'
UNION ALL SELECT 'section_attempts', 'started_at'
UNION ALL SELECT 'section_attempts', 'ended_at'
UNION ALL SELECT 'section_attempts', 'break_started_at'
UNION ALL SELECT 'section_attempts', 'score'
UNION ALL SELECT 'section_attempts', 'status'
UNION ALL SELECT 'section_attempts', 'created_at'
UNION ALL SELECT 'section_attempts', 'updated_at'
UNION ALL SELECT 'section_questions', 'id'
UNION ALL SELECT 'section_questions', 'question_order'
UNION ALL SELECT 'section_questions', 'section_id'
UNION ALL SELECT 'section_questions', 'question_id'
UNION ALL SELECT 'section_questions', 'score'
UNION ALL SELECT 'section_questions', 'created_at'
UNION ALL SELECT 'section_questions', 'updated_at'
UNION ALL SELECT 'sections', 'id'
UNION ALL SELECT 'sections', 'section_name'
UNION ALL SELECT 'sections', 'section_description'
UNION ALL SELECT 'sections', 'section_time'
UNION ALL SELECT 'sections', 'created_at'
UNION ALL SELECT 'sections', 'updated_at'
UNION ALL SELECT 'semesters', 'id'
UNION ALL SELECT 'semesters', 'name'
UNION ALL SELECT 'semesters', 'course_id'
UNION ALL SELECT 'semesters', 'created_at'
UNION ALL SELECT 'semesters', 'updated_at'
UNION ALL SELECT 'session_academic_info', 'id'
UNION ALL SELECT 'session_academic_info', 'session_id'
UNION ALL SELECT 'session_academic_info', 'lesson_id'
UNION ALL SELECT 'session_attendance', 'id'
UNION ALL SELECT 'session_attendance', 'session_id'
UNION ALL SELECT 'session_attendance', 'student_id'
UNION ALL SELECT 'session_attendance', 'status'
UNION ALL SELECT 'session_attendance', 'attended_at'
UNION ALL SELECT 'session_attendance', 'created_at'
UNION ALL SELECT 'session_groups', 'id'
UNION ALL SELECT 'session_groups', 'session_id'
UNION ALL SELECT 'session_groups', 'group_id'
UNION ALL SELECT 'session_package_deductions', 'id'
UNION ALL SELECT 'session_package_deductions', 'session_id'
UNION ALL SELECT 'session_package_deductions', 'student_id'
UNION ALL SELECT 'session_package_deductions', 'deducted_at'
UNION ALL SELECT 'session_rating_questions', 'id'
UNION ALL SELECT 'session_rating_questions', 'title'
UNION ALL SELECT 'session_rating_questions', 'description'
UNION ALL SELECT 'session_rating_questions', 'category'
UNION ALL SELECT 'session_rating_questions', 'weight'
UNION ALL SELECT 'session_rating_questions', 'order'
UNION ALL SELECT 'session_rating_questions', 'is_active'
UNION ALL SELECT 'session_rating_questions', 'created_at'
UNION ALL SELECT 'session_rating_questions', 'updated_at'
UNION ALL SELECT 'session_ratings', 'id'
UNION ALL SELECT 'session_ratings', 'session_id'
UNION ALL SELECT 'session_ratings', 'student_id'
UNION ALL SELECT 'session_ratings', 'rating'
UNION ALL SELECT 'session_ratings', 'comment'
UNION ALL SELECT 'session_ratings', 'created_at'
UNION ALL SELECT 'session_ratings', 'updated_at'
UNION ALL SELECT 'session_student_pdfs', 'id'
UNION ALL SELECT 'session_student_pdfs', 'session_id'
UNION ALL SELECT 'session_student_pdfs', 'student_id'
UNION ALL SELECT 'session_student_pdfs', 'session_pdf'
UNION ALL SELECT 'session_student_pdfs', 'session_answers_pdf'
UNION ALL SELECT 'session_student_pdfs', 'teacher_explanation_pdf'
UNION ALL SELECT 'session_student_pdfs', 'created_at'
UNION ALL SELECT 'session_student_pdfs', 'updated_at'
UNION ALL SELECT 'session_student_question_ratings', 'id'
UNION ALL SELECT 'session_student_question_ratings', 'session_student_rating_id'
UNION ALL SELECT 'session_student_question_ratings', 'question_id'
UNION ALL SELECT 'session_student_question_ratings', 'rating'
UNION ALL SELECT 'session_student_question_ratings', 'comment'
UNION ALL SELECT 'session_student_question_ratings', 'created_at'
UNION ALL SELECT 'session_student_question_ratings', 'updated_at'
UNION ALL SELECT 'session_student_ratings', 'id'
UNION ALL SELECT 'session_student_ratings', 'session_id'
UNION ALL SELECT 'session_student_ratings', 'student_id'
UNION ALL SELECT 'session_student_ratings', 'overall_rating'
UNION ALL SELECT 'session_student_ratings', 'general_comment'
UNION ALL SELECT 'session_student_ratings', 'rated_by_admin_id'
UNION ALL SELECT 'session_student_ratings', 'rated_by_teacher_id'
UNION ALL SELECT 'session_student_ratings', 'created_at'
UNION ALL SELECT 'session_student_ratings', 'updated_at'
UNION ALL SELECT 'session_users', 'id'
UNION ALL SELECT 'session_users', 'session_id'
UNION ALL SELECT 'session_users', 'student_id'
UNION ALL SELECT 'sessions', 'id'
UNION ALL SELECT 'sessions', 'name'
UNION ALL SELECT 'sessions', 'schedule_type'
UNION ALL SELECT 'sessions', 'session_date'
UNION ALL SELECT 'sessions', 'start_date'
UNION ALL SELECT 'sessions', 'end_date'
UNION ALL SELECT 'sessions', 'time_from'
UNION ALL SELECT 'sessions', 'time_to'
UNION ALL SELECT 'sessions', 'teacher_id'
UNION ALL SELECT 'sessions', 'exam_id'
UNION ALL SELECT 'sessions', 'session_link'
UNION ALL SELECT 'sessions', 'material_link'
UNION ALL SELECT 'sessions', 'teacher_material_link'
UNION ALL SELECT 'sessions', 'session_relational_type'
UNION ALL SELECT 'sessions', 'created_at'
UNION ALL SELECT 'sessions', 'updated_at'
UNION ALL SELECT 'sessions', 'content_access_days'
UNION ALL SELECT 'sessions', 'session_pdf'
UNION ALL SELECT 'sessions', 'session_answers_pdf'
UNION ALL SELECT 'sessions', 'teacher_explanation_pdf'
UNION ALL SELECT 'sessions', 'status'
UNION ALL SELECT 'sessions', 'cancel_reason'
UNION ALL SELECT 'sessions', 'cancelled_by'
UNION ALL SELECT 'sessions', 'cancelled_at'
UNION ALL SELECT 'sessions', 'confirmed_at'
UNION ALL SELECT 'sessions', 'confirmed_by'
UNION ALL SELECT 'student', 'id'
UNION ALL SELECT 'student', 'first_name'
UNION ALL SELECT 'student', 'last_name'
UNION ALL SELECT 'student', 'nickname'
UNION ALL SELECT 'student', 'email'
UNION ALL SELECT 'student', 'password'
UNION ALL SELECT 'student', 'phone'
UNION ALL SELECT 'student', 'category'
UNION ALL SELECT 'student', 'grade'
UNION ALL SELECT 'student', 'parent_phone'
UNION ALL SELECT 'student', 'is_verified'
UNION ALL SELECT 'student', 'live_balance'
UNION ALL SELECT 'student', 'exam_balance'
UNION ALL SELECT 'student', 'question_balance'
UNION ALL SELECT 'student', 'avatar'
UNION ALL SELECT 'student_answers', 'id'
UNION ALL SELECT 'student_answers', 'attempt_id'
UNION ALL SELECT 'student_answers', 'question_id'
UNION ALL SELECT 'student_answers', 'selected_option_id'
UNION ALL SELECT 'student_answers', 'grid_in_answer'
UNION ALL SELECT 'student_answers', 'is_correct'
UNION ALL SELECT 'student_answers', 'score'
UNION ALL SELECT 'student_answers', 'created_at'
UNION ALL SELECT 'student_answers', 'updated_at'
UNION ALL SELECT 'student_availability_plans', 'id'
UNION ALL SELECT 'student_availability_plans', 'student_id'
UNION ALL SELECT 'student_availability_plans', 'title'
UNION ALL SELECT 'student_availability_plans', 'notes'
UNION ALL SELECT 'student_availability_plans', 'status'
UNION ALL SELECT 'student_availability_plans', 'admin_notes'
UNION ALL SELECT 'student_availability_plans', 'student_feedback'
UNION ALL SELECT 'student_availability_plans', 'proposed_by'
UNION ALL SELECT 'student_availability_plans', 'proposed_at'
UNION ALL SELECT 'student_availability_plans', 'responded_at'
UNION ALL SELECT 'student_availability_plans', 'created_at'
UNION ALL SELECT 'student_availability_plans', 'updated_at'
UNION ALL SELECT 'student_availability_slots', 'id'
UNION ALL SELECT 'student_availability_slots', 'plan_id'
UNION ALL SELECT 'student_availability_slots', 'day_of_week'
UNION ALL SELECT 'student_availability_slots', 'specific_date'
UNION ALL SELECT 'student_availability_slots', 'time_from'
UNION ALL SELECT 'student_availability_slots', 'time_to'
UNION ALL SELECT 'student_availability_slots', 'created_at'
UNION ALL SELECT 'student_availability_slots', 'admin_slot_id'
UNION ALL SELECT 'student_cancel_requests', 'id'
UNION ALL SELECT 'student_cancel_requests', 'student_id'
UNION ALL SELECT 'student_cancel_requests', 'session_id'
UNION ALL SELECT 'student_cancel_requests', 'reason'
UNION ALL SELECT 'student_cancel_requests', 'status'
UNION ALL SELECT 'student_cancel_requests', 'admin_reply'
UNION ALL SELECT 'student_cancel_requests', 'responded_by_admin_id'
UNION ALL SELECT 'student_cancel_requests', 'responded_at'
UNION ALL SELECT 'student_cancel_requests', 'created_at'
UNION ALL SELECT 'student_cancel_requests', 'updated_at'
UNION ALL SELECT 'student_parallel_answers', 'id'
UNION ALL SELECT 'student_parallel_answers', 'parallel_attempt_id'
UNION ALL SELECT 'student_parallel_answers', 'parallel_question_id'
UNION ALL SELECT 'student_parallel_answers', 'selected_option_id'
UNION ALL SELECT 'student_parallel_answers', 'grid_in_answer'
UNION ALL SELECT 'student_parallel_answers', 'is_correct'
UNION ALL SELECT 'student_parallel_answers', 'score'
UNION ALL SELECT 'student_parallel_answers', 'created_at'
UNION ALL SELECT 'student_parallel_answers', 'updated_at'
UNION ALL SELECT 'student_parallel_attempts', 'id'
UNION ALL SELECT 'student_parallel_attempts', 'student_id'
UNION ALL SELECT 'student_parallel_attempts', 'exam_attempt_id'
UNION ALL SELECT 'student_parallel_attempts', 'status'
UNION ALL SELECT 'student_parallel_attempts', 'created_at'
UNION ALL SELECT 'student_parallel_attempts', 'updated_at'
UNION ALL SELECT 'student_plan_sessions', 'id'
UNION ALL SELECT 'student_plan_sessions', 'plan_id'
UNION ALL SELECT 'student_plan_sessions', 'session_id'
UNION ALL SELECT 'student_plan_sessions', 'notes'
UNION ALL SELECT 'student_plan_sessions', 'order_index'
UNION ALL SELECT 'student_plan_sessions', 'created_at'
UNION ALL SELECT 'student_plan_sessions', 'student_response'
UNION ALL SELECT 'student_quiz_answers', 'id'
UNION ALL SELECT 'student_quiz_answers', 'attempt_id'
UNION ALL SELECT 'student_quiz_answers', 'question_id'
UNION ALL SELECT 'student_quiz_answers', 'selected_option_id'
UNION ALL SELECT 'student_quiz_answers', 'grid_in_answer'
UNION ALL SELECT 'student_quiz_answers', 'is_correct'
UNION ALL SELECT 'student_quiz_answers', 'score'
UNION ALL SELECT 'student_quiz_answers', 'created_at'
UNION ALL SELECT 'student_quiz_answers', 'updated_at'
UNION ALL SELECT 'teacher_availability', 'id'
UNION ALL SELECT 'teacher_availability', 'teacher_id'
UNION ALL SELECT 'teacher_availability', 'day_of_week'
UNION ALL SELECT 'teacher_availability', 'time_from'
UNION ALL SELECT 'teacher_availability', 'time_to'
UNION ALL SELECT 'teacher_availability', 'shared_at'
UNION ALL SELECT 'teacher_availability', 'created_at'
UNION ALL SELECT 'teacher_requests', 'id'
UNION ALL SELECT 'teacher_requests', 'teacher_id'
UNION ALL SELECT 'teacher_requests', 'type'
UNION ALL SELECT 'teacher_requests', 'session_id'
UNION ALL SELECT 'teacher_requests', 'request_date'
UNION ALL SELECT 'teacher_requests', 'time_from'
UNION ALL SELECT 'teacher_requests', 'time_to'
UNION ALL SELECT 'teacher_requests', 'reason'
UNION ALL SELECT 'teacher_requests', 'status'
UNION ALL SELECT 'teacher_requests', 'admin_reply'
UNION ALL SELECT 'teacher_requests', 'cover_teacher_id'
UNION ALL SELECT 'teacher_requests', 'responded_by_admin_id'
UNION ALL SELECT 'teacher_requests', 'responded_at'
UNION ALL SELECT 'teacher_requests', 'created_at'
UNION ALL SELECT 'teacher_requests', 'updated_at'
UNION ALL SELECT 'teachers', 'id'
UNION ALL SELECT 'teachers', 'name'
UNION ALL SELECT 'teachers', 'email'
UNION ALL SELECT 'teachers', 'phone_number'
UNION ALL SELECT 'teachers', 'password'
UNION ALL SELECT 'teachers', 'avatar'
UNION ALL SELECT 'teachers', 'category_id'
UNION ALL SELECT 'teachers', 'created_at'
UNION ALL SELECT 'teachers', 'updated_at'
UNION ALL SELECT 'wallet', 'id'
UNION ALL SELECT 'wallet', 'studentId'
UNION ALL SELECT 'wallet', 'balance'
UNION ALL SELECT 'wallet', 'createdAt'
UNION ALL SELECT 'wallet', 'updatedAt'
UNION ALL SELECT 'wallettransaction', 'id'
UNION ALL SELECT 'wallettransaction', 'walletId'
UNION ALL SELECT 'wallettransaction', 'paymentId'
UNION ALL SELECT 'wallettransaction', 'amount'
UNION ALL SELECT 'wallettransaction', 'type'
UNION ALL SELECT 'wallettransaction', 'source'
UNION ALL SELECT 'wallettransaction', 'createdAt'
) x
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = x.tb
LEFT JOIN information_schema.COLUMNS i ON i.TABLE_SCHEMA = DATABASE() AND i.TABLE_NAME = x.tb AND i.COLUMN_NAME = x.col
WHERE i.COLUMN_NAME IS NULL
GROUP BY x.tb, t.TABLE_NAME
ORDER BY x.tb;
