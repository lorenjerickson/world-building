import { RuleSetOverviewRoute } from '@/components/rule-set-overview-route';

export default async function RuleSetPage({ params }: { params: Promise<{ ruleSetId: string }> }) {
  const { ruleSetId } = await params;
  return <RuleSetOverviewRoute ruleSetId={ruleSetId} />;
}
