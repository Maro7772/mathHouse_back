-- Teacher portal: cover / cancellation requests, weekly availability, session cancellation.
-- Note: drizzle-kit also detected `notes`, `session_package_deductions` and
-- `student_plan_sessions.student_response` as new, because earlier changes were applied with
-- `drizzle-kit push` without a migration. Those already exist in the database, so they are
-- left out here; the 0019 snapshot now includes them.
CREATE TABLE `teacher_availability` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`teacher_id` char(255) NOT NULL,
	`day_of_week` int NOT NULL,
	`time_from` time NOT NULL,
	`time_to` time NOT NULL,
	`shared_at` timestamp DEFAULT (now()),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `teacher_availability_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teacher_requests` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`teacher_id` char(255) NOT NULL,
	`type` enum('cover','cancellation') NOT NULL,
	`session_id` char(36),
	`request_date` date,
	`time_from` time,
	`time_to` time,
	`reason` text NOT NULL,
	`status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
	`admin_reply` text,
	`cover_teacher_id` char(255),
	`responded_by_admin_id` char(36),
	`responded_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `teacher_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `status` enum('scheduled','cancelled') DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cancelled_by` enum('admin','teacher');--> statement-breakpoint
ALTER TABLE `sessions` ADD `cancelled_at` timestamp;--> statement-breakpoint
ALTER TABLE `teacher_availability` ADD CONSTRAINT `teacher_availability_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_teacher_id_teachers_id_fk` FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_cover_teacher_id_teachers_id_fk` FOREIGN KEY (`cover_teacher_id`) REFERENCES `teachers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacher_requests` ADD CONSTRAINT `teacher_requests_responded_by_admin_id_admins_id_fk` FOREIGN KEY (`responded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `teacher_availability_teacher_idx` ON `teacher_availability` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `teacher_requests_teacher_idx` ON `teacher_requests` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `teacher_requests_status_idx` ON `teacher_requests` (`status`);
