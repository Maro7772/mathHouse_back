// The student site shows prices in the student's own currency. Prices are stored in EGP; these are the
// currencies admin set up (Settings → Currency) with their rates against the base currency.
import { Request, Response } from "express";
import { asc } from "drizzle-orm";
import { db } from "../../models/connection";
import { Currency } from "../../models/schema/admin/currency";
import { SuccessResponse } from "../../utils/response";

// GET /api/user/currencies → { currencies: [{ code, symbol, name, rate, isBase }] }  rate = units of it per 1 base
export const getCurrencies = async (_req: Request, res: Response) => {
    const list = await db
        .select({ code: Currency.code, symbol: Currency.symbol, name: Currency.name, rate: Currency.exchangeRate, isBase: Currency.isBase })
        .from(Currency)
        .orderBy(asc(Currency.code));
    return SuccessResponse(res, {
        currencies: list
            .filter((c) => Number(c.rate) > 0)
            .map((c) => ({ ...c, code: String(c.code).toUpperCase(), rate: Number(c.rate), isBase: Boolean(c.isBase) })),
    });
};
