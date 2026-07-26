import { RuleSetArtifactRoute } from '@/components/rule-set-artifact-route';

export default async function Page({ params }: { params: Promise<{ ruleSetId: string }> }) {
  const { ruleSetId } = await params;
  return <RuleSetArtifactRoute kind="module" mode="create" ruleSetId={ruleSetId} />;
}
