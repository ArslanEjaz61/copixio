import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import FavouritesClient from "@/components/app/FavouritesClient";

export const metadata = { title: "Favourites" };
export const dynamic = "force-dynamic";

export default async function FavouritesPage() {
  const user = await currentUser();
  if (!user) redirect("/login"); // a stale cookie: the page renders beside the layout, so it checks too
  return (
    <>
      <div className="ap-top"><div><h1>Favourites</h1><p>Star the coins you want the bot to trade. Search any coin from Binance, KuCoin or your connected exchanges.</p></div></div>
      <FavouritesClient initialFavs={user.favCoins || []} initialOnly={!!user.favOnly} />
    </>
  );
}
