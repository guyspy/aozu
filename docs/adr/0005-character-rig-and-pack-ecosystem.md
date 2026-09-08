# ADR-0005: Separate Visual Rigs and Character Packs from Experience Mechanics

- Status: Accepted
- Date: 2026-08-30

## Context

Visual style strongly influences whether a player adopts a character-based
experience. One fixed house style would exclude players who prefer pixel art,
anime illustration, western cartoons, animals, monsters, or other forms. The
framework must also support Starter packs, agent-generated characters, imported
packs, and packs supplied by professional artists.

Visual choices and experience mechanics vary independently. A fitness,
relationship, or narrative template must not require one art style, and one
character pack must be reusable across compatible purpose templates.

The proof of concept validated deterministic composition from exact-size RGBA
layers, including an item represented by multiple layers placed before and
after the character. It also established a strict candidate, validation,
preview, approval, and activation flow. The website validates final assets but
does not remove backgrounds, resize images, repair alignment, or adapt arbitrary
generator output.

## Decision

### Orthogonal selection axes

Character creation combines two independent selections:

```text
Experience Template / Progress Loops
× Character Rig / Character Pack
= Playable Experience
```

Purpose templates may recommend a visual pack but cannot depend on its art
style. They may require named rig slots such as expressions or props, and pack
validation verifies that the selected rig supplies them. Runtime progress,
dialogue, rules, and memories refer to a character composition or visual state
through stable qualified IDs.

### Rig profile

A versioned rig profile defines the rendering contract shared by compatible
packs:

```ts
interface CharacterRigProfile {
  id: string
  version: number
  canvas: {
    width: number
    height: number
  }
  slots: Array<{
    id: string
    order: number
    required?: boolean
    alpha: "required" | "opaque" | "either"
  }>
}
```

The initial profile uses the proof-of-concept `512 × 768` canvas. That size is
not a platform-wide constant: another profile may declare another canvas and
slot order.

Initial rendering uses exact-canvas RGBA layers. A non-body appearance may
carry one bounded absolute translation and uniform scale shared by all of its
layers; the canonical body is locked. This is an authoring safety net, not a
general rig: there is no rotation, warping, bone animation, or attachment
solver. A layer remains compatible only when its source dimensions and slot
match the selected profile.

Rig version 2 supports an optional `expression-head` between `character-skin` and
`item-front`. An expression is a full-canvas transparent layer containing the
complete aligned head, not cropped facial features. Hair and facial hair are
fixed identity pixels repeated consistently in body skins and head-expression
layers; they are not separate v2 customization slots.

### Character pack

A pack is a versioned set of visual assets and composition definitions for one
rig profile:

```ts
interface CharacterPack {
  id: string
  version: number
  rigProfile: {
    id: string
    version: number
  }
  creator: {
    name: string
    url?: string
    attribution?: string
  }
  license: {
    id: string
    url?: string
    embedding: "allowed"
  }
  assets: CharacterAsset[]
  appearances: CharacterAppearance[]
  defaultComposition: CharacterComposition
}
```

One logical appearance item may contain multiple layer assets in different
slots. A hat, hairstyle, outfit, expression, or prop is therefore not assumed
to be one PNG.

`CharacterComposition` stores qualified appearance references, not copied image
data. Every reference contains `packId`, `packVersion`, and `appearanceId`;
asset references are qualified the same way. This prevents collisions when two
packs use the same local IDs.

A pack's `defaultComposition` is self-contained: it references appearances in
that pack, and each v1 appearance owns layers backed by assets in that pack.
Cross-pack mixing belongs to the active character composition, which resolves
qualified appearances from all installed packs that declare the same rig
profile and version. This keeps an individual pack independently valid without
preventing wardrobe combinations.

A composition resolves to an ordered layer list under the selected rig profile.
Items from different packs may be combined only when they declare the same rig
profile and version. Rig slot orders must be unique. Each appearance layer also
declares an order within its slot, and final rendering sorts by slot order,
layer order, then qualified asset ID. Duplicate slot or layer orders are
rejected rather than relying on manifest insertion order.

### Character authoring draft

The local authoring draft groups appearances by semantic intent rather than by
PNG filename: `body`, `expression`, `outfit`, and `prop`. Each group contains
named variants. A body or outfit variant owns one full-body layer, an expression
owns one whole-head layer, and a prop may own both back and front layers. Props
are multi-select, full-canvas overlays that may be positioned anywhere relative
to the canonical character. The required base body includes the default face;
no expression overlay means that default appearance.

`selected.props` persists activation order, from bottom to top within each rig
slot. Adding a prop places it above earlier props; deactivating and adding it
again moves it to the top. Activating an already selected prop leaves its order
unchanged. The rig still keeps every back layer behind the character and every
front layer in front. React and WebMCP use the same selection commands. A preview
of an inactive prop appends it temporarily without changing persisted order.
Pack export assigns explicit layer orders from this selection, so its default
composition, the workshop, and flattened PNG downloads agree.

Happy, sad, angry, surprised, and sleepy are initial optional expression
variants, not a closed expression vocabulary. Users and agents may add, name,
populate, or remove expression overlays through the same contract. Draft schema
changes are versioned and migrated in IndexedDB; candidate staging compiles the
draft into the Character Pack appearances and qualified assets defined above.

The canonical body inspection projects a small registration frame: alpha
bounds, center, and foot line. The projection reuses persisted inspection data
rather than storing duplicate geometry that can go stale. Expressions and
outfits edit the canonical body; props use the current composite with the edited
prop removed as their placement reference. These clean references are transient
and never enter pack assets or ZIP exports.

Agents may stage a candidate and visually preflight the real compositor through
composite, onion-skin, and target-aware alignment views before asking for user
approval. React and WebMCP use the same revision-safe absolute transform
application command. Local deformation, perspective errors, identity drift,
or bad alpha require regeneration; the website still does not repair pixels.

### Sources and activation

Character creation supports four equivalent pack sources:

- a bundled Starter pack;
- an installed artist pack;
- an imported pack;
- an agent-generated pack prepared outside the website.

Selecting a bundled Starter creates an Experience Draft under ADR-0007; it does
not activate an immutable finished character. Standalone character authoring
produces reusable Character Pack data. It never manufactures a Playbook or
activates a Companion.

All sources use the same pack-approval path:

```text
candidate
→ editable draft when the source is authoring-capable
→ structural and asset validation
→ rendered preview
→ explicit user approval
→ reusable pack
```

Validation requires:

- a valid and supported rig profile;
- unique pack, appearance, item, and asset IDs;
- a complete default composition;
- pack-local default appearance and asset references, plus qualified references
  in an active cross-pack composition;
- only declared layer slots;
- deterministic and unique slot and layer ordering;
- every referenced asset to exist and match its recorded digest;
- exact canvas dimensions for every raster layer;
- supported media types and the rig slot's alpha policy: `required` has at least
  one non-opaque pixel, `opaque` has none, and `either` accepts both;
- creator and license URLs, when present, to use `https`; private local
  authoring may use a `private-use` declaration without an external URL;
- archive paths and sizes within the browser import profile from ADR-0003.

An invalid pack is rejected with diagnostics for its producer. The website does
not repair candidate artwork.

Approving a Character Pack is not Companion activation. A complete resolved
experience must still pass ADR-0007's candidate preview and explicit activation
boundary.

### Persistence and distribution

Raster data remains in the IndexedDB Blob asset store established by ADR-0003.
Mantle entries store qualified pack, composition, appearance, and asset IDs
rather than base64 image data.

The initial browser profile embeds every selected pack manifest and asset into
the resolved experience bundle namespace. Pack activation therefore uses the
same candidate validation and atomic `activeBundleId` pointer swap as ADR-0003;
there is no independent active-pack pointer or cleanup race. ZIP export remains
self-contained and offline restoration never depends on a pack registry.

Pack licensing is independent of the framework's software license. A pack must
identify its creator, license or private-use declaration, attribution, and an explicit machine-readable
declaration that embedding is allowed. Initial imports reject packs without
that declaration.

The machine-readable license block is a routing and presentation aid. The
website presents it but does not interpret arbitrary legal terms. The linked
license text remains authoritative.

Reference-only packs, entitlement providers, and remote rehydration are outside
the initial browser profile. They require a later ADR because they would change
the self-contained export and offline recovery contract.

## Consequences

- Art style can vary without forking progress, story, or persistence code.
- Artists can target an existing rig profile and publish compatible base packs
  or expansions.
- Agent-generated and human-authored packs pass the same trust boundary.
- Full-canvas layers use more storage than cropped and transformed sprites, but
  preserve the alignment and deterministic renderer already proven by the POC.
- Assets are not assumed to mix across rig profiles or profile versions.
- Cross-pack compositions remain deterministic because all references are
  qualified and all selected assets are embedded in the resolved bundle.
- Bone animation, rotation or warping, automatic recoloring, and cross-profile
  conversion remain outside the initial renderer.
