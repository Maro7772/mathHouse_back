-- Live database (MariaDB 10.3) — run in phpMyAdmin on `mathshouseDB` BEFORE deploying the new backend.
-- Safe to run more than once.
--
-- exam_attempts.draft_answers: the answers a student picked but has not submitted yet (JSON),
-- saved as they answer so leaving an exam and coming back keeps them.

ALTER TABLE `mathshouseDB`.`exam_attempts`
  ADD COLUMN IF NOT EXISTS `draft_answers` MEDIUMTEXT NULL DEFAULT NULL;

-- Check: should return one row "draft_answers | mediumtext | YES"
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME = 'exam_attempts' AND COLUMN_NAME = 'draft_answers';
