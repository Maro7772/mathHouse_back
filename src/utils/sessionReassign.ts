// utils/sessionReassign.ts
// Phase C — hand sessions to another teacher (teacher apologised / admin changed the teacher).
// The session row keeps everything (chapter, lessons, PDFs, links, students); only teacher_id changes,
// so the new teacher's dashboard gets the full context at once and the old teacher's loses it.
// Everyone involved is told: the new teacher, the previous teacher, and every student in the session.
import { sql } from "drizzle-orm";
import { db } from "../models/connection";
import { assertTeacherFree, ymd } from "./teacherSchedule";
import { sendStudentNotification } from "./studentNotification";
import { notifyTeacher } from "../controllers/teacher/portal";

type Row = Record<string, any>;
const rowsOf = async (runner: any, q: any): Promise<Row[]> => {
    const res: any = await runner.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const inList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const when = (s: Row) => {
    const d = new Date(`${ymd(s.date)}T${String(s.from).slice(0, 8)}`);
    return Number.isNaN(d.getTime()) ? ymd(s.date)
        : `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

export type Moved = { id: string; name: string; date: any; from: string; to: string; oldTeacherId: string; oldTeacherName: string };

/** The scheduled sessions among `sessionIds` that would really change teacher. */
export async function sessionsToMove(sessionIds: string[], newTeacherId: string): Promise<Moved[]> {
    if (!sessionIds.length) return [];
    return (await rowsOf(db, sql`
        SELECT s.id, s.name, s.session_date AS date, s.time_from AS \`from\`, s.time_to AS \`to\`,
               s.teacher_id AS oldTeacherId, t.name AS oldTeacherName
        FROM sessions s LEFT JOIN teachers t ON t.id = s.teacher_id
        WHERE s.id IN (${inList(sessionIds)}) AND s.status = 'scheduled' AND s.teacher_id <> ${newTeacherId}`)) as Moved[];
}

/** Throws if the new teacher is busy or outside their hours for any of these sessions. */
export async function assertCanReassign(moved: Moved[], newTeacherId: string) {
    await assertTeacherFree(newTeacherId, moved.map((m) => ({ date: ymd(m.date), from: String(m.from), to: String(m.to) })), moved.map((m) => m.id));
}

/** Changes the teacher (use inside the caller's transaction). */
export async function applyReassign(runner: any, moved: Moved[], newTeacherId: string) {
    if (!moved.length) return 0;
    await runner.execute(sql`UPDATE sessions SET teacher_id = ${newTeacherId} WHERE id IN (${inList(moved.map((m) => m.id))})`);
    return moved.length;
}

/** Tells the new teacher (with the lessons), the previous teacher(s) and the students. Never throws. */
export async function notifyReassign(moved: Moved[], newTeacherId: string, reason?: string) {
    if (!moved.length) return;
    try {
        const ids = moved.map((m) => m.id);
        const [newT] = await rowsOf(db, sql`SELECT name FROM teachers WHERE id = ${newTeacherId}`);
        const newName = newT?.name || "a new teacher";
        const lessonRows = await rowsOf(db, sql`
            SELECT sa.session_id AS sessionId, l.name FROM session_academic_info sa JOIN lessons l ON l.id = sa.lesson_id
            WHERE sa.session_id IN (${inList(ids)})`);
        const lessonsOf = (id: string) => lessonRows.filter((r) => r.sessionId === id).map((r) => r.name);
        const people = await rowsOf(db, sql`
            SELECT su.session_id AS sessionId, su.student_id AS studentId FROM session_users su WHERE su.session_id IN (${inList(ids)})
            UNION
            SELECT sg.session_id, gs.student_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
            WHERE sg.session_id IN (${inList(ids)})
              AND NOT EXISTS (SELECT 1 FROM student_cancel_requests cr WHERE cr.session_id = sg.session_id
                              AND cr.student_id = gs.student_id AND cr.status = 'accepted')`);

        // new teacher: one message with every session and its lessons
        const lines = moved.map((m) => {
            const ls = lessonsOf(m.id);
            return `"${m.name}" — ${when(m)}${ls.length ? ` (lesson${ls.length === 1 ? "" : "s"}: ${ls.join(", ")})` : ""}`;
        });
        await notifyTeacher(newTeacherId, `${moved.length === 1 ? "A session was" : `${moved.length} sessions were`} assigned to you: ${lines.join("; ")}. The materials are in your dashboard.`);

        // previous teacher(s)
        const byOld = new Map<string, Moved[]>();
        moved.forEach((m) => m.oldTeacherId && byOld.set(m.oldTeacherId, [...(byOld.get(m.oldTeacherId) || []), m]));
        for (const [oldId, list] of byOld) {
            await notifyTeacher(oldId, `${list.map((m) => `"${m.name}" (${when(m)})`).join(", ")} ${list.length === 1 ? "was" : "were"} handed to ${newName}${reason ? ` — ${reason}` : ""}.`);
        }

        // students: one message each, listing their sessions
        const perStudent = new Map<string, Moved[]>();
        people.forEach((p) => {
            const m = moved.find((x) => x.id === p.sessionId);
            if (m) perStudent.set(p.studentId, [...(perStudent.get(p.studentId) || []), m]);
        });
        for (const [studentId, list] of perStudent) {
            await sendStudentNotification(studentId, `New teacher: ${newName} will teach ${list.map((m) => `"${m.name}" (${when(m)})`).join(", ")}. Same time, same lessons.`);
        }
    } catch (e) {
        console.error("Failed to send reassignment notifications", e);
    }
}

/** Students of a session (direct + group, minus accepted cancellations) — for other notices. */
export async function studentsOfSession(sessionId: string): Promise<string[]> {
    const list = await rowsOf(db, sql`
        SELECT su.student_id AS studentId FROM session_users su WHERE su.session_id = ${sessionId}
        UNION
        SELECT gs.student_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
        WHERE sg.session_id = ${sessionId}
          AND NOT EXISTS (SELECT 1 FROM student_cancel_requests cr WHERE cr.session_id = sg.session_id
                          AND cr.student_id = gs.student_id AND cr.status = 'accepted')`);
    return list.map((r) => r.studentId as string);
}
