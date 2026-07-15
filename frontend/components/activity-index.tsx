"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WorldAsset } from "@/components/world-view";
import { DeleteArtifactButton } from "@/components/delete-artifact-button";
import { CampaignArtifact, deleteCampaignArtifact, deleteWorldArtifact, loadCampaignArtifacts } from "@/lib/artifact-deletion";

export function ActivityIndex({ type }: { type: "worlds" | "campaigns" | "sessions" }) {
  const [worlds, setWorlds] = useState<WorldAsset[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignArtifact[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorlds(JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]"));
    setCampaigns(loadCampaignArtifacts());
  }, []);
  const emptyMessage = type === "campaigns"
    ? "No campaigns have been created."
    : "No game sessions have been recorded.";

  return <main className="dashboard-container">
    <header className="dashboard-header"><div className="header-left"><span className="eyebrow">Chronicle index</span><h2>All {type}</h2></div><Link href="/dashboard" className="secondary-action">Back to dashboard</Link></header>
    <section className="card-surface"><div className="list-stack">
      {type === "worlds" && worlds.map((world) => <article className="list-item artifact-list-item" key={world.id}><Link href={`/world/${encodeURIComponent(world.id)}`}><strong>{world.name}</strong><span className="subtext">{world.description}</span></Link><div className="artifact-list-actions"><Link className="text-link" href={`/world/${encodeURIComponent(world.id)}`}>Open →</Link><DeleteArtifactButton artifactName={world.name} artifactType="world" onDelete={async () => { await deleteWorldArtifact(world); setWorlds((items) => items.filter((item) => item.id !== world.id)); setCampaigns(loadCampaignArtifacts()); }} /></div></article>)}
      {type === "worlds" && worlds.length === 0 && <div className="recent-empty"><p>No worlds have been created.</p><Link href="/world/new" className="primary-action">Create a world</Link></div>}
      {type === "campaigns" && campaigns.map((campaign) => <article className="list-item artifact-list-item" key={campaign.id}><div><strong>{campaign.title}</strong><span className="subtext">{campaign.system || campaign.summary || 'Campaign'}</span></div><DeleteArtifactButton artifactName={campaign.title} artifactType="campaign" onDelete={() => { deleteCampaignArtifact(campaign.id); setCampaigns((items) => items.filter((item) => item.id !== campaign.id)); }} /></article>)}
      {type === "campaigns" && campaigns.length === 0 && <div className="recent-empty"><p>{emptyMessage}</p></div>}
      {type === "sessions" && <div className="recent-empty"><p>{emptyMessage}</p></div>}
    </div></section>
  </main>;
}
