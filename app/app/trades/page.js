import ComingNext from "@/components/app/ComingNext";

export const metadata = { title: "Trades" };

export default function TradesPage() {
  return (
    <ComingNext
      title="Trades"
      lead="Every trade the bot placed, with the signal message it came from."
      points={[
        "Open trades with live profit and loss, and a button to close any of them.",
        "History by day, week and month, filtered by group and exchange.",
        "Each row links to the exact Telegram message that started it.",
      ]}
    />
  );
}
