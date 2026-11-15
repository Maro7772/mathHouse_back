// controllers/admin/planner.ts
// Admin → Live → Planner (MathPortal design):
//   Timetable  – every session in a date range, with its approval state; "dispatch" confirms
//                approved sessions and notifies their students and teacher.
//   Find time  – who is free at a date + time (teachers from their shared availability and bookings,
//                students of a course from the free times they sent and their bookings);
//                "add session" creates a one-off session with a free teacher.
//   Build plan – turn a student's study-plan request (free times) into new sessions and propose them;
//                the student accepts/rejects them through the existing study-plan flow.
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql, SQL } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    sessions, sessionUsers, sessionGroups, sessionLessons, teachers, lessons, courses, groups,
    studentAvailabilityPlans, studentPlanSessions, Student,
} from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { sendStudentNotification } from "../../utils/studentNotification";
import { notifyTeacher } from "../teacher/portal";

type Row = Record<string, any>;
const rows = async (q: SQL): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t);
const toMin = (t: string) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const dayIndex = (date: string) => new Date(`${date}T00:00:00`).getDay();
const pretty = (date: string, time: string) => {
    const d = new Date(`${date}T${hhmmss(time)}`);
    return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

function assertTimes(date: string, timeFrom: string, timeTo: string) {
    if (Number.isNaN(new Date(`${date}T00:00:00`).getTime())) throw new BadRequest("That date does not exist");
    if (toMin(timeFrom) >= toMin(timeTo)) throw new BadRequest("The start time must be before the end time");
}

// ─────────────────────────────────────────────────────────────────────────────
// Bookings: who is already in a scheduled session that overlaps date + time
// ─────────────────────────────────────────────────────────────────────────────
async function bookingsAt(date: string, timeFrom: string, timeTo: string, skipIds: string[] = []) {
    const skip = skipIds.length ? sql`AND s.id NOT IN (${sql.join(skipIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
    const overlap = sql`s.status = 'scheduled' AND s.session_date = ${date}
        AND s.time_from < ${hhmmss(timeTo)} AND s.time_to > ${hhmmss(timeFrom)} ${skip}`;
    const teacherRows = await rows(sql`SELECT DISTINCT s.teacher_id AS id, s.name FROM sessions s WHERE ${overlap}`);
    const studentRows = await rows(sql`
        SELECT su.student_id AS id FROM session_users su JOIN sessions s ON s.id = su.session_id WHERE ${overlap}
        UNION
        SELECT gs.student_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
            JOIN sessions s ON s.id = sg.session_id WHERE ${overlap}
        UNION
        SELECT p.student_id FROM student_plan_sessions ps JOIN student_availability_plans p ON p.id = ps.plan_id
            JOIN sessions s ON s.id = ps.session_id
            WHERE ${overlap} AND ps.student_response = 'pending' AND p.status = 'plan_proposed'`);
    return {
        teachers: new Map(teacherRows.map((r) => [r.id, r.name as string])),
        students: new Set(studentRows.map((r) => r.id as string)),
    };
}

/** Teacher state at a date + time: busy / free / off (outside shared hours) / not_shared. */
async function teacherStates(date: string, timeFrom: string, timeTo: string, courseId?: string, skipIds: string[] = []) {
    const booked = await bookingsAt(date, timeFrom, timeTo, skipIds);
    const all = await rows(sql`
        SELECT t.id, t.name,
          ${courseId ? sql`EXISTS (SELECT 1 FROM course_teachers ct WHERE ct.teacher_id = t.id AND ct.course_id = ${courseId})` : sql`1`} AS teachesCourse
        FROM teachers t ORDER BY t.name`);
    const avail = await rows(sql`SELECT teacher_id AS teacherId, day_of_week AS d, time_from AS f, time_to AS t FROM teacher_availability`);
    const byTeacher = new Map<string, Row[]>();
    avail.forEach((a) => byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) || []), a]));
    const day = dayIndex(date), from = toMin(timeFrom), to = toMin(timeTo);
    return all.map((t) => {
        const windows = byTeacher.get(t.id) || [];
        const state = booked.teachers.has(t.id) ? "busy"
            : !windows.length ? "not_shared"
            : windows.some((w) => Number(w.d) === day && toMin(w.f) <= from && toMin(w.t) >= to) ? "free" : "off";
        return { id: t.id, name: t.name, teachesCourse: Boolean(Number(t.teachesCourse)), state, busyWith: booked.teachers.get(t.id) || null };
    });
}

/** Latest study-plan free times per student (day name or specific date + window). */
async function studentFreeTimes(studentIds: string[]) {
    if (!studentIds.length) return new Map<string, Row[]>();
    const list = await rows(sql`
        SELECT p.student_id AS studentId, sl.day_of_week AS dayName, sl.specific_date AS specificDate,
               sl.time_from AS f, sl.time_to AS t
        FROM student_availability_plans p
        JOIN student_availability_slots sl ON sl.plan_id = p.id
        WHERE p.status <> 'cancelled' AND p.student_id IN (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
          AND p.created_at = (SELECT MAX(p2.created_at) FROM student_availability_plans p2
                              WHERE p2.student_id = p.student_id AND p2.status <> 'cancelled')`);
    const map = new Map<string, Row[]>();
    list.forEach((r) => map.set(r.studentId, [...(map.get(r.studentId) || []), r]));
    return map;
}
const slotCovers = (slot: Row, date: string, from: number, to: number) =>
    (slot.specificDate ? String(slot.specificDate).slice(0, 10) === date : slot.dayName === DAY_NAMES[dayIndex(date)])
    && toMin(slot.f) <= from && toMin(slot.t) >= to;

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/planner/timetable?from&to
// ─────────────────────────────────────────────────────────────────────────────
export const getTimetable = async (req: Request, res: Response) => {
    const from = String(req.query.from || ""), to = String(req.query.to || "");
    if (!ISO.test(from) || !ISO.test(to)) throw new BadRequest("from and to are required (YYYY-MM-DD)");
    if (from > to) throw new BadRequest("from must be on or before to");
    const days = (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000;
    if (days > 62) throw new BadRequest("Pick a range of two months or less");

    const list = await rows(sql`
        SELECT s.id, s.name, s.session_date AS date, s.time_from AS timeFrom, s.time_to AS timeTo,
               s.session_relational_type AS type, s.status, s.cancel_reason AS cancelReason,
               s.confirmed_at AS confirmedAt, s.teacher_id AS teacherId, t.name AS teacherName
        FROM sessions s LEFT JOIN teachers t ON t.id = s.teacher_id
        WHERE s.session_date BETWEEN ${from} AND ${to}
        ORDER BY s.session_date, s.time_from`);
    const ids = list.map((s) => s.id);
    const inIds = ids.length ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql`NULL`;

    const direct = ids.length ? await rows(sql`
        SELECT su.session_id AS sessionId, st.id, CONCAT(st.first_name, ' ', st.last_name) AS name
        FROM session_users su JOIN student st ON st.id = su.student_id WHERE su.session_id IN (${inIds})`) : [];
    const grp = ids.length ? await rows(sql`
        SELECT sg.session_id AS sessionId, g.id, g.name,
               (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = g.id) AS size
        FROM session_groups sg JOIN \`groups\` g ON g.id = sg.group_id WHERE sg.session_id IN (${inIds})`) : [];
    const les = ids.length ? await rows(sql`
        SELECT sa.session_id AS sessionId, l.name AS lesson, co.name AS course
        FROM session_academic_info sa JOIN lessons l ON l.id = sa.lesson_id LEFT JOIN courses co ON co.id = l.course_id
        WHERE sa.session_id IN (${inIds})`) : [];
    const plan = ids.length ? await rows(sql`
        SELECT ps.session_id AS sessionId, ps.student_response AS response, p.id AS planId, p.title, p.status AS planStatus,
               st.id AS studentId, CONCAT(st.first_name, ' ', st.last_name) AS studentName
        FROM student_plan_sessions ps JOIN student_availability_plans p ON p.id = ps.plan_id
        JOIN student st ON st.id = p.student_id
        WHERE ps.session_id IN (${inIds}) AND p.status <> 'cancelled'`) : [];

    const group = <T extends Row>(arr: T[]) => {
        const m = new Map<string, T[]>(); arr.forEach((r) => m.set(r.sessionId, [...(m.get(r.sessionId) || []), r])); return m;
    };
    const D = group(direct), G = group(grp), L = group(les), P = group(plan);

    const out = list.map((s) => {
        const plans = (P.get(s.id) || []).map((p) => ({ planId: p.planId, title: p.title, studentId: p.studentId, studentName: p.studentName, response: p.response }));
        // Waiting on a student's answer → pending; a student turned it down → changes; otherwise approved.
        const approval = plans.some((p) => p.response === "pending") ? "pending" : plans.some((p) => p.response === "rejected") ? "changes" : "approved";
        const students = (D.get(s.id) || []).map((x) => ({ id: x.id, name: x.name }));
        const groupsList = (G.get(s.id) || []).map((g) => ({ id: g.id, name: g.name, size: Number(g.size) }));
        const lessonsList = L.get(s.id) || [];
        return {
            id: s.id, name: s.name, date: String(s.date).slice(0, 10),
            timeFrom: String(s.timeFrom).slice(0, 5), timeTo: String(s.timeTo).slice(0, 5),
            type: s.type, status: s.status, cancelReason: s.cancelReason, confirmedAt: s.confirmedAt,
            teacher: { id: s.teacherId, name: s.teacherName },
            students, groups: groupsList, plans,
            studentCount: new Set(students.map((x) => x.id)).size + groupsList.reduce((a, g) => a + g.size, 0),
            course: lessonsList[0]?.course || null,
            lessons: [...new Set(lessonsList.map((l) => l.lesson))],
            approval,
        };
    });
    return SuccessResponse(res, { from, to, sessions: out });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/planner/free?date&timeFrom&timeTo[&courseId][&skipSessionId]
// ─────────────────────────────────────────────────────────────────────────────
export const getFreeAt = async (req: Request, res: Response) => {
    const date = String(req.query.date || ""), timeFrom = String(req.query.timeFrom || ""), timeTo = String(req.query.timeTo || "");
    const courseId = req.query.courseId ? String(req.query.courseId) : undefined;
    // skipSessionId: a session being moved; skipPlanId: a plan being rebuilt (its current proposal is replaced)
    const skip = req.query.skipSessionId ? [String(req.query.skipSessionId)] : [];
    if (req.query.skipPlanId) skip.push(...await replaceableSessions(String(req.query.skipPlanId)));
    if (!ISO.test(date) || !/^\d{2}:\d{2}/.test(timeFrom) || !/^\d{2}:\d{2}/.test(timeTo)) {
        throw new BadRequest("date, timeFrom and timeTo are required");
    }
    assertTimes(date, timeFrom, timeTo);

    const teachersOut = await teacherStates(date, timeFrom, timeTo, courseId, skip);
    let studentsOut: Row[] = [];
    if (courseId) {
        const enrolled = await rows(sql`
            SELECT DISTINCT st.id, CONCAT(st.first_name, ' ', st.last_name) AS name, st.nickname, st.live_balance AS liveBalance
            FROM enrolledItems e JOIN student st ON st.id = e.studentId
            WHERE e.courseId = ${courseId} AND e.status = 'active' ORDER BY name`);
        const booked = await bookingsAt(date, timeFrom, timeTo, skip);
        const free = await studentFreeTimes(enrolled.map((s) => s.id));
        const from = toMin(timeFrom), to = toMin(timeTo);
        studentsOut = enrolled.map((s) => {
            const slots = free.get(s.id);
            const state = booked.students.has(s.id) ? "busy" : !slots ? "unknown" : slots.some((x) => slotCovers(x, date, from, to)) ? "free" : "off";
            return { id: s.id, name: s.name, nickname: s.nickname, liveBalance: Number(s.liveBalance), state };
        });
    }
    return SuccessResponse(res, { date, timeFrom, timeTo, teachers: teachersOut, students: studentsOut });
};

// ─────────────────────────────────────────────────────────────────────────────
// Creating sessions (shared by "add session" and "build plan")
// ─────────────────────────────────────────────────────────────────────────────
type Item = { date: string; timeFrom: string; timeTo: string; teacherId: string; type: "Explanation" | "Re-Explanation" | "Mistakes" | "Exam"; lessonIds: string[]; name?: string };

/** Checks an item and returns the row to insert. Teachers must not be double-booked. */
async function prepareItem(item: Item, courseId: string, taken: Item[], skipIds: string[] = []) {
    assertTimes(item.date, item.timeFrom, item.timeTo);
    if (item.type !== "Exam" && !item.lessonIds.length) throw new BadRequest(`Pick at least one lesson for the ${pretty(item.date, item.timeFrom)} session`);

    let lessonNames: string[] = [];
    if (item.lessonIds.length) {
        const found = await db.select({ id: lessons.id, name: lessons.name, courseId: lessons.courseId }).from(lessons).where(inArray(lessons.id, item.lessonIds));
        if (found.length !== new Set(item.lessonIds).size) throw new BadRequest("One or more lessons were not found");
        if (found.some((l) => l.courseId !== courseId)) throw new BadRequest("Every lesson must belong to the chosen course");
        lessonNames = item.lessonIds.map((id) => found.find((l) => l.id === id)!.name);
    }
    const [teacher] = await db.select({ id: teachers.id, name: teachers.name }).from(teachers).where(eq(teachers.id, item.teacherId));
    if (!teacher) throw new BadRequest("Teacher not found");

    const booked = await bookingsAt(item.date, item.timeFrom, item.timeTo, skipIds);
    if (booked.teachers.has(teacher.id)) {
        throw new BadRequest(`${teacher.name} already teaches "${booked.teachers.get(teacher.id)}" at ${pretty(item.date, item.timeFrom)}`);
    }
    const clash = taken.find((x) => x.teacherId === item.teacherId && x.date === item.date && toMin(x.timeFrom) < toMin(item.timeTo) && toMin(x.timeTo) > toMin(item.timeFrom));
    if (clash) throw new BadRequest(`Two sessions with ${teacher.name} overlap on ${pretty(item.date, item.timeFrom)}`);

    return {
        teacher,
        row: {
            id: randomUUID(),
            name: item.name?.trim() || (item.type === "Exam" && !lessonNames.length ? "Exam" : lessonNames.join(" · ")).slice(0, 255),
            scheduleType: "once" as const,
            sessionDate: item.date as any,
            timeFrom: hhmmss(item.timeFrom),
            timeTo: hhmmss(item.timeTo),
            teacherId: teacher.id,
            sessionRelationalType: item.type,
        },
    };
}

// POST /admin/planner/sessions — one-off session, approved right away (dispatch it from the timetable)
export const createPlannerSession = async (req: Request, res: Response) => {
    const { courseId, studentIds, groupIds, ...item } = req.body as Item & { courseId: string; studentIds: string[]; groupIds: string[] };
    const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!course) throw new BadRequest("Course not found");
    const uniqStudents = [...new Set(studentIds)], uniqGroups = [...new Set(groupIds)];
    if (!uniqStudents.length && !uniqGroups.length) throw new BadRequest("Pick at least one student or group");
    if (uniqStudents.length) {
        const found = await db.select({ id: Student.id }).from(Student).where(inArray(Student.id, uniqStudents));
        if (found.length !== uniqStudents.length) throw new BadRequest("One or more students were not found");
    }
    if (uniqGroups.length) {
        const found = await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, uniqGroups));
        if (found.length !== uniqGroups.length) throw new BadRequest("One or more groups were not found");
    }

    const { row } = await prepareItem(item, courseId, []);
    await db.transaction(async (tx) => {
        await tx.insert(sessions).values(row);
        if (item.lessonIds.length) await tx.insert(sessionLessons).values(item.lessonIds.map((lessonId) => ({ id: randomUUID(), sessionId: row.id, lessonId })));
        if (uniqStudents.length) await tx.insert(sessionUsers).values(uniqStudents.map((studentId) => ({ id: randomUUID(), sessionId: row.id, studentId })));
        if (uniqGroups.length) await tx.insert(sessionGroups).values(uniqGroups.map((groupId) => ({ id: randomUUID(), sessionId: row.id, groupId })));
    });
    return SuccessResponse(res, { message: "Session added. Dispatch it from the timetable to notify everyone.", sessionId: row.id }, 201);
};

/** Sessions that exist only as this plan's current proposal: nobody joined, nothing marked, no other plan. */
async function replaceableSessions(planId: string): Promise<string[]> {
    const list = await rows(sql`
        SELECT ps.session_id AS id FROM student_plan_sessions ps
        WHERE ps.plan_id = ${planId} AND ps.student_response <> 'accepted'
          AND NOT EXISTS (SELECT 1 FROM session_users su WHERE su.session_id = ps.session_id)
          AND NOT EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = ps.session_id)
          AND NOT EXISTS (SELECT 1 FROM session_attendance a WHERE a.session_id = ps.session_id)
          AND NOT EXISTS (SELECT 1 FROM student_plan_sessions o WHERE o.session_id = ps.session_id AND o.plan_id <> ps.plan_id)`);
    return list.map((r) => r.id as string);
}

// POST /admin/planner/plans/:planId/build — create sessions in the student's free times and propose them
export const buildPlan = async (req: Request, res: Response) => {
    const planId = String(req.params.planId);
    const { courseId, adminNotes, items } = req.body as { courseId: string; adminNotes?: string; items: Item[] };
    const [plan] = await db.select().from(studentAvailabilityPlans).where(eq(studentAvailabilityPlans.id, planId));
    if (!plan) throw new NotFound("Study plan not found");
    if (plan.status === "cancelled" || plan.status === "accepted") throw new BadRequest(`This plan is ${plan.status} — it can't get a new proposal`);
    const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!course) throw new BadRequest("Course not found");

    // Sessions only proposed by an earlier version of this plan are replaced, so they don't count as clashes.
    const earlier = await replaceableSessions(planId);
    const prepared: { row: any; item: Item }[] = [];
    for (const item of items) {
        const p = await prepareItem(item, courseId, prepared.map((x) => x.item), earlier);
        prepared.push({ row: p.row, item });
    }

    await db.transaction(async (tx) => {
        await tx.delete(studentPlanSessions).where(eq(studentPlanSessions.planId, planId));
        if (earlier.length) await tx.delete(sessions).where(inArray(sessions.id, earlier));
        await tx.insert(sessions).values(prepared.map((p) => p.row));
        const lessonRows = prepared.flatMap((p) => p.item.lessonIds.map((lessonId) => ({ id: randomUUID(), sessionId: p.row.id, lessonId })));
        if (lessonRows.length) await tx.insert(sessionLessons).values(lessonRows);
        // The student joins each session when they accept it (existing study-plan flow).
        await tx.insert(studentPlanSessions).values(prepared.map((p, i) => ({ id: randomUUID(), planId, sessionId: p.row.id, orderIndex: i + 1 })));
        await tx.update(studentAvailabilityPlans).set({
            status: "plan_proposed",
            adminNotes: adminNotes !== undefined ? adminNotes : plan.adminNotes,
            proposedBy: (req as any).user?.id || null,
            proposedAt: new Date(),
        }).where(eq(studentAvailabilityPlans.id, planId));
    });

    await sendStudentNotification(plan.studentId,
        `Your study plan "${plan.title}" is ready: ${prepared.length} session${prepared.length === 1 ? "" : "s"} in your free times. Please review and accept them.`);
    return SuccessResponse(res, { message: "Plan sent to the student", planId, sessionIds: prepared.map((p) => p.row.id), removedEarlier: earlier.length }, 201);
};

// POST /admin/planner/sessions/:id/approve — accept a proposed plan session on the student's behalf
export const approvePlanSession = async (req: Request, res: Response) => {
    const sessionId = String(req.params.id);
    const links = await rows(sql`
        SELECT ps.id, ps.plan_id AS planId, p.student_id AS studentId, p.title
        FROM student_plan_sessions ps JOIN student_availability_plans p ON p.id = ps.plan_id
        WHERE ps.session_id = ${sessionId} AND ps.student_response <> 'accepted' AND p.status <> 'cancelled'`);
    if (!links.length) throw new BadRequest("This session is not waiting for a student's answer");
    const [session] = await db.select({ name: sessions.name, date: sessions.sessionDate, timeFrom: sessions.timeFrom }).from(sessions).where(eq(sessions.id, sessionId));

    await db.transaction(async (tx) => {
        for (const l of links) {
            await tx.update(studentPlanSessions).set({ studentResponse: "accepted" }).where(eq(studentPlanSessions.id, l.id));
            const [already] = await tx.select({ id: sessionUsers.id }).from(sessionUsers)
                .where(and(eq(sessionUsers.sessionId, sessionId), eq(sessionUsers.studentId, l.studentId)));
            if (!already) await tx.insert(sessionUsers).values({ id: randomUUID(), sessionId, studentId: l.studentId });
        }
    });
    // A plan whose sessions are all answered and at least one accepted counts as accepted.
    for (const planId of new Set(links.map((l) => l.planId as string))) {
        const [left] = await rows(sql`SELECT SUM(student_response = 'pending') AS pending, SUM(student_response = 'accepted') AS accepted
            FROM student_plan_sessions WHERE plan_id = ${planId}`);
        if (Number(left?.pending) === 0 && Number(left?.accepted) > 0) {
            await db.update(studentAvailabilityPlans).set({ status: "accepted", respondedAt: new Date() }).where(eq(studentAvailabilityPlans.id, planId));
        }
    }
    for (const l of links) {
        await sendStudentNotification(l.studentId, `The admin confirmed "${session?.name}" on ${pretty(String(session?.date).slice(0, 10), String(session?.timeFrom))} for your plan "${l.title}".`);
    }
    return SuccessResponse(res, { message: "Session approved — the student was added and told" });
};

// POST /admin/planner/dispatch { sessionIds } — confirm approved sessions and notify students + teachers
export const dispatchSessions = async (req: Request, res: Response) => {
    const ids: string[] = [...new Set(req.body.sessionIds as string[])];
    const list = await rows(sql`
        SELECT s.id, s.name, s.session_date AS date, s.time_from AS timeFrom, s.teacher_id AS teacherId
        FROM sessions s
        WHERE s.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
          AND s.status = 'scheduled' AND s.confirmed_at IS NULL AND s.session_date >= CURDATE()
          AND NOT EXISTS (SELECT 1 FROM student_plan_sessions ps JOIN student_availability_plans p ON p.id = ps.plan_id
                          WHERE ps.session_id = s.id AND ps.student_response <> 'accepted' AND p.status <> 'cancelled')`);
    if (!list.length) throw new BadRequest("None of these sessions can be dispatched (already sent, cancelled, past, or still waiting for a student)");
    const sentIds = list.map((s) => s.id);
    const inIds = sql.join(sentIds.map((id) => sql`${id}`), sql`, `);
    const people = await rows(sql`
        SELECT su.session_id AS sessionId, su.student_id AS studentId FROM session_users su WHERE su.session_id IN (${inIds})
        UNION
        SELECT sg.session_id, gs.student_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id WHERE sg.session_id IN (${inIds})`);

    await db.update(sessions).set({ confirmedAt: new Date(), confirmedBy: (req as any).user?.id || null }).where(inArray(sessions.id, sentIds));

    // One message per person, listing their sessions.
    const byId = new Map(list.map((s) => [s.id, s]));
    const line = (s: Row) => `${s.name} — ${pretty(String(s.date).slice(0, 10), String(s.timeFrom))}`;
    const perStudent = new Map<string, Row[]>();
    people.forEach((p) => perStudent.set(p.studentId, [...(perStudent.get(p.studentId) || []), byId.get(p.sessionId)!]));
    const perTeacher = new Map<string, Row[]>();
    list.forEach((s) => perTeacher.set(s.teacherId, [...(perTeacher.get(s.teacherId) || []), s]));
    const text = (arr: Row[]) => arr.length === 1 ? `Session confirmed: ${line(arr[0])}.` : `${arr.length} sessions confirmed: ${arr.map(line).join("; ")}.`;

    for (const [studentId, arr] of perStudent) await sendStudentNotification(studentId, text(arr));
    for (const [teacherId, arr] of perTeacher) {
        try { await notifyTeacher(teacherId, text(arr)); } catch (e) { console.error("Failed to notify teacher", e); }
    }
    return SuccessResponse(res, {
        message: `${sentIds.length} session${sentIds.length === 1 ? "" : "s"} dispatched`,
        dispatched: sentIds.length, skipped: ids.length - sentIds.length,
        studentsNotified: perStudent.size, teachersNotified: perTeacher.size,
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// Pick lists for the planner forms
// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/planner/options[?studentId] — courses (+ which the student is enrolled in) and groups
export const getPlannerOptions = async (req: Request, res: Response) => {
    const courseList = await rows(sql`
        SELECT co.id, co.name, cat.name AS category FROM courses co LEFT JOIN category cat ON cat.id = co.category_id ORDER BY co.name`);
    const groupList = await rows(sql`
        SELECT g.id, g.name, (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = g.id) AS size
        FROM \`groups\` g ORDER BY g.name`);
    const studentId = req.query.studentId ? String(req.query.studentId) : null;
    const mine = studentId ? await rows(sql`
        SELECT DISTINCT courseId FROM enrolledItems WHERE studentId = ${studentId} AND status = 'active' AND courseId IS NOT NULL`) : [];
    return SuccessResponse(res, {
        courses: courseList,
        groups: groupList.map((g) => ({ id: g.id, name: g.name, size: Number(g.size) })),
        studentCourseIds: mine.map((m) => m.courseId),
    });
};

// GET /admin/planner/courses/:courseId/lessons — chapters with their lessons, in course order
export const getCourseLessons = async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    const list = await rows(sql`
        SELECT ch.id AS chapterId, ch.name AS chapterName, l.id, l.name
        FROM chapters ch JOIN lessons l ON l.chapter_id = ch.id
        WHERE ch.course_id = ${courseId}
        ORDER BY COALESCE(ch.\`order\`, 9999), ch.created_at, COALESCE(l.\`order\`, 9999), l.created_at`);
    const chapters: { id: string; name: string; lessons: { id: string; name: string }[] }[] = [];
    list.forEach((r) => {
        let ch = chapters[chapters.length - 1];
        if (!ch || ch.id !== r.chapterId) { ch = { id: r.chapterId, name: r.chapterName, lessons: [] }; chapters.push(ch); }
        ch.lessons.push({ id: r.id, name: r.name });
    });
    return SuccessResponse(res, { chapters });
};
