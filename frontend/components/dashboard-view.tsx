"use client";

import { useState } from "react";

interface UserProfile {
  name?: string | null;
  email?: string | null;
  picture?: string | null;
}

interface WorldAsset {
  id: string;
  name: string;
  prompt: string;
  description: string;
  createdAt: string;
  places?: string[];
  characters?: string[];
}

interface DashboardViewProps {
  user: UserProfile;
  onLogout: () => void;
  onBeginWorldBuilding: (existingWorld?: WorldAsset) => void;
  worldsHistory: WorldAsset[];
}

export function DashboardView({
  user,
  onLogout,
  onBeginWorldBuilding,
  worldsHistory,
}: DashboardViewProps) {
  // Mock campaigns & assets
  const [campaigns] = useState([
    { id: "c1", title: "The Shattered Crown", system: "D&D 5e", activeSessions: 12 },
    { id: "c2", title: "Shadows of Aethelgard", system: "Pathfinder 2e", activeSessions: 8 },
    { id: "c3", title: "Netrunner's Heist", system: "Cyberpunk RED", activeSessions: 4 }
  ]);

  const [assets] = useState([
    { id: "a1", type: "Faction", name: "The Obsidian Order", desc: "A cabal of dark mages trying to restore the Shattered Crown." },
    { id: "a2", type: "NPC", name: "Sylvia the Ranger", desc: "A veteran woodward protecting the Whispering Woods." },
    { id: "a3", type: "Relic", name: "Aethelred's Scepter", desc: "A golden staff containing a fragment of the primal wind crystal." }
  ]);

  const userName = user.name || user.email || "GameMaster";
  const userPic = user.picture || "https://api.dicebear.com/7.x/bottts/svg?seed=" + userName;

  return (
    <div className="dashboard-container">
      {/* Header bar */}
      <header className="dashboard-header">
        <div className="header-left">
          <span className="eyebrow">Guild Hall</span>
          <h2>Welcome back, {userName}</h2>
        </div>
        <div className="header-right">
          <div className="user-profile">
            <img src={userPic} alt={userName} className="user-avatar" />
            <div className="user-meta">
              <strong>{userName}</strong>
              <span>{user.email || "gm@aethelgard.net"}</span>
            </div>
          </div>
          <button className="secondary-action" onClick={onLogout}>
            Log Out
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Side: Campaign logs and Assets */}
        <div className="dashboard-left-col">
          {/* Campaigns */}
          <section className="dashboard-section card-surface">
            <div className="section-title-bar">
              <h3>Active Campaigns</h3>
              <span className="badge">{campaigns.length} campaigns</span>
            </div>
            <div className="list-stack">
              {campaigns.map((camp) => (
                <div key={camp.id} className="list-item">
                  <div>
                    <strong>{camp.title}</strong>
                    <span className="subtext">System: {camp.system}</span>
                  </div>
                  <span className="session-count">{camp.activeSessions} sessions</span>
                </div>
              ))}
            </div>
          </section>

          {/* Quick Assets */}
          <section className="dashboard-section card-surface">
            <div className="section-title-bar">
              <h3>Asset Library</h3>
              <span className="badge">{assets.length} items</span>
            </div>
            <div className="list-stack">
              {assets.map((asset) => (
                <div key={asset.id} className="list-item">
                  <div>
                    <span className="asset-type-pill">{asset.type}</span>
                    <strong>{asset.name}</strong>
                    <p className="item-description">{asset.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Side: World Chronicler logs */}
        <div className="dashboard-right-col">
          <section className="dashboard-section worlds-section card-surface">
            <div className="worlds-header">
              <div>
                <h3>World Chronicler Logs</h3>
                <p>AI-assisted world drafts and semantic graph nodes.</p>
              </div>
              <button
                className="primary-action glowing-btn"
                onClick={() => onBeginWorldBuilding()}
              >
                Begin World Building
              </button>
            </div>

            <div className="worlds-list">
              {worldsHistory.length === 0 ? (
                <div className="empty-worlds">
                  <p>No worlds logged in this chronicle yet.</p>
                  <button className="secondary-action" onClick={() => onBeginWorldBuilding()}>
                    Create Your First World
                  </button>
                </div>
              ) : (
                worldsHistory.map((world) => (
                  <div key={world.id} className="world-card">
                    <div className="world-card-body">
                      <div className="world-card-meta">
                        <span className="world-date">
                          {new Date(world.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h4>{world.name}</h4>
                      <p className="world-prompt">Prompt: "{world.prompt}"</p>
                      <p className="world-desc">{world.description}</p>
                      
                      <div className="world-entities-pills">
                        {world.places && world.places.map(p => (
                          <span key={p} className="pill place-pill">📍 {p}</span>
                        ))}
                        {world.characters && world.characters.map(c => (
                          <span key={c} className="pill char-pill">👤 {c}</span>
                        ))}
                      </div>
                    </div>
                    <div className="world-card-actions">
                      <button
                        className="secondary-action"
                        onClick={() => onBeginWorldBuilding(world)}
                      >
                        Open in Workspace
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
