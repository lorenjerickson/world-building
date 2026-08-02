'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AppBreadcrumbs } from './app-breadcrumbs';
import { RuleAuthoringDiagnosticItem } from './rule-authoring-diagnostic';
import { RuleSetSectionNavigation } from './rule-set-section-navigation';
import type { AuthoringDiagnostic } from '@/lib/rule-authoring';
import {
  getRuleSet,
  getRuleSetChildren,
  publishRuleSet,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetApiError,
  RuleSetResource,
} from '@/lib/rule-sets';

function suggestedReleaseVersion(releases: RuleReleaseResource[]): string {
  const versions = releases
    .map((release) => release.version.match(/^(\d+)\.(\d+)\.(\d+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const)
    .sort((left, right) => right[0] - left[0] || right[1] - left[1] || right[2] - left[2]);
  const latest = versions[0];
  return latest ? `${latest[0]}.${latest[1]}.${latest[2] + 1}` : '1.0.0';
}

function releaseDiagnostics(context: Record<string, unknown>): AuthoringDiagnostic[] {
  if (!Array.isArray(context.diagnostics)) return [];
  return context.diagnostics.flatMap((value): AuthoringDiagnostic[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const diagnostic = value as Record<string, unknown>;
    if (typeof diagnostic.code !== 'string'
      || typeof diagnostic.message !== 'string'
      || typeof diagnostic.path !== 'string'
      || diagnostic.severity !== 'error') return [];
    return [{
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.path,
      severity: 'error',
      ...(typeof diagnostic.definitionExternalId === 'string' ? { definitionExternalId: diagnostic.definitionExternalId } : {}),
      ...(typeof diagnostic.definitionName === 'string' ? { definitionName: diagnostic.definitionName } : {}),
      ...(typeof diagnostic.grantIndex === 'number' ? { grantIndex: diagnostic.grantIndex } : {}),
    }];
  });
}

export function RuleSetOverviewRoute({ ruleSetId }: { ruleSetId: string }) {
  const numericId = Number(ruleSetId);
  const invalidId = !Number.isInteger(numericId) || numericId < 1;
  const [ruleSet, setRuleSet] = useState<RuleSetResource>();
  const [modules, setModules] = useState<RuleModuleResource[]>([]);
  const [definitions, setDefinitions] = useState<RuleDefinitionResource[]>([]);
  const [releases, setReleases] = useState<RuleReleaseResource[]>([]);
  const [error, setError] = useState<string>();
  const publishDialogRef = useRef<HTMLDialogElement>(null);
  const [publishVersion, setPublishVersion] = useState('1.0.0');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string>();
  const [publishNotice, setPublishNotice] = useState<string>();
  const [publishDiagnostics, setPublishDiagnostics] = useState<AuthoringDiagnostic[]>([]);

  useEffect(() => {
    if (invalidId) return;
    const controller = new AbortController();
    Promise.all([
      getRuleSet(numericId, controller.signal),
      getRuleSetChildren<RuleModuleResource>(numericId, 'modules', controller.signal),
      getRuleSetChildren<RuleDefinitionResource>(numericId, 'definitions', controller.signal),
      getRuleSetChildren<RuleReleaseResource>(numericId, 'releases', controller.signal),
    ]).then(([ruleSetResult, moduleResult, definitionResult, releaseResult]) => {
      setRuleSet(ruleSetResult);
      setModules(moduleResult);
      setDefinitions(definitionResult);
      setReleases(releaseResult);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof RuleSetApiError ? cause.message : 'The rule set could not be loaded.');
    });
    return () => controller.abort();
  }, [invalidId, numericId]);

  if (invalidId) return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">This rule-set address is invalid.</p></main>;
  if (error) return <main className="dashboard-container"><AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'Unavailable' }]} /><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading rule set…</p></div></main>;

  function openPublishDialog() {
    setPublishVersion(suggestedReleaseVersion(releases));
    setReleaseNotes('');
    setPublishError(undefined);
    setPublishNotice(undefined);
    publishDialogRef.current?.showModal();
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPublishing(true);
    setPublishError(undefined);
    try {
      const release = await publishRuleSet(ruleSet!, {
        version: publishVersion.trim(),
        releaseNotes: releaseNotes.trim() || undefined,
      });
      setReleases((current) => [
        release,
        ...current.filter((candidate) => candidate.id !== release.id),
      ].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)));
      setPublishNotice(`Published immutable release ${release.version}. It is now available when creating a world.`);
      setPublishDiagnostics([]);
      publishDialogRef.current?.close();
    } catch (cause) {
      if (cause instanceof RuleSetApiError) {
        const diagnostics = releaseDiagnostics(cause.context);
        if (diagnostics.length) {
          setPublishDiagnostics(diagnostics);
          setPublishError(undefined);
          publishDialogRef.current?.close();
        } else {
          setPublishError(cause.message);
        }
      } else {
        setPublishError('The ruleset could not be published.');
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="dashboard-container rule-set-detail-container">
      <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: ruleSet.name }]} />
      <RuleSetSectionNavigation active="overview" ruleSetId={numericId} />
      <header className="dashboard-header rule-set-detail-header">
        <div className="header-left"><span className="eyebrow">{ruleSet.status} · {ruleSet.lifecycle}</span><h2>{ruleSet.name}</h2><p>{ruleSet.summary}</p></div>
        <div className="section-actions">
          <button
            className="primary-action btn"
            disabled={!modules.length || !definitions.length}
            title={!modules.length || !definitions.length ? 'Add at least one module and definition before publishing.' : undefined}
            type="button"
            onClick={openPublishDialog}
          >
            Publish release
          </button>
        </div>
      </header>
      {publishNotice ? <div className="alert alert-success rule-set-publish-notice" role="status"><span>{publishNotice}</span></div> : null}
      {publishDiagnostics.length ? (
        <section aria-labelledby="release-validation-title" className="guided-rule-diagnostics rule-set-release-report" role="alert">
          <div className="section-title-bar">
            <div className="rule-set-panel-title">
              <h3 id="release-validation-title">Release validation failed</h3>
              <span>{publishDiagnostics.length} {publishDiagnostics.length === 1 ? 'error' : 'errors'}</span>
            </div>
          </div>
          <p>Correct every error below, then publish the release again.</p>
          <ul>
            {publishDiagnostics.map((diagnostic, index) => (
              <RuleAuthoringDiagnosticItem
                definitions={definitions}
                diagnostic={diagnostic}
                key={`${diagnostic.code}:${diagnostic.path}:${index}`}
                ruleSetId={numericId}
                showPath
              />
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rule-set-detail-summary">
        <Link className="card-surface rule-set-summary-link" href={`/rule-sets/${numericId}/modules`}><span className="eyebrow">Modules</span><strong>{modules.length}</strong><p>Namespaces organizing this rule set.</p><span className="text-link">Open modules</span></Link>
        <Link className="card-surface rule-set-summary-link" href={`/rule-sets/${numericId}/definitions`}><span className="eyebrow">Definitions</span><strong>{definitions.length}</strong><p>Traits, operations, effects, and authored rules.</p><span className="text-link">Open definitions</span></Link>
        <article className="card-surface"><span className="eyebrow">Releases</span><strong>{releases.length}</strong><p>{releases[0] ? `Latest: ${releases[0].version}` : 'No immutable release yet.'}</p>{!releases.length && modules.length > 0 && definitions.length > 0 ? <button className="text-link link" type="button" onClick={openPublishDialog}>Publish the first release</button> : null}</article>
      </section>
      <dialog aria-labelledby="publish-release-title" className="modal rule-set-publish-modal" ref={publishDialogRef}>
        <div className="modal-box card-surface rule-set-publish-dialog">
          <header className="rule-set-form-heading rule-set-publish-heading">
            <div>
              <span className="eyebrow">Ruleset release</span>
              <h2 id="publish-release-title">Publish immutable release</h2>
            </div>
          </header>
          <form onSubmit={publish}>
            <p className="rule-set-publish-intro">Compile, validate, and snapshot the current ruleset as a version that worlds can depend on.</p>
            <div className="rule-set-form-grid rule-set-publish-fields">
              <label className="rule-set-field"><span>Semantic version</span><input className="input" required maxLength={80}
                pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
                value={publishVersion} onChange={(event) => setPublishVersion(event.target.value)} placeholder="1.0.0" /><small>Use a unique semantic version, such as 1.0.0 or 1.1.0-beta.</small></label>
              <label className="rule-set-field"><span>Release notes</span><textarea className="textarea" rows={4} maxLength={20_000}
                value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)}
                placeholder="What changed in this release?" /></label>
            </div>
            {publishError ? <p className="rule-set-notice error" role="alert">{publishError}</p> : null}
            <div className="rule-set-form-actions rule-set-publish-actions">
              <span>Publishing validates every definition and the complete trait graph. Releases are immutable, and existing worlds only adopt them through an explicit upgrade.</span>
              <div className="section-actions">
                <button className="secondary-action" disabled={publishing} type="button" onClick={() => publishDialogRef.current?.close()}>Cancel</button>
                <button className="primary-action" disabled={publishing} type="submit">{publishing ? 'Compiling…' : `Publish ${publishVersion || 'release'}`}</button>
              </div>
            </div>
          </form>
        </div>
      </dialog>
    </main>
  );
}
