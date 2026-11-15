// controllers/user/portal.ts
// Student portal: notifications and session cancel requests.
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    notifications, notificationStudents, sessions, sessionUsers, sessionGroups, groupStudents,
    studentCancelRequests, teachers,
} from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, ConflictError, NotFound, UnauthorizedError } from "../../Errors";

/** Students may ask to cancel until this long before the session starts. */
export const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

const getStudentId = (req: Request): string => {
    if (!req.user?.id) throw new UnauthorizedError("Not authenticated");
    return req.user.id;
};

/** Session start as a Date in Cairo time (sessions are scheduled in Egypt time, UTC+2/+3). */
export const sessionStart = (date: string | Date | null, time: string) => {
    const d = typeof date === "string" ? date.slice(0, 10) : date ? new Date(date).toISOString().slice(0, 10) : "";
    // Africa/Cairo offset for that day
    const probe = new Date(`${d}T12:00:00Z`);
    const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" })
        .formatToParts(probe).find(p => p.type === "timeZoneName")?.value || "GMT+2";
    const m = tz.match(/GMT([+-]\d+)/);
    const offset = m ? Number(m[1]) : 2;
    const sign = offset >= 0 ? "+" : "-";
    return new Date(`${d}T${time.slice(0, 8)}${sign}${String(Math.abs(offset)).padStart(2, "0")}:00`);
};

const isEnrolled = async (studentId: string, sessionId: string) => {
    const [direct] = await db.select({ id: sessionUsers.id }).from(sessionUsers)
        .where(and(eq(sessionUsers.sessionId, sessionId), eq(sessionUsers.studentId, studentId))).limit(1);
    if (direct) return true;
    const [viaGroup] = await db.select({ id: groupStudents.id }).from(sessionGroups)
        .innerJoin(groupStudents, eq(sessionGroups.groupId, groupStudents.groupId))
        .where(and(eq(sessionGroups.sessionId, sessionId), eq(groupStudents.studentId, studentId))).limit(1);
    return !!viaGroup;
};

// ── Notifications ────────────────────────────────────────────────────────────

/** GET /user/notifications — newest first, last 50. */
export const listMyNotifications = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const rows = await db
        .select({
            id: notificationStudents.id,
            text: notifications.notification,
            materialLink: notifications.materialLink,
            materialFile: notifications.materialFile,
            dateTime: notifications.dateTime,
            isRead: notificationStudents.isRead,
        })
        .from(notificationStudents)
        .innerJoin(notifications, eq(notificationStudents.notificationId, notifications.id))
        .where(eq(notificationStudents.studentId, studentId))
        .orderBy(desc(notifications.dateTime))
        .limit(50);

    return SuccessResponse(res, {
        message: "Notifications fetched successfully",
        unread: rows.filter(r => !r.isRead).length,
        notifications: rows,
    });
};

/** PATCH /user/notifications/read — body { ids? }; no ids → mark all read. */
export const markMyNotificationsRead = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    const where = ids && ids.length > 0
        ? and(eq(notificationStudents.studentId, studentId), inArray(notificationStudents.id, ids))
        : eq(notificationStudents.studentId, studentId);
    await db.update(notificationStudents).set({ isRead: true }).where(where);
    return SuccessResponse(res, { message: "Notifications marked as read" });
};

// ── Session cancel requests ──────────────────────────────────────────────────

const requestSelect = {
    id: studentCancelRequests.id,
    sessionId: studentCancelRequests.sessionId,
    sessionName: sessions.name,
    sessionDate: sessions.sessionDate,
    timeFrom: sessions.timeFrom,
    timeTo: sessions.timeTo,
    teacherName: teachers.name,
    reason: studentCancelRequests.reason,
    status: studentCancelRequests.status,
    adminReply: studentCancelRequests.adminReply,
    respondedAt: studentCancelRequests.respondedAt,
    createdAt: studentCancelRequests.createdAt,
};

/** GET /user/sessions/cancel-requests */
export const listMyCancelRequests = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const rows = await db.select(requestSelect)
        .from(studentCancelRequests)
        .innerJoin(sessions, eq(studentCancelRequests.sessionId, sessions.id))
        .leftJoin(teachers, eq(sessions.teacherId, teachers.id))
        .where(eq(studentCancelRequests.studentId, studentId))
        .orderBy(desc(studentCancelRequests.createdAt));
    return SuccessResponse(res, { message: "Cancel requests fetched successfully", requests: rows });
};

/** POST /user/sessions/:sessionId/cancel-request — body { reason }; closes 24 h before the start. */
export const requestSessionCancel = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { sessionId } = req.params;
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 5) throw new BadRequest("Write a short reason (at least 5 characters)");

    const [session] = await db.select({
        id: sessions.id, sessionDate: sessions.sessionDate, startDate: sessions.startDate,
        timeFrom: sessions.timeFrom, status: sessions.status,
    }).from(sessions).where(eq(sessions.id, sessionId));
    if (!session) throw new NotFound("Session not found");
    if (session.status === "cancelled") throw new BadRequest("This session is already cancelled");
    if (!(await isEnrolled(studentId, sessionId))) throw new NotFound("You are not enrolled in this session");

    const start = sessionStart((session.sessionDate || session.startDate) as any, session.timeFrom);
    if (start.getTime() - Date.now() < CANCEL_WINDOW_MS) {
        throw new BadRequest("Cancel requests close 24 hours before the session starts");
    }

    const [open] = await db.select({ id: studentCancelRequests.id }).from(studentCancelRequests)
        .where(and(
            eq(studentCancelRequests.studentId, studentId),
            eq(studentCancelRequests.sessionId, sessionId),
            or(eq(studentCancelRequests.status, "pending"), eq(studentCancelRequests.status, "accepted")),
        )).limit(1);
    if (open) throw new ConflictError("You already asked to cancel this session");

    const id = randomUUID();
    await db.insert(studentCancelRequests).values({ id, studentId, sessionId, reason });
    const [created] = await db.select(requestSelect)
        .from(studentCancelRequests)
        .innerJoin(sessions, eq(studentCancelRequests.sessionId, sessions.id))
        .leftJoin(teachers, eq(sessions.teacherId, teachers.id))
        .where(eq(studentCancelRequests.id, id));
    return SuccessResponse(res, { message: "Request sent — the admin will reply", request: created }, 201);
};

/** DELETE /user/sessions/cancel-requests/:id — withdraw a pending request. */
export const withdrawCancelRequest = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const [row] = await db.select({ id: studentCancelRequests.id, status: studentCancelRequests.status })
        .from(studentCancelRequests)
        .where(and(eq(studentCancelRequests.id, req.params.id), eq(studentCancelRequests.studentId, studentId)));
    if (!row) throw new NotFound("Request not found");
    if (row.status !== "pending") throw new BadRequest("Only pending requests can be withdrawn");
    await db.delete(studentCancelRequests).where(eq(studentCancelRequests.id, row.id));
    return SuccessResponse(res, { message: "Request withdrawn" });
};
