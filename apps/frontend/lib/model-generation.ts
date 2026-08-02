export type CharacterModelGenerationStatus =
  | "queued"
  | "running"
  | "persisting"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CharacterModelGeneration = {
  error?: string;
  id: string;
  inputType: "image" | "text";
  progress: number;
  seed: number;
  stage: string;
  status: CharacterModelGenerationStatus;
  url?: string;
};

async function generationResponse(response: Response): Promise<CharacterModelGeneration> {
  const result = await response.json().catch(() => ({})) as Partial<CharacterModelGeneration> & {
    message?: string;
  };
  if (!response.ok || typeof result.id !== "string") {
    throw new Error(result.message || "3D token generation could not be started.");
  }
  return result as CharacterModelGeneration;
}

export function createCharacterModelFromText(
  characterName: string,
  prompt: string,
): Promise<CharacterModelGeneration> {
  return fetch("/api/character-assets/generations/text", {
    body: JSON.stringify({ characterName, prompt }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then(generationResponse);
}

export function createCharacterModelFromImage({
  characterName,
  image,
  sourceImageUrl,
}: {
  characterName: string;
  image?: File;
  sourceImageUrl?: string;
}): Promise<CharacterModelGeneration> {
  const form = new FormData();
  form.append("characterName", characterName);
  if (image) form.append("image", image);
  if (sourceImageUrl) form.append("sourceImageUrl", sourceImageUrl);
  return fetch("/api/character-assets/generations/image", {
    body: form,
    method: "POST",
  }).then(generationResponse);
}

export function getCharacterModelGeneration(id: string): Promise<CharacterModelGeneration> {
  return fetch(`/api/character-assets/generations/${encodeURIComponent(id)}`, {
    cache: "no-store",
  }).then(generationResponse);
}

export function cancelCharacterModelGeneration(id: string): Promise<CharacterModelGeneration> {
  return fetch(`/api/character-assets/generations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then(generationResponse);
}
