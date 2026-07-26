import { RuleSetArtifactRoute } from '@/components/rule-set-artifact-route';

export default async function Page({ params }: { params: Promise<{ moduleId: string; ruleSetId: string }> }) {
  const { moduleId, ruleSetId } = await params;
  return <RuleSetArtifactRoute artifactId={moduleId} kind="module" mode="edit" ruleSetId={ruleSetId} />;
}
