import { RuleSetCollectionRoute } from '@/components/rule-set-collection-route';

export default async function Page({ params }: { params: Promise<{ ruleSetId: string }> }) {
  const { ruleSetId } = await params;
  return <RuleSetCollectionRoute kind="definitions" ruleSetId={ruleSetId} />;
}
