"use client";

import { useEffect } from "react";
import { setWebMcpStatus } from "@/state/runtime";

export function WebMcpBridge() {
  useEffect(() => {
    setWebMcpStatus(
      "UNAVAILABLE",
      "Legacy tools retired — use the MAAV Stress Lab at /lab.",
    );
  }, []);

  return null;
}
