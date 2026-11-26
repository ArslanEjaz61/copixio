// Favourite coins (27 Nov): shared by the web app and the trader worker (no secrets, no server-only imports).
// A coin is its base ticker. "1000PEPE" on Binance and "PEPE" in a Telegram post are the same coin, so both sides are
// compared without the 1000 / 1M prefix that some exchanges put in front of small coins.
export const normBase = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z])/, "");

// true when the signal's coin is in the user's favourites
export const isFav = (favCoins, base) => {
  const b = normBase(base);
  return !!b && (favCoins || []).some((c) => normBase(c) === b);
};

export const MAX_FAVS = 500;
