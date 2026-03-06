# Arduboy FX Web Editor - Coding Agent Prompt

## Role and Objective

You are building a browser-based JavaScript editor for Arduboy FX data. This tool will live inside an existing Arduboy web tool suite and must let users create, inspect, edit, validate, build, and export the external memory data used by FX-enabled Arduboy games.

The tool must be compatible with the behavior and output conventions of Mr.Blinky's existing FX tooling, especially:

- `Arduboy-Python-Utilities/fxdata-build.py`
- `Arduboy-Python-Utilities/example-fxdata/`
- `Arduboy-Python-Utilities/example-fxdata/fxdata.txt`
- `ArduboyFX` runtime library
- The Arduboy homemade package compile-time FX workflow

This is not just a text editor. It should be a practical modern asset pipeline and visual editor for Arduboy FX projects, while remaining build-compatible with the established ecosystem.

Your highest priority is behavioral compatibility with the reference tooling. 

## Core Product Goal

Create a web tool that allows a user to:

1. Import or create an FX data project.
2. Edit the `fxdata.txt` source directly and/or through structured UI editors.
3. Import assets like images and binary blobs.
4. Preview how those assets will be encoded for Arduboy FX.
5. Build outputs that match the reference pipeline.
6. Export the generated files for use with an Arduino sketch, simulator, or `.arduboy` package.

The tool must make FX authoring feel understandable and modern instead of cryptic, but it must still produce deterministic, ecosystem-compatible outputs.

## Required Technical Context the Implementation Must Respect

### 1. What FX data is

Arduboy FX stores game assets in external flash memory. Typical examples are:

- Sprites and sprite sheets
- Masked sprite data
- Frame lists / metadata tables
- Strings and dialogue text
- Raw binary assets
- Save data regions

The sketch accesses this data through the `ArduboyFX` library. The build pipeline generates a header (`fxdata.h`) with symbolic offsets and page constants, plus one or more binary blobs that are written to external flash.

### 2. How the existing pipeline works

The existing workflow is roughly:

1. User writes `fxdata.txt`
2. `fxdata-build.py` parses it
3. It emits:
   - `fxdata.h`
   - `fxdata.bin`
   - and when save data is present:
     - `fxdata-data.bin`
     - `fxdata-save.bin`
4. The Arduboy toolchain / uploader places the generated binary into the FX flash layout
5. The sketch uses constants from `fxdata.h` and runtime APIs from `ArduboyFX`

Your tool must replicate the build logic closely enough that the generated outputs can replace the Python tool for normal authoring workflows.

### 3. The addressing model

This is critical:

- Resource symbols in `fxdata.h` are offsets within the FX data section.
- They are not absolute flash addresses.
- `FX_DATA_PAGE` identifies where the data section begins in flash, in 256-byte pages.
- At runtime, `ArduboyFX` library in conjunction with the board package combines the resource offset with the current data page base (`programDataPage << 8`) to seek to the correct absolute flash address.

Implication:

- Your generated symbols must preserve this offset-based model.
- Do not generate absolute addresses for resource labels.
- The UI should help users understand the difference between:
  - resource offset
  - page base
  - final absolute flash address

### 4. Data placement conventions

The reference pipeline treats FX storage as end-anchored in the 16 MiB external flash space:

- Page size: `256` bytes
- Total pages: `65536`
- Total address space: `16 MiB`

The generated constants follow the reference convention:

- `FX_DATA_PAGE = 65536 - dataPages - savePages`
- `FX_DATA_BYTES = <data section byte count>`
- If save data exists:
  - `FX_SAVE_PAGE = 65536 - savePages`
  - `FX_SAVE_BYTES = <save section byte count>`

The implementation must respect:

- 256-byte page alignment for the combined FX image
- Save allocation rounded up to 4 KiB blocks (16 pages)
- Deterministic binary layout so offsets match header symbols exactly

### 5. Compile-time behavior and relocation expectations

The Arduboy homemade package modifies / patches FX-related details at compile time so sketches can use symbolic references without manually hardcoding physical flash addresses.

Your tool does not need to replicate the whole board package, but it must generate files that are compatible with that workflow:

- `fxdata.h` with the correct constants and symbols
- Binary data with the expected layout
- Offsets that remain valid when the toolchain applies the normal FX conventions

The tool should also be designed so it can later integrate with `.arduboy` packaging and flashcart workflows.

## Parsing and Format Compatibility Requirements

You must implement a parser and builder that closely track the behavior of `fxdata-build.py`.

### 1. `fxdata.txt` is intentionally C-like but loose

The format is permissive and resembles simplified C declarations. The parser should tolerate the same style of input users expect from the existing ecosystem.

The reference parser strips or tolerates punctuation in a loose way. Preserve compatibility with common patterns seen in real `fxdata.txt` files, including declarations that resemble C arrays and initializer blocks.

Do not make the browser tool stricter than the upstream format unless the stricter behavior is only used for linting and can be overridden.

### 2. Required directives / constructs

At minimum, support the reference behaviors for:

- `include`
- `align`
- `namespace`
- `namespace_end`
- `savesection`

If the upstream reference parser supports additional section directives or aliases, keep the implementation extensible so they can be added without reworking the parser architecture.

#### `include`

- Accept a quoted filename
- Load another text file into the parse stream
- Preserve symbol resolution semantics across included files
- The UI should surface included files in a project tree, not hide them

#### `align`

- Pads the output with `0xFF` until the current output length is evenly divisible by the specified alignment
- The UI should preview the added padding and resulting alignment boundary

#### `namespace` / `namespace_end`

- These primarily affect generated header output and symbol scoping presentation
- Preserve namespace output in `fxdata.h`
- Structured UI should display the logical namespace hierarchy

#### `savesection`

- Marks the transition from normal data to save data
- Everything after this point is treated as save-region content in the reference workflow
- Save data must be split into the dedicated outputs and size accounting described above

### 3. Required value types

At minimum, support and correctly encode:

- `uint8_t` / `int8_t`
- `uint16_t` / `int16_t`
- `uint24_t` / `int24_t`
- `uint32_t` / `int32_t`
- `String` / `string`
- `raw_t`
- `image_t`

The binary emitter must respect the reference width behavior and byte ordering used by `fxdata-build.py`. If there is any ambiguity, match the reference implementation exactly, not a guessed "clean-room" interpretation.

### 4. String behavior

Preserve the behavioral distinction between:

- String declarations that emit null-terminated text
- Quoted byte data used in numeric-array contexts that do not necessarily imply an added null terminator

The UI should make this visible. A user should be able to tell whether a given text item becomes:

- raw bytes
- UTF-8 bytes plus `0x00`

### 5. Raw binary behavior

For `raw_t`:

- Import the referenced file as binary
- Insert the bytes verbatim
- Do not reinterpret or transform the data
- The UI should show size, checksum, and a hex preview

## Image Encoding Requirements

This is one of the most important parts of the tool.

The browser implementation must match the reference image conversion behavior closely enough that generated sprite data is compatible with existing FX code and frame offsets.

### 1. Image resource header

Image resources produced from `image_t` must include the expected metadata header used by the reference pipeline:

### 2. Use existing image conversion pipeline

The existing framework this project is being integrated includes an image importing tool. Utilize this tool in the scope of generating these files.


### 3. Asset preview requirements

The user must be able to inspect, before build:

- original image
- thresholded monochrome preview
- mask preview
- frame slicing grid
- generated byte length
- generated header + payload structure

## Output Requirements

The tool must generate outputs that are directly useful in the standard FX workflow.

### 1. Required generated files

Always support exporting:

- `fxdata.h`
- `fxdata.bin`

When a save section exists, also support:

- `fxdata-data.bin`
- `fxdata-save.bin`

### 2. Header requirements

`fxdata.h` must include:

- `FX_DATA_PAGE`
- `FX_DATA_BYTES`
- `FX_SAVE_PAGE` and `FX_SAVE_BYTES` when applicable
- Symbol definitions for resource offsets
- Namespace output compatible with the source declarations

### 3. Binary layout requirements

`fxdata.bin` must represent:

- data section
- page padding
- save section (if present)
- save allocation padding

This layout must match the reference expectations closely enough to be usable in existing simulators, uploaders, and build flows.

### 4. Export convenience

Support exporting as:

- individual files
- project zip (recommended)

If the surrounding tool suite already has `.arduboy` packaging capability, design the module so it can hand off:

- compiled hex
- `fxdata.bin`
- metadata

to that packager cleanly.

## UX and Product Requirements

This tool should feel like a modern editor, not a bare script wrapper.

### 1. Core UI model

Implement a multi-pane editor with the following major surfaces:

- Project / file tree
- Source editor for raw `fxdata.txt`
- Structured asset panel
- Preview pane
- Memory map / layout pane
- Build output / diagnostics pane

The raw text editor and structured editors must stay in sync.

### 2. Recommended editing modes

Provide both:

#### Raw mode

For advanced users who want direct control over `fxdata.txt`.

Must include:

- syntax highlighting
- inline error markers
- symbol navigation
- include file navigation
- autocomplete for known directives, types, and common constants

#### Structured mode

For users who do not want to hand-author every declaration.

Must include editors for:

- images / sprite sheets
- strings
- numeric arrays
- raw binary blobs
- save section entries
- symbol metadata

Edits made structurally should round-trip back into valid `fxdata.txt` without unexpectedly destroying user formatting more than necessary.

### 3. Memory map view

This is a signature UX feature and should make the tool much easier to understand.

Show:

- each asset's byte range within the data section
- alignment padding blocks
- page boundaries every 256 bytes
- where `savesection` begins
- how much save allocation padding is added
- resulting `FX_DATA_PAGE`, `FX_SAVE_PAGE`, and total sizes

Make it possible to click a region and jump to the related source declaration.

### 4. Build feedback

The build panel should show:

- success / failure state
- generated sizes
- warnings
- hard errors
- missing includes
- missing referenced asset files
- duplicate symbols
- unsupported constructs
- exact resource byte counts

Where possible, errors should point back to:

- file
- line
- declaration
- offending token

### 5. Modern UX conventions

Use current, familiar web-app patterns:

- drag-and-drop imports
- undo / redo
- keyboard shortcuts
- autosave to local browser storage
- explicit dirty-state indicators
- non-destructive previews
- collapsible side panels
- resizable panes
- fast search / filter over assets and symbols
- light and dark mode compatibility if the host suite supports them

### 6. Designed for integration

Because this tool is part of an existing Arduboy web suite:

- make it modular
- avoid hard-coding global app assumptions
- expose a clean internal API for import, build, export, and state serialization
- design it so it can be mounted as one tool page inside a larger application shell

## Architecture Requirements

Build this as a maintainable, testable browser application.

### 1. Preferred implementation shape

Use JavaScript or TypeScript suitable for a modern web stack.

Separate concerns into modules such as:

- `fxdataParser`
- `fxdataAst` or IR model
- `symbolResolver`
- `imageEncoder`
- `binaryEmitter`
- `headerEmitter`
- `projectFileStore`
- `buildDiagnostics`
- `uiState`

Do not intertwine parsing logic with rendering logic.

### 2. Internal data model

Represent the project as a canonical internal model, not only as raw text.

Suggested layers:

1. Source files (`fxdata.txt`, included files, asset files)
2. Parsed AST / intermediate representation
3. Resolved symbol table
4. Final binary sections (data, save)
5. Generated artifacts (`fxdata.h`, `fxdata.bin`, split bins)

This makes it possible to support both raw-text editing and structured UI editing cleanly.

### 3. File handling in browser

Do not assume a Node-only filesystem.

Use browser-friendly file handling:

- `File`
- `Blob`
- drag-and-drop APIs
- in-memory virtual project filesystem

The user should be able to import a folder-like project, manipulate it, and export a zip.

### 4. Deterministic builds

Given the same project inputs, the build outputs must be byte-for-byte deterministic.

This matters for:

- golden test comparisons
- diffability
- reproducibility
- trust when replacing the Python tool

## Implementation Phases

Build this in phases.

### Phase 1 - Compatibility-first builder core

Implement:

- parser for supported directives and types
- include resolution
- symbol table generation
- binary emission
- header generation
- exact size accounting
- save-section handling

No fancy UI required yet. First prove that the browser implementation can reproduce compatible outputs.

### Phase 2 - Asset pipeline

Implement:

- image import (utilizing image tool within project)
- raw binary import
- string editors
- typed numeric array editors

### Phase 3 - Full editor UI

Implement:

- multi-pane UI
- source editor
- structured editors
- diagnostics
- memory map
- export actions

### Phase 4 - Integration hooks

Implement:

- host app integration interface

## Testing and Validation Requirements

You must build this with strong compatibility testing.

### 1. Golden fixture tests

Create golden tests using known reference examples, including:

- `example-fxdata`
- real example projects from the Arduboy FX ecosystem such as `drawframes`

For each fixture, compare your generated outputs against the reference tool where practical:

- `fxdata.h`
- `fxdata.bin`
- split save/data bins when applicable

Where exact text formatting in the header differs cosmetically, byte-critical values and symbol values must still match.

### 2. Parser regression tests

Add tests for:

- includes
- nested namespace use
- alignment behavior
- strings with and without terminators
- raw binary insertion
- image_t sheet slicing edge cases
- save section size rounding
- duplicate symbol errors
- missing file errors

### 3. UI behavior tests

At minimum, validate:

- editing a structured asset updates generated outputs
- editing raw source updates the structured view
- clicking a memory-map asset focuses the correct declaration
- import/export round-trips preserve project contents

## Acceptance Criteria

The implementation is successful only if all of the following are true:

1. A user can build a valid FX project entirely in the browser.
2. The outputs are compatible with normal Arduboy FX development workflows.
3. The generated layout respects the reference page and save conventions.
4. Offsets in `fxdata.h` correctly represent data-section-relative addresses.
5. The image conversion pipeline is close enough to the reference implementation that existing code using `ArduboyFX` reads the expected frames and masks.
6. The editor makes `fxdata.txt` easier to understand rather than hiding it.
7. The tool is modular enough to live inside a larger Arduboy web suite.
8. The implementation is covered by fixture-based tests, not just manual clicks.

## Important Product Philosophy

Do not design this as a totally new proprietary authoring format.

This tool should:

- honor the existing `fxdata.txt` ecosystem
- preserve compatibility with current Arduboy FX development habits
- add clarity, previews, validation, and ergonomics
- let advanced users keep working close to the metal

Think of this as a compatibility-preserving "FX workbench" for the browser.

## Nice-to-Have Enhancements

If core compatibility is complete, consider these additions:

- Hex viewer for selected assets
- Resource size heatmap
- Byte cost estimator before import
- Header snippet previews showing how to use generated symbols in code
- One-click export bundle for simulator use
- Optional `.arduboy` packaging handoff
- Import of an existing project zip and automatic reconstruction of editable state

## Deliverables

Produce:

1. The web implementation
2. A short developer README for the host project
3. A compatibility notes document listing any known differences from `fxdata-build.py`
4. A test suite with fixture coverage
5. A clear integration surface for the existing Arduboy web suite

## Reference Inputs to Study Before or During Implementation

Use these as primary references:

- `https://github.com/MrBlinky/Arduboy-Python-Utilities`
- `https://github.com/MrBlinky/Arduboy-Python-Utilities/blob/main/fxdata-build.py`
- `https://github.com/MrBlinky/Arduboy-Python-Utilities/tree/main/example-fxdata`
- `https://github.com/MrBlinky/Arduboy-Python-Utilities/blob/main/example-fxdata/fxdata.txt`
- `https://github.com/MrBlinky/Arduboy-homemade-package/tree/main/board-package-source/libraries/ArduboyFX`
- `https://github.com/MrBlinky/ArduboyFX`

If you find ambiguous behavior, prefer matching the upstream Python implementation and real example output over inventing cleaner semantics.

These source files are also available in the "ref" folder of this project.

## Final Instruction

Build the tool in a way that a serious Arduboy developer could trust it as a real replacement or companion to the current FX authoring workflow.

The bar is not "it basically works." The bar is:

- compatible
- inspectable
- deterministic
- pleasant to use
- ready to integrate into an existing Arduboy web toolchain
