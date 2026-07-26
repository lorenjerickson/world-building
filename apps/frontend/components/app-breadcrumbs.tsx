import Link from 'next/link';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function AppBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="breadcrumbs app-breadcrumbs" aria-label="Breadcrumb">
      <ul>
        {items.map((item, index) => (
          <li key={`${item.label}:${index}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ul>
    </nav>
  );
}
