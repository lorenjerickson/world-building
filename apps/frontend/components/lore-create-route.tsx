"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Character, LocationNode, Organization, RelicItem, TimelineEvent, Triple, WorldAsset } from "@/components/world-view";

export type LoreType = "locations" | "characters" | "organizations" | "events" | "items";

const loreLabels: Record<LoreType, { singular: string; plural: string; endpoint: string; prompt: string }> = {
  locations: { singular: "location", plural: "Geography & Places", endpoint: "location", prompt: "Describe the place, its role in the world, its atmosphere, and what might draw adventurers there." },
  characters: { singular: "character", plural: "Characters", endpoint: "character", prompt: "Describe who this person is, what they want, and how they might help or complicate the party's plans." },
  organizations: { singular: "organization", plural: "Organizations & Factions", endpoint: "organization", prompt: "Describe this group's purpose, methods, influence, and relationship to other powers in the world." },
  events: { singular: "event", plural: "Timeline & Events", endpoint: "event", prompt: "Describe what happened, when it happened, who was involved, and why its consequences still matter." },
  items: { singular: "item", plural: "Items & Relics", endpoint: "item", prompt: "Describe the object, its history or powers, and why someone in the world would seek or fear it." },
};

export function LoreCreateRoute({ worldId, loreType, parentId }: { worldId: string; loreType: LoreType; parentId?: string }) {
  const router = useRouter();
  const labels = loreLabels[loreType];
  const [world, setWorld] = useState<WorldAsset>();
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const worlds: WorldAsset[] = JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorld(worlds.find((candidate) => candidate.id === worldId));
  }, [worldId]);

  const parent = useMemo(() => world?.locations?.find((location) => location.id === parentId), [parentId, world]);

  async function createLore(event: FormEvent) {
    event.preventDefault();
    if (!world || !prompt.trim()) return;
    setIsCreating(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/generate/world/${encodeURIComponent(world.id)}/${labels.endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, parentId }),
      });
      if (!response.ok) throw new Error("The chronicler could not create this entry.");
      const result = await response.json();
      if (result.status !== "success" || !result.element) throw new Error("The chronicler returned an incomplete entry.");
      const id = `${labels.endpoint}-${Date.now()}`;
      const base = { id, name: result.element.name, description: result.element.description };
      const updated: WorldAsset = { ...world, triples: [...(world.triples || []), ...((result.element.relations || []) as Triple[])] };
      // Put newly created lore first so it is immediately visible in the sidebar's
      // constrained lists, rather than below the scroll fold.
      if (loreType === "locations") updated.locations = [{ ...base, type: "Place", parentId } as LocationNode, ...(world.locations || [])];
      if (loreType === "characters") updated.characters = [{ ...base, locationId: parentId } as Character, ...(world.characters || [])];
      if (loreType === "organizations") updated.organizations = [{ ...base, type: "Faction", baseLocationId: parentId } as Organization, ...(world.organizations || [])];
      if (loreType === "events") updated.events = [{ ...base, year: "Undated" } as TimelineEvent, ...(world.events || [])];
      if (loreType === "items") updated.items = [{ ...base, type: "Relic", locationId: parentId } as RelicItem, ...(world.items || [])];

      const saveResponse = await fetch(`/api/generate/world/${encodeURIComponent(world.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            name: updated.name,
            locations: updated.locations,
            organizations: updated.organizations,
            events: updated.events,
            items: updated.items,
            triples: updated.triples,
            mapUrl: updated.mapUrl,
            mapDescription: updated.mapDescription,
            places: updated.locations?.map((location) => location.name) || [],
            characters: updated.characters || [],
          },
          description: updated.description,
          triples: updated.triples,
        }),
      });
      if (!saveResponse.ok) throw new Error("The entry was generated, but could not be saved to the world.");

      const worlds: WorldAsset[] = JSON.parse(localStorage.getItem("aethelgard_worlds") || "[]");
      localStorage.setItem("aethelgard_worlds", JSON.stringify([updated, ...worlds.filter((candidate) => candidate.id !== world.id)]));
      router.push(`/world/${encodeURIComponent(world.id)}/${loreType}/${encodeURIComponent(id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong while creating this entry.");
    } finally {
      setIsCreating(false);
    }
  }

  if (!world) return <main className="world-create-page"><section className="card-surface">Loading world context...</section></main>;

  return <main className="world-create-page">
    <section className="world-create-panel card-surface">
      <header className="world-create-header">
        <Link className="back-btn" href={`/world/${encodeURIComponent(world.id)}/${loreType}`}>← Back to {labels.plural}</Link>
        <span className="eyebrow">New {labels.singular}</span><h1>Create a {labels.singular}</h1>
        <p>{labels.prompt}</p>
      </header>
      <div className="world-create-grid">
        <form className="world-create-form" onSubmit={createLore}>
          <div className="world-prompt-field"><label htmlFor="lore-prompt">What should the chronicler add?</label><p id="lore-prompt-help">Focus on the details that matter at the table. The context shown alongside this form will be included automatically.</p><textarea id="lore-prompt" aria-describedby="lore-prompt-help" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={10} required placeholder={`Describe the ${labels.singular} you want to add...`} /></div>
          {error && <div className="error-banner"><strong>We couldn&apos;t create this {labels.singular}:</strong> {error}</div>}
          <div className="world-create-submit"><span>You can revise the generated details afterward.</span><button className="primary-action" disabled={isCreating || !prompt.trim()} type="submit">{isCreating ? "Creating..." : `Create ${labels.singular}`}</button></div>
        </form>
        <aside className="world-prompt-guide context-summary"><span className="eyebrow">Included context</span><h2>The chronicler will also know</h2><p>This information is supplied automatically, so you do not need to repeat it.</p><dl><div><dt>World</dt><dd>{world.name}</dd></div>{parent && <div><dt>Parent location</dt><dd>{parent.name} <span>{parent.type}</span></dd></div>}<div><dt>Existing lore</dt><dd>{world.locations?.length || 0} places, {world.characters?.length || 0} characters, {world.organizations?.length || 0} factions</dd></div><div><dt>World premise</dt><dd>{world.description}</dd></div></dl>{!parent && loreType === "locations" && <div className="prompt-tip"><strong>Top-level place</strong><p>This location will be created directly within the world. Use a plus beside an existing place to create a child location.</p></div>}</aside>
      </div>
    </section>
  </main>;
}
