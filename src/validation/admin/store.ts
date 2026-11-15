import { z } from "zod";

const price = z.number().min(0, "Prices can't be negative").max(10_000_000);
export const planSchema = z.object({
    id: z.string().max(36).optional(),
    label: z.string().trim().min(1, "Give every plan a name").max(255),
    days: z.number().int().min(1, "Days must be 1 or more").max(3650),
    priceEgp: price,
    priceUsd: price,
    hasDiscount: z.boolean().default(false),
    discountEgp: price.optional(),
    discountUsd: price.optional(),
}).refine((p) => !p.hasDiscount || ((p.discountEgp ?? 0) <= p.priceEgp && (p.discountUsd ?? 0) <= p.priceUsd), "A discount can't be more than the price");
const plans = z.array(planSchema).min(1, "Keep at least one plan — without one the item can't be bought").max(12);
const target = z.object({ type: z.enum(["course", "chapter", "lesson"]), id: z.string().min(1).max(36) });

export const savePlansSchema = z.object({ plans });
export const applyPlansSchema = z.object({ targets: z.array(target).min(1).max(1000), plans });
export const adjustPricesSchema = z.object({
    targets: z.array(target).min(1).max(1000),
    percent: z.number().min(-90, "Can't lower by more than 90%").max(500).refine((v) => v !== 0, "Enter a percentage"),
    currency: z.enum(["egp", "usd", "both"]),
    roundTo: z.number().min(0.01).max(1000).default(1),
});
