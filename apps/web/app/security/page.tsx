import { DocumentPage } from '../../components/legal-pages';
export default async function Page() {
  return await DocumentPage({ type: 'security' });
}
