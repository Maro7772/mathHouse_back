CREATE TABLE `student_cancel_requests` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`student_id` char(36) NOT NULL,
	`session_id` char(36) NOT NULL,
	`reason` text NOT NULL,
	`status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
	`admin_reply` text,
	`responded_by_admin_id` char(36),
	`responded_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `student_cancel_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `student_cancel_requests` ADD CONSTRAINT `student_cancel_requests_student_id_student_id_fk` FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_cancel_requests` ADD CONSTRAINT `student_cancel_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_cancel_requests` ADD CONSTRAINT `student_cancel_requests_responded_by_admin_id_admins_id_fk` FOREIGN KEY (`responded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `student_cancel_requests_student_idx` ON `student_cancel_requests` (`student_id`);--> statement-breakpoint
CREATE INDEX `student_cancel_requests_session_idx` ON `student_cancel_requests` (`session_id`);--> statement-breakpoint
CREATE INDEX `student_cancel_requests_status_idx` ON `student_cancel_requests` (`status`);