# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Public readers discover and read documents without creating an account.
- A small set of administrators sign in to upload and publish the library's documents.

## Product Purpose

Alexandria is a public digital reading library. It makes a collection of
uploaded HTML documents easy to discover, open, and read while keeping the
original document content separate from the application interface.

## Positioning

Unlike a generic article site, Alexandria preserves and presents original HTML
documents through a dedicated content origin and a sandboxed reader, separating
untrusted document code from the public library and administrator session.

## Operating Context

Readers browse the public library, then open a document in a focused reader.
Administrators use a separate, lazy-loaded area to sign in and publish HTML
files. Document metadata is stored in D1 and immutable document versions in R2.

## Capabilities and Constraints

- Public Library, document reader, and administrator upload are the current
  application surfaces.
- The reader must keep the sandboxed iframe and separate content origin; app
  styles and administrator credentials must never reach uploaded HTML.
- The app is a React SPA on Cloudflare Workers with TypeScript and Tailwind CSS.
- The PWA layer must enhance public reading without making the core library
  depend on a network-only happy path.
- Search, category browsing, and pagination are specified product capabilities;
  the current public UI is an earlier, minimal implementation.

## Brand Commitments

The product name is Alexandria. Its identity should support finding and reading
knowledge, while avoiding a generic blog or a decorative imitation of an
ancient library.

## Evidence on Hand

- Current public Library, Reader, and Admin routes in `src/app/routes/`.
- `SPEC.md` and `TECHSTACK.md` describe the reader, storage, security, mobile,
  and PWA-adjacent technical constraints.
- No brand assets, visual system document, or verified user-research material is
  present in the repository.

## Product Principles

1. Reading remains fast, direct, and open.
2. Original document content stays isolated from application privileges.
3. Navigation and metadata make a growing library understandable.
4. The public reader works independently of optional future AI features.
5. The interface earns trust through clarity, not invented claims.

## Accessibility & Inclusion

Support keyboard use, visible focus, responsive reading at 375px, 768px, and
1440px, semantic status/error messages, and reduced motion where appropriate.

## Inference Record

This record is derived from the current source code and project specifications
after the user explicitly asked the implementation to infer requirements from
the repository rather than continue interviewing.
