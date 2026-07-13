"use client";

import Link from "next/link";
import type { WorldAsset } from "@/components/world-view";
import { campaigns, sessions, worldIdForIndex } from "@/data/recent-activity";

interface UserProfile { name?: string | null; email?: string | null; picture?: string | null; }
interface DashboardViewProps {
  user: UserProfile;
  onLogout: () => void;
  onBeginWorldBuilding: (existingWorld?: WorldAsset) => void;
  worldsHistory: WorldAsset[];
  onOpenCampaign: (worldId: string, campaignId: string) => void;
}

function worldChangeSummary(world: WorldAsset) {
  const counts = [
    `${world.locations?.length || world.places?.length || 0} locations`,
    `${world.characters?.length || 0} characters`,
    `${world.organizations?.length || 0} factions`,
  ];
  return `Latest chronicle contains ${counts.join(", ")}.`;
}

export function DashboardView({ user, onLogout, onBeginWorldBuilding, worldsHistory, onOpenCampaign }: DashboardViewProps) {
  const userName = user.name || user.email || "GameMaster";
  const userPic = user.picture || "https://api.dicebear.com/7.x/bottts/svg?seed=" + userName;
  const recentWorlds = worldsHistory.slice(0, 3);
  const worldIds = worldsHistory.map((world) => world.id);
  const campaignCreationHref = worldIds[0] ? `/world/${encodeURIComponent(worldIds[0])}/campaign/new` : "/world/new";

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-left"><span className="eyebrow">Guild Hall</span><h2>Welcome back, {userName}</h2></div>
        <div className="header-right">
          <div className="user-profile"><img src={userPic} alt={userName} className="user-avatar" /><div className="user-meta"><strong>{userName}</strong><span>{user.email || "gm@aethelgard.net"}</span></div></div>
          <button className="secondary-action" onClick={onLogout}>Log Out</button>
        </div>
      </header>

      <main className="activity-dashboard-grid">
        <div className="activity-dashboard-main">
        <section className="dashboard-section card-surface activity-section">
          <div className="recent-section-header">
            <div><span className="eyebrow">Worldbuilding</span><h3>Worlds</h3><p>The latest changes across your world chronicles.</p></div>
            <div className="section-actions"><Link href="/worlds" className="secondary-action">All worlds</Link><button className="primary-action" onClick={() => onBeginWorldBuilding()}>New world</button></div>
          </div>
          <div className="entity-rows">
            {recentWorlds.length ? recentWorlds.map((world) => (
              <article className="entity-row" key={world.id}>
                <span className="entity-meta">Updated {new Date(world.createdAt).toLocaleDateString()}</span>
                <button className="entity-title-link" onClick={() => onBeginWorldBuilding(world)}>{world.name}</button>
                <p>{worldChangeSummary(world)}</p>
              </article>
            )) : <div className="recent-empty"><p>No worlds yet. Create one to begin a chronicle.</p></div>}
          </div>
        </section>

        <section className="dashboard-section card-surface activity-section">
          <div className="recent-section-header">
            <div><span className="eyebrow">Adventures</span><h3>Campaigns</h3><p>Campaigns with the latest changed prep and lore.</p></div>
            <div className="section-actions"><Link href="/campaigns" className="secondary-action">All campaigns</Link><Link href={campaignCreationHref} className="primary-action">New campaign</Link></div>
          </div>
          <div className="entity-rows">
            {campaigns.slice(0, 3).map((campaign, index) => {
              const worldId = worldIdForIndex(worldIds, index);
              return <article className="entity-row" key={campaign.id}>
                <span className="entity-meta">Updated {new Date(campaign.updatedAt).toLocaleDateString()} · {campaign.system}</span>
                {worldId ? <button className="entity-title-link" onClick={() => onOpenCampaign(worldId, campaign.id)}>{campaign.title}</button> : <Link className="entity-title-link" href="/world/new">{campaign.title}</Link>}
                <p>{campaign.changeSummary}</p>
              </article>;
            })}
          </div>
        </section>
        </div>

        <section className="dashboard-section card-surface activity-section sessions-section">
          <div className="recent-section-header">
            <div><span className="eyebrow">At the table</span><h3>Game sessions</h3><p>The latest play summaries across all campaigns.</p></div>
            <div className="section-actions"><Link href="/sessions" className="secondary-action">All sessions</Link></div>
          </div>
          <div className="entity-rows">
            {sessions.slice(0, 3).map((session, index) => {
              const worldId = worldIdForIndex(worldIds, index);
              return <article className="entity-row" key={session.id}>
                <span className="entity-meta">Played {new Date(session.playedAt).toLocaleDateString()} · {campaigns.find((campaign) => campaign.id === session.campaignId)?.title}</span>
                {worldId ? <Link className="entity-title-link" href={`/world/${encodeURIComponent(worldId)}/campaign/${session.campaignId}/session/${session.id}`}>{session.title}</Link> : <Link className="entity-title-link" href="/world/new">{session.title}</Link>}
                <p>{session.summary}</p>
              </article>;
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
