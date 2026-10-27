# Interface refresh

Design-only implementation on the current main application. This supersedes the green product UI palette; the generated brand assets also use neutral graphite and periwinkle.

## Brief and reference review

Reviewed the repository architecture/product/ADR/operations documents, current application routes and component flows, and the Linear project, EGO-80, EGO-82, EGO-84 and the saved «Я был здесь» concept. The user explicitly ruled out green on 27 October 2026. Preserve the personal handwriting/community idea without reproducing the dense poster, stickers, portrait, mint palette or prototype-only features. The user confirmed the product name Destka and requested a Russian/English language switch. Published legal document bodies are untouched.

## Plan

Palette: Paper `#f8f9fc`, Ink `#20232b`, Cobalt `#3455db`, White `#ffffff`, Graphite `#16171d`, Periwinkle `#b0bfff`. No green or mint in product surfaces, controls or status colors. Amber communicates caution, rose communicates failure, blue communicates positive/informational states; text always carries meaning.

Type: self-hosted variable Manrope for display and reading. Large, closely set headings; restrained text sizes for navigation; body copy below 65–75 characters per line. The font and its OFL license ship locally, with no third-party font requests.

Layout: left-aligned headline and primary action beside a paper autograph composition. On mobile, copy precedes the artwork. The walkthrough is a real three-step sequence, followed by a compact explanation of creator links. Product screens share the same navigation, spacing and control vocabulary.

```text
Destka      History / Notifications / Account     Theme / Language    Create

Your mark.                        Shared autograph paper
Their world.                      Four different marks
Explanation + Create

A few strokes.        1. Make      2. Review      3. Place
A connection.
```

Principles: handwriting is the memorable object; everything around it supports legibility. Generous space without empty decorative sections. No fake creators, live claims, prices, verification, ownership or activity. The home artwork is visibly labeled as an illustration. No automatic animation or cosmetic wait time.

## Review of the plan

A generic pale background plus a hero illustration would not establish the product by itself. Replaced generic cards and dashboard metrics with a code-native paper of different handwritten marks. Kept the process unboxed and numbered only because it is an actual sequence. Reduced the old poster's decoration so the autograph is the focal point. Explicitly removed green after the user's correction.

## Theme and implementation

`apps/web/app/interface-tokens.css` adds light/dark product themes on top of the neutral generated brand tokens. Both themes share semantic variable names, so drawing, photo, moderation, legal, account, history, notification and checkout screens use the same palette. The drawing canvas and autograph images always have white media paper; no image inversion or upload-byte changes.

The header offers System / Light / Dark. Store only this allowlisted preference under `autograph-theme`. Apply it before first paint to prevent a flash, follow OS changes in System mode, synchronize other tabs, and retain in-memory operation if storage is unavailable. The CSS media-query fallback supports dark mode without JavaScript. Keyboard focus and native theme selection remain accessible; reduced motion is respected.

No API, session, first-use consent, upload, processing, moderation, reservation, price, payment, claim, ownership or publication logic is changed. All existing controls and server-authoritative decisions remain intact. New signature artwork is illustrative SVG and never a public/private user asset.

## Destka and interface languages

The product name is Destka, confirmed directly by the user on 27 October 2026. Navigation, metadata, share titles, favicon and generated brand assets use this name. Technical package/database identifiers remain stable.

Russian is the default interface language; English is available in the header. The allowlisted `destka-locale` cookie stores the preference for one year. Server rendering and metadata read this cookie, so the chosen language is present in the initial HTML. Switching refreshes server copy through Next.js while retaining client state, including unfinished drawings. The document `lang`, screen-reader labels, theme names, statuses, dates and error text follow the selection. Creator names and user aliases are interpolated as data, never translated.

The source of translations is `apps/web/lib/messages.ts`; shared client/server translation helpers keep UI language separate from API values, authorization, payment state and pricing. Published legal document bodies stay in their original Russian with a visible explanation. Translated labels and explanatory UI do not create a translated legal edition or change accepted versions/hashes.
