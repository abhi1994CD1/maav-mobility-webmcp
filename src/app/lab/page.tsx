import type { Metadata } from "next";
import { StressLabSpike } from "@/features/stress-lab/StressLabSpike";

export const metadata: Metadata = {
  title: "MAAV Stress Lab — Trusted WebMCP",
  description:
    "Six static browser-native tools backed by the trusted deterministic Stress Lab service.",
};

export default function StressLabPage() {
  return <StressLabSpike />;
}
