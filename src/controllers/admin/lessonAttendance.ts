// Admin → Students → Content & attendance → Attendance sheet.
// Lists every lesson a student owns (bought or unlocked) and lets the admin mark each one
// Attended / Absent, like a score sheet. Session attendance for the same lessons is shown alongside.
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    Student, lessons, chapters, courses, enrolledItems,
    sessions, sessionLessons, sessionAttendance, studentLessonAttendance,
} from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";

type Access = "active" | "expired";

/** Lesson id → how the student owns it (the best access wins: active beats expired). */
async function ownedLessons(studentId: string) {
    const rows = await db
        .select({
            courseId: enrolledItems.courseId,
            chapterId: enrolledItems.chapterId,
            lessonId: enrolledItems.lessonId,
            status: enrolledItems.status,
            expiresAt: enrolledItems.expiresAt,
        })
        .from(enrolledItems)
        .where(and(eq(enrolledItems.studentId, studentId), inArray(enrolledItems.status, ["active", "expired"])));

    const now = Date.now();
    const accessOf = (r: (typeof rows)[number]): Access =>
        r.status === "active" && (!r.expiresAt || new Date(r.expiresAt).getTime() > now) ? "active" : "expired";

    const byLesson = rows.filter(r => r.lessonId);
    const byChapter = rows.filter(r => r.chapterId && !r.lessonId);
    const byCourse = rows.filter(r => r.courseId && !r.chapterId && !r.lessonId);

    const conds = [] as any[];
    if (byLesson.length) conds.push(inArray(lessons.id, byLesson.map(r => r.lessonId!)));
    if (byChapter.length) conds.push(inArray(lessons.chapterId, byChapter.map(r => r.chapterId!)));
    if (byCourse.length) conds.push(inArray(lessons.courseId, byCourse.map(r => r.courseId!)));
    if (conds.length === 0) return { list: [] as any[], access: new Map<string, { access: Access; expiresAt: Date | null }>(), emptyEnrollments: [] as any[] };

    const list = await db
        .select({
            id: lessons.id, name: lessons.name, order: lessons.order,
            chapterId: lessons.chapterId, chapterName: chapters.name, chapterOrder: chapters.order,
            courseId: lessons.courseId, courseName: courses.name,
        })
        .from(lessons)
        .innerJoin(chapters, eq(chapters.id, lessons.chapterId))
        .innerJoin(courses, eq(courses.id, lessons.courseId))
        .where(or(...conds));

    const access = new Map<string, { access: Access; expiresAt: Date | null }>();
    const offer = (lessonId: string, r: (typeof rows)[number]) => {
        const a = accessOf(r);
        const cur = access.get(lessonId);
        if (!cur || (cur.access === "expired" && a === "active")) access.set(lessonId, { access: a, expiresAt: r.expiresAt ?? null });
    };
    for (const l of list) {
        byLesson.filter(r => r.lessonId === l.id).forEach(r => offer(l.id, r));
        byChapter.filter(r => r.chapterId === l.chapterId).forEach(r => offer(l.id, r));
        byCourse.filter(r => r.courseId === l.courseId).forEach(r => offer(l.id, r));
    }
    // enrolled courses / chapters that have no lessons yet: still shown on the sheet, with a note
    const emptyEnrollments: { type: "course" | "chapter"; id: string; name: string; courseName?: string }[] = [];
    const emptyCourseIds = [...new Set(byCourse.map(r => r.courseId!))].filter(id => !list.some(l => l.courseId === id));
    const emptyChapterIds = [...new Set(byChapter.map(r => r.chapterId!))].filter(id => !list.some(l => l.chapterId === id));
    if (emptyCourseIds.length) {
        (await db.select({ id: courses.id, name: courses.name }).from(courses).where(inArray(courses.id, emptyCourseIds)))
            .forEach(c => emptyEnrollments.push({ type: "course", id: c.id, name: c.name }));
    }
    if (emptyChapterIds.length) {
        (await db.select({ id: chapters.id, name: chapters.name, courseName: courses.name }).from(chapters)
            .innerJoin(courses, eq(courses.id, chapters.courseId)).where(inArray(chapters.id, emptyChapterIds)))
            .forEach(c => emptyEnrollments.push({ type: "chapter", id: c.id, name: c.name, courseName: c.courseName }));
    }
    return { list, access, emptyEnrollments };
}

/**
 * GET /api/admin/student/:id/lesson-attendance
 * → { student, summary, courses: [{ id, name, chapters: [{ id, name, lessons: [lesson] }] }] }
 *   lesson = { id, name, order, access, expiresAt, status: "present"|"absent"|null, markedAt, sessions: [{ id, name, date, status }] }
 */
export const getLessonAttendance = async (req: Request, res: Response) => {
    const studentId = req.params.id;
    const [student] = await db
        .select({ id: Student.id, firstname: Student.firstname, lastname: Student.lastname })
        .from(Student).where(eq(Student.id, studentId));
    if (!student) throw new NotFound("Student not found");

    const { list, access, emptyEnrollments } = await ownedLessons(studentId);
    const lessonIds = list.map(l => l.id);

    const [marks, sessionRows] = lessonIds.length
        ? await Promise.all([
            db.select({ lessonId: studentLessonAttendance.lessonId, status: studentLessonAttendance.status, markedAt: studentLessonAttendance.markedAt })
                .from(studentLessonAttendance)
                .where(and(eq(studentLessonAttendance.studentId, studentId), inArray(studentLessonAttendance.lessonId, lessonIds))),
            db.select({
                lessonId: sessionLessons.lessonId, sessionId: sessions.id, name: sessions.name,
                date: sessions.sessionDate, status: sessionAttendance.status,
            })
                .from(sessionAttendance)
                .innerJoin(sessions, eq(sessions.id, sessionAttendance.sessionId))
                .innerJoin(sessionLessons, eq(sessionLessons.sessionId, sessionAttendance.sessionId))
                .where(and(eq(sessionAttendance.studentId, studentId), inArray(sessionLessons.lessonId, lessonIds))),
        ])
        : [[], []];

    const markOf = new Map(marks.map(m => [m.lessonId, m]));
    const sessionsOf = new Map<string, { id: string; name: string; date: any; status: string }[]>();
    for (const s of sessionRows) {
        if (!sessionsOf.has(s.lessonId)) sessionsOf.set(s.lessonId, []);
        sessionsOf.get(s.lessonId)!.push({ id: s.sessionId, name: s.name, date: s.date, status: s.status });
    }

    // group: course → chapter → lessons, in the course's own order
    const coursesOut: any[] = [];
    const sorted = [...list].sort((a, b) =>
        a.courseName.localeCompare(b.courseName) || a.chapterOrder - b.chapterOrder || a.order - b.order);
    for (const l of sorted) {
        let c = coursesOut.find(x => x.id === l.courseId);
        if (!c) coursesOut.push(c = { id: l.courseId, name: l.courseName, chapters: [] });
        let ch = c.chapters.find((x: any) => x.id === l.chapterId);
        if (!ch) c.chapters.push(ch = { id: l.chapterId, name: l.chapterName, order: l.chapterOrder, lessons: [] });
        const m = markOf.get(l.id);
        ch.lessons.push({
            id: l.id, name: l.name, order: l.order,
            access: access.get(l.id)?.access ?? "active",
            expiresAt: access.get(l.id)?.expiresAt ?? null,
            status: m?.status ?? null,
            markedAt: m?.markedAt ?? null,
            sessions: sessionsOf.get(l.id) ?? [],
        });
    }

    const all = coursesOut.flatMap(c => c.chapters.flatMap((ch: any) => ch.lessons));
    return SuccessResponse(res, {
        student: { id: student.id, name: `${student.firstname} ${student.lastname}`.trim() },
        summary: {
            lessons: all.length,
            present: all.filter(l => l.status === "present").length,
            absent: all.filter(l => l.status === "absent").length,
            notMarked: all.filter(l => !l.status).length,
        },
        courses: coursesOut,
        emptyEnrollments, // [{ type: "course" | "chapter", id, name }] enrolled, but no lessons added yet
    });
};

/**
 * PUT /api/admin/student/:id/lesson-attendance
 * body: { entries: [{ lessonId, status: "present" | "absent" | null }] }   (null clears the mark)
 * Only lessons the student owns can be marked.
 */
export const saveLessonAttendance = async (req: Request, res: Response) => {
    const studentId = req.params.id;
    const entries: { lessonId: string; status: "present" | "absent" | null }[] = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entries.length === 0) throw new BadRequest("entries is required");
    if (entries.some(e => !e?.lessonId || ![null, "present", "absent"].includes(e.status as any))) {
        throw new BadRequest('Each entry needs a lessonId and a status of "present", "absent" or null');
    }

    const [student] = await db.select({ id: Student.id }).from(Student).where(eq(Student.id, studentId));
    if (!student) throw new NotFound("Student not found");

    const { access } = await ownedLessons(studentId);
    const notOwned = entries.filter(e => !access.has(e.lessonId));
    if (notOwned.length) throw new BadRequest("Some lessons are not owned by this student");

    const adminId = (req as any).user?.id ?? null;
    let saved = 0, cleared = 0;
    await db.transaction(async (tx) => {
        for (const e of entries) {
            const where = and(eq(studentLessonAttendance.studentId, studentId), eq(studentLessonAttendance.lessonId, e.lessonId));
            if (e.status === null) {
                await tx.delete(studentLessonAttendance).where(where);
                cleared++;
                continue;
            }
            const [existing] = await tx.select({ id: studentLessonAttendance.id }).from(studentLessonAttendance).where(where).limit(1);
            if (existing) {
                await tx.update(studentLessonAttendance)
                    .set({ status: e.status, markedBy: adminId, markedAt: new Date() })
                    .where(eq(studentLessonAttendance.id, existing.id));
            } else {
                await tx.insert(studentLessonAttendance).values({
                    id: randomUUID(), studentId, lessonId: e.lessonId, status: e.status, markedBy: adminId, markedAt: new Date(),
                });
            }
            saved++;
        }
    });

    return SuccessResponse(res, { message: "Attendance saved", saved, cleared });
};
