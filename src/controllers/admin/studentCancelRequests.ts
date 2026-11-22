// controllers/admin/studentCancelRequests.ts
import { sessionHasNobody } from "../../utils/sessionVisibility";
import { notifyTeacher } from "../teacher/portal";
// Admin answers a student's request to cancel their seat in a session.
import { Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../models/connection";
import { sessions, sessionUsers, sessionPackageDeductions, Student, studentCancelRequests, teachers } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { sendStudentNotification } from "../../utils/studentNotification";

const selectRequests = () => db
    .select({
        id: studentCancelRequests.id,
        studentId: studentCancelRequests.studentId,
        studentName: sql<string>`CONCAT(${Student.firstname}, ' ', ${Student.lastname})`,
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
    })
    .from(studentCancelRequests)
    .innerJoin(Student, eq(studentCancelRequests.studentId, Student.id))
    .innerJoin(sessions, eq(studentCancelRequests.sessionId, sessions.id))
    .leftJoin(teachers, eq(sessions.teacherId, teachers.id));

/** GET /admin/student-cancel-requests?status= */
export const listStudentCancelRequests = async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const rows = await selectRequests()
        .where(status === "pending" || status === "accepted" || status === "rejected" ? eq(studentCancelRequests.status, status) : undefined)
        .orderBy(desc(studentCancelRequests.createdAt));
    return SuccessResponse(res, { message: "Student cancel requests fetched successfully", count: rows.length, requests: rows });
};

/**
 * PATCH /admin/student-cancel-requests/:id/respond — body { status: "accepted" | "rejected", adminReply? }
 * Accepted: the student's direct seat is removed and a live session already charged for it is refunded.
 * A student in the session through a group keeps the group, but this session is gone for them
 * (their lists, the teacher's student list and attendance skip it). If nobody is left in the session,
 * it is cancelled so it leaves the teacher's dashboard too. The teacher is told either way.
 * Rejected: nothing changes — the session stays on both dashboards.
 */
export const respondToStudentCancelRequest = async (req: Request, res: Response) => {
    const { status, adminReply } = req.body as { status: "accepted" | "rejected"; adminReply?: string };
    if (status !== "accepted" && status !== "rejected") throw new BadRequest("status must be accepted or rejected");

    const [request] = await db.select().from(studentCancelRequests).where(eq(studentCancelRequests.id, req.params.id));
    if (!request) throw new NotFound("Request not found");
    if (request.status !== "pending") throw new BadRequest("This request was already answered");

    let refunded = false;
    let sessionCancelled = false;
    await db.transaction(async (tx) => {
        await tx.update(studentCancelRequests).set({
            status, adminReply: adminReply || null, respondedByAdminId: req.user?.id ?? null, respondedAt: new Date(),
        }).where(eq(studentCancelRequests.id, request.id));

        if (status !== "accepted") return;

        await tx.delete(sessionUsers).where(and(eq(sessionUsers.sessionId, request.sessionId), eq(sessionUsers.studentId, request.studentId)));

        const [deduction] = await tx.select({ id: sessionPackageDeductions.id, chargeStatus: sessionPackageDeductions.chargeStatus })
            .from(sessionPackageDeductions)
            .where(and(eq(sessionPackageDeductions.sessionId, request.sessionId), eq(sessionPackageDeductions.studentId, request.studentId)));
        if (deduction) {
            await tx.delete(sessionPackageDeductions).where(eq(sessionPackageDeductions.id, deduction.id));
            // only give back a session that was really taken (not a free Re-Explanation or an unpaid attendance)
            if (deduction.chargeStatus === "paid") {
                await tx.update(Student).set({ livebalance: sql`${Student.livebalance} + 1` }).where(eq(Student.id, request.studentId));
                refunded = true;
            }
        }

        // nobody left (no student, no group) → the session itself is cancelled
        const [left] = await tx.select({ id: sessions.id }).from(sessions)
            .where(and(eq(sessions.id, request.sessionId), eq(sessions.status, "scheduled"), sessionHasNobody(sessions.id)));
        if (left) {
            await tx.update(sessions).set({ status: "cancelled", cancelReason: "Cancelled — the student's cancel request was approved" })
                .where(eq(sessions.id, request.sessionId));
            sessionCancelled = true;
        }
    });

    const [session] = await db.select({ name: sessions.name, teacherId: sessions.teacherId, date: sessions.sessionDate, timeFrom: sessions.timeFrom })
        .from(sessions).where(eq(sessions.id, request.sessionId));
    await sendStudentNotification(
        request.studentId,
        `Your request to cancel "${session?.name ?? "the session"}" was ${status}.${adminReply ? ` Admin: ${adminReply}` : ""}`,
    );
    if (status === "accepted" && session?.teacherId) {
        const [st] = await db.select({ first: Student.firstname, last: Student.lastname }).from(Student).where(eq(Student.id, request.studentId));
        const when = `${String(session.date ?? "").slice(0, 10)} ${String(session.timeFrom ?? "").slice(0, 5)}`.trim();
        try {
            await notifyTeacher(session.teacherId, sessionCancelled
                ? `"${session.name}" (${when}) was cancelled — the student cancelled and nobody else is booked.`
                : `${[st?.first, st?.last].filter(Boolean).join(" ") || "A student"} will not attend "${session.name}" (${when}) — their cancel request was approved.`);
        } catch (e) { console.error("Failed to notify teacher", e); }
    }

    const [updated] = await selectRequests().where(eq(studentCancelRequests.id, request.id));
    return SuccessResponse(res, { message: `Request ${status}`, refunded, sessionCancelled, request: updated });
};
