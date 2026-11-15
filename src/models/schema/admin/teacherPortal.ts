// schema/admin/teacherPortal.ts
// Tables that back the teacher portal: cover / cancellation requests and weekly availability.
import { mysqlTable, char, text, timestamp, mysqlEnum, date, time, int, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { teachers } from "./teacher";
import { sessions } from "./Session";
import { admins } from "./admin";

/**
 * A teacher asks admin for something:
 *  - "cover": someone else should teach a time slot (e.g. an absence on a given day, 17:00–18:30)
 *  - "cancellation": cancel one specific session
 * Admin accepts or rejects it and may leave a reply (and, for cover, pick the cover teacher).
 */
export const teacherRequests = mysqlTable("teacher_requests", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    teacherId: char("teacher_id", { length: 255 }).notNull().references(() => teachers.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["cover", "cancellation"]).notNull(),

    // cancellation → the session; cover → optional (the slot is described by date + times)
    sessionId: char("session_id", { length: 36 }).references(() => sessions.id, { onDelete: "set null" }),
    requestDate: date("request_date"),
    timeFrom: time("time_from"),
    timeTo: time("time_to"),
    reason: text("reason").notNull(),

    status: mysqlEnum("status", ["pending", "accepted", "rejected"]).notNull().default("pending"),
    adminReply: text("admin_reply"),
    coverTeacherId: char("cover_teacher_id", { length: 255 }).references(() => teachers.id, { onDelete: "set null" }),
    respondedByAdminId: char("responded_by_admin_id", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    respondedAt: timestamp("responded_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (table) => [
    index("teacher_requests_teacher_idx").on(table.teacherId),
    index("teacher_requests_status_idx").on(table.status),
]);

/**
 * Weekly availability: one row per time range per weekday.
 * dayOfWeek follows JS Date#getDay(): 0 = Sunday … 6 = Saturday.
 * Saving replaces all rows of the teacher and stamps sharedAt (the moment admin can see it).
 */
export const teacherAvailability = mysqlTable("teacher_availability", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    teacherId: char("teacher_id", { length: 255 }).notNull().references(() => teachers.id, { onDelete: "cascade" }),
    dayOfWeek: int("day_of_week").notNull(),
    timeFrom: time("time_from").notNull(),
    timeTo: time("time_to").notNull(),
    sharedAt: timestamp("shared_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("teacher_availability_teacher_idx").on(table.teacherId),
]);

export const teacherRequestTypes = ["cover", "cancellation"] as const;
export const teacherRequestStatuses = ["pending", "accepted", "rejected"] as const;
export type TeacherRequestStatus = (typeof teacherRequestStatuses)[number];
