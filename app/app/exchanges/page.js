import { redirect } from "next/navigation";

// Exchanges now live on the Connections page.
export default function ExchangesPage() {
  redirect("/app/connections");
}
