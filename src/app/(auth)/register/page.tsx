import { redirect } from "next/navigation";

// Registration uses the same magic link / OAuth flow as login.
export default function RegisterPage() {
  redirect("/login");
}
