# Project rules for Code Agents

## Project context

- Build the v1 Spanish-learning Web App for the owner and a small group of friends. Prioritize a reliable learning flow and manageable individual development effort; do not add complexity for portfolio appearance.
- The product design is frozen. Implement the current stage in `docs/07-DEVELOPMENT-AND-VALIDATION.md`; do not treat later-version ideas as current work.

## Documentation map

Consult the document responsible for the question at hand, plus direct dependencies. Do not read every document before every small change or apply a single global document ranking.

- Product goals, users, and v1 scope: `docs/01-PRD.md`.
- Feature behavior, rules, boundaries, and fallbacks: `docs/02-FEATURE-SPEC.md`.
- Pages, navigation, interaction, and UI states: `docs/03-UI-INTERACTION.md`.
- Visual design, UI presentation, and cross-page visual consistency: `docs/DESIGN-SYSTEM.md`.
- Modules, service boundaries, data flow, and chosen technologies: `docs/04-ARCHITECTURE.md`.
- Persistent data, schema, lifecycle, and access control: `docs/05-DATABASE.md`.
- HTTP requests, responses, validation, errors, and frontend/backend contracts: `docs/06-API.md`.
- Stage dependencies, technical validation, and acceptance: `docs/07-DEVELOPMENT-AND-VALIDATION.md`.
- Future versions only: `docs/08-ROADMAP.md`.

For frontend work, use `docs/02-FEATURE-SPEC.md` and `docs/03-UI-INTERACTION.md` for product behavior, `docs/DESIGN-SYSTEM.md` as the Visual Design Source of Truth, and `docs/04-ARCHITECTURE.md`, `docs/05-DATABASE.md`, and `docs/06-API.md` for technical implementation. `docs/00-DESIGN-FREEZE-BASELINE.md` is an immutable snapshot for tracing the original design, not the working specification.

## Scope and decision boundaries

- Default to v1. Do not implement items from `docs/08-ROADMAP.md`, add features, or change the core learning flow for technical convenience or generic best practice without explicit user approval.
- Independently decide local implementation details within the approved behavior and contracts, such as code organization, naming, component boundaries, and small necessary refactors. Keep changes limited to the task and its direct dependencies; reuse existing code where practical.
- Obtain explicit user approval before changing product requirements, core interaction, API contracts, database schema, chosen key technologies, third-party services, material ongoing cost, or v1 scope. Present the proposed change and affected documents before implementing it.
- Before installing **any new software dependency** or adding it to dependency configuration, ask the user. Explain why it is needed, what problem it solves, whether existing capabilities suffice, and its impact. Already approved dependencies that are already present may be used without asking again.
- Do not place secrets, tokens, or real user data in source files, documentation, or commits.

## Conflicts and infeasible design

- For conflicting documents, identify the exact definitions, their owners from the documentation map, and the implementation impact. If the conflict requires a product or contract decision, pause only the affected work and ask the user; continue independent work where possible.
- If existing code differs from the frozen design, correct a clear implementation defect within the task. If the difference could be an intentional design change, report it and seek a decision instead of silently changing code or documents to match.
- If an API/database conflict or a technical spike shows that the design cannot be implemented as specified, report the evidence and the smallest viable choices. Do not invent fields, fabricated AI results, or an unapproved fallback.
- After the user approves a design change, update the affected `docs/` specifications before implementing it, as required by the development plan. Never edit the frozen baseline.

## Implementation and UI

- Follow the architecture in `docs/04-ARCHITECTURE.md`. Avoid new frameworks, services, broad refactors, and abstractions that the current task does not need.
- Build for mobile use first. Adapt the same learning tasks and behavior responsively for desktop; do not redesign the desktop view as a separate dashboard.
- Implement the loading, empty, error, and recovery states relevant to the changed flow, using `docs/03-UI-INTERACTION.md`. Follow `docs/DESIGN-SYSTEM.md` for their visual presentation and other frontend visual decisions.

## Validation and completion

- Before declaring a task complete, check the changed behavior against the relevant specifications and the applicable acceptance criteria in `docs/07-DEVELOPMENT-AND-VALIDATION.md`.
- Run typecheck, lint, and relevant automated tests when the project actually provides them. Run only checks pertinent to the change; do not invent commands or claim an unrun check passed.
- Verify the affected user path and its relevant failure states. For AI, recording, browser, or deployment work, perform the applicable technical spike or device check required by the development plan before claiming that capability works.
- If credentials, a device, or an external service prevents verification, state what was implemented, what was checked, what remains unverified, and why. Do not label unverified behavior complete.

## Git and change management

- Do **not** initialize a Git repository. If none exists, tell the user and let the user decide whether to initialize it.
- Keep a proposed commit to one coherent, verified task. Before every `git commit`, show the intended changes, relevant validation results, and a proposed message describing the change and purpose. Execute that commit only after the user's explicit confirmation; task completion is not commit authorization.
- Do **not** execute `git push` unless the user explicitly requests it. The user also decides whether and how to create or bind the first remote repository. After a commit, you may report that commits remain unpushed.
- Do not present a known broken or unverified state as a stable milestone. Preserve unrelated work; do not use destructive resets, discard changes, rewrite shared history, or force-push without explicit user direction.
