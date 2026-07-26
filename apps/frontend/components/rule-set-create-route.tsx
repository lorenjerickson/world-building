'use client';

import { useRouter } from 'next/navigation';
import { AppBreadcrumbs } from './app-breadcrumbs';
import { RuleSetCreateForm } from './rule-set-create-form';

export function RuleSetCreateRoute() {
  const router = useRouter();
  return (
    <main className="dashboard-container standalone-artifact-detail">
      <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'New rule set' }]} />
      <header className="dashboard-header"><div className="header-left"><span className="eyebrow">Gameplay foundations</span><h2>New rule set</h2><p>Create the workspace first, then author its modules and definitions on dedicated pages.</p></div></header>
      <section className="card-surface standalone-artifact-editor">
        <RuleSetCreateForm onCancel={() => router.push('/rule-sets')} onCreated={(created) => router.push(`/rule-sets/${created.id}`)} />
      </section>
    </main>
  );
}
