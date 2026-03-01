# Arduboy Web Tools — Project Knowledge Base

> **Generated:** 2026-02-28  
> **Purpose:** Comprehensive reference document for building a unified web-based Arduboy tool suite from three source codebases.

---

## Table of Contents

1. [Source Repository Summaries](#1-source-repository-summaries)
2. [Complete Feature Inventory](#2-complete-feature-inventory)
3. [Dependency Map](#3-dependency-map)
4. [Hardware & Protocol Reference](#4-hardware--protocol-reference)
5. [Data Format Reference](#5-data-format-reference)
6. [Migration Plan](#6-migration-plan)
7. [JavaScript Architecture Outline](#7-javascript-architecture-outline)
8. [New Project Structure](#8-new-project-structure)

---

## 1. Source Repository Summaries

### 1.1 Arduboy-Python-Utilities (by MrBlinky)

**Nature:** Collection of standalone Python CLI scripts for managing Arduboy hardware.

**Key files:** `uploader.py`, `flashcart-builder.py`, `flashcart-writer.py`, `flashcart-backup.py`, `flashcart-decompiler.py`, `flashcart-trimmer.py`, `eeprom-backup.py`, `eeprom-restore.py`, `eeprom-erase.py`, `image-converter.py`, `image-viewer.py`, `fxdata-build.py`, `fxdata-upload.py`, `sketch-backup.py`, `sketch-erase.py`, `check-usb-support.py`, `uploader-gui.py`

**Dependencies:** pyserial, Pillow, tkinter (GUI only), zipfile, csv, hashlib

**Architecture:** Flat — each script is self-contained with duplicated serial/device code. No shared library. The `uploader-gui.py` is a tkinter wrapper combining upload + EEPROM + FX dev features.

**What it does:**
- Sketch upload/backup/erase via AVR109 protocol over serial
- FX flash cart build/write/backup/decompile/trim
- EEPROM backup/restore/erase (1KB)
- Image conversion (PNG → C++ header / FX binary)
- FX data build system (custom DSL → binary + C++ header)
- Image viewer (display PNG on Arduboy OLED)
- USB support checking (interrupt vector analysis)
- Hardware patching (SSD1309 display, Arduino Micro LED polarity, Starduino alt-wiring)

---

### 1.2 arduboy_toolset (by haloopdy)

**Nature:** Full-featured PyQt6 desktop GUI application, evolved from the Python Utilities.

**Key architectural improvement:** Clean separation between a reusable `arduboy/` library package (no GUI imports) and the GUI layer. Uses dataclasses for all data interchange.

**Dependencies:** PyQt6, pyserial, Pillow, intelhex, demjson3, python-slugify, requests

**The `arduboy/` library package:**
| Module | Purpose |
|--------|---------|
| `constants.py` | Hardware constants |
| `common.py` | Low-level utils (padding, hex↔bin, bit ops) |
| `arduhex.py` | .hex/.arduboy parsing with `ArduboyParsed` + `ArduboyBinary` dataclasses |
| `fxcart.py` | FX flash cart binary format (parse, compile, trim) — `FxParsedSlot` dataclass |
| `image.py` | Image↔Arduboy binary conversion with `TileConfig` for sprite sheets |
| `patch.py` | Menu button patch, SSD1309 patch, contrast patch, micro LED patch |
| `serial.py` | Complete device communication (flash/verify/backup sketch, FX, EEPROM) |
| `device.py` | USB device discovery, VID:PID matching, `ArduboyDevice` dataclass |
| `shortcuts.py` | High-level conversions (slot↔arduboy, device detection) |
| `fxdata_build.py` | FX data build system (DSL parser) |
| `bloggingadeadhorse.py` | Official cart website API integration |

**GUI features beyond the Python Utilities:**
- Tabbed interface (Sketch, FX Flash, EEPROM, Package, Image Convert, FX Dev)
- Full cart editor with drag-drop reordering
- .arduboy package creation/editing (v2/v3/v4 schema support)
- Network cart updates from official database (bloggingadeadhorse.com)
- Device type detection (Arduboy / ArduboyFX / ArduboyMini)
- Progress dialogs with threaded device operations
- Contrast/SSD1309/Micro LED patching UI
- Title screen auto-generation from text
- Batch export (cart slots → .arduboy files)

---

### 1.3 ArduboyWebFlasher (by Kevin Bates)

**Nature:** Browser-based flash tool using Web Serial API. Single-page application.

**Dependencies:** Web Serial API (Chrome/Edge), JSZip

**What it does (production version):**
- Flash .hex files to internal MCU flash
- Flash .bin files to external FX flash
- Flash .arduboy files (extract hex + FX data from ZIP, write both)
- Device selection (FX vs FX-C) with default cart images
- 1200-baud reset trick for entering bootloader
- Circular progress ring with time estimation

**Architecture:** Single HTML file with inline JavaScript. `SerialPortManager` class wraps Web Serial. No module system, no build step.

**Protocol coverage:** Partial AVR109 — `S` (identify), `P` (enter programming), `A` (set address), `B`+`F`/`C` (block write), `g`+`C` (block read for cart scanning), `x` (LED control), `L` (leave programming), `E` (exit bootloader).

**What it does NOT cover:** EEPROM operations, sketch backup, cart building/decompiling, image conversion, FX data build, verify after write, any patching, any cart editing.

---

## 2. Complete Feature Inventory

### Legend
- ✅ = Fully implemented
- 🔶 = Partially implemented  
- ❌ = Not present

| Feature | Python Utils | Toolset | Web Flasher | **Web Suite (Target)** |
|---------|:---:|:---:|:---:|:---:|
| **Sketch Management** | | | | |
| Upload .hex to flash | ✅ | ✅ | ✅ | ✅ |
| Upload .arduboy to flash | ✅ | ✅ | ✅ | ✅ |
| Backup sketch to .hex/.bin | ✅ | ✅ | ❌ | ✅ |
| Erase sketch | ✅ | ✅ | ❌ | ✅ |
| Verify after write | ✅ | ✅ | ❌ | ✅ |
| **FX Flash Cart** | | | | |
| Write .bin to FX flash | ✅ | ✅ | ✅ | ✅ |
| Backup FX flash to .bin | ✅ | ✅ | ❌ | ✅ |
| Build cart from CSV + files | ✅ | ✅ (from GUI) | ❌ | ✅ |
| Decompile cart .bin → files | ✅ | ✅ | ❌ | ✅ |
| Trim cart (remove trailing empty) | ✅ | ✅ | ❌ | ✅ |
| Cart editor (reorder/add/remove) | ❌ | ✅ | ❌ | ✅ |
| Scan cart (read headers only) | ❌ | ✅ | 🔶 | ✅ |
| Multi-cart (>16MB) support | ✅ | ✅ | ❌ | ✅ |
| **EEPROM** | | | | |
| Backup EEPROM (1KB) | ✅ | ✅ | ❌ | ✅ |
| Restore EEPROM | ✅ | ✅ | ❌ | ✅ |
| Erase EEPROM | ✅ | ✅ | ❌ | ✅ |
| **Image Tools** | | | | |
| Image → C++ code | ✅ | ✅ | ❌ | ✅ |
| Image → FX binary | ✅ | ✅ | ❌ | ✅ |
| Sprite sheet support | ✅ | ✅ | ❌ | ✅ |
| Mask/transparency support | ✅ | ✅ | ❌ | ✅ |
| Display image on OLED | ✅ | ❌ | ❌ | ✅ |
| Title screen generation | ❌ | ✅ | ❌ | ✅ |
| **FX Data Build** | | | | |
| Parse fxdata DSL | ✅ | ✅ | ❌ | ✅ |
| Build fxdata .bin + .h | ✅ | ✅ | ❌ | ✅ |
| Upload dev FX data | ✅ | ✅ | ❌ | ✅ |
| **Package Management** | | | | |
| Read .arduboy (v2/v3/v4) | 🔶 | ✅ | 🔶 | ✅ |
| Write .arduboy (v4) | ❌ | ✅ | ❌ | ✅ |
| Edit package metadata | ❌ | ✅ | ❌ | ✅ |
| **Patching** | | | | |
| SSD1309 display patch | ✅ | ✅ | ❌ | ✅ |
| Contrast adjustment | ❌ | ✅ | ❌ | ✅ |
| Menu button (UP+DOWN) patch | ✅ | ✅ | ❌ | ✅ |
| Micro LED polarity patch | ✅ | ✅ | ❌ | ✅ |
| Starduino alt-wiring patch | ✅ | ❌ | ❌ | 🔶 |
| **Device Management** | | | | |
| Auto-detect device | ✅ | ✅ | 🔶 | ✅ |
| Device type detection (FX/Mini) | ❌ | ✅ | 🔶 | ✅ |
| 1200-baud bootloader reset | ✅ | ✅ | ✅ | ✅ |
| JEDEC flash chip ID read | ✅ | ✅ | ❌ | ✅ |
| Bootloader version check | ✅ | ✅ | ✅ | ✅ |
| LED/button control | ✅ | ✅ | ✅ | ✅ |
| **Network** | | | | |
| Cart update from website | ❌ | ✅ | ❌ | ✅ |
| Download official cart images | ❌ | ✅ | 🔶 | ✅ |
| **Analysis** | | | | |
| Check USB support in hex | ✅ | ❌ | ❌ | ✅ |
| Sketch analysis (device detection) | ❌ | ✅ | ❌ | ✅ |
| Bootloader protection check | ✅ | ✅ | ❌ | ✅ |

---

## 3. Dependency Map

### Python Utilities → External Dependencies
```
uploader.py ──────────► pyserial
flashcart-builder.py ──► pyserial, Pillow, csv, hashlib
flashcart-writer.py ───► pyserial
flashcart-backup.py ───► pyserial
flashcart-decompiler.py► Pillow
flashcart-trimmer.py ──► (none, pure binary)
image-converter.py ────► Pillow
image-viewer.py ───────► pyserial, Pillow
fxdata-build.py ───────► Pillow, re
fxdata-upload.py ──────► pyserial
uploader-gui.py ───────► pyserial, Pillow, tkinter, zipfile
```

### Toolset `arduboy/` Internal Dependency Graph
```
constants.py ◄─── (no imports from package)
     ▲
common.py ◄────── (imports constants)
     ▲
arduhex.py ◄───── (imports common, constants) + intelhex, PIL, zipfile, demjson3
     ▲
image.py ◄──────── (imports common, constants) + PIL
     ▲
patch.py ◄──────── (imports common, constants)
     ▲
fxcart.py ◄─────── (imports common, constants, patch, image)
     ▲
serial.py ◄─────── (imports common, constants) + pyserial
     ▲
device.py ◄─────── (imports constants) + pyserial
     ▲
fxdata_build.py ◄── (imports image) + PIL, re
     ▲
shortcuts.py ◄──── (imports arduhex, fxcart, serial, device, image)
     ▲
bloggingadeadhorse.py ◄── (imports fxcart) + requests, json
```

### JavaScript Web Suite → Required Web APIs / Libraries
```
Web Serial API ─────── Device communication (Chrome/Edge only)
JSZip ──────────────── .arduboy file handling (ZIP)
Canvas API ─────────── Image conversion (replaces Pillow)
File API ───────────── File reading/drag-drop
Fetch API ──────────── Network cart updates
TextEncoder/Decoder ── String ↔ binary
Blob/ArrayBuffer ───── Binary data handling
IndexedDB ──────────── Persistent storage (settings, cached data)
Web Workers ────────── Background processing (cart compile, image convert)
```

---

## 4. Hardware & Protocol Reference

### 4.1 Device USB Identifiers

| Device | Normal VID:PID | Bootloader VID:PID |
|--------|:---:|:---:|
| Arduino Leonardo | 2341:8036 | 2341:0036 |
| Arduino Leonardo (alt) | 2A03:8036 | 2A03:0036 |
| Arduino Micro | 2341:8037 | 2341:0037 |
| Arduino Micro (alt) | 2A03:8037 | 2A03:8037 |
| Genuino Micro | 2341:8237 | 2341:0237 |
| SparkFun Pro Micro 5V | 1B4F:9206 | 1B4F:9205 |
| Adafruit ItsyBitsy 5V | 239A:800E | 239A:000E |

> **Web Serial filter:** `{ usbVendorId: 0x2341, usbProductId: 0x0036 }` and `{ usbVendorId: 0x2341, usbProductId: 0x8036 }` cover the most common Arduboy.

### 4.2 Memory Map

```
ATmega32U4 Internal Flash (32KB):
┌────────────────────┐ 0x0000
│ Interrupt Vectors   │ (0x00–0xC5, 49 vectors × 2 words)
│ Application Code    │
│ ...                 │
├────────────────────┤ 0x7000 (28KB, Caterina) or 0x7400 (29KB, Cathy3K)
│ Bootloader          │ (4KB Caterina / 3KB Cathy3K)
└────────────────────┘ 0x7FFF

ATmega32U4 EEPROM (1KB):
┌────────────────────┐ 0x0000
│ 1024 bytes          │
└────────────────────┘ 0x03FF

External SPI Flash (FX chip, 16MB typical):
┌────────────────────┐ Page 0x0000
│ Flash Cart Slots    │ (linked list of game slots)
│ ...                 │
├────────────────────┤ (variable, end of cart data)
│ Free Space          │
├────────────────────┤ (MAX_PAGES - dev_pages)
│ FX Dev Data         │ (development mode: data at end of flash)
└────────────────────┘ Page 0xFFFF (16MB = 65536 pages × 256 bytes)
```

### 4.3 AVR109/Caterina Serial Protocol

**Connection:** 57600 baud (original) or 115200 baud (Web Flasher uses this). 8N1. The Caterina bootloader actually accepts any baud rate since it's CDC-USB.

**Entering Bootloader:**
1. Open serial port at 1200 baud
2. Close immediately (or after 500ms)
3. Wait for device to disconnect (~500ms)
4. Wait for device to re-enumerate with bootloader PID
5. Open serial port at working baud rate

**Command Reference (all commands used across all three codebases):**

| Cmd | Hex | Params | Response | Description |
|-----|-----|--------|----------|-------------|
| `S` | 0x53 | — | 7 bytes ("ARDUBOY" or "CATERINA") | Get software identifier |
| `V` | 0x56 | — | 2 bytes ASCII (e.g. "10", "13") | Get version. ≥"13" = Cathy3K with FX support |
| `P` | 0x50 | — | 0x0D | Enter programming mode |
| `L` | 0x4C | — | 0x0D | Leave programming mode |
| `E` | 0x45 | — | 0x0D | Exit bootloader, start application |
| `r` | 0x72 | — | 1 byte | Read lock bits |
| `A` | 0x41 | 2 bytes (addr_hi, addr_lo) | 0x0D | Set address. Internal flash: word address. FX: page number |
| `B` | 0x42 | 2 bytes (len_hi, len_lo) + type + data | 0x0D | Block write. Type: `F`=flash, `E`=EEPROM, `C`=FX cart |
| `g` | 0x67 | 2 bytes (len_hi, len_lo) + type | N bytes | Block read. Same type codes |
| `j` | 0x6A | — | 3 bytes (JEDEC ID) | Read external flash JEDEC ID (Cathy3K v1.3+) |
| `x` | 0x78 | 1 byte (control flags) | 0x0D | LED/button control (Cathy3K) |
| `D` | 0x44 | — | (use via B cmd type 'D') | OLED display write |
| `T` | 0x54 | 1 byte (slot) | 0x0D | Select 16MB cart slot (>16MB flash) |

**LED Control Byte (x command):**
```
Bit 7: Disable bootloader menu buttons
Bit 6: (Reserved / breathing off)
Bit 5: Disable RxTx status LEDs
Bit 4: Rx LED on
Bit 3: Tx LED on
Bit 2: RGB Green
Bit 1: RGB Red
Bit 0: RGB Blue
```
Common values: `0xC2` = RED + buttons off, `0xC1` = BLUE + buttons off, `0x44` = GREEN + buttons on, `0x40` = all off + buttons on

**Address Encoding:**

*Internal Flash (type 'F'):* Word address. Page i (128 bytes) → word address = i × 64.
```
addr_hi = i >> 2
addr_lo = (i & 3) << 6
```

*External Flash (type 'C'):* Page number (256 bytes/page). Block b (64KB) → page = b × 256.
```
addr_hi = page >> 8
addr_lo = page & 0xFF
```

*EEPROM (type 'E'):* Byte address.
```
addr_hi = 0x00
addr_lo = 0x00  (always start at 0)
```

### 4.4 FX Program Patching Addresses

Programs stored in FX cart slots are patched at specific offsets:
```
Offset 0x14-0x15: RETI signature (0x18, 0x95) — marks FX data page location
Offset 0x16-0x17: FX data page number (big-endian uint16)
Offset 0x18-0x19: RETI signature (0x18, 0x95) — marks FX save page location
Offset 0x1A-0x1B: FX save page number (big-endian uint16)
```

### 4.5 JEDEC Flash Chip Database

| Manufacturer ID | Name | Common Capacities |
|:---:|---|---|
| 0xEF | Winbond | W25Q128 (16MB) |
| 0xC8 | GigaDevice | GD25Q128 (16MB) |
| 0x9D | ISSI | IS25LP128 (16MB) |
| 0xBF | Microchip | SST25/26 |
| 0x01 | Cypress/Spansion | S25FL |
| 0x20 | Micron | M25P/N25Q |
| 0xC2 | Macronix | MX25L |
| 0x1F | Adesto/Atmel | AT25SF |

Capacity formula: `1 << jedecId[2]` bytes.

---

## 5. Data Format Reference

### 5.1 Intel HEX Format

Standard Intel HEX (IHEX) record format:
```
:LLAAAATT[DD...]CC
```
- `:` — Start code
- `LL` — Byte count (hex)
- `AAAA` — 16-bit address (hex)
- `TT` — Record type: 00=data, 01=EOF, 02=ext segment addr, 04=ext linear addr
- `DD` — Data bytes (hex pairs)
- `CC` — Two's complement checksum

EOF record: `:00000001FF`

### 5.2 FX Flash Cart Slot Header (256 bytes)

```
Offset  Size  Field
------  ----  -----
0x00    7     Magic: "ARDUBOY" (0x41 0x52 0x44 0x55 0x42 0x4F 0x59)
0x07    1     Category ID (0 = all categories)
0x08    2     Previous slot page (big-endian uint16)
0x0A    2     Next slot page (big-endian uint16)
0x0C    2     Slot total size in pages (big-endian uint16)
0x0E    1     Program size in half-pages (128-byte units)
0x0F    2     Program start page (big-endian uint16)
0x11    2     Data start page (big-endian uint16)
0x13    2     Save start page (big-endian uint16)
0x15    2     Data size in pages (big-endian uint16)
0x17    8     (Reserved/padding — 0xFF)
0x19    32    SHA-256 hash of (program + data) for deduplication
0x39    199   Metadata strings: title\0version\0developer\0info\0
```

**Slot Layout:**
```
[Header: 256 bytes]
[Title Screen: 1024 bytes (128×64 1-bit image)]
[Program: N × 256 bytes (hex data padded to page boundary)]
[FX Data: N × 256 bytes]
[Padding: to 4096 boundary if save exists]
[FX Save: N × 4096 bytes (aligned to 4KB)]
```

**Category slots:** Same header + title screen, but no program/data/save (program size = 0).

**End sentinel:** First 7 bytes of next "slot" are all 0xFF (no "ARDUBOY" magic).

### 5.3 .arduboy Package Format

ZIP file containing:
```
info.json          — Metadata (required)
*.hex              — Sketch binary (Intel HEX)
*.bin              — FX data (optional)
*-save.bin         — FX save (optional)
*.png              — Cart title image (optional)
LICENSE.txt        — License (optional)
```

**info.json schema (v4 — current):**
```json
{
  "schemaVersion": 4,
  "title": "Game Title",
  "description": "Description text",
  "author": "Developer Name",
  "version": "1.0.0",
  "date": "2025-01-01",
  "genre": "Action",
  "license": "MIT",
  "url": "https://...",
  "sourceUrl": "https://...",
  "email": "dev@example.com",
  "companion": "",
  "contributors": [
    {
      "name": "Name",
      "roles": ["Code", "Art"],
      "urls": ["https://..."]
    }
  ],
  "binaries": [
    {
      "title": "Game Title",
      "filename": "game.hex",
      "flashdata": "fxdata.bin",
      "flashsave": "fxsave.bin",
      "device": "ArduboyFX",
      "cartImage": "title.png"
    }
  ]
}
```

Older schemas (v2/v3) used different contributor key names: `publisher`, `code`, `art`, `sound` instead of the structured `contributors` array.

### 5.4 Arduboy Screen Image Format (1024 bytes)

128×64 pixels, 1-bit monochrome. Column-major, vertical-byte, LSB = top pixel.

```
For each strip of 8 rows (y = 0, 8, 16, ... 56):
  For each column (x = 0 to 127):
    byte = 0
    For each pixel in strip (p = 0 to 7):
      byte >>= 1
      if pixel(x, y+p) is white:
        byte |= 0x80
    emit(byte)
```

Total: 8 strips × 128 columns = 1024 bytes.

### 5.5 Sprite/Image Format (for Sprites library)

**Code output (.h file):**
```
[width: 1 byte] [height: 1 byte] [pixel_data...] [optional: mask_data interleaved]
```
Width/height max 255 each. If transparent, bytes interleave: image_byte, mask_byte, image_byte, mask_byte...

**FX binary output:**
```
[width: 2 bytes big-endian] [height: 2 bytes big-endian] [pixel_data...]
```
No interleaved mask in FX mode.

Same vertical-byte encoding as screen format, applied per tile/frame.

### 5.6 FX Data Build Script Format (fxdata.txt)

Custom DSL syntax:
```c
// Types
image_t   LABEL = "path/to/image.png"    // Image → binary sprite data
raw_t     LABEL = "path/to/file.bin"      // Raw binary inclusion
uint8_t   LABEL = 0x01 0x02 0x03          // Byte array
uint16_t  LABEL = 1234                    // Big-endian 16-bit
uint24_t  LABEL = 0x123456                // Big-endian 24-bit
uint32_t  LABEL = 0x12345678              // Big-endian 32-bit
String    LABEL = "Hello World"           // Null-terminated UTF-8

// Directives
align N                                    // Align to N-byte boundary
datasection                                // Data section (default)
savesection                                // Save data section
include "otherfile.txt"                    // Include another file
namespace Name { ... } namespace_end       // C++ namespace

// Image filename convention
// filename_WxH_S.png → width W, height H, spacing S
```

Output files: `*-data.bin`, `*-save.bin`, `*.bin` (combined dev), `*.h` (C++ header)

### 5.7 Flash Cart CSV Index Format

Semicolon or comma delimited:
```
List;Title;TitleScreen;HexFile;DataFile;SaveFile;Version;Developer;Info;Likes;Website;Source;EEPROMStart;EEPROMSize;EEPROMFile
```

Rows without a hex file are category headers.

---

## 6. Migration Plan

### Phase 0: Project Setup & Core Infrastructure
**Priority:** Critical | **Effort:** Small

- [ ] Initialize project with Vite + vanilla JS (no framework — matches Web Flasher simplicity)
- [ ] Set up project structure (see Section 8)
- [ ] Configure ESLint, Prettier
- [ ] Set up basic HTML shell with tab navigation
- [ ] Add JSZip dependency
- [ ] Create constants module (hardware values, USB IDs, protocol commands)

### Phase 1: Serial Communication Layer
**Priority:** Critical | **Effort:** Medium
**Source:** `arduboy/serial.py`, `arduboy/device.py`, Web Flasher's `SerialPortManager`

- [ ] Port `SerialPortManager` class with proper error handling
- [ ] Implement connection flow: Web Serial `requestPort()` with all VID:PID filters
- [ ] Implement 1200-baud reset trick
- [ ] Port all AVR109 commands: `S`, `V`, `P`, `L`, `E`, `r`, `A`, `B`, `g`, `j`, `x`, `T`
- [ ] Add timeout and retry logic (missing from all sources)
- [ ] Add disconnect detection and reconnection
- [ ] Implement `JedecInfo` parsing
- [ ] Add proper read buffering (Web Serial returns variable-size chunks)

### Phase 2: Hex/Binary Parsing & Sketch Operations
**Priority:** Critical | **Effort:** Medium
**Source:** `uploader.py`, `arduboy/arduhex.py`, Web Flasher's `parseIntelHex()`

- [ ] Port Intel HEX parser (already exists in Web Flasher — enhance with full validation)
- [ ] Port Intel HEX writer (bin → hex, from `arduboy/common.py`)
- [ ] Implement sketch upload (flash all used pages)
- [ ] Implement sketch verify (read-back and compare)
- [ ] Implement sketch backup (read flash → generate hex)
- [ ] Implement sketch erase (zero-length write to page 0)
- [ ] Port `SketchAnalysis` — page counting, bootloader overlap detection, device detection
- [ ] Port bootloader protection check (lock bits + region analysis)

### Phase 3: EEPROM Operations
**Priority:** High | **Effort:** Small
**Source:** `eeprom-*.py`, `arduboy/serial.py`

- [ ] Implement EEPROM read (1024 bytes)
- [ ] Implement EEPROM write (1024 bytes)
- [ ] Implement EEPROM erase (fill 0xFF)
- [ ] Add UI: file picker, hex viewer/editor, download

### Phase 4: FX Flash Cart — Read/Write
**Priority:** High | **Effort:** Medium
**Source:** `flashcart-writer.py`, `flashcart-backup.py`, `arduboy/serial.py`

- [ ] Implement FX flash write (64KB blocks with partial block preservation)
- [ ] Implement FX flash read/backup
- [ ] Implement FX flash verify
- [ ] Implement cart scan (header-only walk for fast size detection)
- [ ] Add JEDEC chip detection and capacity reporting
- [ ] Support multi-cart (>16MB via `T` command)

### Phase 5: FX Flash Cart — Parse/Compile
**Priority:** High | **Effort:** Large
**Source:** `flashcart-builder.py`, `flashcart-decompiler.py`, `arduboy/fxcart.py`

- [ ] Port `FxParsedSlot` data model
- [ ] Port cart binary parser (walk headers, extract slots)
- [ ] Port cart binary compiler (headers, padding, alignment, linked-list pointers)
- [ ] Port SHA-256 hashing for deduplication
- [ ] Port metadata string encoding/decoding
- [ ] Implement cart trim (find end of data, truncate)

### Phase 6: Binary Patching
**Priority:** High | **Effort:** Medium
**Source:** `arduboy/patch.py`

- [ ] Port menu button patch (timer0 ISR replacement — 152 bytes of AVR machine code)
- [ ] Port SSD1309 display patch (LCD boot program signature detection)
- [ ] Port contrast adjustment patch
- [ ] Port Micro LED polarity patch
- [ ] Port FX data/save page patching (offsets 0x14-0x1B)

### Phase 7: Image Handling
**Priority:** High | **Effort:** Medium
**Source:** `image-converter.py`, `arduboy/image.py`

- [ ] Port screen image ↔ binary conversion (1024 bytes ↔ 128×64 pixels)
- [ ] Port sprite sheet / tile conversion with `TileConfig`
- [ ] Port mask/transparency handling (interleaved and separate)
- [ ] Port code output generation (C++ header format)
- [ ] Port FX binary output generation
- [ ] Use Canvas API for image manipulation (replaces Pillow)
- [ ] Title screen generation from text (using Canvas font rendering)
- [ ] Image preview in UI

### Phase 8: .arduboy Package Management
**Priority:** Medium | **Effort:** Medium
**Source:** `arduboy/arduhex.py`

- [ ] Port .arduboy reader (ZIP → `ArduboyParsed`, v2/v3/v4 schemas)
- [ ] Port .arduboy writer (v4 schema)
- [ ] Port JSON fixer (trailing comma removal)
- [ ] Port contributor schema upgrade (v2 → v4)
- [ ] Package editor UI (edit metadata, binaries, images)
- [ ] Multi-binary support (FX + Mini + plain Arduboy variants)

### Phase 9: FX Data Build System
**Priority:** Medium | **Effort:** Large
**Source:** `fxdata-build.py`, `arduboy/fxdata_build.py`

- [ ] Port DSL parser (line-by-line, supports types, labels, sections, includes, namespaces)
- [ ] Port image conversion within DSL context
- [ ] Port output generation: data.bin, save.bin, combined.bin, .h header
- [ ] Handle `align`, `include`, `namespace` directives
- [ ] Built-in constants (drawing modes)

### Phase 10: Cart Editor UI
**Priority:** Medium | **Effort:** Large
**Source:** `main_cart.py`, `widget_slot.py`

- [ ] Slot list display with drag-drop reordering
- [ ] Category management (add/remove/reorder categories)
- [ ] Game slot editing (title, version, developer, info, images)
- [ ] Import from .hex/.arduboy files (drag-drop)
- [ ] Export slots as .arduboy files
- [ ] Title image preview and editing
- [ ] Search/filter functionality
- [ ] Metadata length warnings (199-byte limit)

### Phase 11: Network Features
**Priority:** Low | **Effort:** Medium
**Source:** `arduboy/bloggingadeadhorse.py`, `widget_update.py`

- [ ] Cart metadata API integration (bloggingadeadhorse.com)
- [ ] Compute updates (match existing cart slots to official database)
- [ ] Apply updates (preserve saves, merge categories)
- [ ] Download compiled cart binaries
- [ ] Device-specific filtering (FX vs Mini)

### Phase 12: Polish & Advanced Features
**Priority:** Low | **Effort:** Variable

- [ ] USB support check (interrupt vector analysis)
- [ ] Image viewer (display on OLED via bootloader)
- [ ] Offline support (Service Worker / PWA)
- [ ] Settings persistence (IndexedDB/localStorage)
- [ ] Comprehensive error handling and recovery
- [ ] Accessibility improvements
- [ ] Mobile-responsive layout (where Web Serial is available)

---

## 7. JavaScript Architecture Outline

### 7.1 Design Principles

1. **Clean separation:** Core library (pure JS, no DOM) vs. UI layer
2. **ES Modules:** Native ESM with `import`/`export`
3. **No framework:** Vanilla JS + Web Components for UI (matches Web Flasher philosophy, keeps it simple)
4. **Async-first:** All serial I/O and file operations are `async`/`await`
5. **Event-driven:** Custom events for progress, status, errors
6. **Progressive:** Start with basic flash → add features incrementally
7. **Testable:** Core library has zero DOM dependencies, unit-testable with Vitest

### 7.2 Module Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        UI Layer                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Sketch   │ │ FX Flash │ │ EEPROM   │ │ Cart     │   │
│  │ Tab      │ │ Tab      │ │ Tab      │ │ Editor   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Image    │ │ Package  │ │ FX Data  │ │ Settings │   │
│  │ Convert  │ │ Editor   │ │ Build    │ │          │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Shared UI Components                    │ │
│  │  (Progress, FilePicker, ImagePreview, HexViewer)    │ │
│  └─────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                     Core Library                         │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────┐   │
│  │ serial/    │ │ formats/   │ │ operations/         │   │
│  │  protocol  │ │  intelhex  │ │  sketch (upload/    │   │
│  │  device    │ │  fxcart    │ │    backup/verify)   │   │
│  │  transport │ │  arduboy   │ │  fx (write/read/    │   │
│  │  jedec     │ │  image     │ │    scan/compile)    │   │
│  └────────────┘ │  fxdata    │ │  eeprom (r/w/erase) │  │
│                 └────────────┘ │  patch (menu/screen/ │  │
│                                │    contrast/led)     │  │
│  ┌────────────┐ ┌────────────┐│  network (cart API)  │  │
│  │ utils/     │ │ constants  ││                      │  │
│  │  binary    │ │            │└────────────────────┘  │  │
│  │  crypto    │ └────────────┘                        │  │
│  │  text      │                                       │  │
│  └────────────┘                                       │  │
└─────────────────────────────────────────────────────────┘
```

### 7.3 Key Classes / Modules

**`serial/transport.js`** — `SerialTransport` class
```js
class SerialTransport {
  constructor()
  async requestPort(filters)    // Web Serial requestPort
  async open(baudRate, bufferSize)
  async close()
  async write(data)             // Uint8Array
  async read(length)            // Returns Uint8Array of exact length (buffered)
  async writeAndRead(data, responseLength)
  async drain()
  get isOpen()
}
```

**`serial/protocol.js`** — `ArduboyProtocol` class
```js
class ArduboyProtocol {
  constructor(transport)
  async getIdentifier()         // 'S' → string
  async getVersion()            // 'V' → number
  async enterProgramming()      // 'P'
  async leaveProgramming()      // 'L'
  async exitBootloader()        // 'E'
  async readLockBits()          // 'r' → byte
  async setAddress(addr)        // 'A' + 2 bytes
  async blockWrite(type, data)  // 'B' + len + type + data
  async blockRead(type, length) // 'g' + len + type → Uint8Array
  async getJedecId()            // 'j' → {manufacturer, type, capacity}
  async setLed(flags)           // 'x' + byte
  async selectCartSlot(slot)    // 'T' + byte
}
```

**`serial/device.js`** — `DeviceManager` class
```js
class DeviceManager {
  static USB_FILTERS = [...]    // All VID:PID pairs
  async connect()               // requestPort + detect state
  async enterBootloader()       // 1200-baud trick
  async getDeviceInfo()         // Version, JEDEC, device type
  isBootloaderMode()
}
```

**`formats/intelhex.js`**
```js
function parseIntelHex(hexString)     // → { data: Uint8Array, startAddress }
function generateIntelHex(data)       // → string (Intel HEX format)
```

**`formats/fxcart.js`**
```js
class FxSlot { category, imageRaw, programRaw, dataRaw, saveRaw, meta }
function parseFxCart(data)            // Uint8Array → FxSlot[]
function compileFxCart(slots)         // FxSlot[] → Uint8Array
function trimFxCart(data)             // → Uint8Array (trimmed)
function scanFxCartHeaders(data)      // Fast header-only scan
```

**`formats/arduboy.js`**
```js
class ArduboyPackage { title, version, author, binaries, contributors, ... }
async function readArduboyFile(file)  // File/Blob → ArduboyPackage
async function writeArduboyFile(pkg)  // ArduboyPackage → Blob (ZIP)
```

**`formats/image.js`**
```js
function screenToImage(bytes)        // 1024 bytes → ImageData (128×64)
function imageToScreen(imageData)    // ImageData → Uint8Array(1024)
function convertSprite(imageData, config) // → { code: string, binary: Uint8Array }
```

**`operations/sketch.js`**
```js
async function uploadSketch(protocol, hexData, options, onProgress)
async function verifySketch(protocol, hexData, onProgress)
async function backupSketch(protocol, includeBootloader, onProgress)
async function eraseSketch(protocol)
function analyzeSketch(binaryData)   // → SketchAnalysis
```

**`operations/fx.js`**
```js
async function writeFx(protocol, data, startPage, verify, onProgress)
async function readFx(protocol, onProgress)    // Full backup
async function scanFx(protocol, onProgress)    // Header scan
async function writeFxDev(protocol, data, save, onProgress)
```

**`operations/eeprom.js`**
```js
async function readEeprom(protocol)        // → Uint8Array(1024)
async function writeEeprom(protocol, data)
async function eraseEeprom(protocol)
```

**`operations/patch.js`**
```js
function patchMenuButtons(program)          // → { success, message, patched }
function patchSSD1309(flashData)            // → patched data
function patchContrast(flashData, level)
function patchMicroLed(flashData)
function patchFxPages(program, dataPage, savePage)
```

### 7.4 UI Component Architecture

Using **Web Components** (Custom Elements) for encapsulation:

```
<arduboy-app>                          // Main shell
  <arduboy-navbar>                     // Tab navigation
  <arduboy-connection-status>          // Device status bar
  
  // Tab panels:
  <arduboy-sketch-panel>               // Upload/backup/erase sketch
  <arduboy-fx-panel>                   // FX flash read/write
  <arduboy-eeprom-panel>               // EEPROM operations
  <arduboy-cart-editor>                // Full cart editor
  <arduboy-image-converter>            // Image → code/binary
  <arduboy-package-editor>             // .arduboy editor
  <arduboy-fxdata-builder>             // FX data DSL builder
  <arduboy-settings-panel>             // Device, preferences
  
  // Shared:
  <arduboy-progress-dialog>            // Modal progress
  <arduboy-file-picker>                // Drag-drop + browse
  <arduboy-image-preview>              // 128×64 preview at scale
  <arduboy-hex-viewer>                 // Binary data viewer
</arduboy-app>
```

### 7.5 Build & Dev Tooling

- **Vite** — Dev server + production bundler (fast, native ESM)
- **Vitest** — Unit testing (Vite-native, fast)
- **ESLint + Prettier** — Code quality
- **No TypeScript initially** — Start with JSDoc types for speed, migrate later if needed

---

## 8. New Project Structure

```
arduboy-webtools/
├── index.html                          # App shell
├── vite.config.js                      # Vite configuration
├── package.json
├── .eslintrc.js
├── .prettierrc
├── .gitignore
│
├── public/
│   ├── favicon.ico
│   ├── images/
│   │   └── arduboy-icon.png
│   └── defaults/                       # Default cart images
│       ├── whole-enchilada.bin
│       └── fx-c-multi.bin
│
├── src/
│   ├── main.js                         # App entry point
│   │
│   ├── core/                           # Pure JS library (no DOM)
│   │   ├── constants.js                # All hardware/protocol constants
│   │   │
│   │   ├── serial/
│   │   │   ├── transport.js            # Web Serial wrapper
│   │   │   ├── protocol.js             # AVR109 command layer
│   │   │   ├── device.js               # Device discovery & management
│   │   │   └── jedec.js                # JEDEC ID database
│   │   │
│   │   ├── formats/
│   │   │   ├── intelhex.js             # Intel HEX parse/generate
│   │   │   ├── fxcart.js               # FX cart binary format
│   │   │   ├── arduboy.js              # .arduboy package (ZIP) format
│   │   │   ├── image.js                # Image ↔ binary conversion
│   │   │   ├── fxdata.js               # FX data DSL parser/builder
│   │   │   └── csv.js                  # Flashcart CSV index format
│   │   │
│   │   ├── operations/
│   │   │   ├── sketch.js               # Upload/verify/backup/erase sketch
│   │   │   ├── fx.js                   # FX flash read/write/scan
│   │   │   ├── eeprom.js               # EEPROM read/write/erase
│   │   │   ├── patch.js                # All binary patches
│   │   │   └── network.js              # Cart update API
│   │   │
│   │   └── utils/
│   │       ├── binary.js               # Binary helpers (pad, align, checksum)
│   │       ├── crypto.js               # SHA-256 wrapper
│   │       └── text.js                 # String/encoding helpers
│   │
│   ├── ui/                             # UI components (DOM-dependent)
│   │   ├── app.js                      # Main app shell & routing
│   │   ├── styles/
│   │   │   ├── main.css                # Global styles
│   │   │   ├── variables.css           # CSS custom properties
│   │   │   └── components.css          # Shared component styles
│   │   │
│   │   ├── components/                 # Reusable UI components
│   │   │   ├── progress-dialog.js      # Modal progress bar
│   │   │   ├── file-picker.js          # File input with drag-drop
│   │   │   ├── image-preview.js        # 128×64 Arduboy screen preview
│   │   │   ├── hex-viewer.js           # Binary data hex viewer
│   │   │   ├── connection-status.js    # Device connection indicator
│   │   │   └── navbar.js               # Tab navigation
│   │   │
│   │   └── panels/                     # Feature panels (tabs)
│   │       ├── sketch-panel.js         # Sketch upload/backup
│   │       ├── fx-panel.js             # FX flash operations
│   │       ├── eeprom-panel.js         # EEPROM operations
│   │       ├── cart-editor.js          # Full cart editor
│   │       ├── image-converter.js      # Image tool
│   │       ├── package-editor.js       # .arduboy editor
│   │       ├── fxdata-builder.js       # FX data build tool
│   │       └── settings-panel.js       # Settings & device config
│   │
│   └── workers/                        # Web Workers for heavy processing
│       ├── cart-compiler.worker.js     # Cart compile/parse in background
│       └── image-converter.worker.js   # Image conversion in background
│
├── tests/
│   ├── core/
│   │   ├── formats/
│   │   │   ├── intelhex.test.js
│   │   │   ├── fxcart.test.js
│   │   │   ├── arduboy.test.js
│   │   │   └── image.test.js
│   │   ├── operations/
│   │   │   └── patch.test.js
│   │   └── utils/
│   │       └── binary.test.js
│   └── fixtures/                       # Test data files
│       ├── sample.hex
│       ├── sample.arduboy
│       └── sample-cart.bin
│
└── docs/
    ├── PROJECT_KNOWLEDGE.md            # This file
    ├── ARCHITECTURE.md                 # Architecture decisions
    ├── PROTOCOL.md                     # Serial protocol reference
    └── FORMATS.md                      # Data format specifications
```

---

## Appendix A: Key Porting Notes

### Python → JavaScript Gotchas

| Python | JavaScript | Notes |
|--------|-----------|-------|
| `bytearray` | `Uint8Array` | JS typed arrays are fixed-size; use `new Uint8Array([...a, ...b])` to concat |
| `struct.pack('>H', val)` | `new DataView(buf).setUint16(0, val)` | Big-endian by default in DataView with `false` for littleEndian param |
| `hashlib.sha256()` | `crypto.subtle.digest('SHA-256', data)` | Returns `Promise<ArrayBuffer>` |
| `PIL.Image` | Canvas API / `ImageData` | Use `OffscreenCanvas` in workers |
| `zipfile` | JSZip | `await JSZip.loadAsync(file)` |
| `serial.Serial()` | `navigator.serial.requestPort()` | Async, requires user gesture |
| `serial.read(n)` | Buffered reader (Web Serial returns chunks) | Must accumulate until `n` bytes received |
| `time.sleep(ms)` | `await new Promise(r => setTimeout(r, ms))` | |
| `intelhex` library | Custom parser (already exists in Web Flasher) | |
| `demjson3` (lenient JSON) | Custom `fixJSON()` (already exists in Web Flasher) | |
| `threading.Thread` | Web Workers | For heavy processing (cart compile, image convert) |
| File I/O | File API + `<input type="file">` | No filesystem access (use File System Access API for saves) |
| `requests.get/post` | `fetch()` | Handle CORS if cart API requires it |

### Critical Web Serial Buffering

Web Serial's `reader.read()` returns **variable-size chunks**, NOT exact byte counts. You MUST implement a buffering layer:

```js
class BufferedReader {
  #buffer = new Uint8Array(0);
  #reader;
  
  async read(length) {
    while (this.#buffer.length < length) {
      const { value } = await this.#reader.read();
      this.#buffer = concat(this.#buffer, value);
    }
    const result = this.#buffer.slice(0, length);
    this.#buffer = this.#buffer.slice(length);
    return result;
  }
}
```

### Web Serial vs pyserial: 1200-Baud Trick

The 1200-baud trick works differently in Web Serial:
1. User must **re-select** the port after bootloader mode (different USB PID)
2. OR: Request port with **both** PIDs in the filter, and hope the browser auto-reconnects
3. The Web Flasher handles this by requesting the port AFTER the reset, letting the user pick the bootloader device

### CORS Considerations

The bloggingadeadhorse.com cart API may need a CORS proxy if it doesn't return `Access-Control-Allow-Origin` headers. Options:
- Use a serverless function (Cloudflare Workers, Vercel Edge)
- Host a lightweight proxy
- Pre-download cart metadata and bundle it

---

## Appendix B: Feature Priority Matrix

| Priority | Feature | Rationale |
|----------|---------|-----------|
| P0 | Sketch upload (.hex + .arduboy) | Core functionality, already in Web Flasher |
| P0 | FX flash write (.bin) | Core functionality, already in Web Flasher |
| P0 | Serial protocol layer | Foundation for everything |
| P1 | Sketch verify | Safety feature |
| P1 | Sketch backup | Important for users |
| P1 | EEPROM operations | Simple to implement, high value |
| P1 | FX flash backup | Important for users |
| P1 | Cart parse/view | Users need to see what's on their device |
| P2 | Cart editor (reorder/add/remove) | Power user feature |
| P2 | Image conversion | Developer tool |
| P2 | Binary patching (SSD1309, contrast) | Hardware compatibility |
| P2 | .arduboy package editor | Developer tool |
| P3 | Cart network updates | Convenience feature |
| P3 | FX data build system | Developer tool, complex DSL |
| P3 | Image viewer (OLED display) | Nice to have |
| P3 | Multi-cart support | Rare hardware |
