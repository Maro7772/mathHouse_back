-- Live database (MariaDB 10.3) — run in phpMyAdmin on `mathshouseDB` BEFORE deploying the new backend.
-- Safe to run more than once.
--
-- Adds student.planner_active:
--   1 = Active   (default; admin gets the planner alert when this student's free times wait for approval)
--   0 = Inactive (no planner alert for this student)

ALTER TABLE `mathshouseDB`.`student`
  ADD COLUMN IF NOT EXISTS `planner_active` tinyint(1) NOT NULL DEFAULT 1;

-- Check: should return one row "planner_active | tinyint(1) | NO | 1"
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME = 'student' AND COLUMN_NAME = 'planner_active';
