type AuthErrorPageProps = {
  searchParams: Promise<{ code?: string | string[] }>;
};

export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const { code } = await searchParams;
  const message =
    code === 'GOOGLE_AUTH_CANCELLED'
      ? 'Google sign-in was cancelled.'
      : code === 'ALREADY_AUTHENTICATED'
        ? 'You are already signed in.'
        : 'Google sign-in could not be completed.';

  return (
    <main>
      <p className="eyebrow">Digital Autograph Platform</p>
      <h1>Sign-in</h1>
      <p>{message}</p>
      <a href="/">Return home</a>
    </main>
  );
}
