// utils/sessionAttendance.ts
// Shared attendance logic, used by the student Join button, the teacher portal and admin manual attendance,
// so all three charge and unlock content the same way.
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../models/connection";
import { sessionAttendance, sessionLessons, sessionPackageDeductions, sessionUsers, sessions } from "../models/schema/admin/Session";
import { cairoNow } from "./cairoTime";
import { Student } from "../models/schema/admin/Student";
import { enrolledItems } from "../models/schema/user/enrolledItems";
import { BadRequest } from "../Errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttendanceSession = {
    id: string;
    sessionRelationalType: string | null;
    contentAccessDays: number | null;
};

/** What happened to the student's balance for one session. */
export type ChargeStatus = "paid" | "free" | "unpaid";

/** Lesson ids attached to each session, grouped by session id. */
export async function getLessonIdsBySession(sessionIds: string[], runner: Tx | typeof db = db) {
    const map = new Map<string, string[]>();
    if (sessionIds.length === 0) return map;
    const rows = await runner
        .select({ sessionId: sessionLessons.sessionId, lessonId: sessionLessons.lessonId })
        .from(sessionLessons)
        .where(inArray(sessionLessons.sessionId, sessionIds));
    for (const row of rows) {
        if (!map.has(row.sessionId)) map.set(row.sessionId, []);
        map.get(row.sessionId)!.push(row.lessonId);
    }
    return map;
}

/** Re-Explanation is free when the student already attended every one of its lessons in other sessions. */
export async function isFreeReExplanation(
    runner: Tx | typeof db,
    studentId: string,
    session: { id: string; sessionRelationalType: string | null },
    sessionLessonIds: string[],
) {
    if (session.sessionRelationalType !== "Re-Explanation" || sessionLessonIds.length === 0) return false;
    const rows = await runner
        .select({ lessonId: sessionLessons.lessonId })
        .from(sessionAttendance)
        .innerJoin(sessionLessons, eq(sessionAttendance.sessionId, sessionLessons.sessionId))
        .where(and(
            eq(sessionAttendance.studentId, studentId),
            eq(sessionAttendance.status, "present"),
            sql`${sessionAttendance.sessionId} != ${session.id}`,
            inArray(sessionLessons.lessonId, sessionLessonIds)
        ));
    const attended = new Set(rows.map(r => r.lessonId));
    return sessionLessonIds.every(id => attended.has(id));
}

/**
 * Charges a student for one session, at most once (a session_package_deductions row is the proof).
 *  - already charged (by the 24h job, Join, teacher or admin) → nothing happens
 *  - free Re-Explanation → recorded as "free"
 *  - balance > 0 → 1 is taken, recorded as "paid"
 *  - balance 0 → `allowUnpaid` (teacher/admin) records "unpaid"; otherwise (student Join) it is refused
 */
export async function chargeForSession(
    tx: Tx,
    studentId: string,
    session: AttendanceSession,
    sessionLessonIds: string[],
    { allowUnpaid }: { allowUnpaid: boolean },
): Promise<{ status: ChargeStatus; newCharge: boolean }> {
    const [existing] = await tx
        .select({ chargeStatus: sessionPackageDeductions.chargeStatus })
        .from(sessionPackageDeductions)
        .where(and(eq(sessionPackageDeductions.sessionId, session.id), eq(sessionPackageDeductions.studentId, studentId)))
        .limit(1);
    if (existing) return { status: existing.chargeStatus as ChargeStatus, newCharge: false };

    let status: ChargeStatus;
    if (await isFreeReExplanation(tx, studentId, session, sessionLessonIds)) {
        status = "free";
    } else {
        // atomic: never goes below 0, and no race between checking and taking
        const [result] = await tx
            .update(Student)
            .set({ livebalance: sql`${Student.livebalance} - 1` })
            .where(and(eq(Student.id, studentId), sql`${Student.livebalance} > 0`));
        if (((result as any)?.affectedRows ?? 0) > 0) status = "paid";
        else if (allowUnpaid) status = "unpaid";
        else throw new BadRequest("Insufficient live balance");
    }

    await tx.insert(sessionPackageDeductions).values({
        id: randomUUID(),
        sessionId: session.id,
        studentId,
        deductedAt: new Date(),
        chargeStatus: status,
    });
    return { status, newCharge: true };
}

/**
 * Marks one student present in one session, inside a transaction:
 *  1. makes sure the student is enrolled in session_users
 *  2. charges the session once (see chargeForSession)
 *  3. upserts session_attendance = "present"
 *  4. unlocks the session's lessons in enrolled_items (expiring after contentAccessDays, if set)
 */
export async function markStudentPresent(
    tx: Tx,
    studentId: string,
    session: AttendanceSession,
    sessionLessonIds: string[],
    { allowUnpaid = true }: { allowUnpaid?: boolean } = {},
): Promise<{ balanceDeducted: boolean; chargeStatus: ChargeStatus; lessonsUnlocked: number }> {
    // 1. Enrollment
    const [existingSessionUser] = await tx
        .select({ id: sessionUsers.id })
        .from(sessionUsers)
        .where(and(eq(sessionUsers.sessionId, session.id), eq(sessionUsers.studentId, studentId)))
        .limit(1);
    if (!existingSessionUser) {
        await tx.insert(sessionUsers).values({ id: randomUUID(), sessionId: session.id, studentId });
    }

    // 2. Charge (before attendance, so the Re-Explanation check doesn't see this session as attended)
    const charge = await chargeForSession(tx, studentId, session, sessionLessonIds, { allowUnpaid });

    // 3. Attendance
    const [existingAttendance] = await tx
        .select({ id: sessionAttendance.id })
        .from(sessionAttendance)
        .where(and(eq(sessionAttendance.sessionId, session.id), eq(sessionAttendance.studentId, studentId)))
        .limit(1);
    const attendedAt = new Date();
    if (existingAttendance) {
        await tx.update(sessionAttendance)
            .set({ status: "present", attendedAt })
            .where(eq(sessionAttendance.id, existingAttendance.id));
    } else {
        await tx.insert(sessionAttendance).values({
            id: randomUUID(),
            sessionId: session.id,
            studentId,
            status: "present",
            attendedAt,
        });
    }

    // 4. Unlock lessons
    let lessonsUnlocked = 0;
    if (sessionLessonIds.length > 0) {
        const alreadyEnrolled = await tx
            .select({ id: enrolledItems.id, lessonId: enrolledItems.lessonId, expiresAt: enrolledItems.expiresAt })
            .from(enrolledItems)
            .where(and(
                eq(enrolledItems.studentId, studentId),
                eq(enrolledItems.status, "active"),
                inArray(enrolledItems.lessonId, sessionLessonIds)
            ));
        const expiresAt = session.contentAccessDays
            ? new Date(Date.now() + session.contentAccessDays * 24 * 60 * 60 * 1000)
            : null;
        // attending again renews access that already ran out (it used to stay expired)
        const now = Date.now();
        const stale = alreadyEnrolled.filter(r => r.expiresAt && new Date(r.expiresAt).getTime() <= now);
        for (const r of stale) {
            await tx.update(enrolledItems).set({ expiresAt }).where(eq(enrolledItems.id, r.id));
        }
        const enrolledLessonIdSet = new Set(alreadyEnrolled.map(r => r.lessonId).filter(Boolean));
        const newEnrollments = sessionLessonIds
            .filter(id => !enrolledLessonIdSet.has(id))
            .map(lessonId => ({ id: randomUUID(), studentId, lessonId, status: "active" as const, expiresAt }));
        if (newEnrollments.length > 0) {
            await tx.insert(enrolledItems).values(newEnrollments);
            lessonsUnlocked = newEnrollments.length;
        }
    }

    return {
        balanceDeducted: charge.newCharge && charge.status === "paid",
        chargeStatus: charge.status,
        lessonsUnlocked,
    };
}

/** "studentId" → charge status, for the given sessions (only students that have a charge record). */
export async function getChargeStatuses(sessionIds: string[]) {
    const map = new Map<string, ChargeStatus>();
    if (sessionIds.length === 0) return map;
    const rows = await db
        .select({
            sessionId: sessionPackageDeductions.sessionId,
            studentId: sessionPackageDeductions.studentId,
            chargeStatus: sessionPackageDeductions.chargeStatus,
        })
        .from(sessionPackageDeductions)
        .where(inArray(sessionPackageDeductions.sessionId, sessionIds));
    for (const r of rows) map.set(`${r.sessionId}:${r.studentId}`, r.chargeStatus as ChargeStatus);
    return map;
}

/**
 * Gives back the live sessions taken for sessions that will not happen (cancelled or deleted).
 * Only sessions that have NOT ended yet (Cairo time) are touched — a past class keeps its charges,
 * so deleting an old series or cancelling a held session never refunds no-shows.
 * For each charge of those sessions whose student was NOT marked present: the charge row is removed and,
 * only if this call really removed it and a session was really taken ("paid"), 1 goes back to the balance
 * (two cancels at once can't refund twice). Returns how many sessions were given back.
 */
export async function refundSessionCharges(tx: Tx, sessionIds: string[]): Promise<number> {
    if (!sessionIds.length) return 0;
    const { stamp } = cairoNow();
    const notEnded = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
            inArray(sessions.id, sessionIds),
            sql`CONCAT(DATE_FORMAT(COALESCE(${sessions.sessionDate}, ${sessions.startDate}), '%Y-%m-%d'), ' ', TIME_FORMAT(${sessions.timeTo}, '%H:%i:%s')) > ${stamp}`,
        ));
    const ids = notEnded.map((s) => s.id);
    if (!ids.length) return 0;
    const charges = await tx
        .select({ id: sessionPackageDeductions.id, sessionId: sessionPackageDeductions.sessionId, studentId: sessionPackageDeductions.studentId, chargeStatus: sessionPackageDeductions.chargeStatus })
        .from(sessionPackageDeductions)
        .where(inArray(sessionPackageDeductions.sessionId, ids));
    if (!charges.length) return 0;
    const present = await tx
        .select({ sessionId: sessionAttendance.sessionId, studentId: sessionAttendance.studentId })
        .from(sessionAttendance)
        .where(and(inArray(sessionAttendance.sessionId, ids), eq(sessionAttendance.status, "present")));
    const came = new Set(present.map((p) => `${p.sessionId}|${p.studentId}`));
    let refunded = 0;
    for (const c of charges) {
        if (came.has(`${c.sessionId}|${c.studentId}`)) continue;
        const [del] = await tx.delete(sessionPackageDeductions).where(eq(sessionPackageDeductions.id, c.id));
        const removed = Number((del as any)?.affectedRows ?? 0) > 0;
        if (removed && c.chargeStatus === "paid") {
            await tx.update(Student).set({ livebalance: sql`${Student.livebalance} + 1` }).where(eq(Student.id, c.studentId));
            refunded++;
        }
    }
    return refunded;
}
