import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20");
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use a time like 16:00");
const TYPES = ["Explanation", "Re-Explanation", "Mistakes", "Exam"] as const;

/** One session the planner creates. */
export const plannerItemSchema = z.object({
    date,
    timeFrom: time,
    timeTo: time,
    teacherId: z.string().min(1, "Pick a teacher"),
    type: z.enum(TYPES),
    lessonIds: z.array(z.string().min(1)).max(20).default([]),
    name: z.string().trim().max(255).optional(),
});

export const plannerCreateSessionSchema = plannerItemSchema.extend({
    courseId: z.string().min(1, "Pick a course"),
    studentIds: z.array(z.string().min(1)).max(200).default([]),
    groupIds: z.array(z.string().min(1)).max(20).default([]),
});

export const plannerBuildPlanSchema = z.object({
    courseId: z.string().min(1, "Pick a course"),
    adminNotes: z.string().trim().max(1000).optional(),
    items: z.array(plannerItemSchema).min(1, "Add at least one session").max(60),
});

export const plannerDispatchSchema = z.object({
    sessionIds: z.array(z.string().min(1)).min(1, "Pick at least one session").max(300),
});
