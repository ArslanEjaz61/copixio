export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p>We store your name, email, a hash of your password, your encrypted exchange API keys, your encrypted Telegram session and the trades the bot places for you. API secrets and the Telegram session are encrypted with AES-256 and are never shown again.</p>
      <p>We read new messages only in the Telegram groups you select, and only to find trading signals. We never send messages from your account and never sell your data.</p>
      <p>The full privacy policy will be published here before paid plans open.</p>
    </>
  );
}
