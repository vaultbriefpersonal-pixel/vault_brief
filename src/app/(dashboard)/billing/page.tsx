import { redirect } from "next/navigation";

// Public-goods pivot: VaultBrief is free — there is no billing surface.
// The old plan/USDC dashboard has been retired. Any bookmark or stale
// link to /billing lands on the projects list instead. (Stripe/Atlos
// integration code remains in the repo but dormant.)
export default function BillingPage() {
  redirect("/projects");
}
