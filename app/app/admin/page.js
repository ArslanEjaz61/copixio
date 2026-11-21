import { redirect } from "next/navigation";

// The admin area moved to its own panel at /admin.
export default function OldAdminPage() {
  redirect("/admin");
}
