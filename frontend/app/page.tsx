"use client";

import { useRouter } from "next/navigation";
import { LandingView } from "@/components/landing-view";

export default function HomePage() {
  const router = useRouter();
  return (
    <LandingView
      isDemoMode
      onDemoLogin={() => router.push("/dashboard")}
    />
  );
}
