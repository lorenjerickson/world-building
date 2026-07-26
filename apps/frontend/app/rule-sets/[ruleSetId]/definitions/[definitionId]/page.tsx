import { RuleSetArtifactRoute } from '@/components/rule-set-artifact-route';

export default async function Page({ params }: { params: Promise<{ definitionId: string; ruleSetId: string }> }) {
  const { definitionId, ruleSetId } = await params;
  return <RuleSetArtifactRoute artifactId={definitionId} kind="definition" mode="edit" ruleSetId={ruleSetId} />;
}
