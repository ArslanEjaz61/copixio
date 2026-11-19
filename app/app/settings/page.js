import { currentUser } from "@/lib/auth";
import SettingsClient from "@/components/app/SettingsClient";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  return (
    <>
      <div className="ap-top"><div><h1>Settings</h1><p>The bot switch, notifications and your account.</p></div></div>
      <SettingsClient name={user.name || ""} email={user.email} paused={!!user.botPaused} notifyOn={!!user.notifyChatId}
        notifyAvailable={!!(process.env.TG_BOT_TOKEN && process.env.TG_BOT_USERNAME)} />
    </>
  );
}
