// controllers/admin/teacherRequests.ts
// Admin side of the teacher portal: answer cover / cancellation requests,
// read a teacher's weekly availability, cancel or restore sessions.
import { Request, Response } from "express";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "../../models/connection";
import { sessions, teachers, teacherRequests } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { loadAvailability, notifyTeacher } from "../teacher/portal";

const requester = alias(teachers, "requester");
const coverTeacher = alias(teachers, "cover_teacher");

const selectRequest = () => db
    .select({
        id: teacherRequests.id,
        type: teacherRequests.type,
        teacherId: teacherRequests.teacherId,
        teacherName: requester.name,
        sessionId: teacherRequests.sessionId,
        sessionName: sessions.name,
        sessionDate: sessions.sessionDate,
        sessionTimeFrom: sessions.timeFrom,
        sessionTimeTo: sessions.timeTo,
        requestDate: teacherRequests.requestDate,
        timeFrom: teacherRequests.timeFrom,
        timeTo: teacherRequests.timeTo,
        reason: teacherRequests.reason,
        status: teacherRequests.status,
        adminReply: teacherRequests.adminReply,
        coverTeacherId: teacherRequests.coverTeacherId,
        coverTeacherName: coverTeacher.name,
        respondedAt: teacherRequests.respondedAt,
        createdAt: teacherRequests.createdAt,
    })
    .from(teacherRequests)
    .innerJoin(requester, eq(teacherRequests.teacherId, requester.id))
    .leftJoin(sessions, eq(teacherRequests.sessionId, sessions.id))
    .leftJoin(coverTeacher, eq(teacherRequests.coverTeacherId, coverTeacher.id));

/** GET /admin/teacher-requests?status=pending|accepted|rejected&teacherId= */
export const listTeacherRequests = async (req: Request, res: Response) => {
    const { status, teacherId } = req.query as { status?: string; teacherId?: string };
    const conditions = [];
    if (status === "pending" || status === "accepted" || status === "rejected") conditions.push(eq(teacherRequests.status, status));
    if (teacherId) conditions.push(eq(teacherRequests.teacherId, teacherId));

    const rows = await selectRequest()
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(teacherRequests.createdAt));

    return SuccessResponse(res, { message: "Teacher requests fetched successfully", count: rows.length, requests: rows });
};

const fmtTime = (t?: string | null) => (t ? t.slice(0, 5) : "");

/**
 * PATCH /admin/teacher-requests/:id/respond
 * body: { status: "accepted" | "rejected", adminReply?, coverTeacherId? }
 *  - accepted cancellation → the session is cancelled (cancelledBy = teacher, reason = the request reason)
 *  - accepted cover with coverTeacherId → single-date sessions of the teacher on that date that overlap
 *    the requested slot are reassigned to the cover teacher
 * The requesting teacher gets a notification either way.
 */
export const respondToTeacherRequest = async (req: Request, res: Response) => {
    const { status, adminReply, coverTeacherId } = req.body as { status: "accepted" | "rejected"; adminReply?: string; coverTeacherId?: string | null };

    const [request] = await db.select().from(teacherRequests).where(eq(teacherRequests.id, req.params.id));
    if (!request) throw new NotFound("Request not found");
    if (request.status !== "pending") throw new BadRequest("This request was already answered");

    if (coverTeacherId) {
        if (request.type !== "cover") throw new BadRequest("A cover teacher only applies to cover requests");
        if (coverTeacherId === request.teacherId) throw new BadRequest("The cover teacher must be someone else");
        const [cover] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.id, coverTeacherId));
        if (!cover) throw new NotFound("Cover teacher not found");
    }

    let reassignedSessions = 0;
    await db.transaction(async (tx) => {
        await tx.update(teacherRequests).set({
            status,
            adminReply: adminReply || null,
            coverTeacherId: status === "accepted" ? coverTeacherId || null : null,
            respondedByAdminId: req.user?.id ?? null,
            respondedAt: new Date(),
        }).where(eq(teacherRequests.id, request.id));

        if (status !== "accepted") return;

        if (request.type === "cancellation" && request.sessionId) {
            await tx.update(sessions).set({
                status: "cancelled",
                cancelReason: request.reason,
                cancelledBy: "teacher",
                cancelledAt: new Date(),
            }).where(eq(sessions.id, request.sessionId));
        }

        if (request.type === "cover" && coverTeacherId && request.requestDate && request.timeFrom && request.timeTo) {
            const result: any = await tx.update(sessions)
                .set({ teacherId: coverTeacherId })
                .where(and(
                    eq(sessions.teacherId, request.teacherId),
                    eq(sessions.scheduleType, "once"),
                    eq(sessions.sessionDate, request.requestDate as any),
                    lt(sessions.timeFrom, request.timeTo),
                    gt(sessions.timeTo, request.timeFrom),
                ));
            reassignedSessions = Number(result?.[0]?.affectedRows ?? 0);
        }
    });

    const what = request.type === "cover"
        ? `cover request for ${request.requestDate ?? ""} ${fmtTime(request.timeFrom)}–${fmtTime(request.timeTo)}`
        : "session cancellation request";
    await notifyTeacher(
        request.teacherId,
        `Your ${what} was ${status}.${adminReply ? ` Admin: ${adminReply}` : ""}`,
    );

    const [updated] = await selectRequest().where(eq(teacherRequests.id, request.id));
    return SuccessResponse(res, { message: `Request ${status}`, reassignedSessions, request: updated });
};

/** GET /admin/teacher-requests/availability/:teacherId */
export const getTeacherAvailabilityForAdmin = async (req: Request, res: Response) => {
    const [teacher] = await db.select({ id: teachers.id, name: teachers.name }).from(teachers).where(eq(teachers.id, req.params.teacherId));
    if (!teacher) throw new NotFound("Teacher not found");
    return SuccessResponse(res, { message: "Availability fetched successfully", teacher, ...(await loadAvailability(teacher.id)) });
};

/** PATCH /admin/session/:id/cancel — body { reason } */
export const cancelSession = async (req: Request, res: Response) => {
    const [session] = await db.select({ id: sessions.id, status: sessions.status }).from(sessions).where(eq(sessions.id, req.params.id));
    if (!session) throw new NotFound("Session not found");
    if (session.status === "cancelled") throw new BadRequest("Session is already cancelled");

    await db.update(sessions).set({
        status: "cancelled", cancelReason: req.body.reason, cancelledBy: "admin", cancelledAt: new Date(),
    }).where(eq(sessions.id, session.id));
    return SuccessResponse(res, { message: "Session cancelled" });
};

/** PATCH /admin/session/:id/restore */
export const restoreSession = async (req: Request, res: Response) => {
    const [session] = await db.select({ id: sessions.id, status: sessions.status }).from(sessions).where(eq(sessions.id, req.params.id));
    if (!session) throw new NotFound("Session not found");
    if (session.status !== "cancelled") throw new BadRequest("Session is not cancelled");

    await db.update(sessions).set({ status: "scheduled", cancelReason: null, cancelledBy: null, cancelledAt: null })
        .where(eq(sessions.id, session.id));
    return SuccessResponse(res, { message: "Session restored" });
};

/** GET /admin/session/cancelled — every cancelled session, newest first (for the Cancellations log). */
export const listCancelledSessions = async (_req: Request, res: Response) => {
    const rows = await db
        .select({
            id: sessions.id,
            name: sessions.name,
            sessionDate: sessions.sessionDate,
            startDate: sessions.startDate,
            timeFrom: sessions.timeFrom,
            timeTo: sessions.timeTo,
            teacherName: teachers.name,
            cancelReason: sessions.cancelReason,
            cancelledBy: sessions.cancelledBy,
            cancelledAt: sessions.cancelledAt,
        })
        .from(sessions)
        .leftJoin(teachers, eq(sessions.teacherId, teachers.id))
        .where(eq(sessions.status, "cancelled"))
        .orderBy(desc(sessions.cancelledAt));
    return SuccessResponse(res, { message: "Cancelled sessions fetched successfully", count: rows.length, sessions: rows });
};

// GET /admin/teacher/overview — every teacher with shared availability, hours per week, sessions this week
// (Saturday–Friday), pending requests and the next session (Teachers list, MathPortal design).
export const getTeachersOverview = async (_req: Request, res: Response) => {
    const run = async (q: any) => { const r: any = await db.execute(q); return ((Array.isArray(r) ? r[0] : r?.rows) ?? []) as any[]; };
    const now = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 1) % 7)); // Saturday
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const today = ymd(now), from = ymd(weekStart), to = ymd(weekEnd);
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;

    const list = await run(sql`
        SELECT t.id, t.name, t.email, t.phone_number AS phone, t.avatar,
          (SELECT GROUP_CONCAT(DISTINCT co.name ORDER BY co.name SEPARATOR '||') FROM course_teachers ct JOIN courses co ON co.id = ct.course_id WHERE ct.teacher_id = t.id) AS courses,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'scheduled' AND s.session_date BETWEEN ${from} AND ${to}) AS weekSessions,
          (SELECT COUNT(*) FROM teacher_requests r WHERE r.teacher_id = t.id AND r.status = 'pending') AS pendingRequests
        FROM teachers t ORDER BY t.name`);
    const avail = await run(sql`SELECT teacher_id AS teacherId, day_of_week AS d, time_from AS f, time_to AS t FROM teacher_availability`);
    const next = await run(sql`
        SELECT s.teacher_id AS teacherId, s.name, s.session_date AS day, s.time_from AS timeFrom
        FROM sessions s
        WHERE s.status = 'scheduled' AND (s.session_date > ${today} OR (s.session_date = ${today} AND s.time_from >= ${nowTime}))
          AND NOT EXISTS (SELECT 1 FROM sessions s2 WHERE s2.teacher_id = s.teacher_id AND s2.status = 'scheduled'
               AND (s2.session_date > ${today} OR (s2.session_date = ${today} AND s2.time_from >= ${nowTime}))
               AND (s2.session_date < s.session_date OR (s2.session_date = s.session_date AND s2.time_from < s.time_from)))`);
    const mins = (x: string) => { const [h, m] = String(x).split(":").map(Number); return h * 60 + (m || 0); };
    const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    return SuccessResponse(res, {
        week: { from, to },
        teachers: list.map((t) => {
            const a = avail.filter((x) => x.teacherId === t.id);
            const n = next.find((x) => x.teacherId === t.id);
            return {
                id: t.id, name: t.name, email: t.email, phone: t.phone, avatar: t.avatar,
                courses: t.courses ? String(t.courses).split("||") : [],
                availableDays: a.length ? [...new Set(a.map((x) => DAY[Number(x.d)]))] : null, // null = never shared
                hoursPerWeek: Math.round(a.reduce((s, x) => s + Math.max(0, mins(x.t) - mins(x.f)), 0) / 6) / 10,
                weekSessions: Number(t.weekSessions), pendingRequests: Number(t.pendingRequests),
                next: n ? { name: n.name, day: n.day instanceof Date ? ymd(n.day) : String(n.day).slice(0, 10), timeFrom: String(n.timeFrom).slice(0, 5) } : null,
            };
        }),
    });
};
