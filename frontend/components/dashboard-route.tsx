"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import type { WorldAsset } from "@/components/world-view";

export function DashboardRoute() {
  const { user } = useUser();
  const router = useRouter();
  const [worlds, setWorlds] = useState<WorldAsset[]>([]);
  useEffect(() => {
    try {
      // localStorage is the legacy persistence layer and is only available after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWorlds(JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]"));
    } catch {
      // The empty initial state is already the correct fallback for corrupt storage.
    }
  }, []);

  return (
    <DashboardView
      user={user || { name: "Demo GameMaster", email: "demo@aethelgard.net" }}
      worldsHistory={worlds}
      onLogout={() => router.push("/")}
      onBeginWorldBuilding={(world) => router.push(world ? `/world/${encodeURIComponent(world.id)}` : "/world/new")}
      onOpenCampaign={(worldId, campaignId) => router.push(`/world/${encodeURIComponent(worldId)}/campaign/${encodeURIComponent(campaignId)}`)}
    />
  );
}
