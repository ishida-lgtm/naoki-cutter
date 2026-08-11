# Naoki Cutter — handoff notes

Electron desktop app for macOS. Purpose-built video editor for one user (a surf
coach) to replace CapCut for a narrow workflow: trim/join clips, add
transitions, crop-zoom with pan tracking, per-segment speed ramping, and 4K
export — nothing else. Optimized for that one workflow, not general-purpose
editing. The user is non-technical; they interact with this only through the
built app, never the source. Keep changes simple and prefer fixing root causes
over adding options/flags.

## Stack

- Electron 32, **no asar** (`electron-packager` without asar packing) — this
  matters because `__dirname` in the packaged app resolves to
  `Contents/Resources/app`, same layout as dev, so paths just work either way.
- No frontend framework. `renderer.js` (~1700 lines) is vanilla DOM
  manipulation directly against `index.html`, with plain `<script>` tags (not
  ES modules) — top-level `let`/`function` declarations share one global
  scope, which the DevTools console can also reach directly (`clips`,
  `selectedClip()`, etc. — useful for live debugging without a rebuild).
- ffmpeg/ffprobe are **bundled binaries**, not a Homebrew dependency — see
  "Portability" below. This was a deliberate fix; do not revert to assuming
  `ffmpeg` is on PATH.

## File map

- `main.js` — Electron main process. Everything ffmpeg: filter graph
  construction, export, probing, the auto-track algorithm. This is where
  almost all the hard bugs in this project's history lived.
- `renderer.js` — all UI/interaction logic: clip list, preview player, JKL
  shuttle transport, scrubber + keyframe strip, drag/zoom/pan, undo/redo,
  timeline with drag-reorder, export wiring.
- `preload.js` — the only IPC surface (`contextBridge`). Keep it a thin
  pass-through; put logic in main.js or renderer.js, not here.
- `index.html` / `style.css` — single-window UI, dark theme, no build step.
- `bin/ffmpeg`, `bin/ffprobe`, `bin/libs/*.dylib` — bundled, portable
  binaries. See "Portability" before touching these.

## Data model

One `clip` object per timeline entry (in the `clips` array):

```js
{
  id, path, name,
  duration, width, height, fps,   // probed from source; width/height are
                                   // POST-ROTATION (see "Rotation" below)
  trimStart, trimEnd,             // seconds into the source file
  zoom,                           // 1 = no crop-in; >1 crops toward zoomX/zoomY
  zoomX, zoomY,                   // 0-1 fraction of source frame, static pan center
  panAnimated,                    // if true, panKeyframes drive pan instead of zoomX/zoomY
  panKeyframes: [{ t, x, y }],    // t = seconds from trimStart (LOCAL time, not
                                   // absolute source time); x/y = 0-1 fraction
  speed,                          // whole-clip playback speed multiplier
  speedSegments: [{ start, end, speed }], // per-range speed overrides, LOCAL
                                   // time like panKeyframes.t; gaps fall back
                                   // to `speed` above
}
```

`transitions` is a parallel array, length `clips.length - 1`:
`{ type: 'cut' | 'crossfade' | 'dissolve', duration }`.

**Everything downstream keys off `panKeyframes[].t` and
`speedSegments[].start/end` being clip-local time (0 at `trimStart`)** — not
absolute source time, not output-timeline time. Getting this axis wrong is
the single most common source of bugs in this codebase (see history below).

## Build & deploy

```bash
cd /Users/ishidanaoki/video-editor-app
npx electron-packager . "Naoki Cutter" --platform=darwin --arch=arm64 --out=dist --overwrite --app-bundle-id=com.naoki.cutter
codesign --remove-signature "dist/Naoki Cutter-darwin-arm64/Naoki Cutter.app"
codesign --deep --force --sign - "dist/Naoki Cutter-darwin-arm64/Naoki Cutter.app"
rm -rf "/Applications/Naoki Cutter.app"
cp -R "dist/Naoki Cutter-darwin-arm64/Naoki Cutter.app" "/Applications/Naoki Cutter.app"
```

The user launches the app from `/Applications`, not from source — **any code
change requires this full rebuild sequence to take effect**, and it kills and
restarts the app (renderer state — clips, keyframes — is not persisted
anywhere, so the user loses their in-progress project on every rebuild). Warn
before rebuilding if they've done nontrivial work in-app.

Re-signing (ad-hoc, `--sign -`) is required every time because modifying
anything inside the `.app` bundle invalidates the original signature, and an
unsigned/mismatched bundle triggers macOS Gatekeeper's "app is damaged" error.

For MacBook Air transfer, refresh the zip after every rebuild:
```bash
cd "dist/Naoki Cutter-darwin-arm64"
ditto -c -k --sequesterRsrc --keepParent "Naoki Cutter.app" ~/Desktop/"Naoki Cutter.zip"
```
The zip must be regenerated from the freshly-signed `.app`, not reused.

## Portability (why ffmpeg is bundled)

Originally shelled out to a Homebrew `ffmpeg`. Broke when the user tried to
run the app on a second Mac without Homebrew. Fixed by copying
`ffmpeg`/`ffprobe` binaries into `bin/` and using `dylibbundler` to pull their
~17 dylib dependencies into `bin/libs/`, rewriting install names to
`@executable_path/libs/...`. `main.js` references
`path.join(__dirname, 'bin', 'ffmpeg')`, never a bare `ffmpeg` on PATH.

If ffmpeg needs to be updated or a new filter/feature needs a newer build,
redo this bundling — don't just swap in a Homebrew-linked binary, it'll break
on any machine without that exact Homebrew layout.

## Hard-won implementation details

These cost real debugging time; read before touching the related code.

**Rotation metadata (iPhone video).** iPhone footage stores raw landscape
pixel dimensions with a rotation flag (Display Matrix / `side_data_list[].rotation`)
rather than pre-rotated dimensions. ffmpeg auto-rotates frames before any
filter sees them, but `ffprobe`'s reported `width`/`height` are pre-rotation.
`probeInfo()` in main.js swaps width/height when
`Math.abs(rotation % 180) === 90`. If width/height ever look transposed for
vertical phone footage, this is the first place to check.

**Auto-fit crop baseline.** Before `zoom` is applied, the crop always first
matches the *output* aspect ratio (e.g. cropping 16:9 source down to a 9:16
slice for vertical export), so mismatched orientations fill the frame instead
of getting padded with black bars. `zoom` then crops in further from that
already-fitted baseline, not from the raw source dimensions. This baseline
computation (`baseW`/`baseH` in `buildVideoFilter`) has to stay in sync with
`getAutoFitScale()` in renderer.js (used for the live preview's CSS
transform) — if they diverge, the preview stops matching the export.

**Pan keyframe interpolation is Catmull-Rom Hermite, not linear — and it
must match between main.js and renderer.js.** `buildPiecewiseExpr()` in
main.js (ffmpeg eval-expression string) and `hermiteInterp()`/
`catmullRomTangents()` in renderer.js (plain JS, for live preview) implement
the *same* cardinal-spline math independently — one emits an ffmpeg filter
expression, the other computes numbers directly for the `<video>` CSS
transform. This was a deliberate fix for real, repeatedly-reproduced drift:
linear interpolation between sparse keyframes cuts corners on a real
subject's non-linear path (e.g. a surfer accelerating off a wave), worst at
the midpoint of a gap between keyframes — which is exactly where users kept
reporting the crop drifting off the subject. If you ever change one of these
two functions, change the other to match, or preview and export will
disagree.

**Preview keyframe placement race ("seek-settle").** Clicking/dragging on the
preview to place a keyframe reads `previewVideo.currentTime` and whatever's
currently painted. On 4K source footage, a fast scrub-seek can leave
`currentTime` already reporting the target time while the actual decoded
frame hasn't painted yet — the user ends up placing a keyframe based on a
stale frame. Fixed via `seekPending` (tracks the video element's native
`seeking`/`seeked` events) plus `waitForFrameSettled()`, which the
preview-click and preview-drag handlers check before accepting a position.
Don't remove this guard without understanding why it's there — it was added
after multiple rounds of misdiagnosing this as a crop-math bug when the crop
math was actually already correct.

**Auto-track ("🎯 自動追跡") is deliberately not ML-based.** It's a
dependency-free tracker in `trackSubject()` (main.js): extract downscaled
grayscale frames via ffmpeg at a fixed interval, then frame-to-frame, find the
centroid of the darkest pixels near a velocity-predicted position (small
Gaussian-weighted search window, not a full-frame search). This works well
specifically because the target footage is backlit surf video — a dark
wetsuit silhouette against bright, sparkling water — and was validated against
real footage to be *more* accurate than the user's own hand-placed keyframes
(manual placement had real, measurable positioning errors, discovered by
overlaying computed crop boxes on raw source frames — see "Debugging
methodology" below). No Python/OpenCV/ML model — a prior architectural
decision explicitly prioritized zero external dependencies for portability
(see "Portability"). If tracking needs to get more robust (e.g. multiple
similar-looking subjects in frame), consider template matching before
reaching for a dependency; the user chose click-to-seed-then-track over fully
automatic detection specifically because multi-surfer footage confuses a
"track the darkest blob" heuristic.

Two safety limits exist in `trackSubject()` after a real crash: `MAX_TRACK_SECONDS`
(caps how much of a clip gets extracted/tracked — an untrimmed multi-minute
clip previously tried to buffer the whole thing and crashed the app with an
out-of-memory allocation failure) and `MAX_BYTES` (kills the ffmpeg process
if the extraction runs away for any other reason). Keep both if you touch
this function — the failure mode without them is a full app crash, not a
graceful error.

**Per-segment speed ("区間速度").** `clip.speedSegments` lets different time
ranges within one clip play at different speeds without physically splitting
the clip in the UI (the older workaround was: cut the clip at each boundary
with `B`, then set `speed` per resulting piece — still works, but fragments
the clip list). Implemented via `partitionSpeedSegments()` (fills gaps with
the clip's base `speed`, resolves overlaps by letting the later segment win)
producing a full non-overlapping partition of `[0, trimDur]`, then in
`buildVideoFilter`/`buildAudioFilter`: crop *once* on the continuous,
un-split stream (so the pan-keyframe `t` timeline is unaffected — crop
happens before segmentation), `split`/`asplit` into one branch per segment,
`trim`/`atrim` + `setpts`/atempo each branch independently, then `concat`.
`clipOutputDuration()` replaces the old flat `trimDur / speed` for computing
each clip's output-timeline duration (used for transition offsets) — it now
sums per-segment durations.

**VideoToolbox encoding.** `h264_videotoolbox` / `hevc_videotoolbox` with
`-q:v` (quality-based, like CRF) rather than `-b:v` (flat bitrate) — chosen so
simple footage doesn't waste bits and complex motion gets more, at a given
visual quality, using Apple Silicon's hardware encode block instead of
libx264/libx265 CPU encoding. `-realtime` was investigated as a possible fix
for an export anomaly and found to already default to `false` (a no-op) —
don't reintroduce it without a concrete reason, it doesn't do anything at
its default.

## Debugging methodology that actually worked

This codebase has a long history of keyframe/crop drift bug reports that
turned out to have several different real causes (interpolation math,
seek-race, and — repeatedly — the user's own hand-placed keyframes just being
imprecise). The technique that reliably separated "code bug" from "bad input
data" every time:

1. **Extract the exact production functions and run them standalone.** Slice
   `main.js`'s source between two known markers (e.g.
   `src.indexOf('const XFADE_NAMES')` to `src.indexOf("ipcMain.handle('export-video'")`)
   and `eval()` it in a throwaway Node script, so you're testing the *actual*
   `buildFilterGraph`/`buildVideoFilter`/`trackSubject` code against a real
   source file — not a reimplementation that might not match. Watch for
   marker ordering: if you add new code before an old marker, index-based
   slicing silently breaks (this happened once — always print/verify the
   slice indices are in the order you expect).
2. **Get real keyframe data from the running app, not assumptions.** The
   renderer's top-level state (`clips`) is reachable from Chrome DevTools
   (View → Toggle Developer Tools in the Electron window) without any
   instrumentation: `JSON.stringify(clips, null, 1)` in the Console, paste
   the result back. (Chrome's paste-protection requires typing
   `allow pasting` once per DevTools session before a paste is accepted.)
3. **Verify crop position against the raw, untouched source — never against
   the user's own keyframes as "ground truth."** Compute the expected crop
   box from the keyframe math by hand (or via the extracted function), then
   `ffmpeg -ss <abs_time> -i <source> -frames:v 1` a raw frame and overlay the
   computed box with `drawbox`. This caught real cases where the *code* was
   provably correct but the user's manually-placed keyframe simply wasn't on
   the subject — comparing tracker output only against manual keyframes would
   have wrongly concluded the new tracker was worse.
4. **When comparing two ffmpeg runs that should be identical, diff the actual
   command, not just the filter string.** A real bug was found this way: a
   manual repro command omitted the `-ss <trimStart> -to <trimEnd>` input
   args that `buildFilterGraph` always includes, silently processing the
   entire untrimmed source instead of the trimmed clip — everything else
   about the command matched, so this was easy to miss without explicitly
   diffing args.
5. **Prefer `-ss` after `-i` (accurate/output seeking) over `-ss` before `-i`
   (fast/input seeking) when extracting frames for verification** — fast
   seeking snaps to the nearest keyframe in the *container*, which can be off
   by up to half a GOP and produce false mismatches that look like bugs but
   are just extraction imprecision.

## Known limitations / things not yet done

- No project persistence — closing/rebuilding the app loses all clips,
  trims, keyframes, and speed segments. If this becomes painful, a simple
  JSON save/load of the `clips`/`transitions` arrays to a project file would
  cover it; nothing else in the data model needs to change.
- Auto-track only extrapolates forward from the seed point/time to
  `trimEnd`, and only within `MAX_TRACK_SECONDS` (90s). It can't track
  backward from the seed, and offers no path to track through the whole
  `trimStart`→`trimEnd` range from a seed placed mid-clip.
- Auto-track can confuse similar-looking subjects (e.g. two surfers close
  together) since it's brightness-based, not identity-based — this is why
  it's click-to-seed rather than fully automatic.
- No automated tests. All verification in this project's history has been
  manual, against real footage, using the methodology above.
