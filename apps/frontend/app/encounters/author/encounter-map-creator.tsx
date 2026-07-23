"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

export function EncounterMapCreator() {
  const [encounterId, setEncounterId] = useState("encounter-demo");
  const [campaignId, setCampaignId] = useState("campaign-demo");
  const [name, setName] = useState("New encounter map");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/encounters/${encodeURIComponent(encounterId.trim())}/maps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignExternalId: campaignId.trim(), commandId: crypto.randomUUID(), name: name.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? "Map creation failed.");
        return;
      }
      window.location.assign(`/encounters/${encodeURIComponent(encounterId.trim())}/maps/${body.id}/drafts/${body.draft.id}`);
    } catch {
      setError("The encounter map service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="dashboard-container encounter-setup-container">
      <header className="dashboard-header">
        <div className="header-left">
          <span className="eyebrow">Encounter authoring</span>
          <h2>Create an encounter map</h2>
        </div>
        <div className="section-actions">
          <Link href="/dashboard" className="secondary-action">Back to dashboard</Link>
        </div>
      </header>

      <section className="card-surface encounter-setup-panel">
        <div className="recent-section-header encounter-setup-intro">
          <div>
            <span className="eyebrow">Map setup</span>
            <h3>Connect the map to its campaign</h3>
            <p>Choose stable campaign and encounter identifiers, then name the working map. The editor will open with a private draft.</p>
          </div>
        </div>

        <form className="encounter-setup-form" onSubmit={create}>
          <div className="rule-set-form-grid">
            <label className="rule-set-field">
              <span>Campaign external ID</span>
              <input required value={campaignId} onChange={(event) => setCampaignId(event.target.value)} autoComplete="off" />
              <small>The campaign that owns this encounter.</small>
            </label>
            <label className="rule-set-field">
              <span>Encounter external ID</span>
              <input required value={encounterId} onChange={(event) => setEncounterId(event.target.value)} autoComplete="off" />
              <small>The encounter this map will be finalized for.</small>
            </label>
            <label className="rule-set-field rule-set-field-wide">
              <span>Map name</span>
              <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          </div>

          {error && <p className="rule-set-notice error" role="alert">{error}</p>}

          <div className="rule-set-form-actions">
            <span>Creates a private workspace draft. Payload and object-storage credentials remain behind the application gateway.</span>
            <button type="submit" className="primary-action" disabled={busy || !campaignId.trim() || !encounterId.trim() || !name.trim()}>
              {busy ? "Creating…" : "Create map"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
