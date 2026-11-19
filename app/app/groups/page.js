import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Exchange, Group, Telegram } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import { exchangeView, groupView } from "@/lib/views";
import SignalGroups from "@/components/app/SignalGroups";

export const metadata = { title: "Signal groups" };
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const user = await currentUser();
  if (!user) redirect("/login"); // a stale cookie: the page renders beside the layout, so it checks too
  await db();
  const [t, groups, exchanges] = await Promise.all([
    Telegram.findOne({ userId: user._id, status: "connected" }, { _id: 1 }).lean(),
    Group.find({ userId: user._id }).sort({ createdAt: 1 }).lean(),
    Exchange.find({ userId: user._id, status: "ok" }).sort({ createdAt: 1 }).lean(),
  ]);
  const plain = (x) => JSON.parse(JSON.stringify(x));
  return (
    <>
      <div className="ap-top"><div><h1>Signal groups</h1><p>The Telegram groups the bot reads, and the money rules for each one.</p></div></div>
      <SignalGroups connected={!!t} initialGroups={plain(groups.map(groupView))} exchanges={plain(exchanges.map(exchangeView))} />
    </>
  );
}
