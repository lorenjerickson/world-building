'use client';

import { useState } from 'react';

interface DeleteArtifactButtonProps {
  artifactName: string;
  artifactType: string;
  disabled?: boolean;
  onDelete: () => Promise<void> | void;
}

export function DeleteArtifactButton({ artifactName, artifactType, disabled, onDelete }: DeleteArtifactButtonProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    if (!window.confirm(`Delete ${artifactType} “${artifactName}”? This cannot be undone.`)) return;
    setDeleting(true);
    setError(undefined);
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${artifactType} could not be deleted.`);
    } finally {
      setDeleting(false);
    }
  }

  return <span className="artifact-delete-control">
    <button type="button" className="danger-action" disabled={disabled || deleting} onClick={remove}>{deleting ? 'Deleting…' : 'Delete'}</button>
    {error && <small role="alert">{error}</small>}
  </span>;
}
