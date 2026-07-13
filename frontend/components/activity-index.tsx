"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WorldAsset } from "@/components/world-view";
import { campaigns, sessions, worldIdForIndex } from "@/data/recent-activity";

export function ActivityIndex({ type }: { type: "worlds" | "campaigns" | "sessions" }) {
  const [worlds, setWorlds] = useState<WorldAsset[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorlds(JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]"));
  }, []);
  const worldIds = worlds.map((world) => world.id);

  return <main className="dashboard-container">
    <header className="dashboard-header"><div className="header-left"><span className="eyebrow">Chronicle index</span><h2>All {type}</h2></div><Link href="/dashboard" className="secondary-action">Back to dashboard</Link></header>
    <section className="card-surface"><div className="list-stack">
      {type === "worlds" && worlds.map((world) => <Link className="list-item" href={`/world/${encodeURIComponent(world.id)}`} key={world.id}><div><strong>{world.name}</strong><span className="subtext">{world.description}</span></div><span className="text-link">Open →</span></Link>)}
      {type === "campaigns" && campaigns.map((campaign, index) => { const worldId = worldIdForIndex(worldIds, index); return <Link className="list-item" href={worldId ? `/world/${encodeURIComponent(worldId)}/campaign/${campaign.id}` : "/world/new"} key={campaign.id}><div><strong>{campaign.title}</strong><span className="subtext">{campaign.system} · {campaign.changeSummary}</span></div><span className="text-link">Open →</span></Link>; })}
      {type === "sessions" && sessions.map((session, index) => { const worldId = worldIdForIndex(worldIds, index); return <Link className="list-item" href={worldId ? `/world/${encodeURIComponent(worldId)}/campaign/${session.campaignId}/session/${session.id}` : "/world/new"} key={session.id}><div><strong>{session.title}</strong><span className="subtext">{session.summary}</span></div><span className="text-link">Read →</span></Link>; })}
    </div></section>
  </main>;
}
