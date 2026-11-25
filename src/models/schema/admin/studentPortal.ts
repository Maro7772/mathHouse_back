// schema/admin/studentPortal.ts
// Student portal: a student asks admin to cancel their seat in an upcoming session
// (allowed until 24 hours before it starts).
import { mysqlTable, char, text, timestamp, mysqlEnum, index, int, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { sessions } from "./Session";
import { Student } from "./Student";
import { admins } from "./admin";

export const studentCancelRequests = mysqlTable("student_cancel_requests", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    studentId: char("student_id", { length: 36 }).notNull().references(() => Student.id, { onDelete: "cascade" }),
    sessionId: char("session_id", { length: 36 }).notNull().references(() => sessions.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: mysqlEnum("status", ["pending", "accepted", "rejected"]).notNull().default("pending"),
    adminReply: text("admin_reply"),
    respondedByAdminId: char("responded_by_admin_id", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (table) => [
    index("student_cancel_requests_student_idx").on(table.studentId),
    index("student_cancel_requests_session_idx").on(table.sessionId),
    index("student_cancel_requests_status_idx").on(table.status),
]);

/**
 * Free live sessions admin gave a student (compensation, trial, discount…). Each grant adds `sessions`
 * to student.live_balance; the reports show sessions used from it as "free — given by admin (reason)".
 */
export const studentFreeSessions = mysqlTable("student_free_sessions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    studentId: char("student_id", { length: 36 }).notNull().references(() => Student.id, { onDelete: "cascade" }),
    sessions: int("sessions").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    givenBy: char("given_by", { length: 255 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("student_free_sessions_student_idx").on(table.studentId),
]);
