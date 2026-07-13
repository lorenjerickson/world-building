"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WorldView, type WorldAsset, type WorldTab } from "@/components/world-view";

export function WorldRoute({ worldId, tab = "overview", itemId = null }: {
  worldId?: string;
  tab?: WorldTab;
  itemId?: string | null;
}) {
  const router = useRouter();
  const [world, setWorld] = useState<WorldAsset | undefined>();
  const [loaded, setLoaded] = useState(!worldId);

  useEffect(() => {
    if (!worldId) return;
    try {
      const worlds: WorldAsset[] = JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]");
      setWorld(worlds.find((candidate) => candidate.id === worldId));
    } finally {
      setLoaded(true);
    }
  }, [worldId]);

  if (!loaded) return <div className="loading-screen"><p>Opening chronicle...</p></div>;
  if (worldId && !world) {
    return <div className="loading-screen"><p>That world is not in this chronicle.</p><button className="secondary-action" onClick={() => router.push("/dashboard")}>Back to dashboard</button></div>;
  }

  return <WorldView initialWorld={world} initialTab={tab} initialItemId={itemId} />;
}
