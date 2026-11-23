// utils/walletPay.ts
// Paying a Store order from the student's wallet balance.
//  • The money leaves the wallet at once (a "withdrawal" in the wallet's activity).
//  • A completed payment row is kept so the order shows in the student's order / package history and the
//    "already bought" checks keep working. Its method is the internal "Wallet" method below.
//  • The money already counted as income when the wallet was topped up, so totals of collected money leave
//    wallet-paid rows out (notWalletPaid) — otherwise it would be counted twice.
import { sql } from "drizzle-orm";
import { paymentMethod, wallet, walletTransaction } from "../models/schema";
import { BadRequest } from "../Errors";

/** Fixed id of the internal "Wallet" payment method (inactive, never offered as a normal method). */
export const WALLET_METHOD_ID = "wallet00-0000-4000-8000-000000000000";

/** SQL condition: this payment was not paid from the wallet. `col` = the payment's paymentMethodId column. */
export const notWalletPaid = (col: any) => sql`${col} <> ${WALLET_METHOD_ID}`;

/** Creates the internal Wallet method the first time it is needed. */
export async function ensureWalletMethod(tx: any) {
    const [found] = await tx.select({ id: paymentMethod.id }).from(paymentMethod).where(sql`${paymentMethod.id} = ${WALLET_METHOD_ID}`);
    if (!found) {
        await tx.insert(paymentMethod).values({
            id: WALLET_METHOD_ID, name: "Wallet", type: "Manual", isActive: false,
            description: "Paid from the student's wallet balance (internal — not offered at checkout)", logo: "",
        });
    }
}

/**
 * Takes `amount` from the student's wallet inside `tx` and records the withdrawal (linked to paymentId).
 * Refuses when the balance is too low. Returns the new balance.
 */
export async function takeFromWallet(tx: any, studentId: string, amount: number, paymentId: string | null) {
    const value = Math.round(Number(amount) || 0);
    const [w] = await tx.select({ id: wallet.id, balance: wallet.balance }).from(wallet).where(sql`${wallet.studentId} = ${studentId}`);
    if (!w) throw new BadRequest("You don't have a wallet yet — top it up first.");
    if (Number(w.balance) < value) throw new BadRequest(`Not enough in your wallet: you have ${w.balance} EGP and this costs ${value} EGP.`);
    if (value > 0) {
        // the balance check is repeated in the UPDATE so two orders at once can't overdraw the wallet
        const res: any = await tx.update(wallet).set({ balance: sql`${wallet.balance} - ${value}` })
            .where(sql`${wallet.id} = ${w.id} AND ${wallet.balance} >= ${value}`);
        const affected = Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows;
        if (affected === 0) throw new BadRequest("Your wallet balance changed — please try again.");
        await tx.insert(walletTransaction).values({ walletId: w.id, amount: value, type: "withdrawal", source: "Student", paymentId });
    }
    return Number(w.balance) - value;
}
