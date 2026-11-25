// What the browser may see of each record. Secrets and sessions never leave the server.
export const exchangeView = (x) => ({
  id: String(x._id), exchange: x.exchange, env: x.env, label: x.label || "", keyTail: x.keyTail, status: x.status,
  lastError: x.lastError || null, usdtFree: x.usdtFree ?? 0, ipRestricted: x.ipRestricted ?? null,
  checkedAt: x.checkedAt || null, createdAt: x.createdAt || null,
  bridge: x.exchange === "mt5" ? {
    online: !!x.bridge?.lastSeenAt && Date.now() - new Date(x.bridge.lastSeenAt).getTime() < 45000,
    lastSeenAt: x.bridge?.lastSeenAt || null, login: x.bridge?.login || null, server: x.bridge?.server || null, currency: x.bridge?.currency || null,
    balance: x.bridge?.balance ?? null, equity: x.bridge?.equity ?? null, leverage: x.bridge?.leverage ?? null, accountName: x.bridge?.accountName || null,
  } : null,
});

export const groupView = (g) => ({
  id: String(g._id), chatId: g.chatId, title: g.title, kind: g.kind, enabled: !!g.enabled,
  exchangeId: g.exchangeId ? String(g.exchangeId) : "", sizeMode: g.sizeMode, sizeUsdt: g.sizeUsdt, sizePercent: g.sizePercent,
  maxOpen: g.maxOpen, slMode: g.slMode, slPercent: g.slPercent, tpMode: g.tpMode, tpPercent: g.tpPercent, tpSplit: g.tpSplit,
  moveSlToEntry: !!g.moveSlToEntry, dailyLossUsdt: g.dailyLossUsdt, maxEntryGapPct: g.maxEntryGapPct,
  market: g.market || "spot", leverage: g.leverage || 5, lots: g.lots || 0.01, riskUsd: g.riskUsd || 0,
});

export const tradeView = (t) => ({
  id: String(t._id), groupId: t.groupId ? String(t.groupId) : null, exchange: t.exchange, env: t.env, symbol: t.symbol, base: t.base,
  status: t.status, entryPrice: t.entryPrice ?? null, qty: t.qty ?? null, qtyLeft: t.qtyLeft ?? null, costUsdt: t.costUsdt ?? null,
  stopPrice: t.stopPrice ?? null, targets: (t.targets || []).map((x) => ({ price: x.price, share: x.share, done: !!x.done })),
  exitPrice: t.exitPrice ?? null, pnlUsdt: t.pnlUsdt ?? 0, feesUsdt: t.feesUsdt ?? 0, outcome: t.outcome || null, error: t.error || null,
  closeRequested: !!t.closeRequested, openedAt: t.openedAt || t.createdAt, closedAt: t.closedAt || null,
  market: t.market || "spot", side: t.side || "long", leverage: t.leverage || null, marginUsdt: t.marginUsdt ?? null,
  floating: t.mt5?.floating ?? null,
});
