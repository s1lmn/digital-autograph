export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Digital Autograph Platform</p>
      <h1>Leave your mark on a creator’s Wall</h1>
      <p>
        Make a digital autograph, review it privately, and place it on a
        creator’s live Wall after moderation.
      </p>
      <div className="linkActions">
        <a href="/autograph/create">Create a digital autograph</a>
        <a href="/me/placements">View your placement history</a>
      </div>
      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works">How it works</h2>
        <ol>
          <li>
            Draw your autograph or edit a photo. Your original upload stays
            private.
          </li>
          <li>Review the cleaned preview and submit it for moderation.</li>
          <li>
            Open a creator’s Wall link and choose an empty slot for your Free
            Claim.
          </li>
        </ol>
        <p>
          Each account has one Free Claim per Wall. A ready, moderated autograph
          is required; availability is checked when you confirm.
        </p>
        <p>
          Have a creator’s link? Open it to view their public Walls. Paid
          takeover is not available yet.
        </p>
      </section>
    </main>
  );
}
