-- Live database (MariaDB 10.3) — run in phpMyAdmin on `mathshouseDB` BEFORE deploying the new backend.
-- Safe to run more than once.
--
-- student_free_sessions: free live sessions admin gives a student, with the reason
-- (each row also adds its sessions to student.live_balance when it is created by the backend).

CREATE TABLE IF NOT EXISTS `mathshouseDB`.`student_free_sessions` (
  `id` char(36) NOT NULL,
  `student_id` char(36) NOT NULL,
  `sessions` int(11) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `given_by` char(255) NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `student_free_sessions_student_idx` (`student_id`),
  CONSTRAINT `student_free_sessions_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Check: should return 6 rows (id, student_id, sessions, reason, given_by, created_at)
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME = 'student_free_sessions' ORDER BY ORDINAL_POSITION;
