-- ============================================================================
-- Math House LIVE database: fix "#1267 Illegal mix of collations".
-- 90 tables use utf8mb4_general_ci; these 6 (and the database default) use utf8mb4_unicode_ci,
-- so joins between them fail (e.g. the teacher portal's Requests and Sessions).
-- This switches the 6 tables to utf8mb4_general_ci. All data is kept: only the text-comparison
-- rule changes (same utf8mb4 characters). Safe to run more than once.
-- BACK UP first (phpMyAdmin -> Export). Then phpMyAdmin -> SQL (or Import) -> Go.
-- The last result is a re-check: it should say "zero rows".
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `mathshouseDB`.`teacher_requests`                 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `mathshouseDB`.`teacher_availability`             CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `mathshouseDB`.`admin_availability_slots`         CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `mathshouseDB`.`session_package_deductions`       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `mathshouseDB`.`session_rating_questions`         CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `mathshouseDB`.`session_student_question_ratings` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- New tables created later get the same rule as the rest (this is what caused the mix).
ALTER DATABASE `mathshouseDB` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Re-check: tables that still differ. "Zero rows" = fixed.
SELECT t.TABLE_NAME AS `table`, t.TABLE_COLLATION AS table_collation
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = 'mathshouseDB' AND t.TABLE_TYPE = 'BASE TABLE'
  AND (t.TABLE_COLLATION <> 'utf8mb4_general_ci'
       OR EXISTS (SELECT 1 FROM information_schema.COLUMNS c
                   WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                     AND c.COLLATION_NAME IS NOT NULL
                     AND c.COLLATION_NAME NOT IN ('utf8mb4_general_ci', 'utf8mb4_bin')));
