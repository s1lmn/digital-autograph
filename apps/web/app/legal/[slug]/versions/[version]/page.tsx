import { DocumentPage } from '../../../../../components/legal-pages';
import { documentRoutes } from '../../../../../lib/legal-publications';
import { notFound } from 'next/navigation';
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; version: string }>;
}) {
  const { slug, version } = await params;
  const route = documentRoutes.find(
    (d) => d.slug === slug && d.type !== 'security',
  );
  if (!route || !version) notFound();
  return await DocumentPage({ type: route.type, version });
}
