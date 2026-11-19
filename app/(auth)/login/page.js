import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  return (
    <>
      <div>
        <h1>Sign in</h1>
        <p className="lead">Welcome back. Your bot keeps running while you are away.</p>
      </div>
      <Suspense><AuthForm mode="login" /></Suspense>
      <p className="au-alt">New to Copixio? <a href="/signup">Create an account</a></p>
    </>
  );
}
