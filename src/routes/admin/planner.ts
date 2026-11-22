import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { requirePermission } from "../../middlewares/requirePermission";
import { validate } from "../../middlewares/validation";
import {
    getTimetable, getFreeAt, getPlannerOptions, getCourseLessons, createPlannerSession, buildPlan, approvePlanSession, dispatchSessions, getPlanBudget, getPlanGroupSessions } from "../../controllers/admin/planner";
import {
    plannerCreateSessionSchema, plannerBuildPlanSchema, plannerDispatchSchema,
} from "../../validation/admin/planner";

// Admin → Live → Planner. Mounted at /admin/planner.
const router = Router();

router.get("/timetable", requirePermission("sessions", "View"), catchAsync(getTimetable));
router.get("/options", requirePermission("sessions", "View"), catchAsync(getPlannerOptions));
router.get("/courses/:courseId/lessons", requirePermission("sessions", "View"), catchAsync(getCourseLessons));
router.get("/free", requirePermission("sessions", "View"), catchAsync(getFreeAt));
router.post("/sessions", requirePermission("sessions", "Add"), validate(plannerCreateSessionSchema), catchAsync(createPlannerSession));
router.post("/sessions/:id/approve", requirePermission("sessions", "Edit"), catchAsync(approvePlanSession));
router.post("/dispatch", requirePermission("sessions", "Edit"), validate(plannerDispatchSchema), catchAsync(dispatchSessions));
router.get("/plans/:planId/budget", requirePermission("availability_plans", "View"), catchAsync(getPlanBudget));
router.get("/plans/:planId/group-sessions", requirePermission("availability_plans", "View"), catchAsync(getPlanGroupSessions));
router.post("/plans/:planId/build", requirePermission("availability_plans", "Edit"), validate(plannerBuildPlanSchema), catchAsync(buildPlan));

export default router;
