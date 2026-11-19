import ComingNext from "@/components/app/ComingNext";

export const metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <ComingNext
      title="Billing"
      lead="Choose a plan and pay monthly in USDT."
      points={[
        "Pick Starter, Pro or Desk.",
        "Pay in USDT; the plan switches on as soon as the payment is confirmed.",
        "See your plan, renewal date and past payments.",
      ]}
    />
  );
}
