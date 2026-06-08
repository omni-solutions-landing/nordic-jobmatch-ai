import { redirect } from "next/navigation";

// Fallback redirect for root domain to Swedish default
export default function RootPage() {
  redirect("/sv");
}
