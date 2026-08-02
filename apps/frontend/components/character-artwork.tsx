"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { deleteLoreImage, uploadLoreImage } from "@/lib/image-uploads";
import {
  cancelCharacterModelGeneration,
  createCharacterModelFromImage,
  createCharacterModelFromText,
  getCharacterModelGeneration,
} from "@/lib/model-generation";
import type { CharacterModelGeneration } from "@/lib/model-generation";
import { deleteCharacterModel, uploadCharacterModel } from "@/lib/model-uploads";

type ArtKind = "portrait" | "token";
type CharacterContext = { name: string; description: string };
type WorldContext = { name: string; description: string };

const CharacterToken3DViewer = dynamic(
  () => import("@/components/character-token-3d-viewer")
    .then((module) => module.CharacterToken3DViewer),
  {
    loading: () => (
      <div className="character-token-3d-loading" role="status">
        Preparing 3D preview…
      </div>
    ),
    ssr: false,
  },
);

function ArtworkPanel({
  character,
  kind,
  onChange,
  referenceUrl,
  url,
  world,
}: {
  character: CharacterContext;
  kind: ArtKind;
  onChange: (url?: string) => void;
  referenceUrl?: string;
  url?: string;
  world: WorldContext;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const isToken = kind === "token";
  const label = isToken ? "2D token" : "Portrait";

  async function replace(nextUrl: string) {
    await deleteLoreImage(url);
    onChange(nextUrl);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWorking(true);
    setError(undefined);
    try {
      await replace(await uploadLoreImage(
        file,
        kind,
        `${character.name} ${label.toLowerCase()}`,
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setWorking(false);
    }
  }

  async function generate() {
    setWorking(true);
    setError(undefined);
    try {
      const response = await fetch("/api/generate/character-art", {
        body: JSON.stringify({
          description: character.description,
          kind,
          name: character.name,
          referenceUrl,
          worldDescription: world.description,
          worldName: world.name,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || !result.url) {
        throw new Error(result.message || "Artwork could not be generated.");
      }
      await replace(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setWorking(true);
    setError(undefined);
    try {
      await deleteLoreImage(url);
      onChange(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Removal failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className={`character-art-panel ${kind}`}>
      <div
        aria-label={url ? `${label} preview for ${character.name}` : undefined}
        className="character-art-preview"
        role={url ? "img" : undefined}
        style={url ? { backgroundImage: `url(${url})` } : undefined}
      >
        {!url ? <span>{label}</span> : null}
      </div>
      <div className="character-art-controls">
        <div>
          <span className="eyebrow">{label}</span>
          <p>
            {isToken
              ? "Square character art for maps and virtual tabletops."
              : "Character art for handouts and the chronicle."}
          </p>
          {referenceUrl ? (
            <span className="art-reference-note">
              Uses the existing {isToken ? "portrait" : "2D token"} as a visual reference.
            </span>
          ) : null}
        </div>
        {error ? <small role="alert">{error}</small> : null}
        <div>
          <button disabled={working} onClick={generate} type="button">
            {working ? "Working…" : url ? "Regenerate" : "Generate with AI"}
          </button>
          <button
            disabled={working}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            {url ? "Replace upload" : "Upload"}
          </button>
          {url ? (
            <button className="remove" disabled={working} onClick={remove} type="button">
              Remove
            </button>
          ) : null}
          <input
            accept="image/png,image/jpeg,image/gif,image/webp"
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={upload}
            ref={fileInput}
            type="file"
          />
        </div>
      </div>
    </section>
  );
}

function ModelPanel({
  character,
  onChange,
  sourceImageUrl,
  url,
}: {
  character: CharacterContext;
  onChange: (url?: string) => void;
  sourceImageUrl?: string;
  url?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceImageInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [generation, setGeneration] = useState<CharacterModelGeneration>();
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWorking(true);
    setError(undefined);
    try {
      const nextUrl = await uploadCharacterModel(file);
      onChange(nextUrl);
      try {
        await deleteCharacterModel(url);
      } catch {
        setError("The new model is saved, but the previous upload could not be cleaned up.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setWorking(true);
    setError(undefined);
    try {
      await deleteCharacterModel(url);
      onChange(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Removal failed.");
    } finally {
      setWorking(false);
    }
  }

  async function waitForGeneration(initial: CharacterModelGeneration) {
    let current = initial;
    setGeneration(current);
    while (!["succeeded", "failed", "cancelled"].includes(current.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!mounted.current) return;
      current = await getCharacterModelGeneration(current.id);
      setGeneration(current);
    }
    if (current.status === "failed") {
      throw new Error(current.error || "Shap-E could not generate this token.");
    }
    if (current.status === "cancelled") return;
    if (!current.url) throw new Error("The generated model was not saved.");

    onChange(current.url);
    try {
      await deleteCharacterModel(url);
    } catch {
      setError("The generated model is saved, but the previous model could not be cleaned up.");
    }
  }

  async function generate(start: () => Promise<CharacterModelGeneration>) {
    setWorking(true);
    setError(undefined);
    setGeneration(undefined);
    try {
      await waitForGeneration(await start());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed.");
    } finally {
      if (mounted.current) setWorking(false);
    }
  }

  function generateFromExistingArt() {
    if (!sourceImageUrl) {
      setError("Add a 2D token or portrait before generating from existing art.");
      return;
    }
    void generate(() => createCharacterModelFromImage({
      characterName: character.name,
      sourceImageUrl,
    }));
  }

  function generateFromPrompt() {
    if (!prompt.trim()) {
      setError("Enter a text prompt for the 3D token.");
      return;
    }
    void generate(() => createCharacterModelFromText(character.name, prompt.trim()));
  }

  async function generateFromUploadedImage(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image) return;
    await generate(() => createCharacterModelFromImage({
      characterName: character.name,
      image,
    }));
  }

  async function cancelGeneration() {
    if (!generation || ["succeeded", "failed", "cancelled"].includes(generation.status)) return;
    try {
      setGeneration(await cancelCharacterModelGeneration(generation.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation could not be cancelled.");
    }
  }

  return (
    <section className="character-art-panel token-3d">
      <div className="character-art-preview character-token-3d-preview">
        {url ? (
          <CharacterToken3DViewer url={url} />
        ) : (
          <span>3D token</span>
        )}
      </div>
      <div className="character-art-controls">
        <div>
          <span className="eyebrow">3D token</span>
          <p>
            A CMS-backed model previewed from above. Drag horizontally to inspect every side.
          </p>
          {sourceImageUrl ? (
            <span className="art-reference-note">
              The 2D character art is ready to use as the Shap-E source image.
            </span>
          ) : null}
        </div>
        {error ? <small role="alert">{error}</small> : null}
        <fieldset className="fieldset character-token-prompt">
          <legend className="fieldset-legend">Text-to-3D prompt</legend>
          <textarea
            className="textarea"
            disabled={working}
            maxLength={1000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={`Describe ${character.name}'s appearance, pose, clothing, and colors…`}
            rows={3}
            value={prompt}
          />
          <p className="label">Used only when generating from text.</p>
        </fieldset>
        {generation ? (
          <div className="character-token-generation" role="status">
            <div>
              <span>{generation.stage}</span>
              <span>{generation.progress}%</span>
            </div>
            <progress
              aria-label="3D token generation progress"
              className="progress"
              max={100}
              value={generation.progress}
            />
          </div>
        ) : null}
        <div>
          <button className="btn" disabled={working || !sourceImageUrl} onClick={generateFromExistingArt} type="button">
            Generate from 2D art
          </button>
          <button className="btn" disabled={working || !prompt.trim()} onClick={generateFromPrompt} type="button">
            Generate from prompt
          </button>
          <button
            className="btn"
            disabled={working}
            onClick={() => sourceImageInput.current?.click()}
            type="button"
          >
            Generate from image
          </button>
          <button
            className="btn"
            disabled={working}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            {url ? "Replace upload" : "Upload model"}
          </button>
          {url ? (
            <button className="btn remove" disabled={working} onClick={remove} type="button">
              Remove
            </button>
          ) : null}
          {working && generation ? (
            <button className="btn remove" onClick={cancelGeneration} type="button">
              Cancel generation
            </button>
          ) : null}
          <input
            accept=".obj,.glb,.gltf,.ply,.stl,model/obj,model/gltf-binary,model/gltf+json,model/ply,model/stl"
            aria-label={`Upload 3D token for ${character.name}`}
            onChange={upload}
            ref={fileInput}
            type="file"
          />
          <input
            accept="image/png,image/jpeg,image/gif,image/webp"
            aria-label={`Generate 3D token for ${character.name} from a source image`}
            onChange={generateFromUploadedImage}
            ref={sourceImageInput}
            type="file"
          />
        </div>
      </div>
    </section>
  );
}

export function CharacterArtwork({
  character,
  onPortraitChange,
  onToken3dChange,
  onTokenChange,
  portraitUrl,
  token3dUrl,
  tokenUrl,
  world,
}: {
  character: CharacterContext;
  onPortraitChange: (url?: string) => void;
  onToken3dChange: (url?: string) => void;
  onTokenChange: (url?: string) => void;
  portraitUrl?: string;
  token3dUrl?: string;
  tokenUrl?: string;
  world: WorldContext;
}) {
  return (
    <div className="character-artwork">
      <ArtworkPanel
        character={character}
        kind="portrait"
        onChange={onPortraitChange}
        referenceUrl={tokenUrl}
        url={portraitUrl}
        world={world}
      />
      <div className="character-token-stack">
        <ArtworkPanel
          character={character}
          kind="token"
          onChange={onTokenChange}
          referenceUrl={portraitUrl}
          url={tokenUrl}
          world={world}
        />
        <ModelPanel
          character={character}
          onChange={onToken3dChange}
          sourceImageUrl={tokenUrl || portraitUrl}
          url={token3dUrl}
        />
      </div>
    </div>
  );
}
