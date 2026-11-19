// What the browser may see of each record. Secrets and sessions never leave the server.
export const exchangeView = (x) => ({
  id: String(x._id), exchange: x.exchange, env: x.env, label: x.label || "", keyTail: x.keyTail, status: x.status,
  lastError: x.lastError || null, usdtFree: x.usdtFree ?? 0, ipRestricted: x.ipRestricted ?? null,
  checkedAt: x.checkedAt || null, createdAt: x.createdAt || null,
});

export const groupView = (g) => ({
  id: String(g._id), chatId: g.chatId, title: g.title, kind: g.kind, enabled: !!g.enabled,
  exchangeId: g.exchangeId ? String(g.exchangeId) : "", sizeMode: g.sizeMode, sizeUsdt: g.sizeUsdt, sizePercent: g.sizePercent,
  maxOpen: g.maxOpen, slMode: g.slMode, slPercent: g.slPercent, tpMode: g.tpMode, tpPercent: g.tpPercent, tpSplit: g.tpSplit,
  moveSlToEntry: !!g.moveSlToEntry, dailyLossUsdt: g.dailyLossUsdt, maxEntryGapPct: g.maxEntryGapPct,
});

export const tradeView = (t) => ({
  id: String(t._id), groupId: t.groupId ? String(t.groupId) : null, exchange: t.exchange, env: t.env, symbol: t.symbol, base: t.base,
  status: t.status, entryPrice: t.entryPrice ?? null, qty: t.qty ?? null, qtyLeft: t.qtyLeft ?? null, costUsdt: t.costUsdt ?? null,
  stopPrice: t.stopPrice ?? null, targets: (t.targets || []).map((x) => ({ price: x.price, share: x.share, done: !!x.done })),
  exitPrice: t.exitPrice ?? null, pnlUsdt: t.pnlUsdt ?? 0, feesUsdt: t.feesUsdt ?? 0, outcome: t.outcome || null, error: t.error || null,
  closeRequested: !!t.closeRequested, openedAt: t.openedAt || t.createdAt, closedAt: t.closedAt || null,
});
