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
      <div className="ap-top"><div><h1>Favourites</h1><p>Pick the coins you want to trade. The bot ignores signals for every other coin.</p></div></div>
      <FavouritesClient initialFavs={user.favCoins || []} initialOnly={!!user.favOnly} />
    </>
  );
}
