export async function uploadLoreImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be smaller than 5 MB.");
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/uploads/images", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || !result.url) throw new Error(result.message || "The image could not be uploaded.");
  return result.url as string;
}

export async function deleteLoreImage(url?: string) {
  if (!url?.startsWith("/api/uploads/images/")) return;
  await fetch(url, { method: "DELETE" });
}
