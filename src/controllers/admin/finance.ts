// controllers/admin/finance.ts
// Admin → Payment → finance registers (MathPortal design, Task H). Everything here is a record:
// approving an adjustment or a refund never changes balances or payments — staff apply those by hand.
// Rules enforced:
//   • a closed (locked) month is read-only — fix it with a correcting entry dated in an open month
//   • nothing is deleted: expenses get correcting lines, cases get resolved/closed with a written result
//   • approvals need a written reference; unmatched money is resolved only with a recorded result
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { and, eq, sql, SQL } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    financeAccounts, financeReconciliations, financeUnmatched, financeAdjustments, financeRefunds,
    financeExpenses, financeTeacherContracts, financeTeacherSettlements, financeCloseItems, financeCloseVersions,
    teachers, FinanceLogEntry,
} from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { saveBase64Image } from "../../utils/handleImages";

type Row = Record<string, any>;
const rows = async (q: SQL): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const num = (v: unknown) => (v == null ? 0 : Number(v));
const me = (req: Request) => ({ id: (req as any).user?.id ?? null, name: (req as any).user?.name ?? "Admin" });
const log = (req: Request, text: string): FinanceLogEntry => ({ at: new Date().toISOString(), by: me(req).name, text });
const ymd = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const periodEnd = (p: string) => { const [y, m] = p.split("-").map(Number); return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Saves an uploaded document (base64 pdf / image) or keeps an existing URL. */
async function saveDoc(req: Request, value: string | null | undefined, folder: string) {
    if (!value) return null;
    if (/^https?:\/\//.test(value)) return value;
    return saveBase64Image(value, req, folder);
}

/** A closed month can't be changed. */
async function assertOpen(day: string | null | undefined, what = "This entry") {
    if (!day) return;
    const p = String(day).slice(0, 7);
    const [v] = await db.select({ id: financeCloseVersions.id }).from(financeCloseVersions).where(eq(financeCloseVersions.period, p)).limit(1);
    if (v) throw new BadRequest(`${what} is in ${monthName(p)}, which is closed. Add a correcting entry dated in an open month instead.`);
}
async function lockedPeriods(): Promise<Set<string>> {
    const list = await rows(sql`SELECT DISTINCT period FROM finance_close_versions`);
    return new Set(list.map((r) => r.period as string));
}

// ═════════════════════════════════════════════════════════════════════════════
// Accounts & channels
// ═════════════════════════════════════════════════════════════════════════════
// GET /admin/finance/accounts — accounts with a 7-day summary and their current balance
export const listAccounts = async (_req: Request, res: Response) => {
    const list = await rows(sql`
        SELECT a.id, a.name, a.number, a.type, a.owner, a.opening_balance AS openingBalance, a.is_active AS isActive,
               a.payment_method_id AS paymentMethodId, pm.name AS paymentMethodName,
               (SELECT r.opening + r.statement_receipts - r.payments FROM finance_reconciliations r
                  WHERE r.account_id = a.id ORDER BY r.day DESC LIMIT 1) AS lastActual,
               (SELECT MAX(r.day) FROM finance_reconciliations r WHERE r.account_id = a.id) AS lastDay,
               (SELECT COALESCE(SUM(r.statement_receipts), 0) FROM finance_reconciliations r
                  WHERE r.account_id = a.id AND r.day >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS receipts7,
               (SELECT COALESCE(SUM(r.payments), 0) FROM finance_reconciliations r
                  WHERE r.account_id = a.id AND r.day >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS payments7,
               (SELECT COUNT(*) FROM finance_reconciliations r WHERE r.account_id = a.id AND r.status = 'open') AS openLines
        FROM finance_accounts a LEFT JOIN paymentMethod pm ON pm.id = a.payment_method_id
        ORDER BY a.is_active DESC, a.name`);
    return SuccessResponse(res, {
        accounts: list.map((a) => ({
            id: a.id, name: a.name, number: a.number, type: a.type, owner: a.owner,
            openingBalance: num(a.openingBalance), isActive: Boolean(num(a.isActive)),
            paymentMethodId: a.paymentMethodId, paymentMethodName: a.paymentMethodName,
            balance: a.lastActual == null ? num(a.openingBalance) : num(a.lastActual),
            lastReconciledDay: ymd(a.lastDay),
            receipts7: num(a.receipts7), payments7: num(a.payments7), openLines: num(a.openLines),
        })),
    });
};

export const createAccount = async (req: Request, res: Response) => {
    const id = randomUUID();
    await db.insert(financeAccounts).values({ id, ...req.body, paymentMethodId: req.body.paymentMethodId || null });
    return SuccessResponse(res, { message: "Account added", id }, 201);
};

export const updateAccount = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [a] = await db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.id, id));
    if (!a) throw new NotFound("Account not found");
    const body = { ...req.body };
    if ("paymentMethodId" in body) body.paymentMethodId = body.paymentMethodId || null;
    await db.update(financeAccounts).set(body).where(eq(financeAccounts.id, id));
    return SuccessResponse(res, { message: "Account saved" });
};

/** Delete a receiving account — only while nothing uses it. Its reconciliation lines would be deleted with it
    (FK cascade) and unmatched cases would lose their account, so an account with history is switched off instead. */
export const deleteAccount = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [a] = await db.select({ id: financeAccounts.id, name: financeAccounts.name }).from(financeAccounts).where(eq(financeAccounts.id, id));
    if (!a) throw new NotFound("Account not found");
    const [u] = await rows(sql`SELECT
        (SELECT COUNT(*) FROM finance_reconciliations WHERE account_id = ${id}) AS recon,
        (SELECT COUNT(*) FROM finance_unmatched WHERE account_id = ${id}) AS unmatched`);
    const recon = num(u?.recon), unmatched = num(u?.unmatched);
    // ?withDays=1 — the admin chose to delete the account together with its reconciliation days
    // (the FK cascade removes them; unmatched cases keep their record with no account). Never inside a closed month.
    if (String(req.query.withDays || "") === "1") {
        const [locked] = await rows(sql`SELECT COUNT(*) AS n FROM finance_reconciliations r
            WHERE r.account_id = ${id} AND DATE_FORMAT(r.day, '%Y-%m') IN (SELECT period FROM finance_close_versions)`);
        if (num(locked?.n)) throw new BadRequest(`${a.name} has ${num(locked?.n)} day${num(locked?.n) === 1 ? "" : "s"} in a closed month, so it can't be deleted — switch it to Inactive instead`);
        await db.delete(financeAccounts).where(eq(financeAccounts.id, id));
        return SuccessResponse(res, { message: "Account deleted", removedDays: recon });
    }
    if (recon || unmatched) {
        const parts = [recon && `${recon} reconciliation day${recon === 1 ? "" : "s"}`, unmatched && `${unmatched} unmatched receipt${unmatched === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
        throw new BadRequest(`${a.name} is used in ${parts}, so it can't be deleted — switch it to Inactive instead to keep the records`);
    }
    await db.delete(financeAccounts).where(eq(financeAccounts.id, id));
    return SuccessResponse(res, { message: "Account deleted" });
};

// ═════════════════════════════════════════════════════════════════════════════
// Daily reconciliation
// ═════════════════════════════════════════════════════════════════════════════
const reconRow = (r: Row, locked: Set<string>) => {
    const opening = num(r.opening), system = num(r.systemReceipts), statement = num(r.statementReceipts), payments = num(r.payments);
    const day = ymd(r.day)!;
    return {
        id: r.id, accountId: r.accountId, accountName: r.accountName, day,
        opening, systemReceipts: system, statementReceipts: statement, payments,
        expected: opening + system - payments, actual: opening + statement - payments, variance: statement - system,
        action: r.action, status: r.status, reviewedBy: r.reviewerName, reviewedAt: r.reviewedAt,
        locked: locked.has(day.slice(0, 7)),
    };
};

// GET /admin/finance/reconciliation?from&to[&accountId]
export const listReconciliation = async (req: Request, res: Response) => {
    const to = ISO.test(String(req.query.to)) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
    const from = ISO.test(String(req.query.from)) ? String(req.query.from) : new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
    const acc = req.query.accountId ? sql`AND r.account_id = ${String(req.query.accountId)}` : sql``;
    const list = await rows(sql`
        SELECT r.id, r.account_id AS accountId, a.name AS accountName, r.day, r.opening, r.system_receipts AS systemReceipts,
               r.statement_receipts AS statementReceipts, r.payments, r.action, r.status, r.reviewed_at AS reviewedAt,
               ad.name AS reviewerName
        FROM finance_reconciliations r JOIN finance_accounts a ON a.id = r.account_id
        LEFT JOIN admins ad ON ad.id = r.reviewed_by
        WHERE r.day BETWEEN ${from} AND ${to} ${acc}
        ORDER BY r.day DESC, a.name`);
    const locked = await lockedPeriods();
    return SuccessResponse(res, { from, to, lines: list.map((r) => reconRow(r, locked)) });
};

// GET /admin/finance/reconciliation/suggest?accountId&day — opening = last actual before the day,
// system receipts = completed payments recorded that day with the account's payment method.
export const suggestReconciliation = async (req: Request, res: Response) => {
    const accountId = String(req.query.accountId || ""), day = String(req.query.day || "");
    if (!accountId || !ISO.test(day)) throw new BadRequest("accountId and day are required");
    const [a] = await db.select().from(financeAccounts).where(eq(financeAccounts.id, accountId));
    if (!a) throw new NotFound("Account not found");
    const [prev] = await rows(sql`SELECT opening + statement_receipts - payments AS actual FROM finance_reconciliations
        WHERE account_id = ${accountId} AND day < ${day} ORDER BY day DESC LIMIT 1`);
    let systemReceipts = 0, systemCount = 0;
    if (a.paymentMethodId) {
        const [s] = await rows(sql`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM payment
            WHERE status = 'completed' AND isDeleted = 0 AND paymentMethodId = ${a.paymentMethodId} AND DATE(createdAt) = ${day}`);
        systemReceipts = num(s?.total); systemCount = num(s?.n);
    }
    const [existing] = await db.select({ id: financeReconciliations.id }).from(financeReconciliations)
        .where(and(eq(financeReconciliations.accountId, accountId), sql`${financeReconciliations.day} = ${day}`));
    return SuccessResponse(res, {
        opening: prev ? num(prev.actual) : a.openingBalance, systemReceipts, systemCount,
        linkedToPaymentMethod: Boolean(a.paymentMethodId), existingLineId: existing?.id ?? null,
    });
};

export const createReconLine = async (req: Request, res: Response) => {
    const b = req.body;
    await assertOpen(b.day, "This day");
    const [a] = await db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.id, b.accountId));
    if (!a) throw new BadRequest("Account not found");
    const [dup] = await db.select({ id: financeReconciliations.id }).from(financeReconciliations)
        .where(and(eq(financeReconciliations.accountId, b.accountId), sql`${financeReconciliations.day} = ${b.day}`));
    if (dup) throw new BadRequest("This account already has a line for that day — edit it instead");
    const id = randomUUID();
    await db.insert(financeReconciliations).values({ id, ...b, day: b.day as any, action: b.action || null, createdBy: me(req).id });
    return SuccessResponse(res, { message: "Line added", id }, 201);
};

async function loadRecon(id: string) {
    const [r] = await db.select().from(financeReconciliations).where(eq(financeReconciliations.id, id));
    if (!r) throw new NotFound("Line not found");
    await assertOpen(ymd(r.day), "This line");
    return r;
}

export const updateReconLine = async (req: Request, res: Response) => {
    const r = await loadRecon(String(req.params.id));
    if (r.status === "reconciled") throw new BadRequest("This day is reconciled — reopen it first");
    await db.update(financeReconciliations).set(req.body).where(eq(financeReconciliations.id, r.id));
    return SuccessResponse(res, { message: "Line saved" });
};

// POST /reconciliation/:id/reconcile — closes the day: variance must be 0 or explained.
export const reconcileLine = async (req: Request, res: Response) => {
    const r = await loadRecon(String(req.params.id));
    const action = (req.body.action ?? r.action ?? "").trim();
    if (r.statementReceipts !== r.systemReceipts && !action) {
        throw new BadRequest("There is a variance — write what explains it before closing the day");
    }
    await db.update(financeReconciliations).set({ status: "reconciled", action: action || null, reviewedBy: me(req).id, reviewedAt: new Date() })
        .where(eq(financeReconciliations.id, r.id));
    return SuccessResponse(res, { message: "Day reconciled" });
};

/** Delete one account-day. Not allowed inside a closed month (loadRecon checks the lock). */
export const deleteReconLine = async (req: Request, res: Response) => {
    const r = await loadRecon(String(req.params.id));
    await db.delete(financeReconciliations).where(eq(financeReconciliations.id, r.id));
    return SuccessResponse(res, { message: "Day deleted" });
};

export const reopenReconLine = async (req: Request, res: Response) => {
    const r = await loadRecon(String(req.params.id));
    await db.update(financeReconciliations).set({ status: "open", reviewedBy: null, reviewedAt: null }).where(eq(financeReconciliations.id, r.id));
    return SuccessResponse(res, { message: "Day reopened" });
};

// ═════════════════════════════════════════════════════════════════════════════
// Unmatched receipts
// ═════════════════════════════════════════════════════════════════════════════
export const listUnmatched = async (_req: Request, res: Response) => {
    const list = await rows(sql`
        SELECT u.*, a.name AS accountName, CONCAT(st.first_name, ' ', st.last_name) AS matchedStudentName, ad.name AS resolvedByName
        FROM finance_unmatched u
        LEFT JOIN finance_accounts a ON a.id = u.account_id
        LEFT JOIN student st ON st.id = u.matched_student_id
        LEFT JOIN admins ad ON ad.id = u.resolved_by
        ORDER BY u.status = 'resolved', u.received_on DESC`);
    return SuccessResponse(res, {
        cases: list.map((u) => ({
            id: u.id, receivedOn: ymd(u.received_on), amount: num(u.amount), accountId: u.account_id, accountName: u.accountName,
            payer: u.payer, possibleStudent: u.possible_student, evidence: u.evidence, issue: u.issue, owner: u.owner,
            dueOn: ymd(u.due_on), resolution: u.resolution, matchedStudentId: u.matched_student_id, matchedStudentName: u.matchedStudentName,
            status: u.status, resolvedBy: u.resolvedByName, resolvedAt: u.resolved_at, createdAt: u.created_at,
        })),
    });
};

export const createUnmatched = async (req: Request, res: Response) => {
    const id = randomUUID();
    const b = req.body;
    await db.insert(financeUnmatched).values({ id, ...b, receivedOn: b.receivedOn as any, dueOn: (b.dueOn || null) as any, accountId: b.accountId || null, createdBy: me(req).id });
    return SuccessResponse(res, { message: "Case opened", id }, 201);
};

async function loadOpenCase(id: string) {
    const [u] = await db.select().from(financeUnmatched).where(eq(financeUnmatched.id, id));
    if (!u) throw new NotFound("Case not found");
    if (u.status === "resolved") throw new BadRequest("This case is resolved and kept as a record");
    return u;
}

/** Delete an unmatched-receipt case (open or resolved). Not allowed when its date is in a closed month. */
export const deleteUnmatched = async (req: Request, res: Response) => {
    const [u] = await db.select().from(financeUnmatched).where(eq(financeUnmatched.id, String(req.params.id)));
    if (!u) throw new NotFound("Case not found");
    await assertOpen(ymd(u.receivedOn), "This case");
    await db.delete(financeUnmatched).where(eq(financeUnmatched.id, u.id));
    return SuccessResponse(res, { message: "Case deleted" });
};

export const updateUnmatched = async (req: Request, res: Response) => {
    const u = await loadOpenCase(String(req.params.id));
    const b = req.body;
    await db.update(financeUnmatched).set({ ...b, ...(b.dueOn !== undefined ? { dueOn: (b.dueOn || null) as any } : {}), ...(b.accountId !== undefined ? { accountId: b.accountId || null } : {}) })
        .where(eq(financeUnmatched.id, u.id));
    return SuccessResponse(res, { message: "Case saved" });
};

export const resolveUnmatched = async (req: Request, res: Response) => {
    const u = await loadOpenCase(String(req.params.id));
    await db.update(financeUnmatched).set({
        status: "resolved", resolution: req.body.resolution, matchedStudentId: req.body.matchedStudentId || null,
        resolvedBy: me(req).id, resolvedAt: new Date(),
    }).where(eq(financeUnmatched.id, u.id));
    return SuccessResponse(res, { message: "Case resolved" });
};

// ═════════════════════════════════════════════════════════════════════════════
// Adjustments & discounts (record only)
// ═════════════════════════════════════════════════════════════════════════════
export const listAdjustments = async (_req: Request, res: Response) => {
    const list = await db.select().from(financeAdjustments).orderBy(sql`${financeAdjustments.status} = 'pending' DESC`, sql`${financeAdjustments.createdAt} DESC`);
    return SuccessResponse(res, { adjustments: list.map((a) => ({ ...a, implementedOn: ymd(a.implementedOn), log: a.log || [] })) });
};

export const createAdjustment = async (req: Request, res: Response) => {
    const id = randomUUID();
    await db.insert(financeAdjustments).values({ id, ...req.body, studentId: req.body.studentId || null, createdBy: me(req).id, log: [log(req, `Requested by ${req.body.requestedBy}`)] });
    return SuccessResponse(res, { message: "Request recorded", id }, 201);
};

export const decideAdjustment = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [a] = await db.select().from(financeAdjustments).where(eq(financeAdjustments.id, id));
    if (!a) throw new NotFound("Request not found");
    if (a.status !== "pending") throw new BadRequest(`This request is already ${a.status}`);
    const b = req.body;
    const entry = b.status === "approved"
        ? log(req, `Approved by ${b.approvedBy} (${b.approvalRef})${b.note ? ` — ${b.note}` : ""}`)
        : log(req, `Rejected — ${b.note}`);
    await db.update(financeAdjustments).set({
        status: b.status,
        approvedBy: b.status === "approved" ? b.approvedBy : null,
        approvalRef: b.status === "approved" ? b.approvalRef : null,
        decisionNote: b.note || null,
        implementedOn: (b.status === "approved" ? b.implementedOn || null : null) as any,
        decidedBy: me(req).id, decidedAt: new Date(),
        log: [...(a.log || []), entry, ...(b.status === "approved" && b.implementedOn ? [log(req, `Implemented on ${b.implementedOn}`)] : [])],
    }).where(eq(financeAdjustments.id, id));
    return SuccessResponse(res, { message: b.status === "approved" ? "Approved — apply the change in the student's account" : "Rejected and kept on record" });
};

export const markAdjustmentImplemented = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [a] = await db.select().from(financeAdjustments).where(eq(financeAdjustments.id, id));
    if (!a) throw new NotFound("Request not found");
    if (a.status !== "approved") throw new BadRequest("Only an approved request can be marked as implemented");
    await db.update(financeAdjustments).set({ implementedOn: req.body.implementedOn, log: [...(a.log || []), log(req, `Implemented on ${req.body.implementedOn}`)] })
        .where(eq(financeAdjustments.id, id));
    return SuccessResponse(res, { message: "Marked as implemented" });
};

// ═════════════════════════════════════════════════════════════════════════════
// Refunds & disputes (record only)
// ═════════════════════════════════════════════════════════════════════════════
export const listRefunds = async (_req: Request, res: Response) => {
    const list = await db.select().from(financeRefunds).orderBy(sql`${financeRefunds.status} = 'closed'`, sql`${financeRefunds.requestedOn} DESC`);
    return SuccessResponse(res, { refunds: list.map((r) => ({ ...r, requestedOn: ymd(r.requestedOn), notifiedOn: ymd(r.notifiedOn), log: r.log || [] })) });
};

export const createRefund = async (req: Request, res: Response) => {
    const id = randomUUID();
    await db.insert(financeRefunds).values({ id, ...req.body, studentId: req.body.studentId || null, requestedOn: req.body.requestedOn as any, createdBy: me(req).id, log: [log(req, `Ticket opened (${req.body.type})`)] });
    return SuccessResponse(res, { message: "Ticket opened", id }, 201);
};

async function loadRefund(id: string) {
    const [r] = await db.select().from(financeRefunds).where(eq(financeRefunds.id, id));
    if (!r) throw new NotFound("Ticket not found");
    if (r.status === "closed") throw new BadRequest("This ticket is closed and kept as a record");
    return r;
}

export const updateRefund = async (req: Request, res: Response) => {
    const r = await loadRefund(String(req.params.id));
    const b = { ...req.body };
    if (b.requestedOn) b.requestedOn = b.requestedOn as any;
    if ("studentId" in b) b.studentId = b.studentId || null;
    await db.update(financeRefunds).set({ ...b, log: [...(r.log || []), log(req, "Details updated")] }).where(eq(financeRefunds.id, r.id));
    return SuccessResponse(res, { message: "Ticket saved" });
};

export const decideRefund = async (req: Request, res: Response) => {
    const r = await loadRefund(String(req.params.id));
    const b = req.body;
    await db.update(financeRefunds).set({
        status: "decided", decision: b.decision, financialEffect: b.financialEffect || null, reviewer: b.reviewer || r.reviewer,
        log: [...(r.log || []), log(req, `Decision: ${b.decision}${b.financialEffect ? ` (effect: ${b.financialEffect})` : ""}`)],
    }).where(eq(financeRefunds.id, r.id));
    return SuccessResponse(res, { message: "Decision recorded — tell the parent, then close the ticket" });
};

export const closeRefund = async (req: Request, res: Response) => {
    const r = await loadRefund(String(req.params.id));
    if (r.status !== "decided" || !r.decision) throw new BadRequest("Record the written decision before closing");
    await db.update(financeRefunds).set({
        status: "closed", notifiedOn: req.body.notifiedOn, closedAt: new Date(),
        log: [...(r.log || []), log(req, `Parent notified on ${req.body.notifiedOn}; ticket closed`)],
    }).where(eq(financeRefunds.id, r.id));
    return SuccessResponse(res, { message: "Ticket closed" });
};

// ═════════════════════════════════════════════════════════════════════════════
// Expenses & payroll
// ═════════════════════════════════════════════════════════════════════════════
export const listExpenses = async (req: Request, res: Response) => {
    const to = ISO.test(String(req.query.to)) ? String(req.query.to) : periodEnd(new Date().toISOString().slice(0, 7));
    const from = ISO.test(String(req.query.from)) ? String(req.query.from) : `${new Date().toISOString().slice(0, 7)}-01`;
    const list = await rows(sql`
        SELECT e.*, ad.name AS createdByName FROM finance_expenses e LEFT JOIN admins ad ON ad.id = e.created_by
        WHERE e.spent_on BETWEEN ${from} AND ${to} ORDER BY e.spent_on DESC, e.created_at DESC`);
    const locked = await lockedPeriods();
    const used = await rows(sql`SELECT DISTINCT branch, category FROM finance_expenses`);
    return SuccessResponse(res, {
        from, to,
        expenses: list.map((e) => ({
            id: e.id, spentOn: ymd(e.spent_on), branch: e.branch, category: e.category, amount: num(e.amount), payee: e.payee,
            method: e.method, approvedBy: e.approved_by, document: e.document, notes: e.notes, correctsId: e.corrects_id,
            createdBy: e.createdByName, createdAt: e.created_at,
            status: e.document && e.approved_by ? "complete" : "missing",
            locked: locked.has(String(ymd(e.spent_on)).slice(0, 7)),
        })),
        branches: [...new Set(used.map((u) => u.branch))].sort(),
        categories: [...new Set(["Rent", "Salaries", "Electricity", "Water", "Gas", "Internet", "Supplies", "Maintenance", "Transport", "Services", ...used.map((u) => u.category)])],
    });
};

export const createExpense = async (req: Request, res: Response) => {
    const b = req.body;
    await assertOpen(b.spentOn, "This expense");
    const id = randomUUID();
    const document = await saveDoc(req, b.document, "finance-docs");
    await db.insert(financeExpenses).values({ id, ...b, spentOn: b.spentOn as any, document, approvedBy: b.approvedBy || null, createdBy: me(req).id });
    return SuccessResponse(res, { message: document ? "Expense recorded" : "Expense recorded — it stays pending until its document is attached", id }, 201);
};

export const updateExpense = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [e] = await db.select().from(financeExpenses).where(eq(financeExpenses.id, id));
    if (!e) throw new NotFound("Expense not found");
    await assertOpen(ymd(e.spentOn), "This expense");
    const b = { ...req.body };
    if (b.spentOn) await assertOpen(b.spentOn, "The new date");
    if ("document" in b) b.document = await saveDoc(req, b.document, "finance-docs");
    await db.update(financeExpenses).set(b).where(eq(financeExpenses.id, id));
    return SuccessResponse(res, { message: "Expense saved" });
};

// POST /expenses/:id/correct — a correcting line (any sign) linked to the original; used for closed months
export const correctExpense = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [e] = await db.select().from(financeExpenses).where(eq(financeExpenses.id, id));
    if (!e) throw new NotFound("Expense not found");
    const b = req.body;
    await assertOpen(b.spentOn, "A correcting entry");
    const newId = randomUUID();
    const document = await saveDoc(req, b.document, "finance-docs");
    await db.insert(financeExpenses).values({
        id: newId, spentOn: b.spentOn, branch: e.branch, category: e.category, amount: b.amount, payee: e.payee, method: e.method,
        approvedBy: e.approvedBy, document, notes: `Correction of ${ymd(e.spentOn)} ${e.payee} (${e.amount}): ${b.notes}`,
        correctsId: e.id, createdBy: me(req).id,
    });
    return SuccessResponse(res, { message: "Correcting entry added", id: newId }, 201);
};

// ═════════════════════════════════════════════════════════════════════════════
// Teacher contracts & settlements
// ═════════════════════════════════════════════════════════════════════════════
const ofPeriod = (p: string) => ({ from: `${p}-01`, to: periodEnd(p) });
type Contract = { kind: "per_session" | "percent"; ratePerSession: number | null; percent: string | number | null; basis: string | null };
const computeDue = (c: Contract | null | undefined, sessionsHeld: number, base: number | null | undefined) => {
    if (!c) return null;
    if (c.kind === "per_session") return sessionsHeld * num(c.ratePerSession);
    if (base == null) return null; // % contracts need the month's base
    return Math.round((num(base) * num(c.percent)) / 100);
};

// GET /admin/finance/teachers?period=YYYY-MM
export const listTeacherSettlements = async (req: Request, res: Response) => {
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period)) ? String(req.query.period) : new Date().toISOString().slice(0, 7);
    const { from, to } = ofPeriod(period);
    const list = await rows(sql`
        SELECT t.id, t.name, t.email,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'scheduled'
             AND s.session_date BETWEEN ${from} AND ${to} AND s.session_date <= CURDATE()) AS held,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'scheduled'
             AND s.session_date BETWEEN ${from} AND ${to} AND s.session_date > CURDATE()) AS upcoming,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'cancelled'
             AND s.session_date BETWEEN ${from} AND ${to}) AS cancelled
        FROM teachers t ORDER BY t.name`);
    const contracts = await db.select().from(financeTeacherContracts);
    const settlements = await db.select().from(financeTeacherSettlements).where(eq(financeTeacherSettlements.period, period));
    const locked = (await lockedPeriods()).has(period);
    const out = list.map((t) => {
        const c = contracts.find((x) => x.teacherId === t.id) || null;
        const s = settlements.find((x) => x.teacherId === t.id) || null;
        const held = num(t.held);
        return {
            id: t.id, name: t.name, email: t.email, held, upcoming: num(t.upcoming), cancelled: num(t.cancelled),
            contract: c && { kind: c.kind, ratePerSession: c.ratePerSession, percent: c.percent == null ? null : Number(c.percent), basis: c.basis, contractRef: c.contractRef, notes: c.notes },
            preview: computeDue(c, held, s?.base),
            settlement: s && { id: s.id, sessions: s.sessions, base: s.base, due: s.due, paidOn: ymd(s.paidOn), paymentRef: s.paymentRef, proof: s.proof, savedAt: s.updatedAt },
        };
    });
    return SuccessResponse(res, { period, locked, teachers: out });
};

export const saveTeacherContract = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId);
    const [t] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.id, teacherId));
    if (!t) throw new NotFound("Teacher not found");
    const b = req.body;
    const values = {
        kind: b.kind, contractRef: b.contractRef, notes: b.notes || null, updatedBy: me(req).id,
        ratePerSession: b.kind === "per_session" ? b.ratePerSession : null,
        percent: b.kind === "percent" ? String(b.percent) : null,
        basis: b.kind === "percent" ? b.basis : null,
    };
    await db.insert(financeTeacherContracts).values({ teacherId, ...values }).onDuplicateKeyUpdate({ set: values });
    return SuccessResponse(res, { message: "Contract saved" });
};

// POST /teachers/:teacherId/settlement { period, base? } — freezes the month's due (until it is paid)
export const saveSettlement = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId);
    const { period, base } = req.body as { period: string; base?: number | null };
    await assertOpen(`${period}-01`, "This month");
    const [c] = await db.select().from(financeTeacherContracts).where(eq(financeTeacherContracts.teacherId, teacherId));
    if (!c) throw new BadRequest("This teacher has no contract on file — add it first (no default rate is ever used)");
    if (c.kind === "percent" && (base == null)) throw new BadRequest("Enter the month's revenue base for this % contract");
    const { from, to } = ofPeriod(period);
    const [h] = await rows(sql`SELECT COUNT(*) AS n FROM sessions WHERE teacher_id = ${teacherId} AND status = 'scheduled'
        AND session_date BETWEEN ${from} AND ${to} AND session_date <= CURDATE()`);
    const held = num(h?.n);
    const due = computeDue(c, held, base)!;
    const [existing] = await db.select().from(financeTeacherSettlements)
        .where(and(eq(financeTeacherSettlements.teacherId, teacherId), eq(financeTeacherSettlements.period, period)));
    if (existing?.paidOn) throw new BadRequest("This month is already paid — it can't be recalculated");
    const snapshot = { kind: c.kind, ratePerSession: c.ratePerSession, percent: c.percent, basis: c.basis, contractRef: c.contractRef };
    if (existing) {
        await db.update(financeTeacherSettlements).set({ sessions: held, base: base ?? null, due, contractSnapshot: snapshot }).where(eq(financeTeacherSettlements.id, existing.id));
    } else {
        await db.insert(financeTeacherSettlements).values({ id: randomUUID(), teacherId, period, sessions: held, base: base ?? null, due, contractSnapshot: snapshot, createdBy: me(req).id });
    }
    return SuccessResponse(res, { message: "Settlement saved", sessions: held, due });
};

export const paySettlement = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId);
    const b = req.body;
    await assertOpen(`${b.period}-01`, "This month");
    const [s] = await db.select().from(financeTeacherSettlements)
        .where(and(eq(financeTeacherSettlements.teacherId, teacherId), eq(financeTeacherSettlements.period, b.period)));
    if (!s) throw new BadRequest("Save the settlement for this month first");
    if (s.paidOn) throw new BadRequest("Already marked as paid");
    const proof = await saveDoc(req, b.proof, "finance-docs");
    if (!proof && !b.paymentRef) throw new BadRequest("Pay only with proof — attach the transfer or write its reference");
    await db.update(financeTeacherSettlements).set({ paidOn: b.paidOn, paymentRef: b.paymentRef, proof }).where(eq(financeTeacherSettlements.id, s.id));
    return SuccessResponse(res, { message: "Marked as paid" });
};

// ═════════════════════════════════════════════════════════════════════════════
// Month-end close
// ═════════════════════════════════════════════════════════════════════════════
const CLOSE_ITEMS = [
    { key: "reconciliation", label: "Daily reconciliations", owner: "Accounts manager", route: "/admin/payment/reconciliation" },
    { key: "unmatched", label: "Unmatched receipts", owner: "Collections officer", route: "/admin/payment/unmatched" },
    { key: "payments", label: "Payment receipts waiting for review", owner: "Collections officer", route: "/admin/payment/paymentrecharge" },
    { key: "adjustments", label: "Adjustments & discounts", owner: "Company manager", route: "/admin/payment/adjustments" },
    { key: "refunds", label: "Refunds & disputes", owner: "Company manager", route: "/admin/payment/refunds" },
    { key: "expenses", label: "Expenses & payroll documents", owner: "Branch admins", route: "/admin/payment/expenses" },
    { key: "teachers", label: "Teacher settlements", owner: "Accounts manager", route: "/admin/payment/teacher-settlements" },
];

async function openCounts(period: string): Promise<Record<string, number>> {
    const { from, to } = ofPeriod(period);
    const [c] = await rows(sql`SELECT
        (SELECT COUNT(*) FROM finance_reconciliations WHERE status = 'open' AND day BETWEEN ${from} AND ${to}) AS reconciliation,
        (SELECT COUNT(*) FROM finance_unmatched WHERE status = 'open' AND received_on <= ${to}) AS unmatched,
        (SELECT COUNT(*) FROM payment WHERE status = 'pending' AND isDeleted = 0 AND DATE(createdAt) <= ${to}) AS payments,
        (SELECT COUNT(*) FROM finance_adjustments WHERE status = 'pending' AND DATE(created_at) <= ${to}) AS adjustments,
        (SELECT COUNT(*) FROM finance_refunds WHERE status <> 'closed' AND requested_on <= ${to}) AS refunds,
        (SELECT COUNT(*) FROM finance_expenses WHERE spent_on BETWEEN ${from} AND ${to} AND (document IS NULL OR approved_by IS NULL OR approved_by = '')) AS expenses,
        (SELECT COUNT(*) FROM teachers t WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'scheduled' AND s.session_date BETWEEN ${from} AND ${to})
            AND NOT EXISTS (SELECT 1 FROM finance_teacher_settlements fs WHERE fs.teacher_id = t.id AND fs.period = ${period} AND fs.paid_on IS NOT NULL)) AS teachers`);
    return Object.fromEntries(CLOSE_ITEMS.map((i) => [i.key, num(c?.[i.key])]));
}

async function monthTotals(period: string) {
    const { from, to } = ofPeriod(period);
    const [t] = await rows(sql`SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM payment WHERE status = 'completed' AND isDeleted = 0 AND paymentMethodId <> 'wallet00-0000-4000-8000-000000000000' AND DATE(createdAt) BETWEEN ${from} AND ${to}) AS collected,
        (SELECT COALESCE(SUM(amount), 0) FROM finance_expenses WHERE spent_on BETWEEN ${from} AND ${to}) AS expenses,
        (SELECT COALESCE(SUM(due), 0) FROM finance_teacher_settlements WHERE period = ${period}) AS teacherDue,
        (SELECT COALESCE(SUM(amount), 0) FROM finance_unmatched WHERE status = 'open' AND received_on <= ${to}) AS unmatchedOpen`);
    return { collected: num(t?.collected), expenses: num(t?.expenses), teacherDue: num(t?.teacherDue), unmatchedOpen: num(t?.unmatchedOpen) };
}

// GET /admin/finance/close?period=YYYY-MM
export const getClose = async (req: Request, res: Response) => {
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period)) ? String(req.query.period) : new Date().toISOString().slice(0, 7);
    const counts = await openCounts(period);
    const states = await rows(sql`
        SELECT ci.item_key AS itemKey, ci.evidence, ci.reviewed_at AS reviewedAt, ci.approved_at AS approvedAt,
               r.name AS reviewedBy, a.name AS approvedBy
        FROM finance_close_items ci LEFT JOIN admins r ON r.id = ci.reviewed_by LEFT JOIN admins a ON a.id = ci.approved_by
        WHERE ci.period = ${period}`);
    const versions = await rows(sql`
        SELECT v.id, v.period, v.version, v.totals, v.note, v.approved_at AS approvedAt, a.name AS approvedBy
        FROM finance_close_versions v LEFT JOIN admins a ON a.id = v.approved_by ORDER BY v.period DESC, v.version DESC`);
    const locked = versions.some((v) => v.period === period);
    return SuccessResponse(res, {
        period, locked,
        items: CLOSE_ITEMS.map((i) => {
            const s = states.find((x) => x.itemKey === i.key);
            return { ...i, open: counts[i.key], evidence: s?.evidence ?? null, reviewedBy: s?.reviewedBy ?? null, reviewedAt: s?.reviewedAt ?? null, approvedBy: s?.approvedBy ?? null, approvedAt: s?.approvedAt ?? null };
        }),
        totals: await monthTotals(period),
        versions: versions.map((v) => ({ ...v, totals: typeof v.totals === "string" ? JSON.parse(v.totals) : v.totals })),
    });
};

// PUT /close/items { period, itemKey, evidence?, reviewed?, approved? }
export const updateCloseItem = async (req: Request, res: Response) => {
    const b = req.body as { period: string; itemKey: string; evidence?: string; reviewed?: boolean; approved?: boolean };
    if (!CLOSE_ITEMS.some((i) => i.key === b.itemKey)) throw new BadRequest("Unknown checklist item");
    await assertOpen(`${b.period}-01`, "This month");
    const [cur] = await db.select().from(financeCloseItems).where(and(eq(financeCloseItems.period, b.period), eq(financeCloseItems.itemKey, b.itemKey)));
    const set: Record<string, any> = {};
    if (b.evidence !== undefined) set.evidence = b.evidence || null;
    if (b.reviewed !== undefined) {
        Object.assign(set, b.reviewed ? { reviewedBy: me(req).id, reviewedAt: new Date() } : { reviewedBy: null, reviewedAt: null, approvedBy: null, approvedAt: null });
    }
    if (b.approved) {
        const reviewed = b.reviewed ?? Boolean(cur?.reviewedAt);
        if (!reviewed) throw new BadRequest("The accounts review comes before management approval");
        const open = (await openCounts(b.period))[b.itemKey];
        if (open > 0) throw new BadRequest(`${open} open item${open === 1 ? "" : "s"} left — fix them before approving`);
        Object.assign(set, { approvedBy: me(req).id, approvedAt: new Date() });
    } else if (b.approved === false) {
        Object.assign(set, { approvedBy: null, approvedAt: null });
    }
    if (cur) await db.update(financeCloseItems).set(set).where(eq(financeCloseItems.id, cur.id));
    else await db.insert(financeCloseItems).values({ id: randomUUID(), period: b.period, itemKey: b.itemKey, ...set });
    return SuccessResponse(res, { message: "Checklist updated" });
};

// POST /close/lock { period, note? } — all items approved → saves a read-only version; the month is locked
export const lockMonth = async (req: Request, res: Response) => {
    const { period, note } = req.body as { period: string; note?: string };
    const [v] = await rows(sql`SELECT MAX(version) AS v FROM finance_close_versions WHERE period = ${period}`);
    if (v?.v) throw new BadRequest(`${monthName(period)} is already closed`);
    if (period >= new Date().toISOString().slice(0, 7)) throw new BadRequest("Only a finished month can be closed");
    const approved = await rows(sql`SELECT item_key AS k FROM finance_close_items WHERE period = ${period} AND approved_at IS NOT NULL`);
    const missing = CLOSE_ITEMS.filter((i) => !approved.some((a) => a.k === i.key));
    if (missing.length) throw new BadRequest(`Not approved yet: ${missing.map((m) => m.label).join(", ")}`);
    const totals = await monthTotals(period);
    await db.insert(financeCloseVersions).values({ id: randomUUID(), period, version: 1, totals, note: note || null, approvedBy: me(req).id });
    return SuccessResponse(res, { message: `${monthName(period)} closed — it is now read-only`, totals }, 201);
};

// GET /admin/finance/summary — counts for the Finance overview / sidebar
export const getFinanceSummary = async (_req: Request, res: Response) => {
    const [c] = await rows(sql`SELECT
        (SELECT COUNT(*) FROM finance_reconciliations WHERE status = 'open') AS reconOpen,
        (SELECT COUNT(*) FROM finance_unmatched WHERE status = 'open') AS unmatchedOpen,
        (SELECT COUNT(*) FROM finance_adjustments WHERE status = 'pending') AS adjustmentsPending,
        (SELECT COUNT(*) FROM finance_refunds WHERE status <> 'closed') AS refundsOpen,
        (SELECT COUNT(*) FROM finance_expenses WHERE document IS NULL OR approved_by IS NULL OR approved_by = '') AS expensesMissing`);
    return SuccessResponse(res, Object.fromEntries(Object.entries(c || {}).map(([k, v]) => [k, num(v)])));
};

// ═════════════════════════════════════════════════════════════════════════════
// Deletes (admin "Delete" permission). Nothing dated inside a closed month can be deleted —
// a closed month is read-only; fix it with a correcting entry in an open month instead.
// ═════════════════════════════════════════════════════════════════════════════
export const deleteRefund = async (req: Request, res: Response) => {
    const [r] = await db.select().from(financeRefunds).where(eq(financeRefunds.id, String(req.params.id)));
    if (!r) throw new NotFound("Ticket not found");
    await assertOpen(ymd(r.requestedOn), "This ticket");
    await db.delete(financeRefunds).where(eq(financeRefunds.id, r.id));
    return SuccessResponse(res, { message: "Ticket deleted" });
};

export const deleteAdjustment = async (req: Request, res: Response) => {
    const [a] = await db.select().from(financeAdjustments).where(eq(financeAdjustments.id, String(req.params.id)));
    if (!a) throw new NotFound("Request not found");
    await assertOpen(ymd(a.implementedOn) || ymd(a.createdAt), "This request");
    await db.delete(financeAdjustments).where(eq(financeAdjustments.id, a.id));
    return SuccessResponse(res, { message: "Request deleted" });
};

export const deleteExpense = async (req: Request, res: Response) => {
    const [e] = await db.select().from(financeExpenses).where(eq(financeExpenses.id, String(req.params.id)));
    if (!e) throw new NotFound("Expense not found");
    await assertOpen(ymd(e.spentOn), "This expense");
    const [fix] = await db.select({ id: financeExpenses.id }).from(financeExpenses).where(eq(financeExpenses.correctsId, e.id)).limit(1);
    if (fix) throw new BadRequest("This line has a correcting entry — delete the correcting entry first");
    await db.delete(financeExpenses).where(eq(financeExpenses.id, e.id));
    return SuccessResponse(res, { message: "Expense deleted" });
};

/** Delete a teacher's saved settlement for one month (period YYYY-MM in the query). */
export const deleteSettlement = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId), period = String(req.query.period || "");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequest("period (YYYY-MM) is required");
    await assertOpen(`${period}-01`, "This settlement");
    const [s] = await db.select({ id: financeTeacherSettlements.id }).from(financeTeacherSettlements)
        .where(and(eq(financeTeacherSettlements.teacherId, teacherId), eq(financeTeacherSettlements.period, period)));
    if (!s) throw new NotFound("No settlement saved for that month");
    await db.delete(financeTeacherSettlements).where(eq(financeTeacherSettlements.id, s.id));
    return SuccessResponse(res, { message: "Settlement deleted" });
};

/** Remove a teacher's contract (rate or %). Saved settlements keep their amounts. */
export const deleteTeacherContract = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId);
    const [c] = await db.select({ teacherId: financeTeacherContracts.teacherId }).from(financeTeacherContracts).where(eq(financeTeacherContracts.teacherId, teacherId));
    if (!c) throw new NotFound("This teacher has no contract");
    await db.delete(financeTeacherContracts).where(eq(financeTeacherContracts.teacherId, teacherId));
    return SuccessResponse(res, { message: "Contract removed" });
};
