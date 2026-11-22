import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { db } from "../../models/connection";
import {
    studentAvailabilityPlans,
    studentAvailabilitySlots,
    studentPlanSessions,
    adminAvailabilitySlots,
    DAYS_OF_WEEK,
} from "../../models/schema/admin/StudentAvailabilityPlan";
import { Student } from "../../models/schema/admin/Student";
import { sessions, sessionUsers } from "../../models/schema/admin/Session";
import { teachers } from "../../models/schema/admin/teacher";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";
import { sendStudentNotification } from "../../utils/studentNotification";

const getStudentId = (req: Request): string => {
    if (!req.user?.id) throw new UnauthorizedError("Not authenticated");
    return req.user.id;
};

// ── Helper: Resolve slots from admin templates or custom slot inputs ──────────
const resolveAndPrepareSlots = async (planId: string, slotIds?: string[], slots?: any[]) => {
    const slotInserts: any[] = [];

    // Option 1: Direct array of admin slot IDs selected by student
    if (Array.isArray(slotIds) && slotIds.length > 0) {
        const foundAdminSlots = await db
            .select()
            .from(adminAvailabilitySlots)
            .where(
                and(
                    inArray(adminAvailabilitySlots.id, slotIds),
                    eq(adminAvailabilitySlots.isActive, true)
                )
            );

        if (foundAdminSlots.length !== slotIds.length) {
            throw new BadRequest("One or more selected slots are invalid or no longer active.");
        }

        for (const adminSlot of foundAdminSlots) {
            slotInserts.push({
                id: randomUUID(),
                planId,
                adminSlotId: adminSlot.id,
                dayOfWeek: adminSlot.dayOfWeek,
                specificDate: null,
                timeFrom: adminSlot.timeFrom,
                timeTo: adminSlot.timeTo,
            });
        }
    } else if (Array.isArray(slots) && slots.length > 0) {
        // Option 2: Array of slot objects (each may specify slotId and/or specificDate / custom times)
        const refIds = slots.filter((s: any) => s.slotId).map((s: any) => s.slotId);
        const activeAdminSlots = await db.select().from(adminAvailabilitySlots).where(eq(adminAvailabilitySlots.isActive, true));
        let adminSlotsMap: Record<string, any> = {};

        if (refIds.length > 0) {
            const foundAdminSlots = await db
                .select()
                .from(adminAvailabilitySlots)
                .where(
                    and(
                        inArray(adminAvailabilitySlots.id, refIds),
                        eq(adminAvailabilitySlots.isActive, true)
                    )
                );

            if (foundAdminSlots.length !== refIds.length) {
                throw new BadRequest("One or more selected slots are invalid or no longer active.");
            }

            for (const as of foundAdminSlots) {
                adminSlotsMap[as.id] = as;
            }
        }

        for (const s of slots) {
            if (s.slotId && adminSlotsMap[s.slotId]) {
                const adminSlot = adminSlotsMap[s.slotId];
                slotInserts.push({
                    id: randomUUID(),
                    planId,
                    adminSlotId: adminSlot.id,
                    dayOfWeek: adminSlot.dayOfWeek,
                    specificDate: s.specificDate ? s.specificDate : null,
                    timeFrom: adminSlot.timeFrom,
                    timeTo: adminSlot.timeTo,
                });
            } else {
                // Only the admin's time slots can be chosen: a day + time that matches an active admin slot
                // is linked to it; any other (custom) time is refused.
                const hms = (t: any) => { const [h, m] = String(t || "").split(":"); return `${String(h).padStart(2, "0")}:${String(m || "00").padStart(2, "0")}`; };
                const match = activeAdminSlots.find((as) => as.dayOfWeek === s.dayOfWeek && hms(as.timeFrom) === hms(s.timeFrom) && hms(as.timeTo) === hms(s.timeTo));
                if (!match) {
                    throw new BadRequest(`${s.dayOfWeek || "That day"} ${hms(s.timeFrom)}–${hms(s.timeTo)} is not one of the available time slots. Pick from the times offered.`);
                }
                slotInserts.push({
                    id: randomUUID(),
                    planId,
                    adminSlotId: match.id,
                    dayOfWeek: match.dayOfWeek,
                    specificDate: s.specificDate ? s.specificDate : null,
                    timeFrom: match.timeFrom,
                    timeTo: match.timeTo,
                });
            }
        }
    }

    return slotInserts;
};

// ── 0. Get Available Slots for Students ──────────────────────────────────────
// Returns all 7 days of the week and all active slots defined by the admin
export const getAvailableSlots = async (req: Request, res: Response) => {
    const { dayOfWeek } = req.query;

    const conditions: any[] = [eq(adminAvailabilitySlots.isActive, true)];

    if (dayOfWeek && typeof dayOfWeek === "string") {
        conditions.push(eq(adminAvailabilitySlots.dayOfWeek, dayOfWeek as any));
    }

    const allSlots = await db
        .select()
        .from(adminAvailabilitySlots)
        .where(and(...conditions))
        .orderBy(asc(adminAvailabilitySlots.dayOfWeek), asc(adminAvailabilitySlots.timeFrom));

    const grouped: Record<string, any[]> = {
        Saturday: [],
        Sunday: [],
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
    };

    for (const slot of allSlots) {
        if (grouped[slot.dayOfWeek]) {
            grouped[slot.dayOfWeek].push(slot);
        }
    }

    // Sort slots within each day by timeFrom ascending
    for (const day of DAYS_OF_WEEK) {
        grouped[day].sort((a, b) => a.timeFrom.localeCompare(b.timeFrom));
    }

    const days = DAYS_OF_WEEK.map((day) => ({
        dayOfWeek: day,
        count: grouped[day].length,
        slots: grouped[day],
    }));

    return SuccessResponse(res, {
        message: "Available slots retrieved successfully",
        total: allSlots.length,
        days,
        grouped,
        slots: allSlots,
    });
};

// ── 1. Create Availability Plan ──────────────────────────────────────────────
export const createAvailabilityPlan = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { title, notes, slots, slotIds } = req.body;

    const [existingStudent] = await db
        .select({ id: Student.id })
        .from(Student)
        .where(eq(Student.id, studentId))
        .limit(1);

    if (!existingStudent) {
        throw new NotFound("Student not found");
    }

    const planId = randomUUID();

    await db.insert(studentAvailabilityPlans).values({
        id: planId,
        studentId,
        title,
        notes: notes || null,
        status: "pending_admin_review",
    });

    const slotInserts = await resolveAndPrepareSlots(planId, slotIds, slots);

    if (slotInserts.length === 0) {
        throw new BadRequest("Please select at least one availability slot.");
    }

    await db.insert(studentAvailabilitySlots).values(slotInserts);

    const [createdPlan] = await db
        .select()
        .from(studentAvailabilityPlans)
        .where(eq(studentAvailabilityPlans.id, planId));

    const createdSlots = await db
        .select()
        .from(studentAvailabilitySlots)
        .where(eq(studentAvailabilitySlots.planId, planId));

    return SuccessResponse(res, {
        message: "Availability plan submitted successfully. Admin will review and propose sessions.",
        plan: {
            ...createdPlan,
            slots: createdSlots,
        },
    }, 201);
};

// ── 2. Get My Availability Plans ─────────────────────────────────────────────
export const getMyAvailabilityPlans = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { status, page = "1", limit = "10" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(studentAvailabilityPlans.studentId, studentId)];
    if (status && typeof status === "string") {
        conditions.push(eq(studentAvailabilityPlans.status, status as any));
    }

    const whereClause = and(...conditions);

    const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(studentAvailabilityPlans)
        .where(whereClause);

    const total = Number(countResult?.count || 0);

    const plans = await db
        .select({
            id: studentAvailabilityPlans.id,
            title: studentAvailabilityPlans.title,
            status: studentAvailabilityPlans.status,
            notes: studentAvailabilityPlans.notes,
            adminNotes: studentAvailabilityPlans.adminNotes,
            studentFeedback: studentAvailabilityPlans.studentFeedback,
            proposedAt: studentAvailabilityPlans.proposedAt,
            respondedAt: studentAvailabilityPlans.respondedAt,
            createdAt: studentAvailabilityPlans.createdAt,
            updatedAt: studentAvailabilityPlans.updatedAt,
        })
        .from(studentAvailabilityPlans)
        .where(whereClause)
        .orderBy(desc(studentAvailabilityPlans.createdAt))
        .limit(limitNum)
        .offset(offset);

    // Fetch slots and session counts for these plans
    const planIds: string[] = plans.map((p) => p.id as string);
    let slotsMap: Record<string, any[]> = {};
    let sessionCountMap: Record<string, number> = {};

    if (planIds.length > 0) {
        const allSlots = await db
            .select()
            .from(studentAvailabilitySlots)
            .where(inArray(studentAvailabilitySlots.planId, planIds));

        for (const slot of allSlots) {
            if (!slotsMap[slot.planId]) slotsMap[slot.planId] = [];
            slotsMap[slot.planId].push(slot);
        }

        const sessionCounts = await db
            .select({
                planId: studentPlanSessions.planId,
                count: sql<number>`COUNT(*)`,
            })
            .from(studentPlanSessions)
            .where(inArray(studentPlanSessions.planId, planIds))
            .groupBy(studentPlanSessions.planId);

        for (const sc of sessionCounts) {
            sessionCountMap[sc.planId] = Number(sc.count);
        }
    }

    const items = plans.map((p) => ({
        ...p,
        slots: slotsMap[p.id as string] || [],
        proposedSessionsCount: sessionCountMap[p.id as string] || 0,
    }));

    return SuccessResponse(res, {
        items,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    });
};

// ── 3. Get Single Availability Plan by ID ───────────────────────────────────
export const getMyAvailabilityPlanById = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { id } = req.params;

    const [plan] = await db
        .select({
            id: studentAvailabilityPlans.id,
            studentId: studentAvailabilityPlans.studentId,
            title: studentAvailabilityPlans.title,
            notes: studentAvailabilityPlans.notes,
            status: studentAvailabilityPlans.status,
            adminNotes: studentAvailabilityPlans.adminNotes,
            studentFeedback: studentAvailabilityPlans.studentFeedback,
            proposedAt: studentAvailabilityPlans.proposedAt,
            respondedAt: studentAvailabilityPlans.respondedAt,
            createdAt: studentAvailabilityPlans.createdAt,
            updatedAt: studentAvailabilityPlans.updatedAt,
        })
        .from(studentAvailabilityPlans)
        .where(
            and(
                eq(studentAvailabilityPlans.id, id),
                eq(studentAvailabilityPlans.studentId, studentId)
            )
        )
        .limit(1);

    if (!plan) {
        throw new NotFound("Availability plan not found");
    }

    const slots = await db
        .select()
        .from(studentAvailabilitySlots)
        .where(eq(studentAvailabilitySlots.planId, id));

    // Fetch proposed sessions with details (including per-session student response)
    const proposedSessions = await db
        .select({
            planSessionId: studentPlanSessions.id,
            planSessionNotes: studentPlanSessions.notes,
            orderIndex: studentPlanSessions.orderIndex,
            studentResponse: studentPlanSessions.studentResponse,
            sessionId: sessions.id,
            sessionName: sessions.name,
            scheduleType: sessions.scheduleType,
            sessionDate: sessions.sessionDate,
            startDate: sessions.startDate,
            endDate: sessions.endDate,
            timeFrom: sessions.timeFrom,
            timeTo: sessions.timeTo,
            sessionLink: sessions.session_link,
            sessionRelationalType: sessions.sessionRelationalType,
            teacherId: sessions.teacherId,
            teacherName: teachers.name,
        })
        .from(studentPlanSessions)
        .innerJoin(sessions, eq(studentPlanSessions.sessionId, sessions.id))
        .leftJoin(teachers, eq(sessions.teacherId, teachers.id))
        .where(eq(studentPlanSessions.planId, id))
        .orderBy(studentPlanSessions.orderIndex, sessions.sessionDate, sessions.timeFrom);

    return SuccessResponse(res, {
        plan: {
            ...plan,
            slots,
            proposedSessions,
        },
    });
};

// ── 4. Respond to Proposed Plan (per session) ───────────────────────────────
// POST /user/availability-plans/:id/respond
//   { action: "accept", rejectedSessionIds?: string[], feedback? }  → accept every waiting session except the rejected ones
//   { action: "reject", feedback? }                                   → decline every waiting session
// Accepted sessions: the student joins them (Upcoming + the teacher's dashboard).
// Declined sessions: hidden from everyone; the plan goes back to the admin to reschedule them
// (sessions accepted earlier stay accepted). With nothing declined, the plan is accepted.
export const respondToProposedPlan = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { id } = req.params;
    const { action, feedback } = req.body as { action: "accept" | "reject"; feedback?: string };
    const rejectedSessionIds: string[] = Array.isArray(req.body?.rejectedSessionIds) ? req.body.rejectedSessionIds : [];

    const [plan] = await db
        .select()
        .from(studentAvailabilityPlans)
        .where(and(eq(studentAvailabilityPlans.id, id), eq(studentAvailabilityPlans.studentId, studentId)))
        .limit(1);
    if (!plan) throw new NotFound("Availability plan not found");
    if (plan.status === "cancelled") throw new BadRequest("This plan was cancelled and cannot be responded to.");
    if (plan.status === "pending_admin_review") throw new BadRequest("The admin is still preparing sessions for this plan.");

    // only the sessions still waiting for an answer can be answered
    const waiting = await db
        .select({ id: studentPlanSessions.id, sessionId: studentPlanSessions.sessionId })
        .from(studentPlanSessions)
        .where(and(eq(studentPlanSessions.planId, id), eq(studentPlanSessions.studentResponse, "pending")));
    if (waiting.length === 0) throw new BadRequest("There are no sessions waiting for your answer in this plan.");

    const waitingIds = new Set(waiting.map((w) => w.sessionId));
    const declineSet = new Set<string>(action === "reject" ? [...waitingIds] : rejectedSessionIds);
    for (const sId of declineSet) {
        if (!waitingIds.has(sId)) throw new BadRequest("One of the sessions you declined is not waiting for an answer in this plan.");
    }
    const accepted = waiting.filter((w) => !declineSet.has(w.sessionId));
    const declined = waiting.filter((w) => declineSet.has(w.sessionId));

    await db.transaction(async (tx) => {
        for (const w of waiting) {
            await tx.update(studentPlanSessions)
                .set({ studentResponse: declineSet.has(w.sessionId) ? "rejected" : "accepted" })
                .where(eq(studentPlanSessions.id, w.id));
        }
        if (accepted.length) {
            const acceptedIds = accepted.map((a) => a.sessionId);
            const already = await tx.select({ sessionId: sessionUsers.sessionId }).from(sessionUsers)
                .where(and(eq(sessionUsers.studentId, studentId), inArray(sessionUsers.sessionId, acceptedIds)));
            const have = new Set(already.map((e) => e.sessionId));
            const add = acceptedIds.filter((sId) => !have.has(sId)).map((sessionId) => ({ id: randomUUID(), sessionId, studentId }));
            if (add.length) await tx.insert(sessionUsers).values(add);
        }
        await tx.update(studentAvailabilityPlans).set({
            // anything declined → back to the admin to reschedule; otherwise the plan is fully accepted
            status: declined.length ? "pending_admin_review" : "accepted",
            studentFeedback: feedback?.trim() ? feedback.trim() : plan.studentFeedback,
            respondedAt: new Date(),
        }).where(eq(studentAvailabilityPlans.id, id));
    });

    await sendStudentNotification(
        studentId,
        declined.length
            ? `You accepted ${accepted.length} and declined ${declined.length} session(s) of "${plan.title}". The admin will offer new times for the declined ones.`
            : `You accepted all ${accepted.length} session(s) of "${plan.title}". They are now in your upcoming sessions.`
    );

    return SuccessResponse(res, {
        message: declined.length
            ? `${accepted.length} accepted, ${declined.length} declined — the admin will reschedule the declined ones.`
            : `All ${accepted.length} session(s) accepted.`,
        acceptedCount: accepted.length,
        rejectedCount: declined.length,
        status: declined.length ? "pending_admin_review" : "accepted",
    });
};

// ── 5. Cancel Plan (Only if pending admin review) ───────────────────────────
export const cancelAvailabilityPlan = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { id } = req.params;

    const [plan] = await db
        .select()
        .from(studentAvailabilityPlans)
        .where(
            and(
                eq(studentAvailabilityPlans.id, id),
                eq(studentAvailabilityPlans.studentId, studentId)
            )
        )
        .limit(1);

    if (!plan) {
        throw new NotFound("Availability plan not found");
    }

    if (plan.status !== "pending_admin_review") {
        throw new BadRequest("Cannot cancel a plan that has already been processed or answered.");
    }

    await db
        .update(studentAvailabilityPlans)
        .set({ status: "cancelled" })
        .where(eq(studentAvailabilityPlans.id, id));

    return SuccessResponse(res, { message: "Availability plan cancelled successfully." });
};

// ── 6. Update Availability Plan ─────────────────────────────────────────────
export const updateAvailabilityPlan = async (req: Request, res: Response) => {
    const studentId = getStudentId(req);
    const { id } = req.params;
    const { title, notes, slots, slotIds } = req.body;

    const [plan] = await db
        .select()
        .from(studentAvailabilityPlans)
        .where(
            and(
                eq(studentAvailabilityPlans.id, id),
                eq(studentAvailabilityPlans.studentId, studentId)
            )
        )
        .limit(1);

    if (!plan) {
        throw new NotFound("Availability plan not found");
    }

    if (plan.status === "accepted") {
        throw new BadRequest("Cannot update an already accepted plan.");
    }

    if (plan.status === "cancelled") {
        throw new BadRequest("Cannot update a cancelled plan.");
    }

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (notes !== undefined) updateData.notes = notes;

    const hasNewSlots = (slotIds && Array.isArray(slotIds) && slotIds.length > 0) ||
        (slots && Array.isArray(slots) && slots.length > 0);

    // If slots are updated, reset status back to pending_admin_review if it was rejected or proposed
    if (hasNewSlots) {
        if (plan.status === "rejected" || plan.status === "plan_proposed") {
            updateData.status = "pending_admin_review";
        }
    }

    if (Object.keys(updateData).length > 0) {
        await db
            .update(studentAvailabilityPlans)
            .set(updateData)
            .where(eq(studentAvailabilityPlans.id, id));
    }

    if (hasNewSlots) {
        const slotInserts = await resolveAndPrepareSlots(id, slotIds, slots);

        if (slotInserts.length > 0) {
            await db.delete(studentAvailabilitySlots).where(eq(studentAvailabilitySlots.planId, id));
            await db.insert(studentAvailabilitySlots).values(slotInserts);
        }
    }

    const [updatedPlan] = await db
        .select()
        .from(studentAvailabilityPlans)
        .where(eq(studentAvailabilityPlans.id, id));

    const updatedSlots = await db
        .select()
        .from(studentAvailabilitySlots)
        .where(eq(studentAvailabilitySlots.planId, id));

    return SuccessResponse(res, {
        message: "Availability plan updated successfully.",
        plan: {
            ...updatedPlan,
            slots: updatedSlots,
        },
    });
};
