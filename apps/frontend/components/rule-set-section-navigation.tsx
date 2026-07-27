import Link from 'next/link';

type RuleSetSection = 'definitions' | 'modules' | 'overview';

const sections: Array<{ label: string; section: RuleSetSection; suffix: string }> = [
  { label: 'Overview', section: 'overview', suffix: '' },
  { label: 'Modules', section: 'modules', suffix: '/modules' },
  { label: 'Definitions', section: 'definitions', suffix: '/definitions' },
];

export function RuleSetSectionNavigation({
  active,
  ruleSetId,
}: {
  active: RuleSetSection;
  ruleSetId: number;
}) {
  return (
    <nav className="tabs rule-set-section-navigation" aria-label="Rule-set sections">
      {sections.map((item) => (
        <Link
          aria-current={active === item.section ? 'page' : undefined}
          className={`tab${active === item.section ? ' tab-active' : ''}`}
          href={`/rule-sets/${ruleSetId}${item.suffix}`}
          key={item.section}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
