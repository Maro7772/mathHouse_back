// controllers/teacher/portal.ts
// Teacher portal actions: meeting link, attendance, cover/cancellation requests,
// weekly availability and notifications.
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    sessions, sessionUsers, sessionGroups, sessionAttendance,
    groupStudents, teachers, teacherRequests, teacherAvailability,
    notifications, notificationTeachers,
} from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, ConflictError, NotFound, UnauthorizedError } from "../../Errors";
import { getLessonIdsBySession, markStudentPresent } from "../../utils/sessionAttendance";
import { alias } from "drizzle-orm/mysql-core";

const getTeacherId = (req: Request): string => {
    if (!req.user?.id) throw new UnauthorizedError("Not authenticated");
    return req.user.id;
};

const getOwnSession = async (teacherId: string, sessionId: string) => {
    const [session] = await db
        .select({
            id: sessions.id,
            name: sessions.name,
            status: sessions.status,
            sessionRelationalType: sessions.sessionRelationalType,
            contentAccessDays: sessions.contentAccessDays,
        })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.teacherId, teacherId)));
    if (!session) throw new NotFound("Session not found or not assigned to you");
    return session;
};

// ── Meeting link ─────────────────────────────────────────────────────────────

/** PATCH /teacher/sessions/:id/meeting-link — set or clear the link students use to join. */
export const updateMeetingLink = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const session = await getOwnSession(teacherId, req.params.id);
    if (session.status === "cancelled") throw new BadRequest("This session is cancelled");

    const link = (req.body.session_link as string) || null;
    await db.update(sessions).set({ session_link: link }).where(eq(sessions.id, session.id));

    return SuccessResponse(res, {
        message: link ? "Meeting link published to students" : "Meeting link removed",
        sessionLink: link,
    });
};

// ── Attendance ───────────────────────────────────────────────────────────────

/**
 * PUT /teacher/sessions/:id/attendance
 * body: { attendance: [{ studentId, status: "present" | "absent" }] }
 * "present" runs the same flow as admin manual attendance (balance deduction + lesson unlock).
 */
export const saveAttendance = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const session = await getOwnSession(teacherId, req.params.id);
    if (session.status === "cancelled") throw new BadRequest("This session is cancelled");

    const entries: { studentId: string; status: "present" | "absent" }[] = req.body.attendance;

    // Only students assigned to this session (directly or through a group) can be marked.
    const [directRows, groupRows] = await Promise.all([
        db.select({ studentId: sessionUsers.studentId }).from(sessionUsers).where(eq(sessionUsers.sessionId, session.id)),
        db.select({ studentId: groupStudents.studentId })
            .from(sessionGroups)
            .innerJoin(groupStudents, eq(sessionGroups.groupId, groupStudents.groupId))
            .where(eq(sessionGroups.sessionId, session.id)),
    ]);
    const assigned = new Set([...directRows, ...groupRows].map(r => r.studentId));
    const unknown = entries.filter(e => !assigned.has(e.studentId));
    if (unknown.length > 0) throw new BadRequest("Some students are not assigned to this session");

    const lessonIds = (await getLessonIdsBySession([session.id])).get(session.id) || [];
    const results: { studentId: string; status: string; balanceDeducted?: boolean }[] = [];

    await db.transaction(async (tx) => {
        for (const entry of entries) {
            if (entry.status === "present") {
                const { balanceDeducted } = await markStudentPresent(tx, entry.studentId, session, lessonIds);
                results.push({ studentId: entry.studentId, status: "present", balanceDeducted });
                continue;
            }
            // absent: record it (a deduction already made for this session is not refunded here)
            const [existing] = await tx
                .select({ id: sessionAttendance.id })
                .from(sessionAttendance)
                .where(and(eq(sessionAttendance.sessionId, session.id), eq(sessionAttendance.studentId, entry.studentId)))
                .limit(1);
            if (existing) {
                await tx.update(sessionAttendance).set({ status: "absent", attendedAt: null }).where(eq(sessionAttendance.id, existing.id));
            } else {
                await tx.insert(sessionAttendance).values({
                    id: randomUUID(), sessionId: session.id, studentId: entry.studentId, status: "absent",
                });
            }
            results.push({ studentId: entry.studentId, status: "absent" });
        }
    });

    return SuccessResponse(res, { message: "Attendance saved", results });
};

// ── Requests (cover / cancellation) ──────────────────────────────────────────

const coverTeacher = alias(teachers, "cover_teacher");

const requestSelect = {
    id: teacherRequests.id,
    type: teacherRequests.type,
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
};

/** GET /teacher/requests */
export const listMyRequests = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const rows = await db
        .select(requestSelect)
        .from(teacherRequests)
        .leftJoin(sessions, eq(teacherRequests.sessionId, sessions.id))
        .leftJoin(coverTeacher, eq(teacherRequests.coverTeacherId, coverTeacher.id))
        .where(eq(teacherRequests.teacherId, teacherId))
        .orderBy(desc(teacherRequests.createdAt));

    return SuccessResponse(res, {
        message: "Requests fetched successfully",
        count: rows.length,
        pending: rows.filter(r => r.status === "pending").length,
        requests: rows,
    });
};

/** POST /teacher/requests — body is either a cover request or a cancellation request. */
export const createRequest = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const body = req.body;
    const id = randomUUID();

    if (body.type === "cancellation") {
        const session = await getOwnSession(teacherId, body.sessionId);
        if (session.status === "cancelled") throw new BadRequest("This session is already cancelled");

        const [open] = await db
            .select({ id: teacherRequests.id })
            .from(teacherRequests)
            .where(and(
                eq(teacherRequests.sessionId, session.id),
                eq(teacherRequests.type, "cancellation"),
                eq(teacherRequests.status, "pending"),
            ))
            .limit(1);
        if (open) throw new ConflictError("A cancellation request for this session is already waiting for admin");

        await db.insert(teacherRequests).values({
            id, teacherId, type: "cancellation", sessionId: session.id, reason: body.reason,
        });
    } else {
        await db.insert(teacherRequests).values({
            id, teacherId, type: "cover",
            requestDate: body.requestDate,
            timeFrom: body.timeFrom,
            timeTo: body.timeTo,
            reason: body.reason,
        } as any);
    }

    const [created] = await db
        .select(requestSelect)
        .from(teacherRequests)
        .leftJoin(sessions, eq(teacherRequests.sessionId, sessions.id))
        .leftJoin(coverTeacher, eq(teacherRequests.coverTeacherId, coverTeacher.id))
        .where(eq(teacherRequests.id, id));

    return SuccessResponse(res, { message: "Request sent to admin", request: created }, 201);
};

/** DELETE /teacher/requests/:id — withdraw a request that admin hasn't answered yet. */
export const withdrawRequest = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const [row] = await db
        .select({ id: teacherRequests.id, status: teacherRequests.status })
        .from(teacherRequests)
        .where(and(eq(teacherRequests.id, req.params.id), eq(teacherRequests.teacherId, teacherId)));
    if (!row) throw new NotFound("Request not found");
    if (row.status !== "pending") throw new BadRequest("Only pending requests can be withdrawn");

    await db.delete(teacherRequests).where(eq(teacherRequests.id, row.id));
    return SuccessResponse(res, { message: "Request withdrawn" });
};

// ── Weekly availability ──────────────────────────────────────────────────────

export const formatAvailability = (rows: { dayOfWeek: number; timeFrom: string; timeTo: string; sharedAt: Date | null }[]) => ({
    sharedAt: rows.reduce<Date | null>((latest, r) => (r.sharedAt && (!latest || r.sharedAt > latest) ? r.sharedAt : latest), null),
    slots: rows
        .map(r => ({ dayOfWeek: r.dayOfWeek, timeFrom: r.timeFrom.slice(0, 5), timeTo: r.timeTo.slice(0, 5) }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.timeFrom.localeCompare(b.timeFrom)),
});

export const loadAvailability = async (teacherId: string) => {
    const rows = await db
        .select({
            dayOfWeek: teacherAvailability.dayOfWeek,
            timeFrom: teacherAvailability.timeFrom,
            timeTo: teacherAvailability.timeTo,
            sharedAt: teacherAvailability.sharedAt,
        })
        .from(teacherAvailability)
        .where(eq(teacherAvailability.teacherId, teacherId));
    return formatAvailability(rows);
};

/** GET /teacher/availability */
export const getMyAvailability = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    return SuccessResponse(res, { message: "Availability fetched successfully", ...(await loadAvailability(teacherId)) });
};

/** PUT /teacher/availability — replaces the whole week and shares it with admin. */
export const saveMyAvailability = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const slots: { dayOfWeek: number; timeFrom: string; timeTo: string }[] = req.body.slots;

    // reject overlapping ranges on the same day
    const byDay = new Map<number, { from: string; to: string }[]>();
    for (const s of slots) {
        const list = byDay.get(s.dayOfWeek) || [];
        if (list.some(x => s.timeFrom < x.to && x.from < s.timeTo)) {
            throw new BadRequest("Two time ranges overlap on the same day");
        }
        list.push({ from: s.timeFrom, to: s.timeTo });
        byDay.set(s.dayOfWeek, list);
    }

    const sharedAt = new Date();
    await db.transaction(async (tx) => {
        await tx.delete(teacherAvailability).where(eq(teacherAvailability.teacherId, teacherId));
        if (slots.length > 0) {
            await tx.insert(teacherAvailability).values(slots.map(s => ({
                id: randomUUID(), teacherId, dayOfWeek: s.dayOfWeek, timeFrom: s.timeFrom, timeTo: s.timeTo, sharedAt,
            })));
        }
    });

    return SuccessResponse(res, { message: "Availability saved and shared with admin", ...(await loadAvailability(teacherId)) });
};

// ── Notifications ────────────────────────────────────────────────────────────

/** GET /teacher/notifications — newest first, last 50. */
export const listMyNotifications = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const rows = await db
        .select({
            id: notificationTeachers.id,
            notificationId: notifications.id,
            text: notifications.notification,
            materialLink: notifications.materialLink,
            materialFile: notifications.materialFile,
            dateTime: notifications.dateTime,
            isRead: notificationTeachers.isRead,
            createdAt: notificationTeachers.createdAt,
        })
        .from(notificationTeachers)
        .innerJoin(notifications, eq(notificationTeachers.notificationId, notifications.id))
        .where(eq(notificationTeachers.teacherId, teacherId))
        .orderBy(desc(notifications.dateTime))
        .limit(50);

    return SuccessResponse(res, {
        message: "Notifications fetched successfully",
        unread: rows.filter(r => !r.isRead).length,
        notifications: rows,
    });
};

/** PATCH /teacher/notifications/read — body { ids?: string[] }; no ids → mark all read. */
export const markNotificationsRead = async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    const where = ids && ids.length > 0
        ? and(eq(notificationTeachers.teacherId, teacherId), inArray(notificationTeachers.id, ids))
        : eq(notificationTeachers.teacherId, teacherId);
    await db.update(notificationTeachers).set({ isRead: true }).where(where);
    return SuccessResponse(res, { message: "Notifications marked as read" });
};

/** Creates a notification addressed to one teacher (used when admin answers a request). */
export const notifyTeacher = async (teacherId: string, text: string) => {
    const notificationId = randomUUID();
    await db.insert(notifications).values({ id: notificationId, dateTime: new Date(), notification: text, sendToAll: false });
    await db.insert(notificationTeachers).values({ id: randomUUID(), notificationId, teacherId });
};
