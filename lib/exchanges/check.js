// One key check for every exchange: { ok, env, usdtFree, ipRestricted } or { ok: false, error }.
import { checkKey as binanceCheck } from "./binance.js";
import { checkKey as kucoinCheck } from "./kucoin.js";
import { checkKey as ccxtCheck } from "./ccxt.js";

export function checkKeyFor(exchange, key, secret, passphrase) {
  if (exchange === "binance") return binanceCheck(key, secret);
  if (exchange === "kucoin") return kucoinCheck(key, secret, passphrase);
  return ccxtCheck(exchange, key, secret, passphrase);
}
