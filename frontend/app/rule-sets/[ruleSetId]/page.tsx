import { RuleSetDetailRoute } from '@/components/rule-set-detail-route';

export default async function RuleSetPage({ params }: { params: Promise<{ ruleSetId: string }> }) {
  const { ruleSetId } = await params;
  return <RuleSetDetailRoute ruleSetId={ruleSetId} />;
}
