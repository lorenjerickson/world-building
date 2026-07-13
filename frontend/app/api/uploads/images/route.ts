import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${backendUrl}/api/uploads/images`, { method: "POST", body: await request.formData() });
  const result = await response.json();
  if (!response.ok) return NextResponse.json(result, { status: response.status });
  return NextResponse.json({ ...result, url: `/api/uploads/images/${encodeURIComponent(result.filename)}` });
}
