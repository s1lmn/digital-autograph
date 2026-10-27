import tokens from '../../docs/brand/tokens.json';
import { localeCookie, parseLocale, translate } from './lib/i18n';
import { NextRequest, NextResponse } from 'next/server';
import { loadWebConfig } from '@digital-autograph/config';
import {
  documentRoutes,
  getPublications,
  selectPublication,
  PublicationError,
} from './lib/legal-publications';

// Status check before App Router streaming; SSR separately verifies readiness/text.
// Only bounded public metadata is fetched here, never a document body or session.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const safe = (response: NextResponse) => {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  };
  const failure = (status: number) => {
    const locale = parseLocale(request.cookies.get(localeCookie)?.value);
    const t = (text: string) => translate(text, locale);
    const title =
      status === 404 ? 'Документ не найден' : 'Документы временно недоступны';
    const message =
      status === 404
        ? 'Эта редакция недоступна или ещё не опубликована.'
        : 'Не удалось загрузить опубликованные документы. Попробуйте обновить страницу позже.';
    // Controlled copy only, with the existing token source. Returning the status
    // directly avoids rewrites whose streamed destination can reset it to 200.
    const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${t(title)} | Destka</title><style>body{margin:0;background:${tokens.color.paper};color:${tokens.color.ink};font-family:${tokens.font.body}}main{max-width:65ch;margin:2rem auto;padding:1rem;overflow-wrap:anywhere}h1{font-family:${tokens.font.display};font-size:clamp(1.75rem,5vw,2.75rem)}p{line-height:1.65}a{color:${tokens.color.primary};display:inline-flex;align-items:center;min-height:44px}a:focus-visible{outline:3px solid ${tokens.color.focus};outline-offset:3px}</style></head><body><main><p>Destka</p><h1>${t(title)}</h1><p>${t(message)}</p><a href="/legal">${t('Каталог опубликованных документов')}</a></main></body></html>`;
    return safe(
      new NextResponse(html, {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
  };
  if (['/legal', '/legal/first-use'].includes(path))
    return safe(NextResponse.next());
  const parts = path.split('/').filter(Boolean);
  const route =
    parts[0] === 'security'
      ? documentRoutes.find((d) => d.type === 'security')
      : documentRoutes.find(
          (d) => d.slug === parts[1] && d.type !== 'security',
        );
  if (!route) return failure(404);
  const tail = parts.slice(route.type === 'security' ? 1 : 2);
  const current = tail.length === 0;
  const archive = tail.length === 1 && tail[0] === 'archive';
  const version =
    tail.length === 2 && tail[0] === 'versions' ? tail[1] : undefined;
  if (!current && !archive && version === undefined) return failure(404);
  try {
    const documents = await getPublications(loadWebConfig().API_INTERNAL_URL);
    if (archive) {
      if (!documents.some((d) => d.type === route.type)) return failure(404);
    } else selectPublication(documents, route.type, version);
    return safe(NextResponse.next());
  } catch (error) {
    return failure(
      error instanceof PublicationError && error.status === 404 ? 404 : 503,
    );
  }
}
export const config = { matcher: ['/legal/:path*', '/security/:path*'] };
