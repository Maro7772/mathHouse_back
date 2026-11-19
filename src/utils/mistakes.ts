// utils/mistakes.ts
// "Buying mistakes" = the student bought a package that includes answers (payment.includedAnswers),
// the same rule the exam answers page already uses. Solutions are only shown to those students.
import { and, eq } from "drizzle-orm";
import { db } from "../models/connection";
import { payment } from "../models/schema/admin/payment";
import { generateSecureStreamUrl } from "../drive/services/services";

export async function hasMistakesAccess(studentId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: payment.id })
        .from(payment)
        .where(and(
            eq(payment.studentId, studentId),
            eq(payment.purpose, "purchase"),
            eq(payment.status, "completed"),
            eq(payment.includedAnswers, true),
            eq(payment.isDeleted, false),
        ))
        .limit(1);
    return !!row;
}

export type PlayableVideo = { type: "bunny"; streamUrl: string } | { type: "external"; url: string } | null;

/**
 * A solution video is stored either as a Bunny video id (uploaded through the admin drive)
 * or as a link. Bunny ids become a short-lived signed stream link, like lesson videos.
 */
export function resolveSolutionVideo(value: string | null | undefined): PlayableVideo {
    const v = (value || "").trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return { type: "external", url: v };
    try {
        return { type: "bunny", streamUrl: generateSecureStreamUrl(v) };
    } catch {
        return null; // Bunny is not configured on this server: hide the video instead of failing the page
    }
}
