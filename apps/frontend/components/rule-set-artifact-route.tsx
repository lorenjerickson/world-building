'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppBreadcrumbs } from './app-breadcrumbs';
import {
  RuleDefinitionCreateForm,
  RuleDefinitionEditForm,
  RuleModuleCreateForm,
  RuleModuleEditForm,
} from './rule-set-child-create-forms';
import {
  deleteRuleDefinition,
  deleteRuleModule,
  getRuleSet,
  getRuleSetChildren,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleSetApiError,
  RuleSetResource,
} from '@/lib/rule-sets';

type ArtifactKind = 'definition' | 'module';

export function RuleSetArtifactRoute({
  artifactId,
  kind,
  mode,
  ruleSetId,
}: {
  artifactId?: string;
  kind: ArtifactKind;
  mode: 'create' | 'edit';
  ruleSetId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const numericRuleSetId = Number(ruleSetId);
  const numericArtifactId = Number(artifactId);
  const requestedModuleId = Number(searchParams.get('module'));
  const invalidRuleSetId = !Number.isInteger(numericRuleSetId) || numericRuleSetId < 1;
  const [ruleSet, setRuleSet] = useState<RuleSetResource>();
  const [modules, setModules] = useState<RuleModuleResource[]>([]);
  const [definitions, setDefinitions] = useState<RuleDefinitionResource[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (invalidRuleSetId) return;
    const controller = new AbortController();
    Promise.all([
      getRuleSet(numericRuleSetId, controller.signal),
      getRuleSetChildren<RuleModuleResource>(numericRuleSetId, 'modules', controller.signal),
      getRuleSetChildren<RuleDefinitionResource>(numericRuleSetId, 'definitions', controller.signal),
    ]).then(([ruleSetResult, moduleResult, definitionResult]) => {
      setRuleSet(ruleSetResult);
      setModules(moduleResult);
      setDefinitions(definitionResult);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof RuleSetApiError ? cause.message : 'The rule-set record could not be loaded.');
    });
    return () => controller.abort();
  }, [invalidRuleSetId, numericRuleSetId]);

  const artifact = kind === 'module'
    ? modules.find((candidate) => candidate.id === numericArtifactId)
    : definitions.find((candidate) => candidate.id === numericArtifactId);
  const selectedModuleId = modules.some((module) => module.id === requestedModuleId)
    ? requestedModuleId
    : undefined;
  const collectionLabel = kind === 'module' ? 'Modules' : 'Definitions';
  const collectionSegment = kind === 'module' ? 'modules' : 'definitions';
  const collectionHref = `/rule-sets/${numericRuleSetId}/${collectionSegment}`;
  const title = mode === 'create' ? `New ${kind}` : artifact?.name ?? `Open ${kind}`;

  if (invalidRuleSetId) return <main className="dashboard-container"><p className="rule-set-notice error">This rule-set address is invalid.</p></main>;
  if (error) return <main className="dashboard-container"><p className="rule-set-notice error">{error}</p></main>;
  if (!ruleSet || (mode === 'edit' && !artifact)) return <main className="dashboard-container"><div className="card-surface recent-empty"><p>Loading {kind}…</p></div></main>;

  const finish = (id?: number) => router.push(
    `${collectionHref}${id ? `#${kind}-${id}` : ''}`,
  );

  return (
    <main className="dashboard-container standalone-artifact-detail">
      <AppBreadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Rule sets', href: '/rule-sets' },
        { label: ruleSet.name, href: `/rule-sets/${numericRuleSetId}` },
        { label: collectionLabel, href: collectionHref },
        { label: title },
      ]} />
      {mode === 'create' ? <header className="dashboard-header"><div className="header-left"><span className="eyebrow">Create {kind}</span><h2>{title}</h2><p>Add the record in a focused workspace, then return to its collection.</p></div></header> : null}
      <section className="standalone-artifact-editor">
        {kind === 'module' && mode === 'create' ? <RuleModuleCreateForm ruleSetId={numericRuleSetId} onCancel={() => finish()} onCreated={(created) => finish(created.id)} /> : null}
        {kind === 'module' && mode === 'edit' && artifact ? <RuleModuleEditForm artifact={artifact as RuleModuleResource} ruleSetId={numericRuleSetId} onCancel={() => finish(numericArtifactId)} onDelete={async () => { await deleteRuleModule(numericRuleSetId, artifact as RuleModuleResource); finish(); }} onSaved={(saved) => finish(saved.id)} /> : null}
        {kind === 'definition' && mode === 'create' ? <RuleDefinitionCreateForm definitions={definitions} modules={modules} ruleSetId={numericRuleSetId} selectedModuleId={selectedModuleId} onCancel={() => finish()} onCreated={(created) => finish(created.id)} /> : null}
        {kind === 'definition' && mode === 'edit' && artifact ? <RuleDefinitionEditForm artifact={artifact as RuleDefinitionResource} definitions={definitions} modules={modules} ruleSetId={numericRuleSetId} onCancel={() => finish(numericArtifactId)} onDelete={async () => { await deleteRuleDefinition(numericRuleSetId, artifact as RuleDefinitionResource); finish(); }} onSaved={(saved) => finish(saved.id)} /> : null}
      </section>
    </main>
  );
}
