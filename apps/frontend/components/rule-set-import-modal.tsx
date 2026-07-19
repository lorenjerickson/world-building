'use client';

import { useRef, useState } from 'react';
import { importRuleSet, RuleSetApiError, RuleSetExportBundle, RuleSetImportResult } from '@/lib/rule-sets';

type Phase = 'idle' | 'parsed' | 'importing' | 'done' | 'error';

export function RuleSetImportModal({
  ruleSetId,
  onClose,
  onImported,
}: {
  ruleSetId: number;
  onClose: () => void;
  onImported: (result: RuleSetImportResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<RuleSetExportBundle>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<RuleSetImportResult>();
  const [error, setError] = useState<string>();

  function handleFile(file: File) {
    setError(undefined);
    setBundle(undefined);
    setPhase('idle');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (parsed?.schemaId !== 'rule-set-export' || parsed?.formatVersion !== '1') {
          setError('This file does not appear to be a valid rule-set export bundle.');
          return;
        }
        setBundle(parsed as RuleSetExportBundle);
        setPhase('parsed');
      } catch {
        setError('The file could not be parsed as JSON.');
      }
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!bundle) return;
    setPhase('importing');
    setError(undefined);
    try {
      const res = await importRuleSet(ruleSetId, bundle);
      setResult(res);
      setPhase('done');
      onImported(res);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'Import failed.');
      setPhase('error');
    }
  }

  return (
    <div className="rule-set-import-modal">
      <div className="rule-set-import-header">
        <strong>Import from bundle</strong>
        <button type="button" className="secondary-action compact-action" onClick={onClose}>Close</button>
      </div>

      {phase === 'idle' && (
        <div className="rule-set-import-drop" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
          <p>Drop a <code>.json</code> export bundle here, or click to select a file.</p>
          <input ref={inputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {error && <p className="rule-set-notice error" role="alert">{error}{phase === 'error' && <button type="button" onClick={() => { setPhase('idle'); setError(undefined); }}> Try again</button>}</p>}

      {bundle && phase === 'parsed' && (
        <div className="rule-set-import-preview">
          <p><strong>Source:</strong> {bundle.ruleSetName} (exported {new Date(bundle.exportedAt).toLocaleString()})</p>
          <p><strong>Contents:</strong> {bundle.modules.length} module{bundle.modules.length !== 1 ? 's' : ''}, {bundle.definitions.length} definition{bundle.definitions.length !== 1 ? 's' : ''}</p>
          <ul className="rule-set-import-module-list">{bundle.modules.map((m) => <li key={m.namespace}><strong>{m.name}</strong><span className="subtext">{m.namespace}</span></li>)}</ul>
          <p className="subtext">Modules that already exist (matched by namespace) will be skipped. Definitions will be created in the matched module.</p>
          <div className="rule-set-form-actions">
            <button type="button" className="secondary-action" onClick={onClose}>Cancel</button>
            <button type="button" className="primary-action" onClick={doImport}>Import {bundle.definitions.length} definition{bundle.definitions.length !== 1 ? 's' : ''}</button>
          </div>
        </div>
      )}

      {phase === 'importing' && <p className="rule-set-notice">Importing…</p>}

      {phase === 'done' && result && (
        <div className="rule-set-import-result">
          <p className="rule-set-notice">
            Import complete: {result.definitionsCreated} definition{result.definitionsCreated !== 1 ? 's' : ''} created,
            {' '}{result.modulesCreated} module{result.modulesCreated !== 1 ? 's' : ''} created,
            {' '}{result.modulesExisting} existing.
          </p>
          {result.definitionsFailed.length > 0 && (
            <div>
              <p className="rule-set-notice error">{result.definitionsFailed.length} definition{result.definitionsFailed.length !== 1 ? 's' : ''} failed:</p>
              <ul className="guided-rule-diagnostics">{result.definitionsFailed.map((f) => <li key={f.name}><span>{f.name}</span>{f.reason}</li>)}</ul>
            </div>
          )}
          <button type="button" className="secondary-action" onClick={onClose}>Close</button>
        </div>
      )}
    </div>
  );
}
