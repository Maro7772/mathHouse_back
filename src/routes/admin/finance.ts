import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { requirePermission } from "../../middlewares/requirePermission";
import { validate } from "../../middlewares/validation";
import * as c from "../../controllers/admin/finance";
import * as v from "../../validation/admin/finance";

// Admin → Payment → finance registers. Mounted at /admin/finance. Uses the "payments" permission module.
const router = Router();
const view = requirePermission("payments", "View");
const add = requirePermission("payments", "Add");
const edit = requirePermission("payments", "Edit");

router.get("/summary", view, catchAsync(c.getFinanceSummary));

router.get("/accounts", view, catchAsync(c.listAccounts));
router.post("/accounts", add, validate(v.accountSchema), catchAsync(c.createAccount));
router.put("/accounts/:id", edit, validate(v.accountSchema.partial()), catchAsync(c.updateAccount));
router.delete("/accounts/:id", requirePermission("payments", "Delete"), catchAsync(c.deleteAccount));

router.get("/reconciliation", view, catchAsync(c.listReconciliation));
router.get("/reconciliation/suggest", view, catchAsync(c.suggestReconciliation));
router.post("/reconciliation", add, validate(v.reconLineSchema), catchAsync(c.createReconLine));
router.put("/reconciliation/:id", edit, validate(v.reconUpdateSchema), catchAsync(c.updateReconLine));
router.post("/reconciliation/:id/reconcile", edit, validate(v.reconReconcileSchema), catchAsync(c.reconcileLine));
router.post("/reconciliation/:id/reopen", edit, catchAsync(c.reopenReconLine));
router.delete("/reconciliation/:id", requirePermission("payments", "Delete"), catchAsync(c.deleteReconLine));

router.get("/unmatched", view, catchAsync(c.listUnmatched));
router.post("/unmatched", add, validate(v.unmatchedSchema), catchAsync(c.createUnmatched));
router.put("/unmatched/:id", edit, validate(v.unmatchedSchema.partial()), catchAsync(c.updateUnmatched));
router.post("/unmatched/:id/resolve", edit, validate(v.unmatchedResolveSchema), catchAsync(c.resolveUnmatched));
router.delete("/unmatched/:id", requirePermission("payments", "Delete"), catchAsync(c.deleteUnmatched));

router.get("/adjustments", view, catchAsync(c.listAdjustments));
router.post("/adjustments", add, validate(v.adjustmentSchema), catchAsync(c.createAdjustment));
router.post("/adjustments/:id/decide", edit, validate(v.adjustmentDecideSchema), catchAsync(c.decideAdjustment));
router.post("/adjustments/:id/implemented", edit, validate(v.adjustmentImplementedSchema), catchAsync(c.markAdjustmentImplemented));
router.delete("/adjustments/:id", requirePermission("payments", "Delete"), catchAsync(c.deleteAdjustment));

router.get("/refunds", view, catchAsync(c.listRefunds));
router.post("/refunds", add, validate(v.refundSchema), catchAsync(c.createRefund));
router.put("/refunds/:id", edit, validate(v.refundUpdateSchema), catchAsync(c.updateRefund));
router.post("/refunds/:id/decide", edit, validate(v.refundDecideSchema), catchAsync(c.decideRefund));
router.post("/refunds/:id/close", edit, validate(v.refundCloseSchema), catchAsync(c.closeRefund));
router.delete("/refunds/:id", requirePermission("payments", "Delete"), catchAsync(c.deleteRefund));

router.get("/expenses", view, catchAsync(c.listExpenses));
router.post("/expenses", add, validate(v.expenseSchema), catchAsync(c.createExpense));
router.put("/expenses/:id", edit, validate(v.expenseUpdateSchema), catchAsync(c.updateExpense));
router.post("/expenses/:id/correct", add, validate(v.expenseCorrectSchema), catchAsync(c.correctExpense));
router.delete("/expenses/:id", requirePermission("payments", "Delete"), catchAsync(c.deleteExpense));

router.get("/teachers", view, catchAsync(c.listTeacherSettlements));
router.put("/teachers/:teacherId/contract", edit, validate(v.contractSchema), catchAsync(c.saveTeacherContract));
router.post("/teachers/:teacherId/settlement", edit, validate(v.settlementSchema), catchAsync(c.saveSettlement));
router.post("/teachers/:teacherId/settlement/pay", edit, validate(v.settlementPaySchema), catchAsync(c.paySettlement));
router.delete("/teachers/:teacherId/settlement", requirePermission("payments", "Delete"), catchAsync(c.deleteSettlement));
router.delete("/teachers/:teacherId/contract", requirePermission("payments", "Delete"), catchAsync(c.deleteTeacherContract));

router.get("/close", view, catchAsync(c.getClose));
router.put("/close/items", edit, validate(v.closeItemSchema), catchAsync(c.updateCloseItem));
router.post("/close/lock", edit, validate(v.closeLockSchema), catchAsync(c.lockMonth));

export default router;
