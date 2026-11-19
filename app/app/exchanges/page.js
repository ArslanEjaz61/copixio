import ComingNext from "@/components/app/ComingNext";

export const metadata = { title: "Exchanges" };

export default function ExchangesPage() {
  return (
    <ComingNext
      title="Exchanges"
      lead="Connect Binance (live or demo) and KuCoin with an API key that can trade but never withdraw."
      points={[
        "Paste your Binance or KuCoin API key and secret (KuCoin also needs its passphrase).",
        "Copixio tests the key, refuses it if withdrawals are allowed, and shows your free USDT balance.",
        "The secret is sealed with AES-256 and never shown again. Remove a key any time.",
      ]}
    />
  );
}
