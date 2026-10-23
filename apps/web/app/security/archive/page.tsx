import { DocumentArchive } from '../../../components/legal-pages';
export default async function Page() {
  return await DocumentArchive({ type: 'security' });
}
