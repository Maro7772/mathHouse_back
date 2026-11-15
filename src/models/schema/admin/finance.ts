// schema/admin/finance.ts
// Admin → Payment → finance registers (MathPortal design, Task H):
// receiving accounts + daily reconciliation, unmatched receipts, adjustments, refunds & disputes,
// expenses & payroll, teacher contracts + monthly settlements, month-end close.
// These are records: approving something here never changes a student's balance or a payment.
import {
    mysqlTable, char, varchar, text, timestamp, mysqlEnum, date, int, decimal, boolean, json, index, uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { admins } from "./admin";
import { teachers } from "./teacher";
import { Student } from "./Student";
import { paymentMethod } from "./paymentMethod";

/** One line of an audit trail kept on a record: who did what, when. */
export type FinanceLogEntry = { at: string; by: string; text: string };

/** Accounts that receive money: bank accounts, wallets, cash boxes. */
export const financeAccounts = mysqlTable("finance_accounts", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    number: varchar("number", { length: 255 }),
    type: mysqlEnum("type", ["Bank", "Wallet", "Cash"]).notNull(),
    owner: varchar("owner", { length: 255 }),
    openingBalance: int("opening_balance").notNull().default(0),
    // Payments recorded in the system with this payment method count as this account's "system receipts".
    paymentMethodId: char("payment_method_id", { length: 36 }).references(() => paymentMethod.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

/** Daily reconciliation: one line per account per day. */
export const financeReconciliations = mysqlTable("finance_reconciliations", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    accountId: char("account_id", { length: 36 }).notNull().references(() => financeAccounts.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    opening: int("opening").notNull().default(0),
    systemReceipts: int("system_receipts").notNull().default(0),
    statementReceipts: int("statement_receipts").notNull().default(0),
    payments: int("payments").notNull().default(0),
    action: text("action"),                    // what explains / fixes a variance
    status: mysqlEnum("status", ["open", "reconciled"]).notNull().default("open"),
    reviewedBy: char("reviewed_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    createdBy: char("created_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [uniqueIndex("finance_recon_account_day").on(t.accountId, t.day)]);

/** Money received that can't be tied to a student yet. */
export const financeUnmatched = mysqlTable("finance_unmatched", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    receivedOn: date("received_on").notNull(),
    amount: int("amount").notNull(),
    accountId: char("account_id", { length: 36 }).references(() => financeAccounts.id, { onDelete: "set null" }),
    payer: varchar("payer", { length: 255 }).notNull(),         // name / phone / reference on the transfer
    possibleStudent: varchar("possible_student", { length: 255 }),
    evidence: text("evidence"),
    issue: text("issue").notNull(),
    owner: varchar("owner", { length: 255 }),
    dueOn: date("due_on"),
    resolution: text("resolution"),
    matchedStudentId: char("matched_student_id", { length: 36 }).references(() => Student.id, { onDelete: "set null" }),
    status: mysqlEnum("status", ["open", "resolved"]).notNull().default("open"),
    resolvedBy: char("resolved_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at"),
    createdBy: char("created_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [index("finance_unmatched_status_idx").on(t.status)]);

/** Price changes, discounts, extensions, session waivers — each needs a written approval reference. */
export const financeAdjustments = mysqlTable("finance_adjustments", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    studentId: char("student_id", { length: 36 }).references(() => Student.id, { onDelete: "set null" }),
    studentName: varchar("student_name", { length: 255 }).notNull(),
    packageLabel: varchar("package_label", { length: 255 }),
    type: mysqlEnum("type", ["Discount", "Price change", "Extension", "Session waiver", "Package change"]).notNull(),
    beforeValue: varchar("before_value", { length: 255 }).notNull(),
    afterValue: varchar("after_value", { length: 255 }).notNull(),
    reason: text("reason").notNull(),
    requestedBy: varchar("requested_by", { length: 255 }).notNull(),
    impact: varchar("impact", { length: 255 }),
    status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"),
    approvedBy: varchar("approved_by", { length: 255 }),       // the person who approved in writing
    approvalRef: varchar("approval_ref", { length: 255 }),     // email / letter / ticket reference
    decisionNote: text("decision_note"),
    implementedOn: date("implemented_on"),
    decidedBy: char("decided_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),
    log: json("log").$type<FinanceLogEntry[]>(),
    createdBy: char("created_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [index("finance_adjustments_status_idx").on(t.status)]);

/** Refund requests and disputes (session counts, discounts, cancellations). */
export const financeRefunds = mysqlTable("finance_refunds", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    studentId: char("student_id", { length: 36 }).references(() => Student.id, { onDelete: "set null" }),
    studentName: varchar("student_name", { length: 255 }).notNull(),
    parentName: varchar("parent_name", { length: 255 }),
    type: mysqlEnum("type", ["Refund", "Session dispute", "Discount dispute", "Package cancellation"]).notNull(),
    requestedOn: date("requested_on").notNull(),
    amount: varchar("amount", { length: 255 }).notNull(),      // money or sessions, e.g. "1,150 EGP" / "2 sessions"
    policy: varchar("policy", { length: 255 }),
    evidence: text("evidence"),
    reviewer: varchar("reviewer", { length: 255 }),
    decision: text("decision"),
    financialEffect: varchar("financial_effect", { length: 255 }),
    notifiedOn: date("notified_on"),
    status: mysqlEnum("status", ["review", "decided", "closed"]).notNull().default("review"),
    closedAt: timestamp("closed_at"),
    log: json("log").$type<FinanceLogEntry[]>(),
    createdBy: char("created_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [index("finance_refunds_status_idx").on(t.status)]);

/** Expenses & payroll. A line without its document stays "missing document". */
export const financeExpenses = mysqlTable("finance_expenses", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    spentOn: date("spent_on").notNull(),
    branch: varchar("branch", { length: 255 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    amount: int("amount").notNull(),                            // negative = correcting entry
    payee: varchar("payee", { length: 255 }).notNull(),
    method: varchar("method", { length: 100 }).notNull(),
    approvedBy: varchar("approved_by", { length: 255 }),
    document: varchar("document", { length: 500 }),            // uploaded file URL
    notes: text("notes"),
    correctsId: char("corrects_id", { length: 36 }),            // a correcting entry points at the line it fixes
    createdBy: char("created_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [index("finance_expenses_day_idx").on(t.spentOn)]);

/** Written teacher contract: a fixed amount per held session, or a % of a monthly base. */
export const financeTeacherContracts = mysqlTable("finance_teacher_contracts", {
    teacherId: char("teacher_id", { length: 255 }).primaryKey().references(() => teachers.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", ["per_session", "percent"]).notNull(),
    ratePerSession: int("rate_per_session"),                    // EGP, when kind = per_session
    percent: decimal("percent", { precision: 5, scale: 2 }),    // when kind = percent
    basis: mysqlEnum("basis", ["gross", "net"]),               // what the % applies to (base is entered monthly)
    contractRef: varchar("contract_ref", { length: 255 }).notNull(),
    notes: text("notes"),
    updatedBy: char("updated_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

/** A teacher's due for one month, frozen when it is saved, and its payment proof. */
export const financeTeacherSettlements = mysqlTable("finance_teacher_settlements", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    teacherId: char("teacher_id", { length: 255 }).notNull().references(() => teachers.id, { onDelete: "cascade" }),
    period: char("period", { length: 7 }).notNull(),           // YYYY-MM
    sessions: int("sessions").notNull().default(0),
    base: int("base"),                                          // revenue base entered for % contracts
    due: int("due").notNull(),
    contractSnapshot: json("contract_snapshot"),
    paidOn: date("paid_on"),
    paymentRef: varchar("payment_ref", { length: 255 }),
    proof: varchar("proof", { length: 500 }),
    createdBy: char("created_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [uniqueIndex("finance_settlement_teacher_period").on(t.teacherId, t.period)]);

/** Month-end checklist progress per item. */
export const financeCloseItems = mysqlTable("finance_close_items", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    period: char("period", { length: 7 }).notNull(),
    itemKey: varchar("item_key", { length: 50 }).notNull(),
    evidence: text("evidence"),
    reviewedBy: char("reviewed_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    approvedBy: char("approved_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => [uniqueIndex("finance_close_item_period_key").on(t.period, t.itemKey)]);

/** Approved (read-only) versions of a closed month. A period with a version is locked. */
export const financeCloseVersions = mysqlTable("finance_close_versions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    period: char("period", { length: 7 }).notNull(),
    version: int("version").notNull(),
    totals: json("totals"),
    note: text("note"),
    approvedBy: char("approved_by", { length: 36 }).references(() => admins.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at").defaultNow(),
}, (t) => [uniqueIndex("finance_close_period_version").on(t.period, t.version)]);
