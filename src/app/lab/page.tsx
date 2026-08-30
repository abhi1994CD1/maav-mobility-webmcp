import type { Metadata } from "next";
import { StressLabSpike } from "@/features/stress-lab/StressLabSpike";

export const metadata: Metadata = {
  title: "MAAV Stress Lab — Gate 2 Agency Proof",
  description:
    "An isolated browser-native WebMCP integration proof using provisional synthetic state.",
};

export default function StressLabPage() {
  return <StressLabSpike />;
}
