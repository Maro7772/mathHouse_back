import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { authorizeRoles } from "../../middlewares/authorized";
import { getUpcomingSessions, getSessionHistory, getSessionDetails, joinSession } from "../../controllers/user/Attends";
import { listMyCancelRequests, requestSessionCancel, withdrawCancelRequest } from "../../controllers/user/portal";

const router = Router();

router.use(authorizeRoles("student"));

router.get("/upcoming", catchAsync(getUpcomingSessions));
router.get("/history", catchAsync(getSessionHistory));

// Cancel requests (close 24 h before the session starts)
router.get("/cancel-requests", catchAsync(listMyCancelRequests));
router.delete("/cancel-requests/:id", catchAsync(withdrawCancelRequest));
router.post("/:sessionId/cancel-request", catchAsync(requestSessionCancel));

router.get("/:sessionId", catchAsync(getSessionDetails));
router.post("/:sessionId/join", catchAsync(joinSession));

export default router;
