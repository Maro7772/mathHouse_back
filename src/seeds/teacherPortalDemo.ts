// Local demo data for the teacher portal. Run with: npm run seed:teacher-demo
// Creates (or refreshes) one demo teacher, four demo students and a spread of sessions
// around today. It only touches rows it owns (emails ending in @mathhouse.local), so it is
// safe to re-run. Do NOT run it against production.
import "dotenv/config";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../models/connection";
import {
    admins, teachers, Student, category, grade, lessons, courses,
    sessions, sessionUsers, sessionLessons, sessionAttendance, sessionStudentRatings,
    teacherRequests, teacherAvailability, notifications, notificationTeachers,
} from "../models/schema";

export const DEMO_ADMIN = { email: "demo.admin@mathhouse.local", password: "DemoAdmin#2026", name: "Demo Super Admin" };
export const DEMO_TEACHER = { email: "demo.teacher@mathhouse.local", password: "DemoTeacher#2026", name: "Mr. Demo Teacher" };
const DEMO_STUDENTS = [
    { firstname: "Omar", lastname: "Mostafa", email: "demo.omar@mathhouse.local" },
    { firstname: "Sara", lastname: "Kamal", email: "demo.sara@mathhouse.local" },
    { firstname: "Ahmed", lastname: "Adel", email: "demo.ahmed@mathhouse.local" },
    { firstname: "Laila", lastname: "Magdy", email: "demo.laila@mathhouse.local" },
];

const ymd = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type DemoSession = {
    day: number; from: string; to: string; name: string;
    type: "Explanation" | "Re-Explanation" | "Mistakes" | "Exam";
    students: number[]; link?: boolean; cancelled?: string;
    ratings?: { s: number; r: number; c?: string }[]; attended?: number[];
};

const PLAN: DemoSession[] = [
    { day: -6, from: "17:00", to: "18:30", name: "Linear Equations — Intro", type: "Explanation", students: [0, 1, 2, 3], link: true, attended: [0, 1, 2, 3],
      ratings: [{ s: 0, r: 9, c: "Good pace. More practice problems, please." }, { s: 1, r: 8 }, { s: 2, r: 9, c: "Clear examples." }] },
    { day: -4, from: "19:00", to: "20:00", name: "Quiz 2 Review", type: "Mistakes", students: [1, 2], link: true, attended: [1, 2],
      ratings: [{ s: 1, r: 9, c: "Seeing my own mistakes worked through step by step really helped." }, { s: 2, r: 8 }] },
    { day: -2, from: "20:30", to: "21:30", name: "Linear Inequalities", type: "Re-Explanation", students: [0, 3], link: true, attended: [0],
      ratings: [{ s: 0, r: 9, c: "The number-line drawings made it click this time." }] },
    { day: -1, from: "17:00", to: "18:30", name: "Quadratic Functions — Intro", type: "Explanation", students: [1, 2, 3], link: true, attended: [1, 2, 3],
      ratings: [{ s: 1, r: 10, c: "The vertex form trick finally clicked." }, { s: 3, r: 9, c: "Clear and patient." }, { s: 2, r: 9 }] },
    { day: 0, from: "10:00", to: "11:00", name: "Percentages", type: "Explanation", students: [2, 3], cancelled: "Group merged into Thursday's class." },
    { day: 0, from: "14:00", to: "16:00", name: "Diagnostic Exam (SAT)", type: "Exam", students: [0, 1, 2, 3], link: true },
    { day: 0, from: "17:00", to: "18:30", name: "Linear Equations & Graphs", type: "Explanation", students: [0, 1, 2, 3] },
    { day: 0, from: "20:30", to: "21:30", name: "Prime Numbers & HCF", type: "Re-Explanation", students: [3] },
    { day: 1, from: "17:00", to: "18:00", name: "Mock Exam 3 Review", type: "Mistakes", students: [0] },
    { day: 1, from: "19:00", to: "20:30", name: "Systems of Equations", type: "Explanation", students: [0, 1, 2] },
    { day: 3, from: "18:00", to: "19:00", name: "Functions & Graphs", type: "Explanation", students: [1, 3] },
    { day: 5, from: "16:00", to: "18:00", name: "Mock Exam 4", type: "Exam", students: [0, 1, 2, 3] },
];

async function main() {
    // ── reference data ──
    const [cat] = await db.select({ id: category.id }).from(category).limit(1);
    const [grd] = await db.select({ id: grade.id }).from(grade).limit(1);
    if (!cat || !grd) throw new Error("Need at least one category and one grade in the database");
    const lessonRows = await db
        .select({ id: lessons.id })
        .from(lessons)
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(isNotNull(lessons.courseId))
        .limit(5);

    // ── super admin (to test the admin side: answering requests, cancelling sessions) ──
    const adminHashed = await bcrypt.hash(DEMO_ADMIN.password, 10);
    const [existingAdmin] = await db.select({ id: admins.id }).from(admins).where(eq(admins.email, DEMO_ADMIN.email));
    if (existingAdmin) {
        await db.update(admins).set({ password: adminHashed }).where(eq(admins.id, existingAdmin.id));
    } else {
        await db.insert(admins).values({
            id: randomUUID(), name: DEMO_ADMIN.name, email: DEMO_ADMIN.email, password: adminHashed,
            phoneNumber: "01000000009", type: "super_admin", status: "active", permissions: [],
        });
    }

    // ── teacher ──
    const hashed = await bcrypt.hash(DEMO_TEACHER.password, 10);
    let [teacher] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.email, DEMO_TEACHER.email));
    if (!teacher) {
        const id = randomUUID();
        await db.insert(teachers).values({ id, name: DEMO_TEACHER.name, email: DEMO_TEACHER.email, phoneNumber: "01000000000", password: hashed, categoryId: cat.id });
        teacher = { id };
    } else {
        await db.update(teachers).set({ password: hashed, name: DEMO_TEACHER.name }).where(eq(teachers.id, teacher.id));
    }

    // ── students (live balance kept high so the 24h deduction cron has room) ──
    const studentIds: string[] = [];
    for (const [i, s] of DEMO_STUDENTS.entries()) {
        const [existing] = await db.select({ id: Student.id }).from(Student).where(eq(Student.email, s.email));
        if (existing) { studentIds.push(existing.id); continue; }
        const id = randomUUID();
        await db.insert(Student).values({
            id, firstname: s.firstname, lastname: s.lastname, nickname: s.firstname, email: s.email,
            password: hashed, phone: `0100000000${i + 1}`, category: cat.id, grade: grd.id,
            isVerified: true, livebalance: 50,
        } as any);
        studentIds.push(id);
    }

    // ── wipe previous demo sessions / requests / availability / notifications ──
    const oldSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.teacherId, teacher.id));
    if (oldSessions.length) await db.delete(sessions).where(inArray(sessions.id, oldSessions.map(s => s.id)));
    await db.delete(teacherRequests).where(eq(teacherRequests.teacherId, teacher.id));
    await db.delete(teacherAvailability).where(eq(teacherAvailability.teacherId, teacher.id));
    const oldNotes = await db.select({ id: notificationTeachers.notificationId }).from(notificationTeachers).where(eq(notificationTeachers.teacherId, teacher.id));
    if (oldNotes.length) await db.delete(notifications).where(inArray(notifications.id, oldNotes.map(n => n.id)));
    await db.delete(notificationTeachers).where(eq(notificationTeachers.teacherId, teacher.id));

    // ── sessions ──
    let cancellationTarget: string | null = null;
    for (const [i, p] of PLAN.entries()) {
        const id = randomUUID();
        await db.insert(sessions).values({
            id, name: p.name, scheduleType: "once", sessionDate: ymd(p.day) as any,
            timeFrom: `${p.from}:00`, timeTo: `${p.to}:00`, teacherId: teacher.id,
            sessionRelationalType: p.type,
            session_link: p.link ? "https://meet.google.com/demo-link" : null,
            status: p.cancelled ? "cancelled" : "scheduled",
            cancelReason: p.cancelled ?? null, cancelledBy: p.cancelled ? "admin" : null,
            cancelledAt: p.cancelled ? new Date() : null,
        });
        if (lessonRows.length) {
            await db.insert(sessionLessons).values({ id: randomUUID(), sessionId: id, lessonId: lessonRows[i % lessonRows.length].id });
        }
        await db.insert(sessionUsers).values(p.students.map(s => ({ id: randomUUID(), sessionId: id, studentId: studentIds[s] })));
        for (const s of p.attended ?? []) {
            await db.insert(sessionAttendance).values({ id: randomUUID(), sessionId: id, studentId: studentIds[s], status: "present", attendedAt: new Date() });
        }
        for (const r of p.ratings ?? []) {
            await db.insert(sessionStudentRatings).values({ id: randomUUID(), sessionId: id, studentId: studentIds[r.s], overallRating: r.r, generalComment: r.c ?? null });
        }
        if (p.day === 1 && !cancellationTarget) cancellationTarget = id;
    }

    // ── requests ──
    await db.insert(teacherRequests).values([
        { id: randomUUID(), teacherId: teacher.id, type: "cover", requestDate: ymd(3) as any, timeFrom: "18:00:00", timeTo: "21:30:00", reason: "Travel — back on Sunday." },
        { id: randomUUID(), teacherId: teacher.id, type: "cover", requestDate: ymd(-3) as any, timeFrom: "20:30:00", timeTo: "21:30:00", reason: "Medical appointment.", status: "accepted", adminReply: "Approved, another teacher takes this slot.", respondedAt: new Date() },
        ...(cancellationTarget ? [{ id: randomUUID(), teacherId: teacher.id, type: "cancellation" as const, sessionId: cancellationTarget, reason: "Student asked to move to next week.", status: "rejected" as const, adminReply: "Please keep it, the student confirmed.", respondedAt: new Date() }] : []),
    ]);

    // ── one notification ──
    const nid = randomUUID();
    await db.insert(notifications).values({ id: nid, dateTime: new Date(), notification: "Welcome to the new teacher portal. Your schedule and ratings are now live." });
    await db.insert(notificationTeachers).values({ id: randomUUID(), notificationId: nid, teacherId: teacher.id });

    console.log(`✅ Teacher portal demo ready: ${PLAN.length} sessions for ${DEMO_TEACHER.email} and ${DEMO_ADMIN.email} (passwords are in src/seeds/teacherPortalDemo.ts)`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

