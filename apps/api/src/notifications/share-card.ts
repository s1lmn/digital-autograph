import sharp from 'sharp';
import type { PublicShare } from '@digital-autograph/notifications';
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export async function renderShareCard(share: PublicShare): Promise<Buffer> {
  const title =
    share.event === 'final_wall'
      ? 'Final Wall'
      : share.event === 'takeover'
        ? 'A new place in history'
        : 'I left my mark';
  // Text only: never fetch an original, signed URL, avatar or remote resource.
  // Fixed canvas/line lengths keep user-controlled text inside the card.
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <style>text { font-family: 'DejaVu Sans', sans-serif; }</style>
    <rect width="1200" height="630" fill="#101a24"/><rect x="64" y="64" width="1072" height="502" rx="28" fill="#f2eee4"/>
    <g fill="#101a24" font-family="sans-serif">
      <text x="110" y="132" font-size="26">DIGITAL AUTOGRAPH</text>
      <text x="110" y="222" font-size="48" font-weight="bold">${escape(title)}</text>
      <text x="110" y="306" font-size="30">${escape([...share.creator].slice(0, 32).join(''))}</text>
      <text x="110" y="374" font-size="30">${share.slotNumber === null ? 'The Wall is complete' : `Slot ${share.slotNumber}`}</text>
      <text x="110" y="433" font-size="24">${escape(share.publicAlias ?? '')}</text>
      <text x="110" y="506" font-size="28" font-weight="bold">View the Wall →</text>
    </g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
