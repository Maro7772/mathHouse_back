// utils/studentPlanning.ts
// Phase D — planning for a student:
//  • how many sessions the student can still be booked into (their purchased live sessions), and
//  • which lessons they already attended or already have booked, so a returning student is never
//    planned the same lesson twice.
import { sql } from "drizzle-orm";
import { db } from "../models/connection";

type Row = Record<string, any>;
const rowsOf = async (q: any): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const notIn = (ids: string[], col: any) => (ids.length ? sql`AND ${col} NOT IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql``);

/** Sessions the student is in (direct or group), not cancelled for them. */
const mySessions = (studentId: string) => sql`(
    SELECT su.session_id AS sid FROM session_users su WHERE su.student_id = ${studentId}
    UNION
    SELECT sg.session_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
    WHERE gs.student_id = ${studentId}
      AND NOT EXISTS (SELECT 1 FROM student_cancel_requests cr WHERE cr.session_id = sg.session_id
                      AND cr.student_id = ${studentId} AND cr.status = 'accepted'))`;

/**
 * Sessions left to plan = live balance − upcoming sessions already booked (not charged yet)
 *                         − sessions waiting for the student's answer in other plans.
 * excludePlanId: the plan being (re)built — its own waiting proposals are being replaced, so they don't count.
 */
export async function studentSessionBudget(studentId: string, excludePlanId?: string) {
    const [st] = await rowsOf(sql`SELECT live_balance AS lb FROM student WHERE id = ${studentId}`);
    const liveBalance = Number(st?.lb) || 0;
    const [b] = await rowsOf(sql`
        SELECT COUNT(DISTINCT s.id) AS n FROM sessions s
        WHERE s.id IN ${mySessions(studentId)} AND s.status = 'scheduled' AND s.session_date >= CURDATE()
          AND NOT EXISTS (SELECT 1 FROM session_package_deductions d WHERE d.session_id = s.id AND d.student_id = ${studentId})`);
    const [p] = await rowsOf(sql`
        SELECT COUNT(*) AS n FROM student_plan_sessions ps JOIN student_availability_plans p ON p.id = ps.plan_id
        WHERE p.student_id = ${studentId} AND ps.student_response = 'pending' AND p.status <> 'cancelled'
          ${excludePlanId ? sql`AND p.id <> ${excludePlanId}` : sql``}`);
    const booked = Number(b?.n) || 0, waiting = Number(p?.n) || 0;
    return { liveBalance, booked, waiting, toPlan: Math.max(0, liveBalance - booked - waiting) };
}

/**
 * lessonId → "attended" | "booked" for this student.
 *  attended: present in a session that covered the lesson, or marked Attended on the admin sheet.
 *  booked:   in an upcoming session of theirs, or proposed to them in a plan still waiting / accepted.
 * skipSessionIds: proposals being replaced (they don't count as booked).
 */
export async function studentLessonStatus(studentId: string, skipSessionIds: string[] = []) {
    const status = new Map<string, "attended" | "booked">();
    const attended = await rowsOf(sql`
        SELECT DISTINCT sa.lesson_id AS id FROM session_attendance a
        JOIN session_academic_info sa ON sa.session_id = a.session_id
        WHERE a.student_id = ${studentId} AND a.status = 'present'
        UNION
        SELECT lesson_id FROM student_lesson_attendance WHERE student_id = ${studentId} AND status = 'present'`);
    attended.forEach((r) => status.set(r.id, "attended"));
    const booked = await rowsOf(sql`
        SELECT DISTINCT sa.lesson_id AS id FROM sessions s JOIN session_academic_info sa ON sa.session_id = s.id
        WHERE s.status = 'scheduled' AND s.session_date >= CURDATE() ${notIn(skipSessionIds, sql`s.id`)}
          AND (s.id IN ${mySessions(studentId)}
               OR EXISTS (SELECT 1 FROM student_plan_sessions ps JOIN student_availability_plans p ON p.id = ps.plan_id
                          WHERE ps.session_id = s.id AND p.student_id = ${studentId} AND p.status <> 'cancelled'
                            AND ps.student_response IN ('pending', 'accepted')))`);
    booked.forEach((r) => { if (!status.has(r.id)) status.set(r.id, "booked"); });
    return status;
}
