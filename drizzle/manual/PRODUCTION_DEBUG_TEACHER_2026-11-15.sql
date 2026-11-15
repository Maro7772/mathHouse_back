-- READ-ONLY. Runs the two teacher-portal queries that fail on the live site, so phpMyAdmin shows
-- the REAL database error (the backend only says "Failed query").
-- Every table is written as `mathshouseDB`.`…`, so it works whichever database phpMyAdmin has selected.
-- Run in phpMyAdmin -> SQL and send everything it shows (each result or red error).

-- 1) The "My requests" query from /api/teacher/requests
SELECT `teacher_requests`.`id`, `teacher_requests`.`type`, `teacher_requests`.`session_id`, `sessions`.`name`,
       `sessions`.`session_date`, `sessions`.`time_from`, `sessions`.`time_to`, `teacher_requests`.`request_date`,
       `teacher_requests`.`time_from`, `teacher_requests`.`time_to`, `teacher_requests`.`reason`, `teacher_requests`.`status`,
       `teacher_requests`.`admin_reply`, `teacher_requests`.`cover_teacher_id`, `cover_teacher`.`name`,
       `teacher_requests`.`responded_at`, `teacher_requests`.`created_at`
FROM `mathshouseDB`.`teacher_requests` AS `teacher_requests`
LEFT JOIN `mathshouseDB`.`sessions` AS `sessions` ON `teacher_requests`.`session_id` = `sessions`.`id`
LEFT JOIN `mathshouseDB`.`teachers` AS `cover_teacher` ON `teacher_requests`.`cover_teacher_id` = `cover_teacher`.`id`
WHERE `teacher_requests`.`teacher_id` = '14e002f1-5258-474f-b1f8-9c9817098f5e'
ORDER BY `teacher_requests`.`created_at` DESC;

-- 2) The "My sessions" query from /api/teacher/sessions
SELECT `id`, `name`, `schedule_type`, `session_date`, `start_date`, `end_date`, `time_from`, `time_to`, `session_link`,
       `material_link`, `session_relational_type`, `content_access_days`, `session_pdf`, `session_answers_pdf`,
       `teacher_explanation_pdf`, `status`, `cancel_reason`, `cancelled_by`, `cancelled_at`, `created_at`
FROM `mathshouseDB`.`sessions`
WHERE `teacher_id` = '14e002f1-5258-474f-b1f8-9c9817098f5e'
ORDER BY `session_date` DESC, `time_from` DESC;

-- 3) Text settings (collation) of the columns that are joined / compared
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mathshouseDB'
  AND ((TABLE_NAME = 'teacher_requests' AND COLUMN_NAME IN ('teacher_id', 'session_id', 'cover_teacher_id', 'type', 'status'))
    OR (TABLE_NAME = 'sessions' AND COLUMN_NAME IN ('id', 'teacher_id', 'status', 'cancelled_by'))
    OR (TABLE_NAME = 'teachers' AND COLUMN_NAME = 'id'));
