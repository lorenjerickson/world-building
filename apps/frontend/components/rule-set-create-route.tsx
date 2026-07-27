'use client';

import { useRouter } from 'next/navigation';
import { AppBreadcrumbs } from './app-breadcrumbs';
import { RuleSetCreateForm } from './rule-set-create-form';

export function RuleSetCreateRoute() {
  const router = useRouter();
  return (
    <main className="dashboard-container standalone-artifact-detail">
      <AppBreadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Rule sets', href: '/rule-sets' }, { label: 'New rule set' }]} />
      <section className="standalone-artifact-editor">
        <RuleSetCreateForm onCancel={() => router.push('/rule-sets')} onCreated={(created) => router.push(`/rule-sets/${created.id}`)} />
      </section>
    </main>
  );
}
