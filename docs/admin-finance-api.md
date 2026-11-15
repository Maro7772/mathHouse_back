# Admin Finance API

Backend for the admin **Payment → finance** pages (MathPortal design, "Task H" accounting guide).
Controller: `src/controllers/admin/finance.ts` · Routes: `src/routes/admin/finance.ts` · Validation: `src/validation/admin/finance.ts`
· Tables: `src/models/schema/admin/finance.ts` · Migration: `drizzle/0022_finance.sql` (10 new `finance_*` tables, nothing else changed).

- Base path `/api/admin/finance`, admin token, `{ success, data }` envelope. Permission module **payments** (View / Add / Edit).
- Money is whole EGP (integers). Dates `YYYY-MM-DD`, months `YYYY-MM`.
- Validation errors: `400 { error: { message: "Validation failed", details: [{ field, message }] } }` — show `details[0].message`.
- Documents (expense documents, teacher payment proof): send a base64 data URL (`data:application/pdf;base64,…` or
  `data:image/png|jpeg|webp;base64,…`, ≤ ~10 MB) or an existing `https://` URL. Stored under `/uploads/finance-docs/`.

## Rules the API enforces
- **Records only.** Approving an adjustment or a refund never changes a wallet, balance or payment. Staff apply it by hand.
- **Closed months are read-only.** After a month is closed, anything dated in it (reconciliation lines, expenses,
  settlements, checklist) returns `400 "… is in <Month>, which is closed. Add a correcting entry …"`.
- **Nothing is deleted.** Expenses get *correcting entries* (`POST /expenses/:id/correct`); cases are resolved/closed with a written result.
- A reconciliation day with a variance can only be closed with a written explanation (`action`).
- An adjustment approval needs `approvedBy` + a written `approvalRef`; a rejection needs a reason.
- A refund ticket closes only after a written decision and the date the parent was told.
- A teacher settlement needs a contract on file (no default rate); paying needs a transfer reference or proof.
- Month-end: each checklist item needs an accounts review, then a management approval, and can only be approved when it has 0 open items.
  The month can be closed when all 7 items are approved (and the month is over).

## Endpoints

### Summary
`GET /summary` → `{ reconOpen, unmatchedOpen, adjustmentsPending, refundsOpen, expensesMissing }` (for badges).

### Accounts & channels
- `GET /accounts` → `{ accounts: [{ id, name, number, type (Bank|Wallet|Cash), owner, openingBalance, isActive, paymentMethodId, paymentMethodName, balance, lastReconciledDay, receipts7, payments7, openLines }] }`
  `balance` = last reconciliation line's actual (or the opening balance). `receipts7/payments7` = last 7 days of statement receipts / payments.
- `POST /accounts` `{ name, number?, type, owner?, openingBalance, paymentMethodId?, isActive? }` · `PUT /accounts/:id` (any subset).
  `paymentMethodId` links an existing payment method (`GET /api/admin/paymentMethod`): completed payments with that method are the account's "system receipts".

### Daily reconciliation
- `GET /reconciliation?from&to[&accountId]` (default last 14 days) → `{ from, to, lines: [{ id, accountId, accountName, day, opening, systemReceipts, statementReceipts, payments, expected, actual, variance, action, status (open|reconciled), reviewedBy, reviewedAt, locked }] }`
  `expected = opening + system − payments`, `actual = opening + statement − payments`, `variance = statement − system`.
- `GET /reconciliation/suggest?accountId&day` → `{ opening, systemReceipts, systemCount, linkedToPaymentMethod, existingLineId }` — prefill for a new line.
- `POST /reconciliation` `{ accountId, day, opening, systemReceipts, statementReceipts, payments, action? }` (one line per account per day).
- `PUT /reconciliation/:id` (numbers / action; not when reconciled — reopen first).
- `POST /reconciliation/:id/reconcile` `{ action? }` — closes the day (variance ≠ 0 needs an action). `POST /reconciliation/:id/reopen`.

### Unmatched receipts
- `GET /unmatched` → `{ cases: [{ id, receivedOn, amount, accountId, accountName, payer, possibleStudent, evidence, issue, owner, dueOn, resolution, matchedStudentId, matchedStudentName, status (open|resolved), resolvedBy, resolvedAt, createdAt }] }`
- `POST /unmatched` `{ receivedOn, amount, accountId?, payer, possibleStudent?, evidence?, issue, owner?, dueOn? }` · `PUT /unmatched/:id` (open cases only).
- `POST /unmatched/:id/resolve` `{ resolution, matchedStudentId? }` — resolution = the result + the final document.

### Adjustments & discounts
- `GET /adjustments` → `{ adjustments: [{ id, studentId, studentName, packageLabel, type, beforeValue, afterValue, reason, requestedBy, impact, status (pending|approved|rejected), approvedBy, approvalRef, decisionNote, implementedOn, decidedAt, log: [{ at, by, text }], createdAt }] }`
  `type`: Discount | Price change | Extension | Session waiver | Package change.
- `POST /adjustments` `{ studentId?, studentName, packageLabel?, type, beforeValue, afterValue, reason, requestedBy, impact? }`
- `POST /adjustments/:id/decide` `{ status: "approved", approvedBy, approvalRef, note?, implementedOn? }` or `{ status: "rejected", note }`
- `POST /adjustments/:id/implemented` `{ implementedOn }` (approved only).

### Refunds & disputes
- `GET /refunds` → `{ refunds: [{ id, studentId, studentName, parentName, type, requestedOn, amount, policy, evidence, reviewer, decision, financialEffect, notifiedOn, status (review|decided|closed), closedAt, log, createdAt }] }`
  `type`: Refund | Session dispute | Discount dispute | Package cancellation. `amount` is text ("1,150 EGP", "2 sessions").
- `POST /refunds` `{ studentId?, studentName, parentName?, type, requestedOn, amount, policy?, evidence?, reviewer? }` · `PUT /refunds/:id` (not closed).
- `POST /refunds/:id/decide` `{ decision, financialEffect?, reviewer? }` → status `decided`.
- `POST /refunds/:id/close` `{ notifiedOn }` (needs a decision).

### Expenses & payroll
- `GET /expenses?from&to` (default this month) → `{ from, to, expenses: [{ id, spentOn, branch, category, amount, payee, method, approvedBy, document, notes, correctsId, createdBy, createdAt, status (complete|missing), locked }], branches: [..used], categories: [..defaults + used] }`
  `status` = `complete` only with a document **and** an approver.
- `POST /expenses` `{ spentOn, branch, category, amount (>0), payee, method, approvedBy?, notes?, document? }`
- `PUT /expenses/:id` any subset (e.g. attach `document` later). Not in a closed month.
- `POST /expenses/:id/correct` `{ spentOn, amount (±, ≠0), notes, document? }` → a new line linked to the original (`correctsId`), dated in an open month.

### Teacher contracts & settlements
- `GET /teachers?period=YYYY-MM` → `{ period, locked, teachers: [{ id, name, email, held, upcoming, cancelled, contract: { kind, ratePerSession, percent, basis, contractRef, notes } | null, preview, settlement: { id, sessions, base, due, paidOn, paymentRef, proof, savedAt } | null }] }`
  `held` = scheduled (not cancelled) sessions dated in the month up to today. `preview` = due with the current contract (null for % contracts until a base is saved).
- `PUT /teachers/:teacherId/contract` `{ kind: "per_session", ratePerSession, contractRef, notes? }` or `{ kind: "percent", percent (0–100), basis: gross|net, contractRef, notes? }`
- `POST /teachers/:teacherId/settlement` `{ period, base? }` — saves (freezes) the month: sessions + due (per_session: held × rate; percent: base × % ). `base` is required for % contracts. Recalculating is allowed until paid.
- `POST /teachers/:teacherId/settlement/pay` `{ period, paidOn, paymentRef, proof? }`.

### Month-end close
- `GET /close?period=YYYY-MM` → `{ period, locked, items: [{ key, label, owner, route, open, evidence, reviewedBy, reviewedAt, approvedBy, approvedAt }], totals: { collected, expenses, teacherDue, unmatchedOpen }, versions: [{ id, period, version, totals, note, approvedAt, approvedBy }] }`
  Items (keys): `reconciliation` (open lines in the month), `unmatched` (open cases up to month end), `payments` (payment receipts still pending),
  `adjustments` (pending), `refunds` (not closed), `expenses` (lines in the month missing a document or approver),
  `teachers` (teachers with sessions in the month whose settlement isn't paid). `route` = admin page to fix it.
- `PUT /close/items` `{ period, itemKey, evidence?, reviewed?: bool, approved?: bool }` — un-reviewing also removes the approval.
- `POST /close/lock` `{ period, note? }` — needs all items approved and a finished month; saves version 1 with the totals and locks the month.
