import { Brand } from "@/components/Logo";

export default function LegalLayout({ children }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 80px", display: "grid", gap: 20 }}>
      <Brand href="/" />
      <article style={{ display: "grid", gap: 14 }}>{children}</article>
    </div>
  );
}
