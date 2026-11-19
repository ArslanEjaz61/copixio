import ComingNext from "@/components/app/ComingNext";

export const metadata = { title: "Telegram groups" };

export default function TelegramPage() {
  return (
    <ComingNext
      title="Telegram groups"
      lead="Connect your Telegram account, choose the signal groups to follow and set rules for each one."
      points={[
        "Sign in with your phone number and the code Telegram sends you.",
        "Tick the groups and channels whose signals should be traded.",
        "For each group: exchange, size per trade, stop loss, take profit, max open trades and a daily loss limit.",
      ]}
    />
  );
}
