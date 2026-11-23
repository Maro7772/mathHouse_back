import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    getPackageBuyHistory,
    initiateAutomaticPackageBuy,
    requestPackageBuy,
    selectPaymentMethods,
    buyPackageWithWallet
} from "../../controllers/user/payment";

const router = Router();

router.get("/package-buy/history", catchAsync(getPackageBuyHistory));
router.post("/package-buy", catchAsync(requestPackageBuy));
router.post("/package-buy/automatic", catchAsync(initiateAutomaticPackageBuy));
router.post("/package-buy/wallet", catchAsync(buyPackageWithWallet));
router.get("/payment-methods", catchAsync(selectPaymentMethods));
export default router;