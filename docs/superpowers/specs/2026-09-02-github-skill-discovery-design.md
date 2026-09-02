# GitHub Skill discovery and import

## Goal

Let a workspace owner discover a small, trustworthy set of GitHub Skills, inspect
what will be loaded, and import a specific immutable revision.  The product must
not paste a Skill into a conversation or treat a marketplace listing as executable
content.

## User flow

1. The Skills page adds a **Discover from GitHub** panel.  A user selects a
   workspace, then either chooses an official source or supplies a GitHub
   repository/ref/Skill directory.
2. The app resolves the ref to a commit SHA and loads only that directory's
   `SKILL.md`.  It displays name, description, origin, pinned SHA, and the full
   instruction body before the import button becomes available.
3. The user explicitly imports the reviewed revision.  Existing workspace skill
   storage records the repository, requested ref, directory, and resolved SHA.
   Future refresh remains an explicit action.

## Discovery scope

The first release has two paths:

* **Trusted catalog:** a server-owned allowlist of well-known public GitHub
  repositories.  Catalog search filters metadata that the server fetched from
  those repositories; it is not a general web search.
* **GitHub URL / coordinates:** user supplies `owner/repo`, optional ref, and
  the directory containing `SKILL.md`.  This retains the current importer while
  adding a mandatory preview step in the UI.

Authenticated GitHub code search is deliberately a follow-up.  GitHub's Code
Search API requires authentication, so it should be added only through the
existing GitHub connector with a clearly disclosed permission and rate-limit
policy.  Anonymous broad code search is never attempted.

## Security and data rules

* The server validates `owner/repo`, ref, and path, and constructs every GitHub
  API URL itself.  It never fetches a user-provided host or raw URL.
* Preview and import resolve a named ref to a full commit SHA.  Import saves the
  resolved SHA, never a moving branch as the effective revision.
* Preview has a 256 KiB `SKILL.md` cap and is read-only; it does not create a
  workspace record.
* The UI labels non-catalog input as third-party content and warns that Skill
  instructions may request tool use or file changes.  Preview is required in
  this UI before importing.
* Catalog ownership is an application deployment decision.  Adding a source is
  a code review change, not a user-entered marketplace URL.

## API and implementation

* `lib/github-skill-discovery.ts` owns the catalog and calls the existing
  GitHub importer for normalization, SHA resolution, and body parsing.
* `GET /api/workspaces/:workspaceId/skill-discovery` returns catalog entries,
  filtered by a local query.  Failures for one catalog item do not fail the
  whole catalog.
* `POST /api/workspaces/:workspaceId/skill-discovery/preview` accepts the same
  coordinates as the existing import endpoint and returns a transient reviewed
  Skill payload.  It is authenticated and workspace-authorized.
* The existing `POST /skills` endpoint remains the single write path, so its
  immutable provenance semantics do not fork.
* The Skills page owns selection, preview, warning, and import state.  The
  catalog cards and direct-coordinate form converge on the same preview/import
  actions.

## Non-goals

* Installing arbitrary scripts, packages, or MCP servers referenced by a Skill.
* Searching arbitrary GitHub code without a connected GitHub identity.
* Automatically updating imported Skills.
* Making marketplace search results trusted by virtue of their listing.

## Acceptance criteria

* A user can browse trusted catalog entries, preview a Skill, and import it
  into one selected workspace.
* A user can enter valid GitHub coordinates and must preview the exact pinned
  body before import is enabled.
* Imported records retain the existing immutable SHA and explicit refresh flow.
* Invalid paths, non-SKILL files, GitHub errors, and unauthorised workspaces
  return safe errors without external-host fetches.
