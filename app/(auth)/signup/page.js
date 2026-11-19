import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/app");
  return (
    <>
      <div>
        <h1>Create your account</h1>
        <p className="lead">Setup takes about ten minutes. You can start on a Binance demo account.</p>
      </div>
      <Suspense><AuthForm mode="signup" /></Suspense>
      <p className="au-alt">Already have an account? <a href="/login">Sign in</a></p>
      <p className="hint">By creating an account you accept the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
    </>
  );
}
