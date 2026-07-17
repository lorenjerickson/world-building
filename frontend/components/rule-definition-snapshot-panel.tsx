'use client';

import { useEffect, useState } from 'react';
import {
  listDefinitionSnapshots,
  restoreDefinitionSnapshot,
  RuleDefinitionResource,
  RuleDefinitionSnapshotResource,
  RuleSetApiError,
} from '@/lib/rule-sets';

function formatReason(reason: RuleDefinitionSnapshotResource['reason']): string {
  switch (reason) {
    case 'autosave': return 'Before save';
    case 'restore': return 'Before restore';
    case 'import': return 'Before import';
    case 'manual': return 'Manual';
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function RuleDefinitionSnapshotPanel({
  ruleSetId,
  definitionId,
  onRestored,
}: {
  ruleSetId: number;
  definitionId: number;
  onRestored: (definition: RuleDefinitionResource) => void;
}) {
  const [snapshots, setSnapshots] = useState<RuleDefinitionSnapshotResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [restoringId, setRestoringId] = useState<string>();

  useEffect(() => {
    setLoading(true);
    setError(undefined);
    listDefinitionSnapshots(ruleSetId, definitionId)
      .then(setSnapshots)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load history.'))
      .finally(() => setLoading(false));
  }, [ruleSetId, definitionId]);

  async function restore(snapshotId: string) {
    setRestoringId(snapshotId);
    setError(undefined);
    try {
      const definition = await restoreDefinitionSnapshot(ruleSetId, definitionId, snapshotId);
      onRestored(definition);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'Restore failed.');
    } finally {
      setRestoringId(undefined);
    }
  }

  if (loading) return <p className="subtext">Loading history…</p>;

  return (
    <div className="snapshot-panel">
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      {snapshots.length === 0
        ? <p className="subtext">No edit history yet. History is captured automatically before each save.</p>
        : (
          <ul className="snapshot-list">
            {snapshots.map((s) => (
              <li key={s.id} className="snapshot-entry">
                <div className="snapshot-entry-meta">
                  <span className="snapshot-name">{s.name}</span>
                  <span className="subtext">{formatReason(s.reason)} · {timeAgo(s.createdAt)}</span>
                </div>
                <button
                  type="button"
                  className="secondary-action compact-action"
                  onClick={() => restore(s.id)}
                  disabled={!!restoringId}
                >
                  {restoringId === s.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
