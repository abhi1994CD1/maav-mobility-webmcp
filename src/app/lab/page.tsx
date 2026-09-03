import type { Metadata } from "next";
import { StressLab } from "@/features/stress-lab/StressLab";

export const metadata: Metadata = {
  title: "maav | Neo / Lab",
  description:
    "A synthetic deterministic mobility resilience workbench with trusted evidence and visible human review.",
};

export default function StressLabPage() {
  return <StressLab />;
}
