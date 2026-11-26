import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getCurrencies } from "../../controllers/user/currency";

const router = Router();
// Currencies admin set up, with rates — the student site converts EGP prices for display
router.get("/", catchAsync(getCurrencies));
export default router;
