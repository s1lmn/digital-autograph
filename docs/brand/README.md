# Brand Kit v1.1 — EGO-82

**Preview proposal, 2026-10-07.** This is the permitted preliminary design before
final naming. Digital Autograph is the existing working name, not a new naming
decision. EGO-80 and EGO-81 remain open; their final name and messaging must replace
the provisional lockup and specimen copy before brand acceptance. No trademark,
legal copy or commercial decision is made here.

Open [the visual kit](preview.html) in a browser. It includes three original
moodboards, the revised direction, keyboard focus specimen, Wall states, creator
co-branding and downloadable exports. No external images, fonts or requests are
needed. Run a static server from the repository and visit
`/docs/brand/preview.html`; relative asset links also work directly from disk.

## Direction and rationale

1. **Living archive — original alternative:** warm paper, deep green, editorial
   typography and an outlined place containing a continuous mark.
2. **Live signal — revised direction:** charcoal green, soft white and restrained
   mint accents. Heavy sans headings, close letter spacing and clear, rounded
   panels give the creator/fan space a younger voice. Dark colors come from the
   user's preference for direction 2; the spacious 1080×1350 card is the chosen
   composition master. Energy is visual, not pressure or fabricated urgency.
3. **Open grid:** mint, modular layout and utility typography. Makes slot mechanics
   obvious but has less distinctive creator/fan identity.

These are original code-native compositions, not photographs or research claims.
The user requested this revision after reviewing v1: a younger design, colors
from direction 2, and the third share specimen (1080×1350) as the strongest layout.
That establishes palette/layout preferences, not acceptance of this final revision
or creator testing. The implementation keeps flows and business rules intact.

## Tokens and frontend adoption

[tokens.json](tokens.json) is canonical. `pnpm brand:export` generates
`apps/web/app/brand-tokens.css`, this gallery, vectors, PNGs and the contrast report.
`pnpm brand:check` rejects stale generated text, missing/invalid PNG dimensions and
contrast failures. The raster manifest binds generator/tokens inputs and exported
PNG checksums; changing either without re-exporting fails verification. PNG pixel
identity is font/platform dependent; re-export on
the chosen release workstation and visually inspect before final publication.

CSS uses `--brand-{group}-{name}`: color, font, space, radius, shadow, type and size.
The existing global stylesheet imports these tokens and maps its legacy
`--color-*` variables to the new palette. No API, payment or ownership semantics
change. Existing component CSS now maps backgrounds, text, focus and status colors
to the same dark tokens; otherwise pale fixed backgrounds would inherit unreadable
light text. Drawing canvases and autograph images use a separate white media-paper
token, preserving black/transparent autograph readability. No rendering algorithm,
upload bytes or media authorization changes.

- Primary: soft mint `#b2f2d6`; dark primary surface `#294b3b`. Filled mint buttons
  use `onPrimary` dark ink `#192724`, not the main light text token.
- Secondary: amber `#ffcb84` on `#4d3822` for protected/reserved states.
- Errors: `#ffb8c2` on `#502d36`; never reuse red for takeover competition.
- Stage `#192724`, surface `#22342e`, light ink `#f4f6ee`, muted ink `#bdc9c1`.
- Structural border `#465b51` is decorative. Meaningful control boundaries use
  `#8a9c90`; never use the subtle border as the sole signal of an input/control.
- Heavy system sans for headings, system UI for reading/controls, monospace with
  `font-variant-numeric: tabular-nums` for prices/timers. No remote font dependency.
- Body 16px with 1.5–1.6 line height; small labels at least 14px in product UI.
  Measure about 65 characters. Heading size scales with viewport.
- 4px spacing base, 8px control radius, 16px cards, pill badges. Flat surfaces;
  small raised shadow only for overlays, never status meaning. Touch targets 44px.

## Symbol, wordmark and creator identity

[mark.svg](assets/mark.svg) and [wordmark.svg](assets/wordmark.svg) are reusable
vectors. The symbol is an outline frame plus a flowing stroke: it must not imply
legal signature validation or proof of ownership. Symbol minimum 24px; favicon
16px is the sole size exception. Leave one symbol-width of clear space around a
lockup; use an isolated symbol where a full wordmark would be too small. Preserve
aspect ratio, strokes and orientation. Approved colors are mint on dark stage
or dark ink on mint. Use the reverse mark on light exports; do not place the mint
mark directly on white media-paper. No gradients, effects or creator recoloring.

Creator cover, avatar, name and approved autograph are the main content. Creator
colors stay in artwork/cover surfaces. Platform controls, semantic statuses,
verification and payment presentation retain platform colors. Place a creator
name below the platform mark, never merge it into the platform wordmark. Long
names wrap to two lines in a live UI; share rendering must fit/measure and truncate
with an ellipsis rather than shrink text below the approved size. The example
creator is fictional. Placeholder avatars contain no initials or account data.

## Badges and Wall states

Every status has text as well as color. Icons use a 24px viewBox, 2px stroke,
round caps/joins; decorative icons have empty alt/`aria-hidden`, meaningful icons
need an accessible name. Icons are exported separately, not emoji.

- **Free:** primary-soft badge, explicit choose action. Availability comes from API.
- **Occupied:** neutral, preview or unavailable-media fallback; no ownership claim
  based solely on an image. Own placement is labeled from authenticated evidence.
- **Takeover available:** primary, review server quote before confirmation. Do not
  invent a price or infer eligibility from the client clock.
- **Protected:** amber + clock + text. Show backend `availableAt`; a timer reaching
  zero requests fresh eligibility instead of enabling a mutation by itself.
- **Reserved:** amber + lock, server expiry/countdown. Show an own resume action
  only when authorized; never expose another buyer's identity.
- **History/displaced:** neutral + history icon, explicit time interval. Preserve
  history; never imply the old placement still owns the slot.
- **Ended:** final Wall viewing, no new claim/takeover controls; archived visibility
  follows the API. Do not assume a scheduled background transition exists.
- **Hidden/unavailable:** neutral explanatory text, no original-media fallback.
- **Failure:** red + explicit reason/action safe to retry; never show payment
  success before verified backend fulfillment. Pending/unknown is informational,
  not success. Respect server manual-review states.
- **Verified creator:** outlined circle/check with visible label. The asset is a
  specimen only. No existing public verification flag is invented; render it in
  product only once the verification workflow supplies authoritative evidence.

The gallery is a design specimen, not a product route or an implemented checkout.
Final messaging is owned by EGO-81; no new product copy is applied to live flows.

## Share templates and essentials

Four SVG masters and PNG exports are in `assets/`: Telegram and X at 1200×630,
VK portrait at 1080×1350 (composition master), Stories at 1080×1920. These are chosen layout presets,
not claims about current platform upload requirements. Telegram/X share the same
landscape composition deliberately. The Stories composition keeps essential
content inside 72px horizontal and 220px vertical safe margins; verify destination
UI before posting. PNG uses an opaque charcoal stage; vectors scale without loss.
The portrait master retains v1's generous header/top spacing, two-line title,
large central creator/mark panel and separate bottom CTA. Other sizes adapt that
hierarchy rather than cropping a portrait or shrinking its type. Portrait exports
are reusable beyond VK; the channel name is a file/preset label, not a restriction.

Each master keeps the platform lockup, a creator/name panel, public mark area and
Wall CTA. Specimen labels are intentionally visible; they are not production cards.
To populate a template, a future renderer must consume an allowlisted public DTO,
escape text, bound/measure names and include only approved public derivatives.
Never embed private originals, signed URLs, storage keys, internal User/Order IDs,
provider payloads, unverified prices or checkout results. Withdrawal/moderation and
cache behavior remain subject to the sharing implementation, not these static
files. Existing EGO-94 work is not bypassed or replaced by this asset pack.

`apps/web/app/icon.svg` is the static platform-only Next.js favicon.
`assets/og-platform.png` is the exported platform OG image, with no creator/user
data. Its production wiring needs the canonical deployed web origin and belongs
to the metadata/share handoff; it is not bound to a build-time localhost URL here.
PNG favicon 32px and apple touch icon 180px are exported for handoff.
Anonymous avatar, empty Wall and empty history vectors have matching semantics.
The five rectangles in the empty illustration are decorative, not the Wall's slot
count. Keep visible empty-state heading/action outside the illustration in product.

## Accessibility evidence and acceptance

[contrast.json](contrast.json) contains computed relative sRGB luminance ratios:
20 approved pairs, all text at least 4.5:1, focus and meaningful boundaries at
least 3:1. This is palette evidence, not certification of every existing screen.
Do not assume arbitrary creator colors or unlisted pairings are accessible.

The gallery supports keyboard navigation, 44px controls, visible focus, responsive
cards and a live status announcement for its focus specimen. Check it at narrow
viewport and 200% zoom, then inspect the raster exports. Integrated screens still
need keyboard, screen-reader, long-name, zoom and artwork-overlay checks as part
of their UX acceptance. No status is communicated only through color.

Remaining gates: independent PR review; EGO-80 final naming; EGO-81 final messages;
human acceptance of the proposed direction and channel previews; merged-main CI.
This task stays In Review while those required acceptances remain open. EGO-84
must not treat this preview as an approved final brand/Figma handoff.
