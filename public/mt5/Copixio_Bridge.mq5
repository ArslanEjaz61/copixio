//+------------------------------------------------------------------+
//| Copixio_Bridge.mq5                                                |
//| Free MetaTrader 5 bridge for Copixio (https://copixio.com).       |
//|                                                                  |
//| What it does: about once a second it sends Copixio a short report |
//| (your account, the positions and deals of its own trades) and     |
//| receives orders to place. The stop loss and take profit are set   |
//| on the position itself, so the broker keeps them even if this EA, |
//| your internet or Copixio goes down.                               |
//|                                                                  |
//| It only touches positions with its own magic number. It never     |
//| withdraws or transfers anything.                                  |
//+------------------------------------------------------------------+
#property copyright "Copixio"
#property link      "https://copixio.com"
#property version   "1.00"
#property description "Copixio bridge: places the orders your Copixio signal groups create."

#include <Trade\Trade.mqh>

input string InpServer    = "https://copixio.com"; // Copixio address
input string InpToken     = "";                    // Your private token (Copixio > Connections > MetaTrader 5)
input int    InpPollMs    = 1000;                  // How often to talk to Copixio (milliseconds)
input long   InpMagic     = 727001;                // Magic number of the trades this EA opens
input int    InpDeviation = 30;                    // Largest slippage allowed (points)
input string InpSuffix    = "";                    // Your broker's symbol suffix, if any (for example m or .pro)
input bool   InpAllowLive = false;                 // Allow trading on a REAL account (off = demo accounts only)

CTrade   g_trade;
string   g_results = "";        // result lines waiting to be sent
bool     g_busy = false;
datetime g_lastDeal = 0;        // time of the newest deal already reported
string   g_done[];              // ids of the orders already executed (never run one twice)
string   g_status = "";
datetime g_lastOk = 0;

//+------------------------------------------------------------------+
string Clean(string s)
  {
   StringReplace(s, "|", " ");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   return s;
  }
//+------------------------------------------------------------------+
void SetStatus(string s)
  {
   if(s == g_status)
      return;
   g_status = s;
   Comment("Copixio bridge\n", s);
   Print("Copixio: ", s);
  }
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpToken) != 64)
     {
      SetStatus("Paste your 64-character token in the EA inputs (Copixio > Connections > MetaTrader 5).");
      return(INIT_SUCCEEDED);
     }
   string key = "CX_LASTDEAL_" + (string)AccountInfoInteger(ACCOUNT_LOGIN);
   if(GlobalVariableCheck(key))
      g_lastDeal = (datetime)(long)GlobalVariableGet(key);
   else
      g_lastDeal = TimeCurrent() - 86400;
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpDeviation);
   EventSetMillisecondTimer(MathMax(500, InpPollMs));
   SetStatus("Starting. Allow WebRequest for " + InpServer + " in Tools > Options > Expert Advisors.");
   return(INIT_SUCCEEDED);
  }
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }
//+------------------------------------------------------------------+
void OnTimer()
  {
   if(g_busy || StringLen(InpToken) != 64)
      return;
   g_busy = true;
   Poll();
   g_busy = false;
  }
//+------------------------------------------------------------------+
bool AlreadyDone(string id)
  {
   for(int i = 0; i < ArraySize(g_done); i++)
      if(g_done[i] == id)
         return(true);
   return(false);
  }
//+------------------------------------------------------------------+
void RememberDone(string id)
  {
   int n = ArraySize(g_done);
   if(n >= 300)
     {
      for(int i = 1; i < n; i++)
         g_done[i - 1] = g_done[i];
      n--;
     }
   ArrayResize(g_done, n + 1);
   g_done[n] = id;
  }
//+------------------------------------------------------------------+
string BuildReport(datetime &newest)
  {
   string r = "";
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   r += "A|" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + "|" + Clean(AccountInfoString(ACCOUNT_SERVER)) + "|" + Clean(AccountInfoString(ACCOUNT_CURRENCY)) + "|" +
        DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + "|" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + "|" +
        (string)AccountInfoInteger(ACCOUNT_LEVERAGE) + "|" + (string)mode + "|" + Clean(AccountInfoString(ACCOUNT_NAME)) + "|" + (string)TerminalInfoInteger(TERMINAL_BUILD) + "\n";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      r += "P|" + (string)t + "|" + PositionGetString(POSITION_SYMBOL) + "|" + (string)PositionGetInteger(POSITION_TYPE) + "|" +
           DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + "|" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 8) + "|" +
           DoubleToString(PositionGetDouble(POSITION_SL), 8) + "|" + DoubleToString(PositionGetDouble(POSITION_TP), 8) + "|" +
           DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + "|" + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) + "|" +
           Clean(PositionGetString(POSITION_COMMENT)) + "|" + (string)(long)PositionGetInteger(POSITION_TIME) + "\n";
     }
   r += "PE\n";
   newest = g_lastDeal;
   if(HistorySelect(g_lastDeal - 5, TimeCurrent() + 60))
     {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong d = HistoryDealGetTicket(i);
         if(d == 0 || HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic)
            continue;
         long type = HistoryDealGetInteger(d, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
            continue;
         datetime dt = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
         if(dt > newest)
            newest = dt;
         r += "D|" + (string)d + "|" + (string)HistoryDealGetInteger(d, DEAL_POSITION_ID) + "|" + HistoryDealGetString(d, DEAL_SYMBOL) + "|" + (string)type + "|" +
              DoubleToString(HistoryDealGetDouble(d, DEAL_VOLUME), 2) + "|" + DoubleToString(HistoryDealGetDouble(d, DEAL_PRICE), 8) + "|" +
              DoubleToString(HistoryDealGetDouble(d, DEAL_PROFIT), 2) + "|" + DoubleToString(HistoryDealGetDouble(d, DEAL_COMMISSION), 2) + "|" +
              DoubleToString(HistoryDealGetDouble(d, DEAL_SWAP), 2) + "|" + (string)HistoryDealGetInteger(d, DEAL_REASON) + "|" +
              Clean(HistoryDealGetString(d, DEAL_COMMENT)) + "|" + (string)(long)dt + "|" + (string)HistoryDealGetInteger(d, DEAL_ENTRY) + "\n";
        }
     }
   r += g_results;
   return(r);
  }
//+------------------------------------------------------------------+
int Post(string body, string &resp)
  {
   char data[], res[];
   string rh;
   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0)
      ArrayResize(data, n - 1);
   string url = InpServer;
   while(StringLen(url) > 0 && StringGetCharacter(url, StringLen(url) - 1) == '/')
      url = StringSubstr(url, 0, StringLen(url) - 1);
   url += "/api/mt5/bridge";
   string headers = "Content-Type: text/plain\r\nAuthorization: Bearer " + InpToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", url, headers, 8000, data, res, rh);
   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014 || err == 4060)
         SetStatus("Not allowed to reach Copixio: add " + InpServer + " in Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
      else
         SetStatus("Cannot reach Copixio (error " + (string)err + "). Check your internet connection.");
      return(-1);
     }
   resp = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   return(code);
  }
//+------------------------------------------------------------------+
void Poll()
  {
   datetime newest = g_lastDeal;
   string body = BuildReport(newest);
   string sent = g_results;
   string resp = "";
   int code = Post(body, resp);
   if(code == -1)
      return;
   if(code == 401)
     {
      SetStatus("Copixio refused the token. Make a new one in Copixio > Connections > MetaTrader 5 and paste it in the EA inputs.");
      return;
     }
   if(code != 200)
     {
      SetStatus("Copixio answered " + (string)code + ". Trying again.");
      return;
     }
   // the report went through: its result lines and deals are not sent again
   if(sent == g_results)
      g_results = "";
   if(newest > g_lastDeal)
     {
      g_lastDeal = newest;
      GlobalVariableSet("CX_LASTDEAL_" + (string)AccountInfoInteger(ACCOUNT_LOGIN), (double)(long)newest);
     }
   g_lastOk = TimeLocal();
   bool tradeAllowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   SetStatus(tradeAllowed ? "Connected to Copixio. Waiting for signals." : "Connected, but AutoTrading is OFF. Switch on the AutoTrading button (and Allow Algo Trading in the EA properties).");
   bool ran = false;
   string lines[];
   int nl = StringSplit(resp, '\n', lines);
   for(int i = 0; i < nl; i++)
     {
      string line = lines[i];
      StringTrimRight(line);
      if(StringLen(line) < 3 || StringGetCharacter(line, 0) != 'C')
         continue;
      Execute(line);
      ran = true;
     }
   if(ran)
     {
      // send the results at once instead of waiting a second
      string r2 = "";
      datetime n2 = g_lastDeal;
      string b2 = BuildReport(n2);
      string s2 = g_results;
      if(Post(b2, r2) == 200 && s2 == g_results)
         g_results = "";
     }
  }
//+------------------------------------------------------------------+
void Result(string id, bool ok, string ticket, double price, double vol, string msg)
  {
   g_results += "R|" + id + "|" + (ok ? "ok" : "fail") + "|" + ticket + "|" + DoubleToString(price, 8) + "|" + DoubleToString(vol, 2) + "|" + Clean(msg) + "\n";
  }
//+------------------------------------------------------------------+
string ResolveSymbol(string canon)
  {
   string c = canon;
   StringToUpper(c);
   string tries[2];
   tries[0] = c + InpSuffix;
   tries[1] = c;
   for(int i = 0; i < 2; i++)
      if(StringLen(tries[i]) > 0 && SymbolSelect(tries[i], true))
         return(tries[i]);
   string best = "";
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
     {
      string nm = SymbolName(i, false);
      string up = nm;
      StringToUpper(up);
      if(StringFind(up, c) == 0 && (best == "" || StringLen(nm) < StringLen(best)))
         best = nm;
     }
   if(best != "" && SymbolSelect(best, true))
      return(best);
   return("");
  }
//+------------------------------------------------------------------+
double NormLots(string sym, double lots, bool &tooSmall)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double mn = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double mx = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0)
      step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   tooSmall = lots < mn;
   if(lots < mn)
      lots = mn;
   if(lots > mx)
      lots = mx;
   return(NormalizeDouble(lots, 2));
  }
//+------------------------------------------------------------------+
void Execute(string line)
  {
   string p[];
   int n = StringSplit(line, '|', p);
   if(n < 15)
      return;
   string id = p[1], kind = p[2];
   if(AlreadyDone(id))
      return;
   RememberDone(id);
   if(!(bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !(bool)MQLInfoInteger(MQL_TRADE_ALLOWED))
     {
      Result(id, false, "0", 0, 0, "AutoTrading is switched off in MetaTrader 5");
      return;
     }
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL && !InpAllowLive)
     {
      Result(id, false, "0", 0, 0, "This is a REAL account. Turn on AllowLive in the Copixio EA inputs to trade on it");
      return;
     }
   if(kind == "open")
      ExecOpen(id, p);
   else
      if(kind == "close")
         ExecClose(id, p);
      else
         if(kind == "modify")
            ExecModify(id, p);
         else
            Result(id, false, "0", 0, 0, "unknown order kind " + kind);
  }
//+------------------------------------------------------------------+
void ExecOpen(string id, string &p[])
  {
   string canon = p[3];
   string sym = ResolveSymbol(canon);
   if(sym == "")
     {
      Result(id, false, "0", 0, 0, "Symbol " + canon + " was not found at your broker (set the suffix input if your broker adds one)");
      return;
     }
   bool buy = (p[4] == "buy");
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK), bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double price = buy ? ask : bid;
   if(price <= 0)
     {
      Result(id, false, "0", 0, 0, "No price for " + sym + " (market closed?)");
      return;
     }
   double lots = StringToDouble(p[5]), risk = StringToDouble(p[6]);
   double sl = StringToDouble(p[7]), tp = StringToDouble(p[8]);
   double slPct = StringToDouble(p[9]), tpPct = StringToDouble(p[10]);
   double entry = StringToDouble(p[13]), gap = StringToDouble(p[14]);
   string comment = p[12];
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   // the price must not have run away from the signal's entry
   if(entry > 0 && gap > 0)
     {
      double ran = buy ? (price / entry - 1.0) * 100.0 : (1.0 - price / entry) * 100.0;
      if(ran > gap)
        {
         Result(id, false, "0", 0, 0, "Price " + DoubleToString(price, digits) + " already ran " + DoubleToString(ran, 2) + "% past the entry " + DoubleToString(entry, digits));
         return;
        }
     }
   if(sl <= 0 && slPct > 0)
      sl = buy ? price * (1.0 - slPct / 100.0) : price * (1.0 + slPct / 100.0);
   if(tp <= 0 && tpPct > 0)
      tp = buy ? price * (1.0 + tpPct / 100.0) : price * (1.0 - tpPct / 100.0);
   sl = (sl > 0) ? NormalizeDouble(sl, digits) : 0;
   tp = (tp > 0) ? NormalizeDouble(tp, digits) : 0;
   if(sl > 0 && ((buy && sl >= price) || (!buy && sl <= price)))
     {
      Result(id, false, "0", 0, 0, "Stop loss " + DoubleToString(sl, digits) + " is on the wrong side of the price " + DoubleToString(price, digits));
      return;
     }
   if(tp > 0 && ((buy && tp <= price) || (!buy && tp >= price)))
     {
      Result(id, false, "0", 0, 0, "Take profit " + DoubleToString(tp, digits) + " is on the wrong side of the price " + DoubleToString(price, digits));
      return;
     }
   if(risk > 0)
     {
      if(sl <= 0)
        {
         Result(id, false, "0", 0, 0, "Sizing by risk needs a stop loss");
         return;
        }
      double loss = 0;
      if(!OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, 1.0, price, sl, loss) || loss >= 0)
        {
         Result(id, false, "0", 0, 0, "Could not work out the lot size from the risk");
         return;
        }
      lots = risk / (-loss);
     }
   bool small = false;
   lots = NormLots(sym, lots, small);
   if(small && risk > 0)
     {
      Result(id, false, "0", 0, 0, "A risk of " + DoubleToString(risk, 2) + " is smaller than the smallest lot allows (" + DoubleToString(lots, 2) + ")");
      return;
     }
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpDeviation);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = buy ? g_trade.Buy(lots, sym, 0, sl, tp, comment) : g_trade.Sell(lots, sym, 0, sl, tp, comment);
   uint rc = g_trade.ResultRetcode();
   if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_PLACED && rc != TRADE_RETCODE_DONE_PARTIAL))
     {
      Result(id, false, "0", 0, 0, g_trade.ResultRetcodeDescription() + " (" + (string)rc + ")");
      return;
     }
   ulong deal = g_trade.ResultDeal();
   long posId = 0;
   if(deal > 0 && HistoryDealSelect(deal))
      posId = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
   if(posId == 0)
      posId = (long)g_trade.ResultOrder();
   double fill = g_trade.ResultPrice();
   if(fill <= 0)
      fill = price;
   double vol = g_trade.ResultVolume();
   if(vol <= 0)
      vol = lots;
   Result(id, true, (string)posId, fill, vol, "");
   Print("Copixio: opened ", buy ? "BUY " : "SELL ", DoubleToString(vol, 2), " ", sym, " at ", DoubleToString(fill, digits));
  }
//+------------------------------------------------------------------+
void ExecClose(string id, string &p[])
  {
   ulong ticket = (ulong)StringToInteger(p[11]);
   if(ticket == 0 || !PositionSelectByTicket(ticket))
     {
      Result(id, false, (string)ticket, 0, 0, "Position not found (already closed?)");
      return;
     }
   if(PositionGetInteger(POSITION_MAGIC) != InpMagic)
     {
      Result(id, false, (string)ticket, 0, 0, "That position does not belong to the Copixio EA");
      return;
     }
   string sym = PositionGetString(POSITION_SYMBOL);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = g_trade.PositionClose(ticket, InpDeviation);
   uint rc = g_trade.ResultRetcode();
   if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_DONE_PARTIAL))
     {
      Result(id, false, (string)ticket, 0, 0, g_trade.ResultRetcodeDescription() + " (" + (string)rc + ")");
      return;
     }
   Result(id, true, (string)ticket, g_trade.ResultPrice(), g_trade.ResultVolume(), "");
   Print("Copixio: closed position ", (string)ticket);
  }
//+------------------------------------------------------------------+
void ExecModify(string id, string &p[])
  {
   ulong ticket = (ulong)StringToInteger(p[11]);
   if(ticket == 0 || !PositionSelectByTicket(ticket) || PositionGetInteger(POSITION_MAGIC) != InpMagic)
     {
      Result(id, false, (string)ticket, 0, 0, "Position not found");
      return;
     }
   string sym = PositionGetString(POSITION_SYMBOL);
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double sl = StringToDouble(p[7]), tp = StringToDouble(p[8]);
   if(sl <= 0)
      sl = PositionGetDouble(POSITION_SL);
   if(tp <= 0)
      tp = PositionGetDouble(POSITION_TP);
   bool ok = g_trade.PositionModify(ticket, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits));
   if(!ok)
     {
      Result(id, false, (string)ticket, 0, 0, g_trade.ResultRetcodeDescription());
      return;
     }
   Result(id, true, (string)ticket, 0, 0, "");
  }
//+------------------------------------------------------------------+
