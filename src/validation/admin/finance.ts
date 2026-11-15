import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20");
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11");
const money = z.number().int("Whole pounds only").min(0).max(100_000_000);
const text = (max = 255) => z.string().trim().max(max);
const req = (label: string, max = 255) => z.string().trim().min(1, `${label} is required`).max(max);
// A document: an uploaded file as a base64 data URL (pdf / image), or an existing URL.
const doc = z.string().max(15_000_000).refine((v) => /^data:(application\/pdf|image\/(png|jpe?g|webp));base64,/.test(v) || /^https?:\/\//.test(v), "Upload a PDF or an image");

// ── accounts & reconciliation ──
export const accountSchema = z.object({
    name: req("Name"),
    number: text().optional(),
    type: z.enum(["Bank", "Wallet", "Cash"]),
    owner: text().optional(),
    openingBalance: money.default(0),
    paymentMethodId: z.string().max(36).nullable().optional(),
    isActive: z.boolean().optional(),
});
export const reconLineSchema = z.object({
    accountId: req("Account", 36),
    day,
    opening: z.number().int().min(-100_000_000).max(100_000_000),
    systemReceipts: money,
    statementReceipts: money,
    payments: money,
    action: text(1000).optional(),
});
export const reconUpdateSchema = reconLineSchema.omit({ accountId: true, day: true }).partial();
export const reconReconcileSchema = z.object({ action: text(1000).optional() });

// ── unmatched receipts ──
export const unmatchedSchema = z.object({
    receivedOn: day,
    amount: money.refine((v) => v > 0, "Amount must be more than 0"),
    accountId: z.string().max(36).nullable().optional(),
    payer: req("Payer / reference"),
    possibleStudent: text().optional(),
    evidence: text(2000).optional(),
    issue: req("Issue", 2000),
    owner: text().optional(),
    dueOn: day.nullable().optional(),
});
export const unmatchedResolveSchema = z.object({
    resolution: req("Resolution (result + final document)", 2000),
    matchedStudentId: z.string().max(36).nullable().optional(),
});

// ── adjustments ──
export const adjustmentSchema = z.object({
    studentId: z.string().max(36).nullable().optional(),
    studentName: req("Student"),
    packageLabel: text().optional(),
    type: z.enum(["Discount", "Price change", "Extension", "Session waiver", "Package change"]),
    beforeValue: req("Before"),
    afterValue: req("After"),
    reason: req("Business reason", 2000),
    requestedBy: req("Requested by"),
    impact: text().optional(),
});
export const adjustmentDecideSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("approved"), approvedBy: req("Approved by"), approvalRef: req("Written approval reference"), note: text(2000).optional(), implementedOn: day.nullable().optional() }),
    z.object({ status: z.literal("rejected"), note: req("Reason for rejecting", 2000) }),
]);
export const adjustmentImplementedSchema = z.object({ implementedOn: day });

// ── refunds & disputes ──
export const refundSchema = z.object({
    studentId: z.string().max(36).nullable().optional(),
    studentName: req("Student"),
    parentName: text().optional(),
    type: z.enum(["Refund", "Session dispute", "Discount dispute", "Package cancellation"]),
    requestedOn: day,
    amount: req("Amount / sessions"),
    policy: text().optional(),
    evidence: text(2000).optional(),
    reviewer: text().optional(),
});
export const refundUpdateSchema = refundSchema.partial();
export const refundDecideSchema = z.object({ decision: req("Decision", 2000), financialEffect: text().optional(), reviewer: text().optional() });
export const refundCloseSchema = z.object({ notifiedOn: day });

// ── expenses ──
export const expenseSchema = z.object({
    spentOn: day,
    branch: req("Branch"),
    category: req("Category", 100),
    amount: money.refine((v) => v > 0, "Amount must be more than 0"),
    payee: req("Payee"),
    method: req("Payment method", 100),
    approvedBy: text().optional(),
    notes: text(2000).optional(),
    document: doc.nullable().optional(),
});
export const expenseUpdateSchema = expenseSchema.partial();
export const expenseCorrectSchema = z.object({
    spentOn: day,
    amount: z.number().int().min(-100_000_000).max(100_000_000).refine((v) => v !== 0, "Amount can't be 0"),
    notes: req("Why this correction is needed", 2000),
    document: doc.nullable().optional(),
});

// ── teacher settlements ──
export const contractSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("per_session"), ratePerSession: z.number().int().min(1, "Enter the amount per session").max(1_000_000), contractRef: req("Contract reference"), notes: text(2000).optional() }),
    z.object({ kind: z.literal("percent"), percent: z.number().min(0.01).max(100), basis: z.enum(["gross", "net"]), contractRef: req("Contract reference"), notes: text(2000).optional() }),
]);
export const settlementSchema = z.object({ period, base: money.nullable().optional() });
export const settlementPaySchema = z.object({ period, paidOn: day, paymentRef: req("Transfer reference"), proof: doc.nullable().optional() });

// ── month-end close ──
export const closeItemSchema = z.object({
    period,
    itemKey: req("Item", 50),
    evidence: text(2000).optional(),
    reviewed: z.boolean().optional(),
    approved: z.boolean().optional(),
});
export const closeLockSchema = z.object({ period, note: text(2000).optional() });
