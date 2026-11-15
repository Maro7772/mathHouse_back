// controllers/admin/studentCancelRequests.ts
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
 * (A student who is in the session through a group keeps the group, but is not charged for this session.)
 */
export const respondToStudentCancelRequest = async (req: Request, res: Response) => {
    const { status, adminReply } = req.body as { status: "accepted" | "rejected"; adminReply?: string };
    if (status !== "accepted" && status !== "rejected") throw new BadRequest("status must be accepted or rejected");

    const [request] = await db.select().from(studentCancelRequests).where(eq(studentCancelRequests.id, req.params.id));
    if (!request) throw new NotFound("Request not found");
    if (request.status !== "pending") throw new BadRequest("This request was already answered");

    let refunded = false;
    await db.transaction(async (tx) => {
        await tx.update(studentCancelRequests).set({
            status, adminReply: adminReply || null, respondedByAdminId: req.user?.id ?? null, respondedAt: new Date(),
        }).where(eq(studentCancelRequests.id, request.id));

        if (status !== "accepted") return;

        await tx.delete(sessionUsers).where(and(eq(sessionUsers.sessionId, request.sessionId), eq(sessionUsers.studentId, request.studentId)));

        const [deduction] = await tx.select({ id: sessionPackageDeductions.id }).from(sessionPackageDeductions)
            .where(and(eq(sessionPackageDeductions.sessionId, request.sessionId), eq(sessionPackageDeductions.studentId, request.studentId)));
        if (deduction) {
            await tx.delete(sessionPackageDeductions).where(eq(sessionPackageDeductions.id, deduction.id));
            await tx.update(Student).set({ livebalance: sql`${Student.livebalance} + 1` }).where(eq(Student.id, request.studentId));
            refunded = true;
        }
    });

    const [session] = await db.select({ name: sessions.name }).from(sessions).where(eq(sessions.id, request.sessionId));
    await sendStudentNotification(
        request.studentId,
        `Your request to cancel "${session?.name ?? "the session"}" was ${status}.${adminReply ? ` Admin: ${adminReply}` : ""}`,
    );

    const [updated] = await selectRequests().where(eq(studentCancelRequests.id, request.id));
    return SuccessResponse(res, { message: `Request ${status}`, refunded, request: updated });
};
