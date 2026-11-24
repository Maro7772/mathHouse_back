// controllers/admin/sessionCommonLessons.ts
// Add session → the lessons a group (or several students) have IN COMMON, so the admin doesn't have to
// pick a course / chapter first. A lesson is common when every student owns it (an active, unexpired
// purchase of the lesson, its chapter, its semester or its course). Only lessons that NONE of the
// students attended yet are listed; the rest are counted in hiddenAttended.
import { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";

type Row = Record<string, any>;
const rows = async (q: any): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const inList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

// POST /api/admin/session/common-lessons { groupId?, studentIds? }
export const getCommonLessons = async (req: Request, res: Response) => {
    const groupId = req.body.groupId ? String(req.body.groupId) : null;
    const picked: string[] = Array.isArray(req.body.studentIds) ? req.body.studentIds.map(String) : [];
    const members = groupId
        ? (await rows(sql`SELECT student_id AS id FROM group_students WHERE group_id = ${groupId}`)).map((r) => r.id as string)
        : [];
    const studentIds = [...new Set([...members, ...picked])];
    if (!studentIds.length) throw new BadRequest(groupId ? "This group has no students yet" : "Pick a group or students first");

    const students = await rows(sql`SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM student WHERE id IN (${inList(studentIds)})`);

    // every lesson each student owns right now
    const owned = await rows(sql`
        SELECT DISTINCT e.studentId, l.id AS lessonId
        FROM enrolledItems e
        JOIN lessons l ON l.id = e.lessonId OR l.chapter_id = e.chapterId OR l.course_id = e.courseId
            OR (e.semesterId IS NOT NULL AND l.chapter_id IN (SELECT ch.id FROM chapters ch WHERE ch.semester_id = e.semesterId))
        WHERE e.studentId IN (${inList(studentIds)}) AND e.status = 'active' AND (e.expiresAt IS NULL OR e.expiresAt > NOW())`);
    const owners = new Map<string, Set<string>>();
    owned.forEach((r) => owners.set(r.lessonId, (owners.get(r.lessonId) || new Set()).add(r.studentId)));
    const common = [...owners.entries()].filter(([, s]) => s.size === studentIds.length).map(([id]) => id);
    // who owns nothing at all (they make the common list empty)
    const ownsSomething = new Set(owned.map((r) => r.studentId));
    const ownsNothing = students.filter((s) => !ownsSomething.has(s.id)).map((s) => s.name);

    if (!common.length) {
        return SuccessResponse(res, { students: students.length, courses: [], ownsNothing, sharedTotal: 0, hiddenAttended: 0 });
    }

    const lessonRows = await rows(sql`
        SELECT l.id, l.name, ch.id AS chapterId, ch.name AS chapterName, co.id AS courseId, co.name AS courseName,
               co.category_id AS subCategoryId, COALESCE(cat.parent_category_id, co.category_id) AS categoryId
        FROM lessons l
        JOIN chapters ch ON ch.id = l.chapter_id
        JOIN courses co ON co.id = l.course_id
        LEFT JOIN category cat ON cat.id = co.category_id
        WHERE l.id IN (${inList(common)})
        ORDER BY co.name, ch.\`order\`, l.\`order\`, l.name`);
    const attended = await rows(sql`
        SELECT x.lessonId, COUNT(DISTINCT x.studentId) AS n FROM (
            SELECT sa.lesson_id AS lessonId, a.student_id AS studentId FROM session_attendance a
            JOIN session_academic_info sa ON sa.session_id = a.session_id
            WHERE a.status = 'present' AND a.student_id IN (${inList(studentIds)}) AND sa.lesson_id IN (${inList(common)})
            UNION
            SELECT lesson_id, student_id FROM student_lesson_attendance
            WHERE status = 'present' AND student_id IN (${inList(studentIds)}) AND lesson_id IN (${inList(common)})
        ) x GROUP BY x.lessonId`);
    const attendedBy = new Map(attended.map((r) => [r.lessonId, Number(r.n) || 0]));
    // only lessons NOBODY in the selection attended yet (attended by even one student → left out)
    const hiddenAttended = lessonRows.filter((l) => attendedBy.get(l.id)).length;

    // course → chapter → lessons
    const courses: any[] = [];
    for (const l of lessonRows) {
        if (attendedBy.get(l.id)) continue;
        let co = courses.find((c) => c.id === l.courseId);
        if (!co) courses.push(co = { id: l.courseId, name: l.courseName, categoryId: l.categoryId, subCategoryId: l.subCategoryId, chapters: [] });
        let ch = co.chapters.find((c: any) => c.id === l.chapterId);
        if (!ch) co.chapters.push(ch = { id: l.chapterId, name: l.chapterName, lessons: [] });
        ch.lessons.push({ id: l.id, name: l.name, attended: 0 });
    }
    return SuccessResponse(res, { students: students.length, courses, ownsNothing, sharedTotal: lessonRows.length, hiddenAttended });
};
