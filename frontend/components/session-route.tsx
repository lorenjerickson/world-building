"use client";

import Link from "next/link";
import { campaigns, sessions } from "@/data/recent-activity";

export function SessionRoute({ worldId, campaignId, sessionId }: { worldId: string; campaignId: string; sessionId: string }) {
  const session = sessions.find((candidate) => candidate.id === sessionId);
  const campaign = campaigns.find((candidate) => candidate.id === campaignId);
  return <main className="dashboard-container">
    <header className="dashboard-header"><div className="header-left"><span className="eyebrow">{campaign?.title || "Campaign"} / Session summary</span><h2>{session?.title || "Session"}</h2></div><Link className="secondary-action" href={`/world/${encodeURIComponent(worldId)}/campaign/${campaignId}`}>Back to campaign</Link></header>
    <article className="card-surface"><span className="recent-date">Played {session ? new Date(session.playedAt).toLocaleDateString() : "recently"}</span><p className="lore-body">{session?.summary || "No summary has been recorded for this session."}</p>{session && <><h3>Key moments</h3><ul>{session.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></>}</article>
  </main>;
}
