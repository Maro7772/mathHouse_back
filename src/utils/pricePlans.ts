// utils/pricePlans.ts
// Saves the price plans of one course / chapter / lesson WITHOUT deleting and re-creating them.
// Students' enrolments point at a plan (enrolledItems.priceId); re-creating plans used to delete those
// enrolments through the foreign key. Plans are now updated in place and keep their ids.
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { prices } from "../models/schema";

export type PlanInput = {
    id?: string;
    label: string;
    days: number;
    priceEgp: number | string;
    priceUsd: number | string;
    hasDiscount?: boolean;
    discountEgp?: number | string | null;
    discountUsd?: number | string | null;
};

type Tx = { select: any; insert: any; update: any; delete: any };
const money = (v: unknown) => (v == null || v === "" ? "0.00" : Number(v).toFixed(2));

/**
 * Makes the stored plans of a target equal to `plans` (same order; the first is the default).
 * Matching: by `id` when given, otherwise by the same label + days, otherwise a new plan.
 * Stored plans that are no longer listed are removed (their enrolments keep access — the FK sets priceId to NULL).
 */
export async function syncPricePlans(tx: Tx, targetType: "course" | "chapter" | "lesson", targetId: string, plans: PlanInput[]) {
    const existing: { id: string; durationLabel: string; durationDays: number }[] = await tx
        .select({ id: prices.id, durationLabel: prices.durationLabel, durationDays: prices.durationDays })
        .from(prices).where(and(eq(prices.targetId, targetId), eq(prices.targetType, targetType)));
    const free = new Map(existing.map((p) => [p.id, p]));
    const keep = new Set<string>();

    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        let match = plan.id && free.get(plan.id);
        if (!match) match = [...free.values()].find((p) => p.durationLabel === plan.label && Number(p.durationDays) === Number(plan.days));
        const values = {
            durationLabel: String(plan.label),
            durationDays: Number(plan.days),
            priceEgp: money(plan.priceEgp),
            priceUsd: money(plan.priceUsd),
            hasDiscount: Boolean(plan.hasDiscount),
            discountEgp: plan.hasDiscount ? money(plan.discountEgp) : "0.00",
            discountUsd: plan.hasDiscount ? money(plan.discountUsd) : "0.00",
            isDefault: i === 0,
        };
        if (match) {
            free.delete(match.id);
            keep.add(match.id);
            await tx.update(prices).set(values).where(eq(prices.id, match.id));
        } else {
            const id = randomUUID();
            keep.add(id);
            await tx.insert(prices).values({ id, targetId, targetType, ...values });
        }
    }
    const removed = [...free.keys()];
    if (removed.length) await tx.delete(prices).where(inArray(prices.id, removed));
    return { kept: keep.size, removed: removed.length };
}
