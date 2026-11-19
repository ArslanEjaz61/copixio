import ComingNext from "@/components/app/ComingNext";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ComingNext
      title="Settings"
      lead="Your account, security and notifications."
      points={[
        "Change your name, email and password.",
        "Turn on two-factor sign-in with an authenticator app.",
        "Choose which Telegram messages the bot sends you: entries, exits, daily summary.",
      ]}
    />
  );
}
