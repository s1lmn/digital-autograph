# Public Wall concept adoption — EGO-148

This frontend slice adapts the poster composition and signature grid from the
[«Я был здесь» concept saved in Linear](https://linear.app/egor-loshkarev/document/ya-byl-zdes-russkij-koncept-stranicy-artista-i-fanatskoj-steny-7b16ac376f8b).
It is a child of EGO-84, related to EGO-82. The concept is a visual reference,
not a source of new product rules or public data. This slice does not complete
EGO-84, approve final naming/messages, or replace its Figma/usability handoff.

## Composition and contracts

| Concept element      | Implemented behavior                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creator poster       | Large actual `creator.displayName`, mint Wall title, link to the grid, current status and dates alongside it. No invented portrait, biography or verification.                     |
| Close signature grid | Four columns on desktop; two at widths up to 64rem. Original slot numbers remain visible and are preserved in ordered-list values after filtering.                                 |
| Signature as content | Existing public placement derivative on white `mediaPaper`. Black/transparent autographs remain legible; no recoloring, original-upload fallback or private preview is introduced. |
| Empty-place filter   | Native All/Empty toggle buttons with `aria-pressed`; occupancy comes exclusively from `PublicWallDTO.slots[].occupied`. Missing media never makes an occupied slot empty.          |
| Counts               | Occupied and empty counts, plus a polite result summary, calculated from the returned slots. No fixed 16-slot demonstration limit, fabricated participants or scarcity percentage. |
| Call to action       | Existing sign-in and confirmed free-claim flow. An empty slot is explicitly not reserved; backend eligibility and conflict responses remain authoritative.                         |

The existing Brand Kit v1.1 supplies every color/font token. Control targets
remain at least 44px, small labels at least 14px, and statuses have visible text.
The page uses the existing English product copy; the Russian prototype does not
implicitly authorize a partial localization or final marketing claims.

## Interaction and failure states

- Filtering is local presentation and sends no claim or availability request.
  The selected view survives Refresh Wall, successful claims and conflicts;
  counts and membership then follow the refreshed response.
- A view with no empty slots provides an explanation, Refresh Wall and Show all
  slots. The latter returns keyboard focus to the persistent All slots button.
- New occupied-slot fragments from history/notifications and same-document
  anchors repeating the current fragment reveal the full grid and focus the
  original slot. Slot IDs and existing links are retained. Modified clicks,
  downloads and links targeting another document/window keep native behavior.
- Scheduled, paused, ended and elapsed live Walls remain readable and filterable
  without enabling claims. Existing auth, ready-autograph, confirmation, replay,
  race, offline-refresh and history failure states remain in place.
- Unavailable media remains an occupied placement. Failed public media retains
  the existing retry control. Paid takeover stays disabled by the current
  frontend capability; filtering does not introduce a price or eligibility.

## Verification and remaining design work

Component regressions cover unavailable-media occupancy, stable numbering, no
requests on filtering, empty results after refresh, focus restoration, fragment
navigation, read-only statuses, successful claims and Slot conflicts.
Playwright exercises the actual API/PostgreSQL free-claim flow while filtering,
and a ten-slot public Wall at 1440, 768, 390 and 320px, keyboard toggles, fragments,
a long/unbroken creator name and text enlarged to 200%. Screenshots are emitted
as test artifacts for desktop, narrow and enlarged-text views.

These checks do not claim human screen-reader acceptance or the EGO-86 usability
study. Full-page creator art, approved portraits, verified badges, translated
copy, reserved/protected/payment states and the souvenir share renderer need
their own authoritative contracts and acceptance in the parent design work.
