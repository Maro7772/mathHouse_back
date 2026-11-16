-- Live database (MariaDB 10.3) — run in phpMyAdmin on `mathshouseDB` BEFORE deploying the new backend.
-- Safe to run more than once.
--
-- Adds session_package_deductions.charge_status:
--   'paid'   = 1 live session was taken from the balance (all existing rows)
--   'free'   = Re-Explanation of lessons the student already attended
--   'unpaid' = teacher/admin marked the student present while the balance was 0

ALTER TABLE `mathshouseDB`.`session_package_deductions`
  ADD COLUMN IF NOT EXISTS `charge_status` varchar(16) NOT NULL DEFAULT 'paid';

-- Check: should return one row "charge_status | varchar(16) | NO | paid"
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME = 'session_package_deductions' AND COLUMN_NAME = 'charge_status';
