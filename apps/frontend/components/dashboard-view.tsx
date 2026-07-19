"use client";

import Link from "next/link";
import Image from "next/image";
import type { WorldAsset } from "@/components/world-view";
import { RuleSetDashboardSection } from "@/components/rule-set-dashboard-section";
import { DeleteArtifactButton } from "@/components/delete-artifact-button";

interface UserProfile { sub?: string | null; name?: string | null; email?: string | null; picture?: string | null; }
interface DashboardViewProps {
  user: UserProfile;
  onLogout: () => void;
  onBeginWorldBuilding: (existingWorld?: WorldAsset) => void;
  worldsHistory: WorldAsset[];
  onDeleteWorld: (world: WorldAsset) => Promise<void>;
}

function worldChangeSummary(world: WorldAsset) {
  const counts = [
    `${world.locations?.length || world.places?.length || 0} locations`,
    `${world.characters?.length || 0} characters`,
    `${world.organizations?.length || 0} factions`,
  ];
  return `Latest chronicle contains ${counts.join(", ")}.`;
}

export function DashboardView({ user, onLogout, onBeginWorldBuilding, onDeleteWorld, worldsHistory }: DashboardViewProps) {
  const userName = user.name || user.email || user.sub || "Authenticated user";
  const userInitial = userName.trim().charAt(0).toUpperCase() || "?";
  const recentWorlds = worldsHistory.slice(0, 3);

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-left"><span className="eyebrow">Guild Hall</span><h2>Welcome back, {userName}</h2></div>
        <div className="header-right">
          <div className="user-profile">{user.picture ? <Image unoptimized src={user.picture} alt={userName} width={48} height={48} className="user-avatar" /> : <span className="user-avatar user-avatar-initial" aria-hidden="true">{userInitial}</span>}<div className="user-meta"><strong>{userName}</strong>{user.email && <span>{user.email}</span>}</div></div>
          <button className="secondary-action" onClick={onLogout}>Log Out</button>
        </div>
      </header>

      <main className="activity-dashboard-grid">
        <div className="activity-dashboard-main">
        <RuleSetDashboardSection />
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
                <DeleteArtifactButton artifactName={world.name} artifactType="world" onDelete={() => onDeleteWorld(world)} />
              </article>
            )) : <div className="recent-empty"><p>No worlds yet. Create one to begin a chronicle.</p></div>}
          </div>
        </section>

        <section className="dashboard-section card-surface activity-section">
          <div className="recent-section-header">
            <div><span className="eyebrow">Adventures</span><h3>Campaigns</h3><p>Campaigns with the latest changed prep and lore.</p></div>
            <div className="section-actions"><Link href="/campaigns" className="secondary-action">All campaigns</Link></div>
          </div>
          <div className="entity-rows">
            <div className="recent-empty"><p>No campaigns have been created.</p></div>
          </div>
        </section>
        </div>

        <section className="dashboard-section card-surface activity-section sessions-section">
          <div className="recent-section-header">
            <div><span className="eyebrow">At the table</span><h3>Game sessions</h3><p>The latest play summaries across all campaigns.</p></div>
            <div className="section-actions"><Link href="/sessions" className="secondary-action">All sessions</Link></div>
          </div>
          <div className="entity-rows">
            <div className="recent-empty"><p>No game sessions have been recorded.</p></div>
          </div>
        </section>
      </main>
    </div>
  );
}
