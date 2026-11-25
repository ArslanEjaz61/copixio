// The exchanges Copixio trades on, for the server and the browser alike (no secrets here).
// binance / kucoin use their own clients; the rest go through ccxt (lib/exchanges/ccxt.js).
// guide: where the user makes a key. Every key needs spot trading ON and withdrawals OFF.
export const EXCHANGES = [
  { id: "binance", name: "Binance", mark: "BN", color: "#F0B90B", ink: "#14100A", demo: true,
    guide: ["Binance → Profile → API Management → Create API → System generated.", "Tick Enable Spot & Margin Trading. Leave Enable Withdrawals off.", "Restrict access to the IP shown here, or leave it unrestricted."] },
  { id: "kucoin", name: "KuCoin", mark: "KC", color: "#23AF91", pass: "Passphrase",
    guide: ["KuCoin → Account → API Management → Create API.", "Pick General + Spot Trading. Leave Transfer and Withdrawal off.", "Set your own passphrase and keep it: Copixio needs it too."] },
  { id: "okx", name: "OKX", mark: "OK", color: "#0B0B0B", pass: "Passphrase", ccxt: "okx",
    guide: ["OKX → Profile → API → Create API key (for trading).", "Permissions: Read + Trade. Leave Withdraw off.", "Add the IP shown here and set a passphrase you keep."] },
  { id: "bitget", name: "Bitget", mark: "BG", color: "#00C2C6", ink: "#062A2B", pass: "Passphrase", ccxt: "bitget",
    guide: ["Bitget → Profile → API Management → Create API → System-generated.", "Permissions: Read + Spot Trade. Leave Withdraw off.", "Bind the IP shown here and set a passphrase you keep."] },
  { id: "mexc", name: "MEXC", mark: "MX", color: "#1972F5", ccxt: "mexc",
    guide: ["MEXC → Profile → API Management → Create API.", "Tick Spot trading (View + Trade). Leave Withdraw off.", "Link the IP shown here."] },
  { id: "coinbase", name: "Coinbase", mark: "CB", color: "#0052FF", ccxt: "coinbase", keyLabel: "API key name", secretLabel: "Private key", longSecret: true,
    guide: ["Coinbase Developer Platform → API keys → Create API key (Coinbase App / Advanced Trade).", "Permissions: View + Trade. Leave Transfer off.", "Paste the key name (organizations/…/apiKeys/…) and the whole private key, including the BEGIN and END lines."] },
  { id: "kraken", name: "Kraken", mark: "KR", color: "#7132F5", ccxt: "kraken",
    guide: ["Kraken → Settings → API → Create API key.", "Permissions: Query Funds, Query/Create & Modify/Cancel Orders. Leave Withdraw Funds off.", "Add the IP shown here under IP restrictions."] },
  { id: "htx", name: "HTX", mark: "HT", color: "#2F7BE5", ccxt: "htx",
    guide: ["HTX → Account → API Management → Create API key.", "Permissions: Read + Trade. Leave Withdraw off.", "Bind the IP shown here."] },
  { id: "bitfinex", name: "Bitfinex", mark: "BF", color: "#16B157", ccxt: "bitfinex",
    guide: ["Bitfinex → Account → API Keys → Create New Key.", "Turn on Orders (Read + Write) and Wallets (Read). Leave Withdrawals off.", "Add the IP shown here as an allowed IP."] },
  // 25 Nov: MetaTrader 5 through the free Copixio EA (an Expert Advisor running in the user's own terminal).
  // No API key: the EA polls Copixio with a private token (lib/mt5.js, /api/mt5/bridge). Forex, gold, indices, crypto CFDs.
  { id: "mt5", name: "MetaTrader 5", mark: "M5", color: "#1F6FEB", bridge: true,
    guide: ["Download the Copixio EA (button above) and copy it into MetaTrader 5 → File → Open Data Folder → MQL5 → Experts.",
      "In MetaTrader 5: Tools → Options → Expert Advisors → tick Allow WebRequest for listed URL and add https://copixio.com.",
      "Drag the EA onto any chart, paste your token in its inputs, and switch AutoTrading on. Keep the terminal running."] },
  { id: "upbit", name: "Upbit", mark: "UP", color: "#093687", ccxt: "upbit",
    guide: ["Upbit → My Page → Open API Management.", "Tick View assets and Place orders. Leave Withdraw off.", "Upbit only allows listed IPs: add the IP shown here. Copixio trades the coin's USDT market."] },
];

export const EXCHANGE_IDS = EXCHANGES.map((x) => x.id);
// 24 Nov: exchanges whose USDT perpetual futures Copixio trades (lib/exchanges/futures.js)
export const FUTURES_IDS = ["binance", "kucoin", "okx", "bitget", "htx"];
export const exchangeMeta = (id) => EXCHANGES.find((x) => x.id === id) || { id, name: id, mark: "?", color: "#5A6B7B" };
export const exchangeName = (id, env) => exchangeMeta(id).name + (env === "demo" ? " demo" : "");
