import { db } from "@/lib/db";
import { Exchange, Telegram } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import { exchangeView } from "@/lib/views";
import ConnectionsClient from "@/components/app/ConnectionsClient";

export const metadata = { title: "Connections" };
export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await currentUser();
  await db();
  const [ex, t] = await Promise.all([
    Exchange.find({ userId: user._id }).sort({ createdAt: 1 }).lean(),
    Telegram.findOne({ userId: user._id }).lean(),
  ]);
  const tg = t ? { status: t.status, tgName: t.tgName || null, phone: t.phone ? t.phone.replace(/\d(?=\d{3})/g, "•") : null } : { status: "none" };
  return (
    <>
      <div className="ap-top"><div><h1>Connections</h1><p>Your exchange accounts and your Telegram. Keys can trade but never withdraw.</p></div></div>
      <ConnectionsClient
        initialExchanges={JSON.parse(JSON.stringify(ex.map(exchangeView)))}
        initialTelegram={tg}
        serverIp={process.env.SERVER_IP || "187.126.26.48"}
        configured={!!(process.env.TG_API_ID && process.env.TG_API_HASH)}
      />
    </>
  );
}
