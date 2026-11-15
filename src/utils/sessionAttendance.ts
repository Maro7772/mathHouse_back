// utils/sessionAttendance.ts
// Shared "mark a student present" logic, used by admin manual attendance and by the teacher portal.
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../models/connection";
import { sessionAttendance, sessionLessons, sessionPackageDeductions, sessionUsers } from "../models/schema/admin/Session";
import { Student } from "../models/schema/admin/Student";
import { enrolledItems } from "../models/schema/user/enrolledItems";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttendanceSession = {
    id: string;
    sessionRelationalType: string | null;
    contentAccessDays: number | null;
};

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

/**
 * Marks one student present in one session, inside a transaction:
 *  1. makes sure the student is enrolled in session_users
 *  2. upserts session_attendance = "present"
 *  3. deducts 1 live session from the student's balance, once per session
 *     (Re-Explanation is free when the student already attended all its lessons elsewhere)
 *  4. unlocks the session's lessons in enrolled_items (expiring after contentAccessDays, if set)
 */
export async function markStudentPresent(
    tx: Tx,
    studentId: string,
    session: AttendanceSession,
    sessionLessonIds: string[],
): Promise<{ balanceDeducted: boolean; lessonsUnlocked: number }> {
    // 1. Enrollment
    const [existingSessionUser] = await tx
        .select({ id: sessionUsers.id })
        .from(sessionUsers)
        .where(and(eq(sessionUsers.sessionId, session.id), eq(sessionUsers.studentId, studentId)))
        .limit(1);
    if (!existingSessionUser) {
        await tx.insert(sessionUsers).values({ id: randomUUID(), sessionId: session.id, studentId });
    }

    // 2. Attendance
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

    // 3. Balance deduction (never twice for the same session)
    const [existingDeduction] = await tx
        .select({ id: sessionPackageDeductions.id })
        .from(sessionPackageDeductions)
        .where(and(eq(sessionPackageDeductions.sessionId, session.id), eq(sessionPackageDeductions.studentId, studentId)))
        .limit(1);

    let balanceDeducted = false;
    if (!existingDeduction) {
        let shouldDeduct = true;

        if (session.sessionRelationalType === "Re-Explanation" && sessionLessonIds.length > 0) {
            const previouslyAttendedRows = await tx
                .select({ lessonId: sessionLessons.lessonId })
                .from(sessionAttendance)
                .innerJoin(sessionLessons, eq(sessionAttendance.sessionId, sessionLessons.sessionId))
                .where(and(
                    eq(sessionAttendance.studentId, studentId),
                    eq(sessionAttendance.status, "present"),
                    sql`${sessionAttendance.sessionId} != ${session.id}`,
                    inArray(sessionLessons.lessonId, sessionLessonIds)
                ));
            const attendedLessonIdSet = new Set(previouslyAttendedRows.map(r => r.lessonId));
            if (sessionLessonIds.every(id => attendedLessonIdSet.has(id))) shouldDeduct = false;
        }

        if (shouldDeduct) {
            await tx
                .update(Student)
                .set({ livebalance: sql`GREATEST(0, ${Student.livebalance} - 1)` })
                .where(eq(Student.id, studentId));
            await tx.insert(sessionPackageDeductions).values({
                id: randomUUID(),
                sessionId: session.id,
                studentId,
                deductedAt: new Date(),
            }).catch(() => {});
            balanceDeducted = true;
        }
    }

    // 4. Unlock lessons
    let lessonsUnlocked = 0;
    if (sessionLessonIds.length > 0) {
        const alreadyEnrolled = await tx
            .select({ lessonId: enrolledItems.lessonId })
            .from(enrolledItems)
            .where(and(
                eq(enrolledItems.studentId, studentId),
                eq(enrolledItems.status, "active"),
                inArray(enrolledItems.lessonId, sessionLessonIds)
            ));
        const enrolledLessonIdSet = new Set(alreadyEnrolled.map(r => r.lessonId).filter(Boolean));
        const expiresAt = session.contentAccessDays
            ? new Date(Date.now() + session.contentAccessDays * 24 * 60 * 60 * 1000)
            : null;
        const newEnrollments = sessionLessonIds
            .filter(id => !enrolledLessonIdSet.has(id))
            .map(lessonId => ({ id: randomUUID(), studentId, lessonId, status: "active" as const, expiresAt }));
        if (newEnrollments.length > 0) {
            await tx.insert(enrolledItems).values(newEnrollments);
            lessonsUnlocked = newEnrollments.length;
        }
    }

    return { balanceDeducted, lessonsUnlocked };
}
