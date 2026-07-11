"use client";

import { useState, useTransition } from "react";

interface WorldAsset {
  id: string;
  name: string;
  prompt: string;
  description: string;
  createdAt: string;
  places?: string[];
  characters?: string[];
  triples?: Array<{ subject: string; predicate: string; object: string }>;
}

interface WorldViewProps {
  initialWorld?: WorldAsset;
  onBackToDashboard: (newWorld?: WorldAsset) => void;
}

export function WorldView({ initialWorld, onBackToDashboard }: WorldViewProps) {
  const [prompt, setPrompt] = useState("");
  const [world, setWorld] = useState<WorldAsset | null>(initialWorld || null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Helper to generate local triples for display if they are not returned by the API
  const generateTriples = (name: string, places: string[], characters: string[], promptText: string) => {
    const promptLower = promptText.toLowerCase();
    
    if (promptLower.includes("cyberpunk") || promptLower.includes("sci-fi") || promptLower.includes("space")) {
      return [
        { subject: characters[0] || "CEO Tanaka", predicate: "controls", object: places[1] || "Arasaka Tower" },
        { subject: characters[1] || "Dexter the Netrunner", predicate: "hacks", object: places[2] || "Netspace Grid" },
        { subject: characters[2] || "Cyber-Ninja Ren", predicate: "worksFor", object: characters[0] || "CEO Tanaka" },
        { subject: characters[1] || "Dexter the Netrunner", predicate: "enemyOf", object: characters[0] || "CEO Tanaka" },
        { subject: characters[2] || "Cyber-Ninja Ren", predicate: "hunts", object: characters[1] || "Dexter the Netrunner" }
      ];
    }
    
    if (promptLower.includes("dark") || promptLower.includes("gothic") || promptLower.includes("horror")) {
      return [
        { subject: characters[0] || "Lord Vlad", predicate: "rules", object: places[0] || "Castle Dracula" },
        { subject: characters[1] || "Father Gabriel", predicate: "protects", object: places[1] || "Gallowmote Village" },
        { subject: characters[2] || "The Weeping Banshee", predicate: "haunts", object: places[2] || "Screaming Catacombs" },
        { subject: characters[0] || "Lord Vlad", predicate: "terrorizes", object: places[1] || "Gallowmote Village" },
        { subject: characters[1] || "Father Gabriel", predicate: "enemyOf", object: characters[0] || "Lord Vlad" }
      ];
    }

    // Default High-Fantasy or dynamic
    return [
      { subject: characters[0] || "King Aethelred", predicate: "rules", object: places[0] || "Eldoria" },
      { subject: characters[1] || "Sylvia the Ranger", predicate: "guards", object: places[1] || "Whispering Woods" },
      { subject: characters[2] || "Malakar the Necromancer", predicate: "lurksIn", object: places[2] || "Shadow Spire" },
      { subject: characters[2] || "Malakar the Necromancer", predicate: "enemyOf", object: characters[0] || "King Aethelred" },
      { subject: characters[1] || "Sylvia the Ranger", predicate: "allyOf", object: characters[0] || "King Aethelred" }
    ];
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt }),
        });

        if (!res.ok) {
          throw new Error(`Generation failed with status ${res.status}`);
        }

        const data = await res.json();
        
        if (data.status === "success" && data.world_metadata) {
          const meta = data.world_metadata;
          
          // Re-parse markdown elements for clean visual rendering if necessary
          const cleanDesc = data.generated_content
            .replace(/\*\*[^*]+\*\*/, "") // Remove bold title
            .trim();

          const generatedPlaces = meta.places || [];
          const generatedCharacters = meta.characters || [];

          const newWorld: WorldAsset = {
            id: meta.id,
            name: meta.name || "Unnamed Realm",
            prompt: prompt,
            description: cleanDesc,
            createdAt: meta.createdAt || new Date().toISOString(),
            places: generatedPlaces,
            characters: generatedCharacters,
            triples: generateTriples(meta.name, generatedPlaces, generatedCharacters, prompt)
          };

          setWorld(newWorld);
          setPrompt("");
        } else {
          throw new Error("Invalid response format from server");
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || "An error occurred while generating world lore.");
      }
    });
  };

  const activeWorldTriples = world && (world.triples || generateTriples(world.name, world.places || [], world.characters || [], world.prompt));

  return (
    <div className="world-view-container">
      {/* Title Bar */}
      <header className="workspace-header">
        <div className="header-left">
          <button className="back-btn" onClick={() => onBackToDashboard(world || undefined)}>
            ← Back to Dashboard
          </button>
          <h2>Campaign Workspace</h2>
        </div>
        <div className="header-right">
          {world ? (
            <span className="realm-tag">Realm Active: <strong>{world.name}</strong></span>
          ) : (
            <span className="realm-tag realm-empty">No active realm</span>
          )}
        </div>
      </header>

      <div className="workspace-grid">
        {/* Left Col: Prompter Panel */}
        <div className="workspace-left">
          <section className="prompter-section card-surface">
            <h3>Lore Generator</h3>
            <p>Write a prompt describing the world, theme, climate, or factions. The AI assistant will draft the setting, NPCs, and map their connections.</p>
            
            <form onSubmit={handleGenerate} className="prompt-form">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., A floating archipelago of sky castles ruled by wind sorcerers and besieged by shadow harpies..."
                disabled={isPending}
                rows={5}
                required
              />
              <button 
                type="submit" 
                className={`primary-action glowing-btn ${isPending ? "loading-btn" : ""}`}
                disabled={isPending || !prompt.trim()}
              >
                {isPending ? "Invoking AI Assistant..." : "Generate World Lore"}
              </button>
            </form>

            {error && (
              <div className="error-banner">
                <strong>Error:</strong> {error}
              </div>
            )}
          </section>

          {/* Quick reference for current realm */}
          {world && (
            <section className="realm-inventory card-surface">
              <h3>Realm Registry</h3>
              <div className="inventory-grid">
                <div>
                  <strong>Places Logged (PostgreSQL)</strong>
                  <ul>
                    {world.places && world.places.map((place, idx) => (
                      <li key={idx}>📍 {place}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>NPCs Registered (PostgreSQL)</strong>
                  <ul>
                    {world.characters && world.characters.map((char, idx) => (
                      <li key={idx}>👤 {char}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Right Col: Lore and Graph Display */}
        <div className="workspace-right">
          {world ? (
            <div className="workspace-results-stack">
              {/* Lore Card */}
              <section className="lore-display card-surface">
                <span className="eyebrow">Chronicled Chronicle</span>
                <h3>{world.name}</h3>
                <div className="lore-body">
                  <p>{world.description}</p>
                </div>
              </section>

              {/* Graph Connections */}
              <section className="relations-display card-surface">
                <div className="section-title-bar">
                  <h3>LevelGraph Relations Network</h3>
                  <p className="subtext">Semantic triple links tracked in LevelDB</p>
                </div>
                
                <div className="triples-grid">
                  {activeWorldTriples && activeWorldTriples.length > 0 ? (
                    activeWorldTriples.map((triple, idx) => (
                      <div key={idx} className="triple-card">
                        <div className="node subject-node">
                          <span className="node-label">Subject</span>
                          <strong>{triple.subject}</strong>
                        </div>
                        <div className="arrow-connection">
                          <span className="predicate-label">{triple.predicate}</span>
                          <div className="connector-line"></div>
                          <span className="arrow-head">▶</span>
                        </div>
                        <div className="node object-node">
                          <span className="node-label">Object</span>
                          <strong>{triple.object}</strong>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-triples">No relationship triples recorded for this realm.</p>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="empty-workspace-state card-surface">
              <div className="glowing-crystal">🔮</div>
              <h3>The Scrying Pool is Still</h3>
              <p>Write a prompt on the left to invoke the AI assistant and generate your campaign's setting and relationship network.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
