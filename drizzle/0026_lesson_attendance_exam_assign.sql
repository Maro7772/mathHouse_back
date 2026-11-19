CREATE TABLE `exam_groups` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`exam_id` char(255) NOT NULL,
	`group_id` char(36) NOT NULL,
	`assigned_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `exam_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `exam_groups_unique` UNIQUE(`exam_id`,`group_id`)
);
--> statement-breakpoint
CREATE TABLE `exam_students` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`exam_id` char(255) NOT NULL,
	`student_id` char(36) NOT NULL,
	`assigned_by` char(36),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `exam_students_id` PRIMARY KEY(`id`),
	CONSTRAINT `exam_students_unique` UNIQUE(`exam_id`,`student_id`)
);
--> statement-breakpoint
CREATE TABLE `student_lesson_attendance` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`student_id` char(36) NOT NULL,
	`lesson_id` char(255) NOT NULL,
	`status` enum('present','absent') NOT NULL,
	`marked_by` char(36),
	`marked_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `student_lesson_attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `student_lesson_attendance_unique` UNIQUE(`student_id`,`lesson_id`)
);
--> statement-breakpoint
ALTER TABLE `exam_groups` ADD CONSTRAINT `exam_groups_exam_id_exams_id_fk` FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exam_groups` ADD CONSTRAINT `exam_groups_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exam_students` ADD CONSTRAINT `exam_students_exam_id_exams_id_fk` FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exam_students` ADD CONSTRAINT `exam_students_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_lesson_attendance` ADD CONSTRAINT `student_lesson_attendance_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_lesson_attendance` ADD CONSTRAINT `student_lesson_attendance_lesson_id_lessons_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `exam_groups_group_idx` ON `exam_groups` (`group_id`);--> statement-breakpoint
CREATE INDEX `exam_students_student_idx` ON `exam_students` (`student_id`);--> statement-breakpoint
CREATE INDEX `student_lesson_attendance_student_idx` ON `student_lesson_attendance` (`student_id`);