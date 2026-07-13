"use client";

import { useState, useTransition, useEffect, useRef, useDeferredValue } from "react";
import { useRouter } from "next/navigation";
import { LoreDocument, MarkdownLongText, type LoreFact, type LoreReference } from "@/components/lore-document";
import { deleteLoreImage, uploadLoreImage } from "@/lib/image-uploads";
import { CharacterArtwork } from "@/components/character-artwork";

// --- Data Interfaces ---
export interface LocationNode {
  id: string;
  name: string;
  type: string; // Continent, Region, City, District, Building, Landmark, etc.
  description: string;
  parentId?: string;
  x?: number; // Map X coord (%)
  y?: number; // Map Y coord (%)
  mapUrl?: string;
  mapDescription?: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  locationId?: string;
  factionId?: string;
  portraitUrl?: string;
  tokenUrl?: string;
}

export interface Organization {
  id: string;
  name: string;
  type: string; // Guild, Megacorp, Order, Cult, Syndicate, etc.
  description: string;
  baseLocationId?: string;
}

export interface TimelineEvent {
  id: string;
  name: string;
  year: string;
  description: string;
}

export interface RelicItem {
  id: string;
  name: string;
  type: string; // Weapon, Relic, Tech, Cyberware, Key Item, etc.
  description: string;
  locationId?: string;
}

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

export interface WorldAsset {
  id: string;
  name: string;
  prompt: string;
  description: string;
  createdAt: string;
  places?: string[]; // compatibility
  characters?: (Character | string)[]; // compatibility with legacy string entries
  mapUrl?: string;
  mapDescription?: string;
  locations?: LocationNode[];
  organizations?: Organization[];
  events?: TimelineEvent[];
  items?: RelicItem[];
  triples?: Triple[];
}

interface WorldViewProps {
  initialWorld?: WorldAsset;
  onBackToDashboard?: (newWorld?: WorldAsset) => void;
  initialTab?: WorldTab;
  initialItemId?: string | null;
}

export type WorldTab = "overview" | "map" | "locations" | "characters" | "organizations" | "events" | "items" | "relations";

export function WorldView({ initialWorld, onBackToDashboard, initialTab = "overview", initialItemId = null }: WorldViewProps) {
  const router = useRouter();
  // --- Prompt / World Creation State ---
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // --- World State ---
  const [world, setWorld] = useState<WorldAsset | null>(initialWorld || null);
  const [isSaving, setIsSaving] = useState(false);

  // --- Active Tab / Selected Item State ---
  const [activeTab, setActiveTab] = useState<WorldTab>(initialTab);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId);
  const [loreSearch, setLoreSearch] = useState("");
  const deferredLoreSearch = useDeferredValue(loreSearch);
  const [expandedLoreSections, setExpandedLoreSections] = useState<Record<"locations" | "characters" | "organizations" | "events" | "items", boolean>>({
    locations: true,
    characters: true,
    organizations: initialTab === "organizations",
    events: initialTab === "events",
    items: initialTab === "items",
  });
  const toggleLoreSection = (section: keyof typeof expandedLoreSections) => setExpandedLoreSections((current) => ({ ...current, [section]: !current[section] }));

  // Keep the workspace addressable and browser-history friendly. The route is the
  // source of truth on initial render; interactions below update it in one place.
  useEffect(() => {
    if (!world) return;
    const itemPath = selectedItemId ? `/${encodeURIComponent(selectedItemId)}` : "";
    const path = activeTab === "overview"
      ? `/world/${encodeURIComponent(world.id)}`
      : `/world/${encodeURIComponent(world.id)}/${activeTab}${itemPath}`;
    router.replace(path, { scroll: false });
  }, [activeTab, selectedItemId, router, world]);

  useEffect(() => {
    setActiveTab(initialTab);
    setSelectedItemId(initialItemId);
  }, [initialItemId, initialTab]);

  // --- AI Co-pilot State ---
  const [aiElementType, setAiElementType] = useState<"location" | "character" | "organization" | "event" | "item">("character");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiDraft, setAiDraft] = useState<{
    name: string;
    description: string;
    relations: Triple[];
  } | null>(null);

  // --- Form Input States ---
  // Shared edit inputs
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editLocationId, setEditLocationId] = useState("");
  const [editFactionId, setEditFactionId] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editX, setEditX] = useState<number>(50);
  const [editY, setEditY] = useState<number>(50);

  // New item inputs (manual creators)
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [newLocationId, setNewLocationId] = useState("");
  const [newFactionId, setNewFactionId] = useState("");
  const [newYear, setNewYear] = useState("");

  // New Triple inputs
  const [newTripleSubject, setNewTripleSubject] = useState("");
  const [newTriplePredicate, setNewTriplePredicate] = useState("");
  const [newTripleObject, setNewTripleObject] = useState("");
  const hydratedLocationId = useRef<string | null>(null);
  const isMigratingEmbeddedImages = useRef(false);

  // A location opened directly by URL has not passed through handleSelectLocation,
  // so hydrate its controlled editor fields when the routed selection changes.
  useEffect(() => {
    if (activeTab !== "locations" || !selectedItemId || hydratedLocationId.current === selectedItemId) return;
    const location = world?.locations?.find((candidate) => candidate.id === selectedItemId);
    if (!location) return;
    hydratedLocationId.current = selectedItemId;
    setEditName(location.name);
    setEditType(location.type);
    setEditDesc(location.description);
    setEditParentId(location.parentId || "");
    setEditX(location.x ?? 50);
    setEditY(location.y ?? 50);
  }, [activeTab, selectedItemId, world?.locations]);

  // --- Initialize Lists / Backward Compatibility ---
  useEffect(() => {
    if (world) {
      // Migrate places string list into locations array
      if (!world.locations || world.locations.length === 0) {
        const placesList = world.places || [];
        const migLocations: LocationNode[] = placesList.map((p, i) => ({
          id: `loc-${i}-${Date.now()}`,
          name: p,
          type: "Region",
          description: "A major place in the realm."
        }));
        // Migrate characters string list into objects
        const charsList = world.characters || [];
        const migChars: Character[] = charsList.map((c, i) => {
          const charName = typeof c === "string" ? c : String(c);
          return {
            id: `char-${i}-${Date.now()}`,
            name: charName,
            description: "A prominent character in the world."
          };
        });

        // Setup fallback initial triples
        const initialTriples: Triple[] = [];
        if (migLocations.length > 0 && migChars.length > 0) {
          initialTriples.push({ subject: migChars[0].name, predicate: "residesIn", object: migLocations[0].name });
        }

        const migratedWorld = {
          ...world,
          locations: migLocations,
          characters: migChars as (Character | string)[],
          organizations: world.organizations || [],
          events: world.events || [],
          items: world.items || [],
          triples: world.triples || initialTriples,
          mapDescription: world.mapDescription || `A visual record of the realm ${world.name}.`
        };
        setWorld(migratedWorld);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorld]);

  // --- Auto-Save Sync to Backend & LocalStorage ---
  const syncWorld = async (updatedWorld: WorldAsset) => {
    setIsSaving(true);
    // 1. Sync to LocalStorage
    const saved = localStorage.getItem("aethelgard_worlds");
    if (saved) {
      try {
        const history: WorldAsset[] = JSON.parse(saved);
        const updatedHistory = [updatedWorld, ...history.filter((w) => w.id !== updatedWorld.id)];
        localStorage.setItem("aethelgard_worlds", JSON.stringify(updatedHistory));
      } catch (e) {
        console.error("LocalStorage save error", e);
      }
    }

    // 2. Sync to Postgres + LevelGraph
    try {
      const res = await fetch(`/api/generate/world/${updatedWorld.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: {
            name: updatedWorld.name,
            locations: updatedWorld.locations,
            organizations: updatedWorld.organizations,
            events: updatedWorld.events,
            items: updatedWorld.items,
            triples: updatedWorld.triples,
            mapUrl: updatedWorld.mapUrl,
            mapDescription: updatedWorld.mapDescription,
            places: updatedWorld.locations?.map((l) => l.name) || [],
            characters: updatedWorld.characters || []
          },
          description: updatedWorld.description,
          triples: updatedWorld.triples
        }),
      });
      if (!res.ok) {
        throw new Error(`Server sync failed: ${res.status}`);
      }
    } catch (err) {
      console.error("Backend database sync failed", err);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Helper state updates ---
  const updateWorldData = (updater: (prev: WorldAsset) => WorldAsset) => {
    if (!world) return;
    const next = updater(world);
    setWorld(next);
    syncWorld(next);
  };

  const uploadMapImage = async (file: File, locationId?: string) => {
    try {
      const previousUrl = locationId ? world?.locations?.find((location) => location.id === locationId)?.mapUrl : world?.mapUrl;
      const uploadedUrl = await uploadLoreImage(file);
      await deleteLoreImage(previousUrl);
      setError(null);
      if (locationId) {
        updateWorldData((previous) => ({
          ...previous,
          locations: (previous.locations || []).map((location) => location.id === locationId ? { ...location, mapUrl: uploadedUrl } : location),
        }));
      } else {
        updateWorldData((previous) => ({ ...previous, mapUrl: uploadedUrl }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The map could not be uploaded.");
    }
  };

  const removeMapImage = async (locationId?: string) => {
    const imageUrl = locationId ? world?.locations?.find((location) => location.id === locationId)?.mapUrl : world?.mapUrl;
    await deleteLoreImage(imageUrl);
    if (locationId) updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((location) => location.id === locationId ? { ...location, mapUrl: undefined } : location) }));
    else updateWorldData((previous) => ({ ...previous, mapUrl: undefined }));
  };

  // Convert maps saved by older builds from embedded data URLs to stored files.
  useEffect(() => {
    if (!world || isMigratingEmbeddedImages.current) return;
    const hasEmbeddedImages = world.mapUrl?.startsWith("data:") || world.locations?.some((location) => location.mapUrl?.startsWith("data:"));
    if (!hasEmbeddedImages) return;
    isMigratingEmbeddedImages.current = true;
    void (async () => {
      try {
        const migrated = { ...world };
        if (world.mapUrl?.startsWith("data:")) {
          const blob = await fetch(world.mapUrl).then((response) => response.blob());
          migrated.mapUrl = await uploadLoreImage(new File([blob], "world-map", { type: blob.type }));
        }
        migrated.locations = await Promise.all((world.locations || []).map(async (location) => {
          if (!location.mapUrl?.startsWith("data:")) return location;
          const blob = await fetch(location.mapUrl).then((response) => response.blob());
          return { ...location, mapUrl: await uploadLoreImage(new File([blob], `${location.id}-map`, { type: blob.type })) };
        }));
        setWorld(migrated);
        await syncWorld(migrated);
      } catch (cause) {
        setError(cause instanceof Error ? `A legacy map could not be migrated: ${cause.message}` : "A legacy map could not be migrated.");
      } finally {
        isMigratingEmbeddedImages.current = false;
      }
    })();
  }, [world]);

  // --- Initial World Generator Handler ---
  const handleGenerateWorld = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/generate/world", {
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
          const cleanDesc = data.generated_content
            .replace(/\*\*[^*]+\*\*/, "") // Remove bold title
            .trim();

          const generatedPlaces: string[] = meta.places || [];
          const generatedCharacters: string[] = meta.characters || [];

          // Format new world with hierarchical arrays
          const newLocations: LocationNode[] = generatedPlaces.map((p, i) => ({
            id: `loc-${i}-${Date.now()}`,
            name: p,
            type: "Region",
            description: `A notable location in the realm.`
          }));

          const newCharacters: Character[] = generatedCharacters.map((c, i) => ({
            id: `char-${i}-${Date.now()}`,
            name: c,
            description: `A prominent character in this setting.`,
            locationId: newLocations[i % newLocations.length]?.id
          }));

          // Set default connection triples
          const initialTriples: Triple[] = [];
          newCharacters.forEach((c, i) => {
            const locName = newLocations[i % newLocations.length]?.name;
            if (locName) {
              initialTriples.push({ subject: c.name, predicate: "residesIn", object: locName });
            }
          });

          const newWorld: WorldAsset = {
            id: meta.id,
            name: meta.name || "Unnamed Realm",
            prompt: prompt,
            description: cleanDesc,
            createdAt: meta.createdAt || new Date().toISOString(),
            locations: newLocations,
            characters: newCharacters as (Character | string)[],
            organizations: [],
            events: [],
            items: [],
            triples: initialTriples,
            mapDescription: `An illustrated map of the newly discovered land of ${meta.name}.`
          };

          setWorld(newWorld);
          setPrompt("");
          setActiveTab("overview");
          setSelectedItemId(null);
          
          // Save to LocalStorage history
          const saved = localStorage.getItem("aethelgard_worlds");
          const history = saved ? JSON.parse(saved) : [];
          localStorage.setItem("aethelgard_worlds", JSON.stringify([newWorld, ...history]));
          router.replace(`/world/${encodeURIComponent(newWorld.id)}`);
        } else {
          throw new Error("Invalid response format from server");
        }
      } catch (err) {
        console.error(err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(errMsg);
      }
    });
  };

  // --- Element Editor Edit Form Handlers ---
  const handleSelectLocation = (id: string | null) => {
    setSelectedItemId(id);
    setActiveTab("locations");
    if (id && world?.locations) {
      const loc = world.locations.find((l) => l.id === id);
      if (loc) {
        setEditName(loc.name);
        setEditType(loc.type);
        setEditDesc(loc.description);
        setEditParentId(loc.parentId || "");
        setEditX(loc.x || 50);
        setEditY(loc.y || 50);
      }
    }
  };

  const handleUpdateLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || !world) return;
    updateWorldData((prev) => {
      const locs = prev.locations || [];
      const updatedLocs = locs.map((l) =>
        l.id === selectedItemId
          ? { ...l, name: editName, type: editType, description: editDesc, parentId: editParentId || undefined, x: editX, y: editY }
          : l
      );
      return { ...prev, locations: updatedLocs };
    });
  };

  const handleSelectCharacter = (id: string | null) => {
    setSelectedItemId(id);
    setActiveTab("characters");
    const chars = (world?.characters || []).filter((character): character is Character => typeof character !== "string");
    if (id && chars) {
      const char = chars.find((c) => c.id === id);
      if (char) {
        setEditName(char.name);
        setEditDesc(char.description || "");
        setEditLocationId(char.locationId || "");
        setEditFactionId(char.factionId || "");
      }
    }
  };

  const handleUpdateCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || !world) return;
    updateWorldData((prev) => {
      const chars = (prev.characters || []).filter((character): character is Character => typeof character !== "string");
      const updatedChars = chars.map((c) =>
        c.id === selectedItemId
          ? { ...c, name: editName, description: editDesc, locationId: editLocationId || undefined, factionId: editFactionId || undefined }
          : c
      );
      return { ...prev, characters: updatedChars };
    });
  };

  const handleSelectOrganization = (id: string | null) => {
    setSelectedItemId(id);
    setActiveTab("organizations");
    if (id && world?.organizations) {
      const org = world.organizations.find((o) => o.id === id);
      if (org) {
        setEditName(org.name);
        setEditType(org.type);
        setEditDesc(org.description);
        setEditLocationId(org.baseLocationId || "");
      }
    }
  };

  const handleUpdateOrganization = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || !world) return;
    updateWorldData((prev) => {
      const orgs = prev.organizations || [];
      const updatedOrgs = orgs.map((o) =>
        o.id === selectedItemId
          ? { ...o, name: editName, type: editType, description: editDesc, baseLocationId: editLocationId || undefined }
          : o
      );
      return { ...prev, organizations: updatedOrgs };
    });
  };

  const handleSelectEvent = (id: string | null) => {
    setSelectedItemId(id);
    setActiveTab("events");
    if (id && world?.events) {
      const ev = world.events.find((e) => e.id === id);
      if (ev) {
        setEditName(ev.name);
        setEditYear(ev.year);
        setEditDesc(ev.description);
      }
    }
  };

  const handleUpdateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || !world) return;
    updateWorldData((prev) => {
      const evs = prev.events || [];
      const updatedEvs = evs.map((ev) =>
        ev.id === selectedItemId
          ? { ...ev, name: editName, year: editYear, description: editDesc }
          : ev
      );
      return { ...prev, events: updatedEvs };
    });
  };

  const handleSelectItem = (id: string | null) => {
    setSelectedItemId(id);
    setActiveTab("items");
    if (id && world?.items) {
      const it = world.items.find((i) => i.id === id);
      if (it) {
        setEditName(it.name);
        setEditType(it.type);
        setEditDesc(it.description);
        setEditLocationId(it.locationId || "");
      }
    }
  };

  const handleUpdateItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || !world) return;
    updateWorldData((prev) => {
      const itemsList = prev.items || [];
      const updatedItems = itemsList.map((it) =>
        it.id === selectedItemId
          ? { ...it, name: editName, type: editType, description: editDesc, locationId: editLocationId || undefined }
          : it
      );
      return { ...prev, items: updatedItems };
    });
  };

  // --- Manual Creator Handlers ---
  const handleCreateLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !world) return;
    const parent = newParentId || undefined;
    const newLoc: LocationNode = {
      id: `loc-${Date.now()}`,
      name: newName,
      type: newType || "City",
      description: newDesc || "A newly created location.",
      parentId: parent,
      x: 50,
      y: 50
    };
    updateWorldData((prev) => ({
      ...prev,
      locations: [...(prev.locations || []), newLoc]
    }));
    // Reset fields
    setNewName("");
    setNewType("");
    setNewDesc("");
    setNewParentId("");
  };

  const handleCreateCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !world) return;
    const newChar: Character = {
      id: `char-${Date.now()}`,
      name: newName,
      description: newDesc || "A newly chronicled character.",
      locationId: newLocationId || undefined,
      factionId: newFactionId || undefined
    };
    updateWorldData((prev) => ({
      ...prev,
      characters: [...(prev.characters || []), newChar] as (Character | string)[]
    }));
    setNewName("");
    setNewDesc("");
    setNewLocationId("");
    setNewFactionId("");
  };

  const handleCreateOrganization = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !world) return;
    const newOrg: Organization = {
      id: `org-${Date.now()}`,
      name: newName,
      type: newType || "Guild",
      description: newDesc || "A newly formed faction.",
      baseLocationId: newLocationId || undefined
    };
    updateWorldData((prev) => ({
      ...prev,
      organizations: [...(prev.organizations || []), newOrg]
    }));
    setNewName("");
    setNewType("");
    setNewDesc("");
    setNewLocationId("");
  };

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !world) return;
    const newEv: TimelineEvent = {
      id: `ev-${Date.now()}`,
      name: newName,
      year: newYear || "Year 0",
      description: newDesc || "A memorable event in history."
    };
    updateWorldData((prev) => ({
      ...prev,
      events: [...(prev.events || []), newEv]
    }));
    setNewName("");
    setNewYear("");
    setNewDesc("");
  };

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !world) return;
    const newIt: RelicItem = {
      id: `it-${Date.now()}`,
      name: newName,
      type: newType || "Relic",
      description: newDesc || "An item of significance.",
      locationId: newLocationId || undefined
    };
    updateWorldData((prev) => ({
      ...prev,
      items: [...(prev.items || []), newIt]
    }));
    setNewName("");
    setNewType("");
    setNewDesc("");
    setNewLocationId("");
  };

  const handleCreateTriple = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTripleSubject.trim() || !newTriplePredicate.trim() || !newTripleObject.trim() || !world) return;
    const trip: Triple = {
      subject: newTripleSubject.trim(),
      predicate: newTriplePredicate.trim(),
      object: newTripleObject.trim()
    };
    updateWorldData((prev) => ({
      ...prev,
      triples: [...(prev.triples || []), trip]
    }));
    setNewTripleSubject("");
    setNewTriplePredicate("");
    setNewTripleObject("");
  };

  // --- Deletion Handlers ---
  const handleDeleteElement = (type: "locations" | "characters" | "organizations" | "events" | "items", id: string) => {
    if (!world) return;
    updateWorldData((prev) => {
      const fieldList = (prev[type] || []) as { id: string }[];
      const filtered = fieldList.filter((item) => item.id !== id);
      return { ...prev, [type]: filtered };
    });
    setSelectedItemId(null);
  };

  const handleDeleteTriple = (idx: number) => {
    if (!world) return;
    updateWorldData((prev) => {
      const filtered = (prev.triples || []).filter((_, i) => i !== idx);
      return { ...prev, triples: filtered };
    });
  };

  // --- AI Co-pilot Logic ---
  const handleAIGenerateElement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || !world) return;

    setIsAiGenerating(true);
    setAiDraft(null);
    setError(null);

    // Determine parent context if we are currently inside locations
    const parentId = activeTab === "locations" ? selectedItemId : undefined;

    try {
      const res = await fetch(`/api/generate/world/${world.id}/${aiElementType}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: aiPrompt,
          parentId
        })
      });

      if (!res.ok) {
        throw new Error(`AI generation failed: ${res.status}`);
      }

      const data = await res.json();
      if (data.status === "success" && data.element) {
        setAiDraft(data.element);
      } else {
        throw new Error("Invalid draft format received.");
      }
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleForgeDraft = () => {
    if (!aiDraft || !world) return;

    updateWorldData((prev) => {
      const updatedState = { ...prev };
      const currentParentId = activeTab === "locations" ? (selectedItemId || undefined) : undefined;

      const randomId = `${aiElementType}-${Date.now()}`;

      if (aiElementType === "location") {
        const newLoc: LocationNode = {
          id: randomId,
          name: aiDraft.name,
          type: "City",
          description: aiDraft.description,
          parentId: currentParentId,
          x: 50,
          y: 50
        };
        updatedState.locations = [...(updatedState.locations || []), newLoc];
      } else if (aiElementType === "character") {
        const newChar: Character = {
          id: randomId,
          name: aiDraft.name,
          description: aiDraft.description,
          locationId: currentParentId
        };
        updatedState.characters = [...(updatedState.characters || []), newChar] as (Character | string)[];
      } else if (aiElementType === "organization") {
        const newOrg: Organization = {
          id: randomId,
          name: aiDraft.name,
          type: "Guild",
          description: aiDraft.description,
          baseLocationId: currentParentId
        };
        updatedState.organizations = [...(updatedState.organizations || []), newOrg];
      } else if (aiElementType === "event") {
        const newEv: TimelineEvent = {
          id: randomId,
          name: aiDraft.name,
          year: "Year 0",
          description: aiDraft.description
        };
        updatedState.events = [...(updatedState.events || []), newEv];
      } else if (aiElementType === "item") {
        const newIt: RelicItem = {
          id: randomId,
          name: aiDraft.name,
          type: "Relic",
          description: aiDraft.description,
          locationId: currentParentId
        };
        updatedState.items = [...(updatedState.items || []), newIt];
      }

      // Add suggested relations triples
      if (aiDraft.relations && aiDraft.relations.length > 0) {
        updatedState.triples = [...(updatedState.triples || []), ...aiDraft.relations];
      }

      return updatedState;
    });

    // Reset draft
    setAiDraft(null);
    setAiPrompt("");
  };

  // --- Recursive Locations Tree Sidebar Component ---
  function LocationTreeRecursive({
    node,
    nodes,
    level
  }: {
    node: LocationNode;
    nodes: LocationNode[];
    level: number;
  }) {
    const children = nodes.filter((n) => n.parentId === node.id && visibleLoreIds.locations.has(n.id));
    const [isExpanded, setIsExpanded] = useState(true);
    const isActive = selectedItemId === node.id && activeTab === "locations";

    return (
      <div className="tree-node-wrapper">
        <div 
          className={`tree-node ${isActive ? "active" : ""}`}
          style={{ paddingLeft: `${level * 12 + 8}px` }}
        >
          <div className="tree-node-click" onClick={() => handleSelectLocation(node.id)}>
            <span className="tree-chevron" onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}>
              {children.length > 0 ? (isExpanded ? "▼" : "▶") : ""}
            </span>
            <span className="node-text">{node.name}</span>
            <span className="node-badge">{node.type}</span>
          </div>
          <button 
            className="tree-nested-add-btn" 
            title="Create nested location"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/world/${encodeURIComponent(world!.id)}/locations/new?parentId=${encodeURIComponent(node.id)}`);
            }}
          >
            +
          </button>
        </div>
        {children.length > 0 && isExpanded && (
          <div className="tree-children-list">
            {children.map((child) => (
              <LocationTreeRecursive
                key={child.id}
                node={child}
                nodes={nodes}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- RENDER SCREEN: Prompter Lore Initial Form (No active world) ---
  if (!world) {
    return (
      <main className="world-create-page">
        <section className="world-create-panel card-surface">
          <header className="world-create-header">
            <button className="back-btn" onClick={() => onBackToDashboard ? onBackToDashboard() : router.push("/dashboard")}>
              ← Back to Guild Hall
            </button>
            <span className="eyebrow">World creation</span>
            <h1>Create a new world</h1>
            <p>Describe the setting you want to run. The chronicler will turn your direction into a world you can expand and use at the table.</p>
          </header>

          <div className="world-create-grid">
            <form onSubmit={handleGenerateWorld} className="world-create-form">
              <div className="world-prompt-field">
                <label htmlFor="world-prompt">Describe your world</label>
                <p id="world-prompt-help">Write as if you were explaining your campaign idea to another GM. A short paragraph is enough to get started.</p>
                <textarea
                  id="world-prompt"
                  aria-describedby="world-prompt-help"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A chain of floating islands where rival merchant houses control travel between sky ports. Ancient storm giants are waking below the clouds, and every faction wants the lost compass that can command them. The tone should be adventurous, politically tense, and occasionally wondrous."
                  disabled={isPending}
                  rows={10}
                  required
                />
              </div>

              {error && (
                <div className="error-banner">
                  <strong>We couldn&apos;t create the world:</strong> {error}
                </div>
              )}

              <div className="world-create-submit">
                <span>You can revise every detail after the world is created.</span>
                <button type="submit" className={`primary-action ${isPending ? "loading-btn" : ""}`} disabled={isPending || !prompt.trim()}>
                  {isPending ? "Building your world..." : "Create world"}
                </button>
              </div>
            </form>

            <aside className="world-prompt-guide" aria-labelledby="prompt-guide-title">
              <span className="eyebrow">GM guidance</span>
              <h2 id="prompt-guide-title">What makes a useful description?</h2>
              <p>Give the chronicler a few strong decisions to build around. You do not need to answer every question.</p>
              <ul>
                <li><strong>Genre and tone</strong><span>Dark fantasy, hopeful science fiction, political intrigue, swashbuckling adventure.</span></li>
                <li><strong>The central trouble</strong><span>What is changing, threatened, or about to draw adventurers into action?</span></li>
                <li><strong>Memorable details</strong><span>Name a place, people, creature, or custom that makes this world feel distinct.</span></li>
                <li><strong>Campaign boundaries</strong><span>Mention themes to emphasize or avoid, the scale of play, and any ruleset assumptions.</span></li>
              </ul>
              <div className="prompt-tip"><strong>Tip</strong><p>Leave some questions unanswered. Useful mysteries give you and your players room to shape the world during play.</p></div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  // --- Extract helper variables for active tabs ---
  const locations = world.locations || [];
  const characters = (world.characters || []) as Character[];
  const organizations = world.organizations || [];
  const events = world.events || [];
  const items = world.items || [];
  const triples = world.triples || [];

  // Locations with a missing parent must remain reachable instead of disappearing
  // behind a parent node that no longer exists.
  const locationIds = new Set(locations.map((location) => location.id));
  const rootLocations = locations.filter((location) => !location.parentId || !locationIds.has(location.parentId));

  // Active item reference
  const activeLocation = activeTab === "locations" ? locations.find((l) => l.id === selectedItemId) : null;
  const activeCharacter = activeTab === "characters" ? characters.find((c) => c.id === selectedItemId) : null;
  const activeOrg = activeTab === "organizations" ? organizations.find((o) => o.id === selectedItemId) : null;
  const activeEvent = activeTab === "events" ? events.find((e) => e.id === selectedItemId) : null;
  const activeItem = activeTab === "items" ? items.find((i) => i.id === selectedItemId) : null;
  const loreReferences: LoreReference[] = [
    ...locations.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.type || "Location", href: `/world/${encodeURIComponent(world.id)}/locations/${encodeURIComponent(entry.id)}` })),
    ...characters.map((entry) => ({ id: entry.id, name: entry.name, kind: "Character", href: `/world/${encodeURIComponent(world.id)}/characters/${encodeURIComponent(entry.id)}` })),
    ...organizations.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.type || "Faction", href: `/world/${encodeURIComponent(world.id)}/organizations/${encodeURIComponent(entry.id)}` })),
    ...events.map((entry) => ({ id: entry.id, name: entry.name, kind: "Event", href: `/world/${encodeURIComponent(world.id)}/events/${encodeURIComponent(entry.id)}` })),
    ...items.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.type || "Item", href: `/world/${encodeURIComponent(world.id)}/items/${encodeURIComponent(entry.id)}` })),
  ];
  const referenceFor = (id?: string) => loreReferences.find((reference) => reference.id === id);

  const visibleLoreIds = (() => {
    const normalizedSearchTerms = deferredLoreSearch.toLocaleLowerCase().normalize("NFKD").split(/\s+/).filter(Boolean);
    const matches = (values: Array<string | undefined>) => {
      if (!normalizedSearchTerms.length) return true;
      const content = values.filter(Boolean).join(" ").toLocaleLowerCase().normalize("NFKD");
      return normalizedSearchTerms.every((term) => content.includes(term));
    };
    const locationIds = new Set(locations.filter((entry) => matches([entry.name, entry.type, entry.description, locations.find((parent) => parent.id === entry.parentId)?.name])).map((entry) => entry.id));
    // Preserve the path to matching nested places so results remain understandable.
    for (const id of [...locationIds]) {
      let parentId = locations.find((entry) => entry.id === id)?.parentId;
      while (parentId) { locationIds.add(parentId); parentId = locations.find((entry) => entry.id === parentId)?.parentId; }
    }
    return {
      locations: locationIds,
      characters: new Set(characters.filter((entry) => matches([entry.name, entry.description, locations.find((location) => location.id === entry.locationId)?.name, organizations.find((organization) => organization.id === entry.factionId)?.name])).map((entry) => entry.id)),
      organizations: new Set(organizations.filter((entry) => matches([entry.name, entry.type, entry.description, locations.find((location) => location.id === entry.baseLocationId)?.name])).map((entry) => entry.id)),
      events: new Set(events.filter((entry) => matches([entry.name, entry.year, entry.description])).map((entry) => entry.id)),
      items: new Set(items.filter((entry) => matches([entry.name, entry.type, entry.description, locations.find((location) => location.id === entry.locationId)?.name])).map((entry) => entry.id)),
    };
  })();
  const hasLoreSearch = deferredLoreSearch.trim().length > 0;
  const loreSearchResultCount = Object.values(visibleLoreIds).reduce((total, ids) => total + ids.size, 0);

  const documentDeleteAction = (type: "locations" | "characters" | "organizations" | "events" | "items", id: string) => (
    <button type="button" className="danger-text-button" onClick={() => handleDeleteElement(type, id)}>Delete</button>
  );

  return (
    <div className="world-workspace-page">
      {/* Title Bar */}
      <header className="workspace-navbar">
        <div className="nav-left">
          <button className="back-btn" onClick={() => onBackToDashboard ? onBackToDashboard(world) : router.push("/dashboard")}>
            ← Back to Dashboard
          </button>
          <div className="nav-title-group">
            <h2>Campaign Workspace</h2>
            <span className="navbar-subtitle">Chronicle: <strong>{world.name}</strong></span>
          </div>
        </div>
        <div className="nav-right">
          {isSaving ? (
            <span className="sync-badge syncing">🧙‍♂️ Syncing Spell...</span>
          ) : (
            <span className="sync-badge synced">🔮 Chronicles Saved</span>
          )}
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="workspace-layout-grid">
        {/* Column 1: Sidebar Navigation Tree */}
        <aside className="workspace-sidebar">
          <div className="sidebar-header">
            <h3>Chronicle Index</h3>
          </div>

          <label className="lore-search-field">
            <span>Search all lore</span>
            <div><input type="search" value={loreSearch} onChange={(event) => setLoreSearch(event.target.value)} placeholder="Names, notes, types..." />{loreSearch && <button type="button" aria-label="Clear lore search" onClick={() => setLoreSearch("")}>×</button>}</div>
            {hasLoreSearch && <small>{loreSearchResultCount} matching records</small>}
          </label>
          
          <div className="sidebar-nav-list">
            <button 
              className={`sidebar-nav-item ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => { setActiveTab("overview"); setSelectedItemId(null); }}
            >
              Overview
            </button>
            <button 
              className={`sidebar-nav-item ${activeTab === "map" ? "active" : ""}`}
              onClick={() => { setActiveTab("map"); setSelectedItemId(null); }}
            >
              World Map
            </button>

            <div className="sidebar-lore-section">
              <div className="sidebar-nav-row">
                <button className="sidebar-collapse-button" aria-label="Toggle locations" aria-expanded={expandedLoreSections.locations || hasLoreSearch} onClick={() => toggleLoreSection("locations")}>{expandedLoreSections.locations || hasLoreSearch ? "▾" : "▸"}</button>
                <button className={`sidebar-nav-item ${activeTab === "locations" && !selectedItemId ? "active" : ""}`} onClick={() => { setActiveTab("locations"); setSelectedItemId(null); setExpandedLoreSections((current) => ({ ...current, locations: true })); }}>Geography & Places <span>{hasLoreSearch ? `${visibleLoreIds.locations.size}/${locations.length}` : locations.length}</span></button>
                <button className="sidebar-create-link" aria-label="Create a location" title="Create a location" onClick={() => router.push(`/world/${encodeURIComponent(world.id)}/locations/new`)}>+</button>
              </div>
              {(expandedLoreSections.locations || hasLoreSearch) && <div className="locations-tree-box">
                {rootLocations.filter((location) => visibleLoreIds.locations.has(location.id)).length === 0 ? (
                  <p className="empty-tree-text">No regions charted yet.</p>
                ) : (
                  rootLocations.filter((location) => visibleLoreIds.locations.has(location.id)).map((rootNode) => (
                    <LocationTreeRecursive
                      key={rootNode.id}
                      node={rootNode}
                      nodes={locations}
                      level={0}
                    />
                  ))
                )}
                <button 
                  className="sidebar-add-root-btn"
                  onClick={() => router.push(`/world/${encodeURIComponent(world.id)}/locations/new`)}
                >
                  + Add Root Region
                </button>
              </div>}
            </div>

            <div className="sidebar-lore-section">
              <div className="sidebar-nav-row"><button className="sidebar-collapse-button" aria-label="Toggle characters" aria-expanded={expandedLoreSections.characters || hasLoreSearch} onClick={() => toggleLoreSection("characters")}>{expandedLoreSections.characters || hasLoreSearch ? "▾" : "▸"}</button><button className={`sidebar-nav-item ${activeTab === "characters" && !selectedItemId ? "active" : ""}`} onClick={() => { setActiveTab("characters"); setSelectedItemId(null); setExpandedLoreSections((current) => ({ ...current, characters: true })); }}>Characters <span>{hasLoreSearch ? `${visibleLoreIds.characters.size}/${characters.length}` : characters.length}</span></button><button className="sidebar-create-link" aria-label="Create a character" title="Create a character" onClick={() => router.push(`/world/${encodeURIComponent(world.id)}/characters/new`)}>+</button></div>
              {(expandedLoreSections.characters || hasLoreSearch) && <div className="sidebar-record-list">{visibleLoreIds.characters.size ? characters.filter((character) => visibleLoreIds.characters.has(character.id)).map((character) => <button className={selectedItemId === character.id && activeTab === "characters" ? "active" : ""} key={character.id} onClick={() => handleSelectCharacter(character.id)}>{character.name}</button>) : <span>No matching characters</span>}</div>}
            </div>
            <div className="sidebar-lore-section">
              <div className="sidebar-nav-row"><button className="sidebar-collapse-button" aria-label="Toggle organizations" aria-expanded={expandedLoreSections.organizations || hasLoreSearch} onClick={() => toggleLoreSection("organizations")}>{expandedLoreSections.organizations || hasLoreSearch ? "▾" : "▸"}</button><button className={`sidebar-nav-item ${activeTab === "organizations" && !selectedItemId ? "active" : ""}`} onClick={() => { setActiveTab("organizations"); setSelectedItemId(null); setExpandedLoreSections((current) => ({ ...current, organizations: true })); }}>Organizations & Factions <span>{hasLoreSearch ? `${visibleLoreIds.organizations.size}/${organizations.length}` : organizations.length}</span></button><button className="sidebar-create-link" aria-label="Create an organization" title="Create an organization" onClick={() => router.push(`/world/${encodeURIComponent(world.id)}/organizations/new`)}>+</button></div>
              {(expandedLoreSections.organizations || hasLoreSearch) && <div className="sidebar-record-list">{visibleLoreIds.organizations.size ? organizations.filter((organization) => visibleLoreIds.organizations.has(organization.id)).map((organization) => <button className={selectedItemId === organization.id && activeTab === "organizations" ? "active" : ""} key={organization.id} onClick={() => handleSelectOrganization(organization.id)}>{organization.name}</button>) : <span>No matching organizations</span>}</div>}
            </div>
            <div className="sidebar-lore-section">
              <div className="sidebar-nav-row"><button className="sidebar-collapse-button" aria-label="Toggle events" aria-expanded={expandedLoreSections.events || hasLoreSearch} onClick={() => toggleLoreSection("events")}>{expandedLoreSections.events || hasLoreSearch ? "▾" : "▸"}</button><button className={`sidebar-nav-item ${activeTab === "events" && !selectedItemId ? "active" : ""}`} onClick={() => { setActiveTab("events"); setSelectedItemId(null); setExpandedLoreSections((current) => ({ ...current, events: true })); }}>Timeline & Events <span>{hasLoreSearch ? `${visibleLoreIds.events.size}/${events.length}` : events.length}</span></button><button className="sidebar-create-link" aria-label="Create an event" title="Create an event" onClick={() => router.push(`/world/${encodeURIComponent(world.id)}/events/new`)}>+</button></div>
              {(expandedLoreSections.events || hasLoreSearch) && <div className="sidebar-record-list">{visibleLoreIds.events.size ? events.filter((event) => visibleLoreIds.events.has(event.id)).map((event) => <button className={selectedItemId === event.id && activeTab === "events" ? "active" : ""} key={event.id} onClick={() => handleSelectEvent(event.id)}>{event.name}</button>) : <span>No matching events</span>}</div>}
            </div>
            <div className="sidebar-lore-section">
              <div className="sidebar-nav-row"><button className="sidebar-collapse-button" aria-label="Toggle items" aria-expanded={expandedLoreSections.items || hasLoreSearch} onClick={() => toggleLoreSection("items")}>{expandedLoreSections.items || hasLoreSearch ? "▾" : "▸"}</button><button className={`sidebar-nav-item ${activeTab === "items" && !selectedItemId ? "active" : ""}`} onClick={() => { setActiveTab("items"); setSelectedItemId(null); setExpandedLoreSections((current) => ({ ...current, items: true })); }}>Items & Relics <span>{hasLoreSearch ? `${visibleLoreIds.items.size}/${items.length}` : items.length}</span></button><button className="sidebar-create-link" aria-label="Create an item" title="Create an item" onClick={() => router.push(`/world/${encodeURIComponent(world.id)}/items/new`)}>+</button></div>
              {(expandedLoreSections.items || hasLoreSearch) && <div className="sidebar-record-list">{visibleLoreIds.items.size ? items.filter((item) => visibleLoreIds.items.has(item.id)).map((item) => <button className={selectedItemId === item.id && activeTab === "items" ? "active" : ""} key={item.id} onClick={() => handleSelectItem(item.id)}>{item.name}</button>) : <span>No matching items</span>}</div>}
            </div>
            <button 
              className={`sidebar-nav-item ${activeTab === "relations" ? "active" : ""}`}
              onClick={() => { setActiveTab("relations"); setSelectedItemId(null); }}
            >
              Relationship Graph
            </button>
          </div>
        </aside>

        {/* Column 2: Central Content Panel */}
        <main className="workspace-main-panel">
          <div className="card-surface min-h-[500px]">
            {/* Overview View */}
            {activeTab === "overview" && (
              <div className="tab-content-container">
                <div className="document-edit-mode"><LoreDocument eyebrow="World chronicle" title={world.name} description={world.description} imageUrl={world.mapUrl} imageLabel="world map" facts={[]} references={loreReferences} related={loreReferences.slice(0, 12)} onTitleChange={(value) => updateWorldData((previous) => ({ ...previous, name: value }))} onDescriptionChange={(value) => updateWorldData((previous) => ({ ...previous, description: value }))} onImageChange={(value) => updateWorldData((previous) => ({ ...previous, mapUrl: value }))} /></div>
                <span className="eyebrow">Chronicled Chronicle</span>
                <div className="editable-section mb-6">
                  <input 
                    type="text" 
                    value={world.name} 
                    onChange={(e) => updateWorldData((prev) => ({ ...prev, name: e.target.value }))}
                    className="world-title-input"
                  />
                  <textarea 
                    value={world.description} 
                    onChange={(e) => updateWorldData((prev) => ({ ...prev, description: e.target.value }))}
                    className="world-desc-textarea"
                    rows={8}
                  />
                </div>

                <div className="registry-stats">
                  <h4>Chronicle Statistics</h4>
                  <div className="stats-grid">
                    <div className="stat-card" onClick={() => setActiveTab("locations")}>
                      <span className="number">{locations.length}</span>
                      <span className="label">Locations</span>
                    </div>
                    <div className="stat-card" onClick={() => setActiveTab("characters")}>
                      <span className="number">{characters.length}</span>
                      <span className="label">NPCs</span>
                    </div>
                    <div className="stat-card" onClick={() => setActiveTab("organizations")}>
                      <span className="number">{organizations.length}</span>
                      <span className="label">Factions</span>
                    </div>
                    <div className="stat-card" onClick={() => setActiveTab("events")}>
                      <span className="number">{events.length}</span>
                      <span className="label">Events</span>
                    </div>
                    <div className="stat-card" onClick={() => setActiveTab("items")}>
                      <span className="number">{items.length}</span>
                      <span className="label">Relics</span>
                    </div>
                    <div className="stat-card" onClick={() => setActiveTab("relations")}>
                      <span className="number">{triples.length}</span>
                      <span className="label">Relations</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Map View */}
            {activeTab === "map" && (
              <div className="tab-content-container">
                <div className="editor-section-heading">
                  <div><span className="eyebrow">World geography</span><h3>World map</h3><p>Upload a map for the setting and use location coordinates to place its markers.</p></div>
                  <label className="map-upload-button"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadMapImage(file); event.target.value = ""; }} />{world.mapUrl ? "Replace map" : "Upload map"}</label>
                </div>
                
                <div className={`map-grid-board ${world.mapUrl ? "has-map-image" : ""}`} style={world.mapUrl ? { backgroundImage: `url(${world.mapUrl})` } : undefined}>
                  <div className="map-grid-overlay">
                    <div className="compass-rose">🧭</div>
                    {/* Render pinned locations */}
                    {locations.map((loc) => {
                      const px = loc.x ?? 50;
                      const py = loc.y ?? 50;
                      return (
                        <div 
                          key={loc.id} 
                          className="map-pin-marker"
                          style={{ left: `${px}%`, top: `${py}%` }}
                          onClick={() => handleSelectLocation(loc.id)}
                          title={`${loc.name} (${loc.type})`}
                        >
                          📍
                          <span className="pin-label">{loc.name}</span>
                        </div>
                      );
                    })}
                  </div>
                  {!world.mapUrl && <div className="map-empty-state"><strong>No world map uploaded</strong><span>Add an image to give your location markers geographic context.</span></div>}
                </div>

                {world.mapUrl && <button className="map-remove-button" type="button" onClick={() => removeMapImage()}>Remove world map</button>}

                <div className="map-notes-field">
                  <label>Map and geography notes</label>
                  <MarkdownLongText value={world.mapDescription || ""} onChange={(value) => updateWorldData((previous) => ({ ...previous, mapDescription: value }))} references={loreReferences} label="map and geography notes" />
                </div>
              </div>
            )}

            {/* Geography & Locations Tab */}
            {activeTab === "locations" && (
              <div className="tab-content-container">
                {activeLocation ? (
                  <div>
                    <div className="document-edit-mode"><LoreDocument eyebrow={activeLocation.type || "Location"} title={activeLocation.name} description={activeLocation.description} imageUrl={activeLocation.mapUrl} imageLabel="location map" references={loreReferences.filter((reference) => reference.id !== activeLocation.id)} related={[
                      ...locations.filter((entry) => entry.parentId === activeLocation.id).map((entry) => referenceFor(entry.id)!),
                      ...characters.filter((entry) => entry.locationId === activeLocation.id).map((entry) => referenceFor(entry.id)!),
                      ...organizations.filter((entry) => entry.baseLocationId === activeLocation.id).map((entry) => referenceFor(entry.id)!),
                      ...items.filter((entry) => entry.locationId === activeLocation.id).map((entry) => referenceFor(entry.id)!),
                    ].filter(Boolean)} facts={[
                      { label: "Type", value: activeLocation.type, options: ["Continent", "Region", "City", "District", "Building", "Landmark", "Wilderness"].map((value) => ({ value, label: value })), onChange: (value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, type: value } : entry) })) },
                      { label: "Within", value: activeLocation.parentId || "", emptyLabel: "Top-level location", options: locations.filter((entry) => entry.id !== activeLocation.id).map((entry) => ({ value: entry.id, label: entry.name })), onChange: (value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, parentId: value || undefined } : entry) })) },
                      { label: "Map position X", value: String(activeLocation.x ?? 50), onChange: (value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, x: Math.max(0, Math.min(100, Number(value) || 0)) } : entry) })) },
                      { label: "Map position Y", value: String(activeLocation.y ?? 50), onChange: (value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, y: Math.max(0, Math.min(100, Number(value) || 0)) } : entry) })) },
                    ] as LoreFact[]} onTitleChange={(value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, name: value } : entry) }))} onDescriptionChange={(value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, description: value } : entry) }))} onImageChange={(value) => updateWorldData((previous) => ({ ...previous, locations: (previous.locations || []).map((entry) => entry.id === activeLocation.id ? { ...entry, mapUrl: value } : entry) }))} actions={documentDeleteAction("locations", activeLocation.id)} /></div>
                    {/* Breadcrumbs */}
                    <div className="breadcrumbs">
                      <span onClick={() => setSelectedItemId(null)}>Geography</span>
                      {activeLocation.parentId && (
                        <>
                          {" > "}
                          <span onClick={() => handleSelectLocation(activeLocation.parentId!)}>
                            {locations.find((l) => l.id === activeLocation.parentId)?.name}
                          </span>
                        </>
                      )}
                      {" > "}
                      <span className="active-breadcrumb">{activeLocation.name}</span>
                    </div>

                    <div className="location-editor-header">
                      <div><span className="location-type-label">{activeLocation.type}</span><h3>{activeLocation.name}</h3><p>Edit the location&apos;s identity, place in the world, and table-ready notes.</p></div>
                      <button type="button" className="danger-text-button" onClick={() => handleDeleteElement("locations", activeLocation.id)}>Delete location</button>
                    </div>

                    <section className="location-map-panel">
                      <div className="location-map-preview" style={activeLocation.mapUrl ? { backgroundImage: `url(${activeLocation.mapUrl})` } : undefined}>
                        {!activeLocation.mapUrl && <div><strong>No location map</strong><span>Add a regional, city, district, or encounter map.</span></div>}
                      </div>
                      <div className="location-map-copy"><span className="eyebrow">Location map</span><h4>Give this place its own map</h4><p>This map belongs to {activeLocation.name}, separate from the overall world map.</p><div className="location-map-actions"><label className="map-upload-button"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadMapImage(file, activeLocation.id); event.target.value = ""; }} />{activeLocation.mapUrl ? "Replace map" : "Upload map"}</label>{activeLocation.mapUrl && <button type="button" className="map-remove-button" onClick={() => removeMapImage(activeLocation.id)}>Remove</button>}</div></div>
                    </section>

                    <form onSubmit={handleUpdateLocation} className="location-edit-form">
                      <section className="editor-form-section"><div className="editor-form-heading"><h4>Location details</h4><p>The name and kind of place your players will recognize.</p></div><div className="editor-field-grid"><label className="editor-field editor-field-wide"><span>Name</span><input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="workspace-input" /></label><label className="editor-field"><span>Location type</span><select value={editType} onChange={(e) => setEditType(e.target.value)} className="workspace-input"><option value="Continent">Continent</option><option value="Region">Region</option><option value="City">City</option><option value="District">District</option><option value="Building">Building</option><option value="Landmark">Landmark</option><option value="Wilderness">Wilderness</option></select></label></div></section>

                      <section className="editor-form-section"><div className="editor-form-heading"><h4>Place in the world</h4><p>Choose its parent and marker position on the world map.</p></div><div className="editor-field-grid"><label className="editor-field editor-field-wide"><span>Parent location</span><select value={editParentId} onChange={(e) => setEditParentId(e.target.value)} className="workspace-input"><option value="">No parent — top-level location</option>{locations.filter((location) => location.id !== activeLocation.id).map((location) => <option key={location.id} value={location.id}>{location.name} ({location.type})</option>)}</select></label><label className="editor-field coordinate-field"><span>Horizontal position</span><div><input type="range" value={editX} onChange={(e) => setEditX(Number(e.target.value))} min={0} max={100} /><output>{editX}%</output></div></label><label className="editor-field coordinate-field"><span>Vertical position</span><div><input type="range" value={editY} onChange={(e) => setEditY(Number(e.target.value))} min={0} max={100} /><output>{editY}%</output></div></label></div></section>

                      <section className="editor-form-section"><div className="editor-form-heading"><h4>Lore and GM notes</h4><p>Capture what makes the place memorable and useful during play.</p></div><label className="editor-field"><span>Description</span><textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="workspace-input" rows={7} placeholder="Atmosphere, inhabitants, current trouble, secrets, and adventure hooks..." /></label></section>

                      <div className="location-form-actions"><span>Changes are saved to the world chronicle.</span><button type="submit" className="primary-action">Save location</button></div>
                    </form>

                    {/* Nested Inhabitants / Entities list */}
                    <div className="nested-inhabitants-section mt-8 border-t border-white/5 pt-6">
                      <h4>Inhabitants & Landmarks of {activeLocation.name}</h4>
                      <div className="inhabitants-grid mt-4">
                        <div>
                          <h5>👤 Characters Present</h5>
                          <ul>
                            {characters.filter((c) => c.locationId === activeLocation.id).map((c) => (
                              <li key={c.id} className="clickable-li" onClick={() => handleSelectCharacter(c.id)}>
                                {c.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h5>🛡️ Base of Operations (Factions)</h5>
                          <ul>
                            {organizations.filter((o) => o.baseLocationId === activeLocation.id).map((o) => (
                              <li key={o.id} className="clickable-li" onClick={() => handleSelectOrganization(o.id)}>
                                {o.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h5>🔮 Relics Located Here</h5>
                          <ul>
                            {items.filter((i) => i.locationId === activeLocation.id).map((i) => (
                              <li key={i.id} className="clickable-li" onClick={() => handleSelectItem(i.id)}>
                                {i.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3>Geography Directory</h3>
                    <p className="subtext">A complete listing of all regions, domains, and structures.</p>

                    <div className="list-stack mt-4">
                      {locations.map((loc) => (
                        <div key={loc.id} className="list-item clickable-node-item" onClick={() => handleSelectLocation(loc.id)}>
                          <div>
                            <strong>{loc.name}</strong>
                            <span className="subtext">Type: {loc.type} {loc.parentId ? `| Sub-location of: ${locations.find(p=>p.id===loc.parentId)?.name}` : ""}</span>
                          </div>
                          <span>📍</span>
                        </div>
                      ))}
                    </div>

                    {/* Manual Location Form */}
                    <form onSubmit={handleCreateLocation} className="creator-box-form mt-8 border-t border-white/5 pt-6">
                      <h4>Chart New Geography</h4>
                      <div className="flex gap-4 mt-4">
                        <div className="flex-1">
                          <input 
                            type="text" 
                            placeholder="Location Name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            required
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[180px]">
                          <select 
                            value={newType}
                            onChange={(e) => setNewType(e.target.value)}
                            className="workspace-input"
                          >
                            <option value="">Select Type</option>
                            <option value="Continent">Continent</option>
                            <option value="Region">Region</option>
                            <option value="City">City</option>
                            <option value="District">District</option>
                            <option value="Building">Building</option>
                            <option value="Landmark">Landmark</option>
                          </select>
                        </div>
                      </div>

                      <div className="mt-4">
                        <select
                          value={newParentId}
                          onChange={(e) => setNewParentId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">Nests Inside (Parent - Optional)</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-4">
                        <textarea
                          placeholder="Description / Chronicles..."
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          className="workspace-input"
                          rows={3}
                        />
                      </div>

                      <button type="submit" className="primary-action px-6 py-2 mt-4">
                        Chart Geography
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Characters Tab */}
            {activeTab === "characters" && (
              <div className="tab-content-container">
                {activeCharacter ? (
                  <div>
                    <div className="document-edit-mode"><LoreDocument eyebrow="Character" title={activeCharacter.name} description={activeCharacter.description || ""} references={loreReferences.filter((reference) => reference.id !== activeCharacter.id)} related={[referenceFor(activeCharacter.locationId), referenceFor(activeCharacter.factionId)].filter(Boolean) as LoreReference[]} media={<CharacterArtwork portraitUrl={activeCharacter.portraitUrl} tokenUrl={activeCharacter.tokenUrl} character={{ name: activeCharacter.name, description: activeCharacter.description || "" }} world={{ name: world.name, description: world.description }} onPortraitChange={(portraitUrl) => updateWorldData((previous) => ({ ...previous, characters: (previous.characters || []).map((entry) => typeof entry !== "string" && entry.id === activeCharacter.id ? { ...entry, portraitUrl } : entry) }))} onTokenChange={(tokenUrl) => updateWorldData((previous) => ({ ...previous, characters: (previous.characters || []).map((entry) => typeof entry !== "string" && entry.id === activeCharacter.id ? { ...entry, tokenUrl } : entry) }))} />} facts={[
                      { label: "Current location", value: activeCharacter.locationId || "", emptyLabel: "Uncharted", options: locations.map((entry) => ({ value: entry.id, label: entry.name })), onChange: (value) => updateWorldData((previous) => ({ ...previous, characters: (previous.characters || []).map((entry) => typeof entry !== "string" && entry.id === activeCharacter.id ? { ...entry, locationId: value || undefined } : entry) })) },
                      { label: "Affiliation", value: activeCharacter.factionId || "", emptyLabel: "Unaffiliated", options: organizations.map((entry) => ({ value: entry.id, label: entry.name })), onChange: (value) => updateWorldData((previous) => ({ ...previous, characters: (previous.characters || []).map((entry) => typeof entry !== "string" && entry.id === activeCharacter.id ? { ...entry, factionId: value || undefined } : entry) })) },
                    ]} onTitleChange={(value) => updateWorldData((previous) => ({ ...previous, characters: (previous.characters || []).map((entry) => typeof entry !== "string" && entry.id === activeCharacter.id ? { ...entry, name: value } : entry) }))} onDescriptionChange={(value) => updateWorldData((previous) => ({ ...previous, characters: (previous.characters || []).map((entry) => typeof entry !== "string" && entry.id === activeCharacter.id ? { ...entry, description: value } : entry) }))} actions={documentDeleteAction("characters", activeCharacter.id)} /></div>
                    <div className="breadcrumbs">
                      <span onClick={() => setSelectedItemId(null)}>Characters</span>
                      {" > "}
                      <span className="active-breadcrumb">{activeCharacter.name}</span>
                    </div>

                    <form onSubmit={handleUpdateCharacter} className="edit-form mt-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-amber-500 font-bold">NPC Name</label>
                        <input 
                          type="text" 
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="workspace-input"
                        />
                      </div>

                      <div className="flex gap-4 mt-4">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Current Location</label>
                          <select
                            value={editLocationId}
                            onChange={(e) => setEditLocationId(e.target.value)}
                            className="workspace-input"
                          >
                            <option value="">(None - Uncharted)</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Affiliated Faction</label>
                          <select
                            value={editFactionId}
                            onChange={(e) => setEditFactionId(e.target.value)}
                            className="workspace-input"
                          >
                            <option value="">(None - Unaffiliated)</option>
                            {organizations.map((o) => (
                              <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 mt-4">
                        <label className="text-xs text-amber-500 font-bold">Biography & Notes</label>
                        <textarea 
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="workspace-input"
                          rows={6}
                        />
                      </div>

                      <div className="flex gap-2 justify-between mt-4">
                        <button type="submit" className="primary-action px-6 py-2">
                          Update Character
                        </button>
                        <button 
                          type="button" 
                          className="danger-btn px-4 py-2"
                          onClick={() => handleDeleteElement("characters", activeCharacter.id)}
                        >
                          Delete NPC
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div>
                    <h3>Character Directory (NPCs)</h3>
                    <p className="subtext">Registered GameMaster personas and faction leaders.</p>

                    <div className="list-stack mt-4">
                      {characters.map((c) => (
                        <div key={c.id} className="list-item clickable-node-item" onClick={() => handleSelectCharacter(c.id)}>
                          <div>
                            <strong>{c.name}</strong>
                            <span className="subtext">
                              Location: {locations.find((l) => l.id === c.locationId)?.name || "Uncharted"} 
                              {c.factionId ? ` | Faction: ${organizations.find((o)=>o.id===c.factionId)?.name}` : ""}
                            </span>
                          </div>
                          <span>👤</span>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleCreateCharacter} className="creator-box-form mt-8 border-t border-white/5 pt-6">
                      <h4>Register New Character</h4>
                      <div className="mt-4">
                        <input 
                          type="text" 
                          placeholder="Character Name"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          required
                          className="workspace-input"
                        />
                      </div>

                      <div className="flex gap-4 mt-4">
                        <select
                          value={newLocationId}
                          onChange={(e) => setNewLocationId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">Current Location (Optional)</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>

                        <select
                          value={newFactionId}
                          onChange={(e) => setNewFactionId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">Affiliated Faction (Optional)</option>
                          {organizations.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-4">
                        <textarea
                          placeholder="Biography & Chronicles..."
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          className="workspace-input"
                          rows={3}
                        />
                      </div>

                      <button type="submit" className="primary-action px-6 py-2 mt-4">
                        Register NPC
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Organizations Tab */}
            {activeTab === "organizations" && (
              <div className="tab-content-container">
                {activeOrg ? (
                  <div>
                    <div className="document-edit-mode"><LoreDocument eyebrow={activeOrg.type || "Organization"} title={activeOrg.name} description={activeOrg.description} references={loreReferences.filter((reference) => reference.id !== activeOrg.id)} related={[referenceFor(activeOrg.baseLocationId), ...characters.filter((entry) => entry.factionId === activeOrg.id).map((entry) => referenceFor(entry.id))].filter(Boolean) as LoreReference[]} facts={[
                      { label: "Organization type", value: activeOrg.type, onChange: (value) => updateWorldData((previous) => ({ ...previous, organizations: (previous.organizations || []).map((entry) => entry.id === activeOrg.id ? { ...entry, type: value } : entry) })) },
                      { label: "Base of operations", value: activeOrg.baseLocationId || "", emptyLabel: "No fixed base", options: locations.map((entry) => ({ value: entry.id, label: entry.name })), onChange: (value) => updateWorldData((previous) => ({ ...previous, organizations: (previous.organizations || []).map((entry) => entry.id === activeOrg.id ? { ...entry, baseLocationId: value || undefined } : entry) })) },
                    ]} onTitleChange={(value) => updateWorldData((previous) => ({ ...previous, organizations: (previous.organizations || []).map((entry) => entry.id === activeOrg.id ? { ...entry, name: value } : entry) }))} onDescriptionChange={(value) => updateWorldData((previous) => ({ ...previous, organizations: (previous.organizations || []).map((entry) => entry.id === activeOrg.id ? { ...entry, description: value } : entry) }))} actions={documentDeleteAction("organizations", activeOrg.id)} /></div>
                    <div className="breadcrumbs">
                      <span onClick={() => setSelectedItemId(null)}>Factions</span>
                      {" > "}
                      <span className="active-breadcrumb">{activeOrg.name}</span>
                    </div>

                    <form onSubmit={handleUpdateOrganization} className="edit-form mt-4">
                      <div className="flex gap-4">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Faction Name</label>
                          <input 
                            type="text" 
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[180px] flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Type</label>
                          <input 
                            type="text" 
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            placeholder="e.g. Guild, Megacorp"
                            className="workspace-input"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 mt-4">
                        <label className="text-xs text-amber-500 font-bold">Base of Operations</label>
                        <select
                          value={editLocationId}
                          onChange={(e) => setEditLocationId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">(None - Uncharted)</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1 mt-4">
                        <label className="text-xs text-amber-500 font-bold">Factions Lore & Ideology</label>
                        <textarea 
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="workspace-input"
                          rows={6}
                        />
                      </div>

                      <div className="flex gap-2 justify-between mt-4">
                        <button type="submit" className="primary-action px-6 py-2">
                          Update Faction
                        </button>
                        <button 
                          type="button" 
                          className="danger-btn px-4 py-2"
                          onClick={() => handleDeleteElement("organizations", activeOrg.id)}
                        >
                          Delete Faction
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div>
                    <h3>Factions & Organizations</h3>
                    <p className="subtext">Guilds, syndicates, and magical cabals shaping the political landscape.</p>

                    <div className="list-stack mt-4">
                      {organizations.map((o) => (
                        <div key={o.id} className="list-item clickable-node-item" onClick={() => handleSelectOrganization(o.id)}>
                          <div>
                            <strong>{o.name}</strong>
                            <span className="subtext">Type: {o.type} | Base Location: {locations.find((l) => l.id === o.baseLocationId)?.name || "Uncharted"}</span>
                          </div>
                          <span>🛡️</span>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleCreateOrganization} className="creator-box-form mt-8 border-t border-white/5 pt-6">
                      <h4>Establish New Faction</h4>
                      <div className="flex gap-4 mt-4">
                        <div className="flex-1">
                          <input 
                            type="text" 
                            placeholder="Faction Name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            required
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[180px]">
                          <input 
                            type="text" 
                            placeholder="Type (e.g. Syndicate)"
                            value={newType}
                            onChange={(e) => setNewType(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                      </div>

                      <div className="mt-4">
                        <select
                          value={newLocationId}
                          onChange={(e) => setNewLocationId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">Base Location (Optional)</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-4">
                        <textarea
                          placeholder="Establish alignment, motives, and assets..."
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          className="workspace-input"
                          rows={3}
                        />
                      </div>

                      <button type="submit" className="primary-action px-6 py-2 mt-4">
                        Establish Faction
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Events / Timeline Tab */}
            {activeTab === "events" && (
              <div className="tab-content-container">
                {activeEvent ? (
                  <div>
                    <div className="document-edit-mode"><LoreDocument eyebrow="Historical event" title={activeEvent.name} description={activeEvent.description} references={loreReferences.filter((reference) => reference.id !== activeEvent.id)} facts={[{ label: "When", value: activeEvent.year, onChange: (value) => updateWorldData((previous) => ({ ...previous, events: (previous.events || []).map((entry) => entry.id === activeEvent.id ? { ...entry, year: value } : entry) })) }]} onTitleChange={(value) => updateWorldData((previous) => ({ ...previous, events: (previous.events || []).map((entry) => entry.id === activeEvent.id ? { ...entry, name: value } : entry) }))} onDescriptionChange={(value) => updateWorldData((previous) => ({ ...previous, events: (previous.events || []).map((entry) => entry.id === activeEvent.id ? { ...entry, description: value } : entry) }))} actions={documentDeleteAction("events", activeEvent.id)} /></div>
                    <div className="breadcrumbs">
                      <span onClick={() => setSelectedItemId(null)}>Events</span>
                      {" > "}
                      <span className="active-breadcrumb">{activeEvent.name}</span>
                    </div>

                    <form onSubmit={handleUpdateEvent} className="edit-form mt-4">
                      <div className="flex gap-4">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Event Title</label>
                          <input 
                            type="text" 
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[150px] flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Year/Age</label>
                          <input 
                            type="text" 
                            value={editYear}
                            onChange={(e) => setEditYear(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 mt-4">
                        <label className="text-xs text-amber-500 font-bold">Historical Record</label>
                        <textarea 
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="workspace-input"
                          rows={6}
                        />
                      </div>

                      <div className="flex gap-2 justify-between mt-4">
                        <button type="submit" className="primary-action px-6 py-2">
                          Update Event
                        </button>
                        <button 
                          type="button" 
                          className="danger-btn px-4 py-2"
                          onClick={() => handleDeleteElement("events", activeEvent.id)}
                        >
                          Delete Event
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div>
                    <h3>Chronological Timeline</h3>
                    <p className="subtext">Key moments and historic periods that define this realm.</p>

                    <div className="list-stack mt-4">
                      {events.sort((a,b)=>a.year.localeCompare(b.year)).map((ev) => (
                        <div key={ev.id} className="list-item clickable-node-item" onClick={() => handleSelectEvent(ev.id)}>
                          <div>
                            <strong>{ev.name}</strong>
                            <span className="subtext">Epoch: {ev.year}</span>
                          </div>
                          <span>⏳</span>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleCreateEvent} className="creator-box-form mt-8 border-t border-white/5 pt-6">
                      <h4>Log Historic Event</h4>
                      <div className="flex gap-4 mt-4">
                        <div className="flex-1">
                          <input 
                            type="text" 
                            placeholder="Event Title"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            required
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[150px]">
                          <input 
                            type="text" 
                            placeholder="Year (e.g. 403 AC)"
                            value={newYear}
                            onChange={(e) => setNewYear(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                      </div>

                      <div className="mt-4">
                        <textarea
                          placeholder="Describe the incident, participants, and aftermath..."
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          className="workspace-input"
                          rows={3}
                        />
                      </div>

                      <button type="submit" className="primary-action px-6 py-2 mt-4">
                        Log Event
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Items & Relics Tab */}
            {activeTab === "items" && (
              <div className="tab-content-container">
                {activeItem ? (
                  <div>
                    <div className="document-edit-mode"><LoreDocument eyebrow={activeItem.type || "Item"} title={activeItem.name} description={activeItem.description} references={loreReferences.filter((reference) => reference.id !== activeItem.id)} related={[referenceFor(activeItem.locationId)].filter(Boolean) as LoreReference[]} facts={[
                      { label: "Item type", value: activeItem.type, onChange: (value) => updateWorldData((previous) => ({ ...previous, items: (previous.items || []).map((entry) => entry.id === activeItem.id ? { ...entry, type: value } : entry) })) },
                      { label: "Located at", value: activeItem.locationId || "", emptyLabel: "Location unknown", options: locations.map((entry) => ({ value: entry.id, label: entry.name })), onChange: (value) => updateWorldData((previous) => ({ ...previous, items: (previous.items || []).map((entry) => entry.id === activeItem.id ? { ...entry, locationId: value || undefined } : entry) })) },
                    ]} onTitleChange={(value) => updateWorldData((previous) => ({ ...previous, items: (previous.items || []).map((entry) => entry.id === activeItem.id ? { ...entry, name: value } : entry) }))} onDescriptionChange={(value) => updateWorldData((previous) => ({ ...previous, items: (previous.items || []).map((entry) => entry.id === activeItem.id ? { ...entry, description: value } : entry) }))} actions={documentDeleteAction("items", activeItem.id)} /></div>
                    <div className="breadcrumbs">
                      <span onClick={() => setSelectedItemId(null)}>Relics & Items</span>
                      {" > "}
                      <span className="active-breadcrumb">{activeItem.name}</span>
                    </div>

                    <form onSubmit={handleUpdateItem} className="edit-form mt-4">
                      <div className="flex gap-4">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Item Name</label>
                          <input 
                            type="text" 
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[180px] flex flex-col gap-1">
                          <label className="text-xs text-amber-500 font-bold">Type</label>
                          <input 
                            type="text" 
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            placeholder="e.g. Weapon, Key Item"
                            className="workspace-input"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 mt-4">
                        <label className="text-xs text-amber-500 font-bold">Current Location</label>
                        <select
                          value={editLocationId}
                          onChange={(e) => setEditLocationId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">(None - Uncharted)</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1 mt-4">
                        <label className="text-xs text-amber-500 font-bold">Item Description & Powers</label>
                        <textarea 
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="workspace-input"
                          rows={6}
                        />
                      </div>

                      <div className="flex gap-2 justify-between mt-4">
                        <button type="submit" className="primary-action px-6 py-2">
                          Update Item
                        </button>
                        <button 
                          type="button" 
                          className="danger-btn px-4 py-2"
                          onClick={() => handleDeleteElement("items", activeItem.id)}
                        >
                          Delete Item
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div>
                    <h3>Relic & Item Inventory</h3>
                    <p className="subtext">Legendary weapons, ancient keys, and powerful components.</p>

                    <div className="list-stack mt-4">
                      {items.map((it) => (
                        <div key={it.id} className="list-item clickable-node-item" onClick={() => handleSelectItem(it.id)}>
                          <div>
                            <strong>{it.name}</strong>
                            <span className="subtext">Type: {it.type} | Current Location: {locations.find((l) => l.id === it.locationId)?.name || "Uncharted"}</span>
                          </div>
                          <span>🔮</span>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleCreateItem} className="creator-box-form mt-8 border-t border-white/5 pt-6">
                      <h4>Chronicle Legendary Item</h4>
                      <div className="flex gap-4 mt-4">
                        <div className="flex-1">
                          <input 
                            type="text" 
                            placeholder="Item Name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            required
                            className="workspace-input"
                          />
                        </div>
                        <div className="w-[180px]">
                          <input 
                            type="text" 
                            placeholder="Type (e.g. Weapon)"
                            value={newType}
                            onChange={(e) => setNewType(e.target.value)}
                            className="workspace-input"
                          />
                        </div>
                      </div>

                      <div className="mt-4">
                        <select
                          value={newLocationId}
                          onChange={(e) => setNewLocationId(e.target.value)}
                          className="workspace-input"
                        >
                          <option value="">Current Location (Optional)</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-4">
                        <textarea
                          placeholder="Describe the artifact's properties, materials, or history..."
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          className="workspace-input"
                          rows={3}
                        />
                      </div>

                      <button type="submit" className="primary-action px-6 py-2 mt-4">
                        Forge Item
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Relations Tab */}
            {activeTab === "relations" && (
              <div className="tab-content-container">
                <h3>LevelGraph Relationship network</h3>
                <p className="subtext">Manage semantic triple connections recorded in the LevelGraph DB.</p>

                <div className="triples-list-stack mt-4">
                  {triples.length === 0 ? (
                    <p className="empty-triples text-center p-8 text-muted">No semantic triples defined yet.</p>
                  ) : (
                    triples.map((triple, idx) => (
                      <div key={idx} className="triple-card-row">
                        <div className="triple-part bg-purple-950/20">{triple.subject}</div>
                        <div className="triple-pred bg-amber-950/20">── {triple.predicate} ──▶</div>
                        <div className="triple-part bg-purple-950/20">{triple.object}</div>
                        <button 
                          className="delete-triple-btn"
                          title="Sever Connection"
                          onClick={() => handleDeleteTriple(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Triple Manual Creator Form */}
                <form onSubmit={handleCreateTriple} className="creator-box-form mt-8 border-t border-white/5 pt-6">
                  <h4>Forge Relationship Link</h4>
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div>
                      <input 
                        type="text" 
                        placeholder="Subject Entity"
                        value={newTripleSubject}
                        onChange={(e) => setNewTripleSubject(e.target.value)}
                        required
                        className="workspace-input"
                        list="entities-list"
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        placeholder="Predicate (rules, guards...)"
                        value={newTriplePredicate}
                        onChange={(e) => setNewTriplePredicate(e.target.value)}
                        required
                        className="workspace-input"
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        placeholder="Object Entity"
                        value={newTripleObject}
                        onChange={(e) => setNewTripleObject(e.target.value)}
                        required
                        className="workspace-input"
                        list="entities-list"
                      />
                    </div>
                  </div>

                  {/* Datalist for entity autocomplete */}
                  <datalist id="entities-list">
                    <option value={world.name} />
                    {locations.map(l => <option key={l.id} value={l.name} />)}
                    {characters.map(c => <option key={c.id} value={c.name} />)}
                    {organizations.map(o => <option key={o.id} value={o.name} />)}
                    {items.map(i => <option key={i.id} value={i.name} />)}
                  </datalist>

                  <button type="submit" className="primary-action px-6 py-2 mt-4">
                    Link Entities
                  </button>
                </form>
              </div>
            )}
          </div>
        </main>

        {/* Column 3: AI Co-pilot Panel */}
        <aside className="workspace-copilot">
          <div className="copilot-header">
            <h3>AI Co-pilot</h3>
          </div>

          <div className="copilot-body">
            {/* Dynamic Authoring Cues */}
            <div className="copilot-section card-surface-sub">
              <h4>Authoring Cues</h4>
              <p className="section-subtext">Checklist suggestions to expand your setting.</p>
              
              <div className="cue-list mt-3">
                {/* World checks */}
                {organizations.length === 0 && (
                  <button 
                    className="cue-item"
                    onClick={() => {
                      setAiElementType("organization");
                      setAiPrompt(`Dominant guild or faction in ${world.name}`);
                    }}
                  >
                    🚩 No organizations charted. Define a ruling faction.
                  </button>
                )}
                {events.length === 0 && (
                  <button 
                    className="cue-item"
                    onClick={() => {
                      setAiElementType("event");
                      setAiPrompt(`A major cataclysm or war that shaped ${world.name}`);
                    }}
                  >
                    🚩 Timeline is empty. Define a historic event.
                  </button>
                )}
                {/* Location checks */}
                {activeLocation && characters.filter(c => c.locationId === activeLocation.id).length === 0 && (
                  <button 
                    className="cue-item"
                    onClick={() => {
                      setAiElementType("character");
                      setAiPrompt(`An NPC living in ${activeLocation.name}`);
                    }}
                  >
                    🚩 No NPCs in {activeLocation.name}. Generate a local figure.
                  </button>
                )}
                {activeLocation && items.filter(i => i.locationId === activeLocation.id).length === 0 && (
                  <button 
                    className="cue-item"
                    onClick={() => {
                      setAiElementType("item");
                      setAiPrompt(`A legendary magic artifact hidden in ${activeLocation.name}`);
                    }}
                  >
                    🚩 No relics in {activeLocation.name}. Hide an item here.
                  </button>
                )}
                <div className="cue-generic-text text-[11px] text-muted-strong mt-2">
                  {activeLocation ? `💡 AI context set to Location: ${activeLocation.name}` : `💡 AI context set to World: ${world.name}`}
                </div>
              </div>
            </div>

            {/* Element AI Generator */}
            <div className="copilot-section card-surface-sub mt-4">
              <h4>Invoke AI Generator</h4>
              <form onSubmit={handleAIGenerateElement} className="mt-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-amber-500 font-bold">Element Type</label>
                  <select 
                    value={aiElementType}
                    onChange={(e) => setAiElementType(e.target.value as "location" | "character" | "organization" | "event" | "item")}
                    className="workspace-input"
                  >
                    <option value="location">📍 Location / Structure</option>
                    <option value="character">👥 NPC / Character</option>
                    <option value="organization">🛡️ Organization / Faction</option>
                    <option value="event">⏳ Historical Event</option>
                    <option value="item">🔮 Item / Relic</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 mt-3">
                  <label className="text-xs text-amber-500 font-bold">Concept Prompt</label>
                  <textarea
                    placeholder={
                      aiElementType === "character" 
                        ? "e.g. a legendary rogue wizard holding ancient scrolls" 
                        : aiElementType === "location" 
                          ? "e.g. a glowing obsidian tower under the city" 
                          : "Describe your concept..."
                    }
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    required
                    className="workspace-input"
                    rows={4}
                  />
                </div>

                <button 
                  type="submit" 
                  className={`primary-action w-full mt-3 py-2 font-semibold ${isAiGenerating ? "loading-btn" : ""}`}
                  disabled={isAiGenerating || !aiPrompt.trim()}
                >
                  {isAiGenerating ? "Invoking AI..." : "Draft Lore Element"}
                </button>
              </form>

              {/* RENDER DRAFT PANEL */}
              {aiDraft && (
                <div className="ai-draft-card mt-4 border border-amber-500/30 bg-amber-500/5 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-amber-400 font-bold uppercase tracking-wider">AI Draft</span>
                    <button className="text-xs text-muted hover:text-white" onClick={() => setAiDraft(null)}>Discard</button>
                  </div>
                  <h4 className="text-white text-sm font-semibold">{aiDraft.name}</h4>
                  <p className="text-[12px] text-muted mt-1 leading-normal">{aiDraft.description}</p>
                  
                  {aiDraft.relations && aiDraft.relations.length > 0 && (
                    <div className="draft-relations mt-2">
                      <span className="text-[10px] text-amber-500/70 font-semibold block mb-1">Suggested Connections:</span>
                      {aiDraft.relations.map((r, i) => (
                        <div key={i} className="text-[10px] text-muted italic">
                          • {r.subject} {r.predicate} {r.object}
                        </div>
                      ))}
                    </div>
                  )}

                  <button 
                    className="primary-action glowing-btn w-full mt-3 py-2 text-xs font-semibold"
                    onClick={handleForgeDraft}
                  >
                    Forge into Chronicle
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
