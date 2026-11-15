import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Time must be HH:MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
};

export const meetingLinkSchema = z.object({
    session_link: z.string().trim().url("Meeting link must be a valid URL").max(500).or(z.literal("")),
});

export const attendanceSchema = z.object({
    attendance: z.array(z.object({
        studentId: z.string().min(1),
        status: z.enum(["present", "absent"]),
    })).min(1, "Mark at least one student"),
});

export const createTeacherRequestSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("cover"),
        requestDate: date,
        timeFrom: time,
        timeTo: time,
        reason: z.string().trim().min(3, "Please add a reason").max(2000),
    }),
    z.object({
        type: z.literal("cancellation"),
        sessionId: z.string().min(1),
        reason: z.string().trim().min(3, "Please add a reason").max(2000),
    }),
]).superRefine((v, ctx) => {
    if (v.type === "cover" && toMinutes(v.timeTo) <= toMinutes(v.timeFrom)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End time must be after start time", path: ["timeTo"] });
    }
});

export const saveAvailabilitySchema = z.object({
    slots: z.array(z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        timeFrom: time,
        timeTo: time,
    }).refine(v => toMinutes(v.timeTo) > toMinutes(v.timeFrom), { message: "End time must be after start time" })).max(50),
});

export const respondTeacherRequestSchema = z.object({
    status: z.enum(["accepted", "rejected"]),
    adminReply: z.string().trim().max(2000).optional(),
    coverTeacherId: z.string().optional().nullable(),
});

export const cancelSessionSchema = z.object({
    reason: z.string().trim().min(3, "Please add a reason").max(2000),
});
