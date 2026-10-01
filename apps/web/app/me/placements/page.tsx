import { loadWebConfig } from '@digital-autograph/config';
import { UserPlacementHistory } from '../../../components/placement-history';

export const dynamic = 'force-dynamic';

export default function UserPlacementsPage() {
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main>
      <p className="eyebrow">Digital Autograph Platform</p>
      <h1>Your placement history</h1>
      <p>
        Review current and completed placements associated with your account.
      </p>
      <UserPlacementHistory apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
