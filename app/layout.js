import "./globals.css";

// Fonts load from Google Fonts in the browser (display=swap), not at build time: a build must never fail because a
// font server did not answer. Families: see DESIGN.md.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@600;700;800&family=Source+Sans+3:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

export const metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://copixio.com"),
  title: { default: "Copixio", template: "%s · Copixio" },
  description:
    "Copixio trades the Telegram signals you choose on your own Binance and KuCoin account, with your own size, stop loss and daily limits for every group.",
  icons: { icon: "/icon.svg" },
};

export const viewport = { themeColor: "#0E2238", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
