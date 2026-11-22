-- Live database (MariaDB 10.3) — run in phpMyAdmin on `mathshouseDB` BEFORE deploying the Phase E backend.
-- Safe to run more than once.
-- Adds sessions.recording_link: the class recording (Google Drive link) the teacher adds after the session.

ALTER TABLE `mathshouseDB`.`sessions`
  ADD COLUMN IF NOT EXISTS `recording_link` varchar(500) NULL DEFAULT NULL;

-- Check: one row "recording_link | varchar(500) | YES"
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'recording_link';

-- Fix: session_attendance.attended_at must be optional (the code saves no time for "absent").
-- Created as a bare `timestamp`, it became NOT NULL + ON UPDATE CURRENT_TIMESTAMP, which also
-- overwrote the attended time on every later edit of the row. Existing values are kept.
ALTER TABLE `mathshouseDB`.`session_attendance`
  MODIFY `attended_at` timestamp NULL DEFAULT NULL;

-- Check: "attended_at | timestamp | YES | NULL" (no "on update")
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME = 'session_attendance' AND COLUMN_NAME = 'attended_at';
