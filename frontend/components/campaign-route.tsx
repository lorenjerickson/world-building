"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { WorldAsset } from "@/components/world-view";

const campaigns: Record<string, { title: string; system: string; activeSessions: number }> = {
  c1: { title: "The Shattered Crown", system: "D&D 5e", activeSessions: 12 },
  c2: { title: "Shadows of Aethelgard", system: "Pathfinder 2e", activeSessions: 8 },
  c3: { title: "Netrunner's Heist", system: "Cyberpunk RED", activeSessions: 4 },
};

export function CampaignRoute({ worldId, campaignId }: { worldId: string; campaignId: string }) {
  const [world, setWorld] = useState<WorldAsset>();
  useEffect(() => {
    const worlds: WorldAsset[] = JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorld(worlds.find((candidate) => candidate.id === worldId));
  }, [worldId]);
  const campaign = campaigns[campaignId];

  return (
    <main className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-left"><span className="eyebrow">{world?.name || "World"} / Campaign</span><h2>{campaign?.title || campaignId}</h2></div>
        <Link className="secondary-action" href={`/world/${encodeURIComponent(worldId)}`}>Back to world</Link>
      </header>
      <section className="dashboard-section card-surface">
        <h3>Campaign Chronicle</h3>
        <p className="subtext">{campaign ? `${campaign.system} · ${campaign.activeSessions} sessions` : "Campaign details"}</p>
        <p>This campaign is scoped to <strong>{world?.name || worldId}</strong>. Its URL now preserves both sides of that parent-child relationship.</p>
      </section>
    </main>
  );
}
