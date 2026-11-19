import { mysqlTable, char, timestamp, mysqlEnum, uniqueIndex, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { Student } from "./Student";
import { lessons } from "./lessons";

/**
 * Admin attendance sheet: one row per student per lesson they bought,
 * marked "present" or "absent" by an admin (Students → Content & attendance).
 * Session attendance stays in session_attendance; the sheet shows both.
 */
export const studentLessonAttendance = mysqlTable("student_lesson_attendance", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    studentId: char("student_id", { length: 36 }).notNull().references(() => Student.id, { onDelete: "cascade" }),
    lessonId: char("lesson_id", { length: 255 }).notNull().references(() => lessons.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", ["present", "absent"]).notNull(),
    markedBy: char("marked_by", { length: 36 }),
    markedAt: timestamp("marked_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("student_lesson_attendance_unique").on(t.studentId, t.lessonId),
    index("student_lesson_attendance_student_idx").on(t.studentId),
]);
