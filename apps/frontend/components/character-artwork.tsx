"use client";

import { ChangeEvent, useRef, useState } from "react";
import { deleteLoreImage, uploadLoreImage } from "@/lib/image-uploads";

type ArtKind = "portrait" | "token";

function ArtworkPanel({ kind, url, referenceUrl, character, world, onChange }: { kind: ArtKind; url?: string; referenceUrl?: string; character: { name: string; description: string }; world: { name: string; description: string }; onChange: (url?: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  async function replace(nextUrl: string) { await deleteLoreImage(url); onChange(nextUrl); }
  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setWorking(true); setError(undefined); try { await replace(await uploadLoreImage(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed."); } finally { setWorking(false); } }
  async function generate() { setWorking(true); setError(undefined); try { const response = await fetch("/api/generate/character-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, name: character.name, description: character.description, worldName: world.name, worldDescription: world.description, referenceUrl }) }); const result = await response.json(); if (!response.ok || !result.url) throw new Error(result.message || "Artwork could not be generated."); await replace(result.url); } catch (cause) { setError(cause instanceof Error ? cause.message : "Generation failed."); } finally { setWorking(false); } }
  return <section className={`character-art-panel ${kind}`}><div className="character-art-preview" style={url ? { backgroundImage: `url(${url})` } : undefined}>{!url && <span>{kind === "portrait" ? "Portrait" : "Token"}</span>}</div><div className="character-art-controls"><div><span className="eyebrow">{kind}</span><p>{kind === "portrait" ? "Character art for handouts and the chronicle." : "Square art for maps and virtual tabletops."}</p>{referenceUrl && <span className="art-reference-note">Uses existing {kind === "portrait" ? "token" : "portrait"} as its visual reference.</span>}</div>{error && <small>{error}</small>}<div><button type="button" disabled={working} onClick={generate}>{working ? "Working..." : url ? "Regenerate" : "Generate with AI"}</button><button type="button" disabled={working} onClick={() => fileInput.current?.click()}>{url ? "Replace upload" : "Upload"}</button>{url && <button className="remove" type="button" onClick={async () => { await deleteLoreImage(url); onChange(undefined); }}>Remove</button>}<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={upload} /></div></div></section>;
}

export function CharacterArtwork({ portraitUrl, tokenUrl, character, world, onPortraitChange, onTokenChange }: { portraitUrl?: string; tokenUrl?: string; character: { name: string; description: string }; world: { name: string; description: string }; onPortraitChange: (url?: string) => void; onTokenChange: (url?: string) => void }) {
  return <div className="character-artwork"><ArtworkPanel kind="portrait" url={portraitUrl} referenceUrl={tokenUrl} character={character} world={world} onChange={onPortraitChange} /><ArtworkPanel kind="token" url={tokenUrl} referenceUrl={portraitUrl} character={character} world={world} onChange={onTokenChange} /></div>;
}
