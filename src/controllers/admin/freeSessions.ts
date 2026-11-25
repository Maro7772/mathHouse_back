// Admin gives a student free live sessions, with a reason (compensation, trial, discount…).
// The sessions are added to student.live_balance and logged in student_free_sessions; the reports
// count sessions used from this balance as free — given by admin (reason).
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../models/connection";
import { Student, studentFreeSessions, admins } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";

const MAX_AT_ONCE = 50;

/** GET /admin/student/:id/free-sessions — every grant, newest first, and the total given. */
export const listFreeSessions = async (req: Request, res: Response) => {
    const studentId = String(req.params.id);
    const grants = await db
        .select({
            id: studentFreeSessions.id,
            sessions: studentFreeSessions.sessions,
            reason: studentFreeSessions.reason,
            createdAt: studentFreeSessions.createdAt,
            givenBy: admins.name,
        })
        .from(studentFreeSessions)
        .leftJoin(admins, eq(admins.id, studentFreeSessions.givenBy))
        .where(eq(studentFreeSessions.studentId, studentId))
        .orderBy(desc(studentFreeSessions.createdAt));
    return SuccessResponse(res, { grants, total: grants.reduce((n, g) => n + Number(g.sessions || 0), 0) });
};

/** POST /admin/student/:id/free-sessions { sessions, reason } */
export const giveFreeSessions = async (req: Request, res: Response) => {
    const studentId = String(req.params.id);
    const n = Number(req.body?.sessions);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!Number.isInteger(n) || n < 1 || n > MAX_AT_ONCE) throw new BadRequest(`Sessions must be a whole number from 1 to ${MAX_AT_ONCE}`);
    if (reason.length < 3) throw new BadRequest("Write the reason (e.g. compensation, trial, sibling discount)");
    if (reason.length > 255) throw new BadRequest("The reason is too long (255 characters max)");

    const [st] = await db.select({ id: Student.id }).from(Student).where(eq(Student.id, studentId));
    if (!st) throw new NotFound("Student not found");

    const adminId = (req as any).user?.id ?? null;
    await db.transaction(async (tx) => {
        await tx.insert(studentFreeSessions).values({ id: randomUUID(), studentId, sessions: n, reason, givenBy: adminId });
        await tx.update(Student).set({ livebalance: sql`${Student.livebalance} + ${n}` }).where(eq(Student.id, studentId));
    });
    const [after] = await db.select({ live: Student.livebalance }).from(Student).where(eq(Student.id, studentId));
    return SuccessResponse(res, { message: `${n} free session${n === 1 ? "" : "s"} added`, liveBalance: after?.live ?? null });
};
