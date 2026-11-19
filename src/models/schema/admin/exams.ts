import { mysqlTable, char, varchar, timestamp, int, boolean, foreignKey, mysqlEnum, json, uniqueIndex, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { questions } from "./questions";
import { rawScore } from "./rawScore";
import { courses } from "./courses";
import { examCodes } from "./examCodes";
import { Sections } from "./sections";
import { Student } from "./Student";
import { groups } from "./Groups";

export const examType = mysqlEnum("exam_type", ["static", "adaptive"]).notNull();

export const Exams = mysqlTable("exams", {
    id: char("id", { length: 255 }).primaryKey().notNull().default(sql`(uuid())`),
    title: varchar("title", { length: 255 }).notNull(),
    description: varchar("description", { length: 255 }),
    duration: int("duration").notNull(), // Duration in minutes
    totalScore: int("total_score").notNull(),
    passScore: int("pass_score").notNull(),
    rawScoreId: char("raw_score_id", { length: 255 }).notNull().references(() => rawScore.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    examType: examType,

    // Details
    courseId: char("course_id", { length: 255 }).notNull().references(() => courses.id, { onDelete: "cascade" }),
    year: int("year"),
    Month: mysqlEnum("month", ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]),
    codeId: char("code_id", { length: 255 }).notNull().references(() => examCodes.id, { onDelete: "cascade" }),

    // Calculators allowed for this exam (subset of CALCULATOR_TYPES)
    calculators: json("calculators").$type<string[]>().default([]),
    session_pdf: varchar("session_pdf", { length: 500 }),
    session_answers_pdf: varchar("session_answers_pdf", { length: 500 }),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const ExamSections = mysqlTable("exam_sections", {
    id: char("id", { length: 255 }).primaryKey().notNull().default(sql`(uuid())`),
    sectionId: char("section_id", { length: 255 }).notNull().references(() => Sections.id, { onDelete: "cascade" }),
    sectionOrder: int("section_order").notNull(),
    examId: char("exam_id", { length: 255 }).notNull().references(() => Exams.id, { onDelete: "cascade" }),

    // Per-exam section duration override (minutes). If null, falls back to Sections.sectionTime.
    duration: int("duration"),

    // Break configuration between sections
    breakLimited: boolean("break_limited").notNull().default(false), // true = break has a max duration
    maxBreakDuration: int("max_break_duration"),                     // Max break in minutes (only used when breakLimited = true)

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const SectionQuestions = mysqlTable("section_questions", {
    id: char("id", { length: 255 }).primaryKey().notNull().default(sql`(uuid())`),
    questionOrder: int("question_order").notNull(),
    sectionId: char("section_id", { length: 255 }).notNull().references(() => ExamSections.id, { onDelete: "cascade" }),
    questionId: char("question_id", { length: 255 }).notNull().references(() => questions.id, { onDelete: "cascade" }),
    score: int("score").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const AdaptiveExam = mysqlTable("adaptive_exam", {
    id: char("id", { length: 255 }).primaryKey().notNull().default(sql`(uuid())`),
    examId: char("exam_id", { length: 255 }).notNull().references(() => Exams.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
/**
 * Exam assignment: an admin gives an exam to specific students and/or whole groups.
 * Assigned students always see the exam (even with 0 exam balance) and start it for free.
 */
export const examStudents = mysqlTable("exam_students", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    examId: char("exam_id", { length: 255 }).notNull().references(() => Exams.id, { onDelete: "cascade" }),
    studentId: char("student_id", { length: 36 }).notNull().references(() => Student.id, { onDelete: "cascade" }),
    assignedBy: char("assigned_by", { length: 36 }),
    createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
    uniqueIndex("exam_students_unique").on(t.examId, t.studentId),
    index("exam_students_student_idx").on(t.studentId),
]);

export const examGroups = mysqlTable("exam_groups", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    examId: char("exam_id", { length: 255 }).notNull().references(() => Exams.id, { onDelete: "cascade" }),
    groupId: char("group_id", { length: 36 }).notNull().references(() => groups.id, { onDelete: "cascade" }),
    assignedBy: char("assigned_by", { length: 36 }),
    createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
    uniqueIndex("exam_groups_unique").on(t.examId, t.groupId),
    index("exam_groups_group_idx").on(t.groupId),
]);
