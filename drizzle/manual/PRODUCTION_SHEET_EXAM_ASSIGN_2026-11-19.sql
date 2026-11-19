-- Live database (MariaDB 10.3) — run in phpMyAdmin on `mathshouseDB` BEFORE deploying the new backend.
-- Safe to run more than once. (Also run PRODUCTION_ATTENDANCE_CHARGE_2026-11-16.sql if not done yet.)
--
-- 1. student_lesson_attendance — admin attendance sheet (Students → Content & attendance → Attendance sheet)
-- 2. exam_students / exam_groups — exams assigned to students and groups
-- ids are always written by the app, so no UUID() default is needed here.

CREATE TABLE IF NOT EXISTS `mathshouseDB`.`student_lesson_attendance` (
  `id` char(36) NOT NULL,
  `student_id` char(36) NOT NULL,
  `lesson_id` char(255) NOT NULL,
  `status` enum('present','absent') NOT NULL,
  `marked_by` char(36) NULL DEFAULT NULL,
  `marked_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_lesson_attendance_unique` (`student_id`, `lesson_id`),
  KEY `student_lesson_attendance_student_idx` (`student_id`),
  CONSTRAINT `student_lesson_attendance_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`) ON DELETE CASCADE,
  CONSTRAINT `student_lesson_attendance_lesson_id_lessons_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `mathshouseDB`.`exam_students` (
  `id` char(36) NOT NULL,
  `exam_id` char(255) NOT NULL,
  `student_id` char(36) NOT NULL,
  `assigned_by` char(36) NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `exam_students_unique` (`exam_id`, `student_id`),
  KEY `exam_students_student_idx` (`student_id`),
  CONSTRAINT `exam_students_exam_id_exams_id_fk` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `exam_students_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `mathshouseDB`.`exam_groups` (
  `id` char(36) NOT NULL,
  `exam_id` char(255) NOT NULL,
  `group_id` char(36) NOT NULL,
  `assigned_by` char(36) NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `exam_groups_unique` (`exam_id`, `group_id`),
  KEY `exam_groups_group_idx` (`group_id`),
  CONSTRAINT `exam_groups_exam_id_exams_id_fk` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `exam_groups_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Check: should list the 3 tables
SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_NAME IN ('student_lesson_attendance', 'exam_students', 'exam_groups');
