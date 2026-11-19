import { db } from "@/lib/db";
import { Exchange } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import { exchangeView } from "@/lib/views";
import ExchangesClient from "@/components/app/ExchangesClient";

export const metadata = { title: "Exchanges" };
export const dynamic = "force-dynamic";

export default async function ExchangesPage() {
  const user = await currentUser();
  await db();
  const list = (await Exchange.find({ userId: user._id }).sort({ createdAt: 1 }).lean()).map(exchangeView);
  return (
    <>
      <div className="ap-top"><div><h1>Exchanges</h1><p>Connect Binance (live or demo) or KuCoin. The key can trade but never withdraw.</p></div></div>
      <ExchangesClient initial={JSON.parse(JSON.stringify(list))} serverIp={process.env.SERVER_IP || "187.126.26.48"} />
    </>
  );
}
