export type LoreImagePurpose = "world-map" | "location-map" | "portrait" | "token" | "handout";

const MEDIA_IMAGE_PATH = /^\/api\/media-assets\/\d+\/[^/]+$/;

export async function uploadLoreImage(
  file: File,
  purpose: LoreImagePurpose = "handout",
  altText?: string,
) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be smaller than 5 MB.");
  const form = new FormData();
  form.append("file", file);
  const query = new URLSearchParams({ type: "image", purpose });
  if (altText?.trim()) query.set("altText", altText.trim());
  const response = await fetch(`/api/media-assets?${query}`, { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || !result.url) throw new Error(result.message || "The image could not be uploaded.");
  return result.url as string;
}

export async function deleteLoreImage(url?: string) {
  if (!url || !MEDIA_IMAGE_PATH.test(url)) return;
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(result.message || "The image could not be removed.");
  }
}
