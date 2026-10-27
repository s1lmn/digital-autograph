import { getTranslator } from '../lib/i18n-server';
import { Icon } from '../components/ui-icon';
import { SignatureArt } from '../components/signature-art';
import styles from './page.module.css';

export default async function HomePage() {
  const t = await getTranslator();

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroCopy}>
          <p className={styles.introduction}>
            <span />
            {t(' A space for your autograph')}
          </p>
          <h1 id="home-heading">
            {t('Your mark.')}
            <br />
            {t('Their world.')}
          </h1>
          <p className={styles.description}>
            {t(
              'The creators you love. A Wall you can be part of. Leave something that feels like you.',
            )}
          </p>
          <div className={styles.heroActions}>
            <a className="primaryLink" href="/autograph/create">
              {t('Create a digital autograph ')}
              <Icon name="arrow" />
            </a>
            <a className={styles.howLink} href="#how-it-works">
              {t('How it works')}
            </a>
          </div>
          <p className={styles.privateNote}>
            <Icon name="lock" size={15} />
            {t(' Your original stays private. Always.')}
          </p>
        </div>
        <figure
          className={styles.artwork}
          aria-label={t('Illustration of a community autograph Wall')}
        >
          <div className={styles.artHeading}>
            <span>{t('A shared space')}</span>
            <span>{t('Made personal')}</span>
          </div>
          <div className={styles.paper}>
            <div className={styles.paperHeading}>
              <span>{t('We were here.')}</span>
              <Icon name="pen" size={18} />
            </div>
            <div className={styles.signatureGrid}>
              {[0, 1, 2, 3].map((variant) => (
                <div key={variant}>
                  <SignatureArt variant={variant} />
                </div>
              ))}
            </div>
            <div className={styles.paperFoot}>
              <span>{t('Different handwriting.')}</span>
              <span>{t('One shared story.')}</span>
            </div>
          </div>
          <div className={styles.signatureNote}>
            {t('A place for your kind of different.')}
          </div>
          <figcaption>{t('Illustration of a Wall')}</figcaption>
        </figure>
      </section>
      <section className={styles.process} aria-labelledby="how-it-works">
        <div className={styles.processIntro}>
          <h2 id="how-it-works">
            {t('A few strokes.')}
            <br />
            {t('A connection.')}
          </h2>
          <p>{t('From your own handwriting to a place on their Wall.')}</p>
        </div>
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <h3>{t('Make it yours')}</h3>
            <p>
              {t(
                'Draw your autograph or edit a photo. Your original upload stays private.',
              )}
            </p>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <h3>{t('Give it a look')}</h3>
            <p>
              {t('Review the cleaned preview and submit it for moderation.')}
            </p>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <h3>{t('Find your place')}</h3>
            <p>
              {t(
                'Open a creator’s Wall link and choose an empty slot for your Free Claim.',
              )}
            </p>
          </li>
        </ol>
      </section>
      <section className={styles.wallNote} aria-labelledby="wall-link-heading">
        <div>
          <h2 id="wall-link-heading">{t('Already have a creator’s link?')}</h2>
          <p>
            {t(
              'Open it to see their public Walls. Each account has one Free Claim per Wall. A ready, moderated autograph is required; availability is checked when you confirm. Paid takeover is not available yet.',
            )}
          </p>
        </div>
        <a href="/me/placements">
          {t('View your placement history ')}
          <Icon name="arrow" />
        </a>
      </section>
    </main>
  );
}
