import { NextResponse } from "next/server";

const backend = () => process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  // Let the browser/CDN honor the immutable response header; Next's data cache
  // rejects generated images larger than 2 MB.
  const response = await fetch(`${backend()}/uploads/${encodeURIComponent(filename)}`, { cache: "no-store" });
  if (!response.ok) return new NextResponse(null, { status: response.status });
  return new NextResponse(response.body, { status: 200, headers: { "Content-Type": response.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const response = await fetch(`${backend()}/api/uploads/images/${encodeURIComponent(filename)}`, { method: "DELETE" });
  return NextResponse.json(await response.json(), { status: response.status });
}
