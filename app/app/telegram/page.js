import { redirect } from "next/navigation";

// Telegram sign-in is on Connections; groups and rules are on Signal groups.
export default function TelegramPage() {
  redirect("/app/groups");
}
