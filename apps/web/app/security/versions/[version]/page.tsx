import { DocumentPage } from '../../../../components/legal-pages';
export default async function Page({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  return await DocumentPage({ type: 'security', version });
}
