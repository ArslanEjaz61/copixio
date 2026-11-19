import { db } from "@/lib/db";
import { Exchange, Group, Telegram } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import { exchangeView, groupView } from "@/lib/views";
import TelegramClientUI from "@/components/app/TelegramClient";

export const metadata = { title: "Telegram groups" };
export const dynamic = "force-dynamic";

export default async function TelegramPage() {
  const user = await currentUser();
  await db();
  const [t, groups, exchanges] = await Promise.all([
    Telegram.findOne({ userId: user._id }).lean(),
    Group.find({ userId: user._id }).sort({ createdAt: 1 }).lean(),
    Exchange.find({ userId: user._id, status: "ok" }).sort({ createdAt: 1 }).lean(),
  ]);
  const tg = t ? { status: t.status, tgName: t.tgName || null, phone: t.phone ? t.phone.replace(/\d(?=\d{3})/g, "•") : null } : { status: "none" };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  return (
    <>
      <div className="ap-top"><div><h1>Telegram groups</h1><p>Connect Telegram, choose the groups to trade and set the money rules for each one.</p></div></div>
      <TelegramClientUI
        configured={!!(process.env.TG_API_ID && process.env.TG_API_HASH)}
        initialTelegram={tg}
        initialGroups={plain(groups.map(groupView))}
        exchanges={plain(exchanges.map(exchangeView))}
      />
    </>
  );
}
