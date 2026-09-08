# Architecture Decision Records

This directory records architectural decisions for Companion.

ADRs use the following sections:

- **Status** — Proposed, Accepted, Superseded, or Deprecated.
- **Context** — the forces and constraints behind the decision.
- **Decision** — the chosen architecture and its boundaries.
- **Consequences** — the benefits, costs, and deliberate limitations.

File names use a four-digit, monotonically increasing number. Before the v1
architecture freeze, Accepted ADRs may be amended with their rationale kept in
Git history. After that freeze, a changed decision adds a new ADR and marks the
old one as superseded.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-mantle-four-atom-backbone.md) | Accepted | Use Mantle's four atoms as the declarative runtime backbone |
| [0002](0002-fixed-backbone-and-agent-customization.md) | Accepted | Protect a fixed backbone and validate agent-authored customization |
| [0003](0003-indexeddb-mantle-storage-adapter.md) | Accepted | Persist Mantle runtime state through a semantic IndexedDB adapter |
| [0004](0004-progress-loops-and-precompiled-playbooks.md) | Accepted | Compose experiences from Progress Loops and precompiled Playbooks |
| [0005](0005-character-rig-and-pack-ecosystem.md) | Accepted | Separate visual rigs and character packs from experience mechanics |
| [0006](0006-functional-items-and-appearance-separation.md) | Accepted | Give items validated gameplay affordances without coupling function to artwork |
| [0007](0007-data-driven-starter-packages.md) | Accepted | Author experiences from static Starter packages through Mantle Triggers |
| [0008](0008-scene-packs-and-layered-compositions.md) | Accepted | Validate and render versioned Scene Packs as layered compositions |
| [0009](0009-character-library-collections-and-portable-backups.md) | Accepted | Organize Characters with Collections and restore portable libraries atomically |
