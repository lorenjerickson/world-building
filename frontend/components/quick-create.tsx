"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function QuickCreate({ type, worldId, campaignId }: { type: "campaign" | "session"; worldId: string; campaignId?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const id = `${type}-${Date.now()}`;
    router.push(type === "campaign" ? `/world/${encodeURIComponent(worldId)}/campaign/${id}` : `/world/${encodeURIComponent(worldId)}/campaign/${campaignId}/session/${id}`);
  }
  return <main className="dashboard-container">
    <header className="dashboard-header"><div className="header-left"><span className="eyebrow">New {type}</span><h2>{type === "campaign" ? "Begin a new adventure" : "Log a game session"}</h2></div><button className="secondary-action" onClick={() => router.back()}>Cancel</button></header>
    <form className="card-surface prompt-form" onSubmit={submit}><label><span>{type === "campaign" ? "Campaign name" : "Session title"}</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === "campaign" ? "The Ashen Prophecy" : "Into the ruined observatory"} /></label><button className="primary-action" type="submit">Create {type}</button></form>
  </main>;
}
