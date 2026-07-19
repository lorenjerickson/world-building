"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import type { WorldAsset } from "@/components/world-view";
import { deleteWorldArtifact } from "@/lib/artifact-deletion";

export function DashboardRoute() {
  const { user, isLoading } = useUser();
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

  if (isLoading || !user) return null;

  return (
    <DashboardView
      user={user}
      worldsHistory={worlds}
      onLogout={() => window.location.assign("/api/auth/logout")}
      onBeginWorldBuilding={(world) => router.push(world ? `/world/${encodeURIComponent(world.id)}` : "/world/new")}
      onDeleteWorld={async (world) => {
        await deleteWorldArtifact(world);
        setWorlds((items) => items.filter((item) => item.id !== world.id));
      }}
    />
  );
}
