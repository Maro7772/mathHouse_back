// utils/groupMatching.ts
// Phase F — existing GROUP sessions a student (study-plan request) can join.
// A session matches when:
//  • it is a group session (has a group), scheduled (not cancelled), today or later, inside the date range;
//  • it fits completely inside one of the student's free times (the request's day / date + time);
//  • it is in a course the student owns (when they own any);
//  • it teaches at least one lesson the student still needs — not attended, not already booked
//    (a Re-Explanation may revisit attended lessons; it is shown with that note);
//  • the student is not already in it, and has no other session at that time.
import { sql } from "drizzle-orm";
import { db } from "../models/connection";
import { studentLessonStatus } from "./studentPlanning";
import { ymd } from "./teacherSchedule";

type Row = Record<string, any>;
const rowsOf = async (q: any): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const toMin = (t: any) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const inList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

export type GroupMatch = {
    id: string; name: string; date: string; timeFrom: string; timeTo: string; type: string;
    teacher: { id: string; name: string };
    groups: { id: string; name: string; size: number }[];
    lessons: { id: string; name: string; status: "attended" | "booked" | null }[];
    course: string | null;
    needed: number;          // lessons the student still needs
    revisits: boolean;       // Re-Explanation of lessons already attended
    inThisPlan: "pending" | "accepted" | "rejected" | null;
};

export async function matchGroupSessions(planId: string, opts: { from?: string; to?: string } = {}) {
    const [plan] = await rowsOf(sql`SELECT id, student_id AS studentId FROM student_availability_plans WHERE id = ${planId}`);
    if (!plan) return { studentId: null as string | null, matches: [] as GroupMatch[] };
    const studentId = plan.studentId as string;
    const slots = await rowsOf(sql`SELECT day_of_week AS day, specific_date AS specificDate, time_from AS f, time_to AS t FROM student_availability_slots WHERE plan_id = ${planId}`);
    if (!slots.length) return { studentId, matches: [] };

    const from = opts.from || ymd(new Date());
    const to = opts.to || ymd(new Date(Date.now() + 60 * 86400000));
    const candidates = await rowsOf(sql`
        SELECT s.id, s.name, s.session_date AS date, s.time_from AS timeFrom, s.time_to AS timeTo,
               s.session_relational_type AS type, s.teacher_id AS teacherId, t.name AS teacherName
        FROM sessions s LEFT JOIN teachers t ON t.id = s.teacher_id
        WHERE s.status = 'scheduled' AND s.session_date BETWEEN ${from} AND ${to} AND s.session_date >= CURDATE()
          AND EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM session_users su WHERE su.session_id = s.id AND su.student_id = ${studentId})
          AND NOT EXISTS (SELECT 1 FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
                          WHERE sg.session_id = s.id AND gs.student_id = ${studentId})
          AND NOT EXISTS (SELECT 1 FROM student_cancel_requests cr WHERE cr.session_id = s.id AND cr.student_id = ${studentId} AND cr.status = 'accepted')
        ORDER BY s.session_date, s.time_from
        LIMIT 500`);

    // fits completely inside a free time
    const fits = candidates.filter((c) => {
        const d = ymd(c.date), from = toMin(c.timeFrom), to = toMin(c.timeTo);
        const dayName = DAY_NAMES[new Date(`${d}T00:00:00`).getDay()];
        return slots.some((sl) => (sl.specificDate ? ymd(sl.specificDate) === d : sl.day === dayName) && toMin(sl.f) <= from && toMin(sl.t) >= to);
    });
    if (!fits.length) return { studentId, matches: [] };
    const ids = fits.map((c) => c.id);

    // the student's own sessions those days (they can't be in two places)
    const mine = await rowsOf(sql`
        SELECT s.session_date AS date, s.time_from AS f, s.time_to AS t FROM sessions s
        WHERE s.status = 'scheduled' AND s.session_date BETWEEN ${from} AND ${to}
          AND (s.id IN (SELECT su.session_id FROM session_users su WHERE su.student_id = ${studentId})
               OR s.id IN (SELECT sg.session_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id WHERE gs.student_id = ${studentId}))
          AND NOT EXISTS (SELECT 1 FROM student_cancel_requests cr WHERE cr.session_id = s.id AND cr.student_id = ${studentId} AND cr.status = 'accepted')`);

    const [lessonRows, groupRows, ownedCourses, planRows] = await Promise.all([
        rowsOf(sql`SELECT sa.session_id AS sessionId, l.id, l.name, l.course_id AS courseId, co.name AS course
                   FROM session_academic_info sa JOIN lessons l ON l.id = sa.lesson_id LEFT JOIN courses co ON co.id = l.course_id
                   WHERE sa.session_id IN (${inList(ids)})`),
        rowsOf(sql`SELECT sg.session_id AS sessionId, g.id, g.name, (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = g.id) AS size
                   FROM session_groups sg JOIN \`groups\` g ON g.id = sg.group_id WHERE sg.session_id IN (${inList(ids)})`),
        rowsOf(sql`SELECT DISTINCT COALESCE(e.courseId, l.course_id, ch.course_id) AS courseId FROM enrolledItems e
                   LEFT JOIN lessons l ON l.id = e.lessonId LEFT JOIN chapters ch ON ch.id = e.chapterId
                   WHERE e.studentId = ${studentId} AND e.status = 'active' AND (e.expiresAt IS NULL OR e.expiresAt > NOW())`),
        rowsOf(sql`SELECT session_id AS sessionId, student_response AS response FROM student_plan_sessions WHERE plan_id = ${planId}`),
    ]);
    const owned = new Set(ownedCourses.map((r) => r.courseId).filter(Boolean));
    // this plan's own waiting proposals don't count as "booked"
    const pendingHere = planRows.filter((r) => r.response !== "accepted").map((r) => r.sessionId);
    const status = await studentLessonStatus(studentId, pendingHere);

    const matches: GroupMatch[] = [];
    for (const c of fits) {
        const d = ymd(c.date);
        if (mine.some((m) => ymd(m.date) === d && toMin(m.f) < toMin(c.timeTo) && toMin(m.t) > toMin(c.timeFrom))) continue;
        const ls = lessonRows.filter((l) => l.sessionId === c.id);
        if (owned.size && ls.length && !ls.some((l) => owned.has(l.courseId))) continue;          // not a course they bought
        const lessons = ls.map((l) => ({ id: l.id, name: l.name, status: (status.get(l.id) || null) as GroupMatch["lessons"][number]["status"] }));
        const needed = lessons.filter((l) => !l.status).length;
        const revisits = c.type === "Re-Explanation" && lessons.some((l) => l.status === "attended");
        if (lessons.length && needed === 0 && !revisits) continue;                                 // nothing new for them
        const planRow = planRows.find((r) => r.sessionId === c.id);
        matches.push({
            id: c.id, name: c.name, date: d, timeFrom: String(c.timeFrom).slice(0, 5), timeTo: String(c.timeTo).slice(0, 5),
            type: c.type, teacher: { id: c.teacherId, name: c.teacherName },
            groups: groupRows.filter((g) => g.sessionId === c.id).map((g) => ({ id: g.id, name: g.name, size: Number(g.size) || 0 })),
            lessons, course: ls[0]?.course || null, needed, revisits,
            inThisPlan: (planRow?.response as GroupMatch["inThisPlan"]) || null,
        });
    }
    return { studentId, matches };
}
