# Naoki Cutter — handoff notes

Electron desktop app for macOS. Purpose-built video editor for one user (a surf
coach) to replace CapCut for a narrow workflow: trim/join clips, add
transitions, crop-zoom with pan tracking, per-segment speed ramping, and 4K
export — nothing else. Optimized for that one workflow, not general-purpose
editing. The user is non-technical; they interact with this only through the
built app, never the source. Keep changes simple and prefer fixing root causes
over adding options/flags.

**User workflow preference:** whenever a new feature is added, explicitly ask
the user whether they also want a keyboard shortcut for it. Do this at handoff
even when the feature is already reachable by mouse; do not silently invent a
key unless the user has specified one.

The keyboard `+` / `;` key (the physical key immediately to the right of `L` on
the user's Japanese keyboard, with or without Shift) invokes the same
keyframe-add path as the toolbar `＋` button. Adding a keyframe automatically
enables `panAnimated`, so the shortcut must not require a separate click on the
`キー` checkbox.

**Multi-clip export selection.** `exportSelectedClipIds` is distinct from the
single active `selectedClipId`: clip-row `選択` checkboxes choose any number of
clips for one export or batch-setting target, while ordinary selection still
controls preview/editing.
Export preserves timeline order. A transition is retained only when two picked
clips were adjacent in the original timeline; skipped gaps join with a cut.
The lightweight project JSON stores these IDs, stale IDs are pruned on render,
and splitting an export-picked clip propagates the pick to both resulting
halves.
`E` invokes the checked-clips export button only when at least one clip is
picked and no export is already running; key repeat must remain ignored so one
keypress cannot open multiple save dialogs.

**Editor training intervals and batch clip settings.** The slim action strip
below the main toolbar supports both interval and point labels without leaving
the editor. Intervals are `preparation` (wave waiting through turning and
starting to paddle), `catch_paddle`, `paddle_form`, `takeoff`, and
`takeoff_posture`; points are `catch_timing` and `hands_down_timing`. Start/end
buttons use the
active editing video's absolute source time (including the active comparison
pane), and `save-training-segment` extracts local derived features through the
same `/api/training/features` endpoint before merging that event into the
source's existing verified example. Re-labeling one event replaces only that
event; it must not erase other event segments for the same source.

Point labels extract features from a small window around the confirmed frame
but store only the exact user-confirmed timestamp. `paddle_form` stores a
free-text form description. `takeoff_posture` stores separate free-text shape,
footwork, and takeoff-type fields. `takeoff_duration_seconds` and
`preparation_duration_seconds` are derived from their intervals and stored in
`example.metrics`; never ask the user to calculate these manually. Training
schema version 2 is additive and must preserve older travel/catch/takeoff data.

Zoom has direct 2x and 3x preset buttons. The `設定の適用先` control copies the
active clip's current zoom/static pan, pan-animation keyframes, whole-clip
speed, and speed segments to the current, checkbox-selected, or all clips.
It deliberately does not copy trim boundaries, source paths, or transitions.
The pure copy implementation lives in `clip-settings.js` and clips keyframes
and speed segments to the target clip's local duration. Keep it as the common
extension point for future batch-applicable clip settings. Its tests live in
`test/clip-settings.test.js`.

**Review recording and waveforms.** Timeline waveforms are generated in the
main process with bundled ffmpeg (`audio-waveform`) and cached by source path,
size, mtime, and bin count; the large peak array is intentionally not persisted
inside project JSON. The fullscreen recording overlay draws only the effective
crop/zoom/pan of the selected source frame to a canvas, so UI controls never
appear in the captured video. Its Web Audio graph mixes the original video's
audio and microphone through independent 0–200% gains. MediaRecorder emits
small WebM chunks to main-process temp storage; `finish-review-recording`
transcodes them to H.264/AAC MP4 and always removes the temporary WebM. Never
copy, modify, or delete the original source video as part of this workflow.
`R` is contextual: enter recording mode, then start, then stop; Escape closes
the mode only while idle. `W` toggles waveform visibility and persists that UI
preference in localStorage. Both shortcuts ignore key repeat.

The recording canvas owns normalized annotation strokes. The toolbar offers
2 seconds, 3 seconds (default), or always-visible duration buttons, persisted
through localStorage. A pen stroke or arrow stays visible while it is being
drawn, then uses the selected duration after pointer-up. Strokes are redrawn after every video frame until expiry,
which makes them part of the captured canvas stream while keeping the floating
tool controls out of the final MP4. During capture, J shuttles backward, K toggles play/pause, and L
shuttles forward as keyboard-only playback controls; the user explicitly does
not want J/K/L buttons in the recording toolbar. Source/mic mute buttons drive
the same independent Web Audio gain nodes as their sliders.
Left/Right Arrow also remain keyboard-only in recording mode and route through
the existing `stepFrame(-1/1)` path for exact one-frame movement.
J/K/L ignore OS key-repeat; separate presses change shuttle speed. Recording-mode
K must route through `pressK()` so reverse timers are cancelled before L starts.
During reverse seeks, the recording canvas retains its last fully decoded video
frame instead of clearing to black, and reverse progression uses fixed decoded
steps so slow 4K seeks do not accumulate into sudden time jumps.
Pen, arrow, and clear-all deliberately remain toolbar buttons only; the user
explicitly declined keyboard shortcuts for these three drawing actions.

The recording overlay canvas is intentionally capped at 30fps while video,
reverse shuttle, or pointer drawing is active, and at 5fps while paused. The
MediaRecorder canvas stream is 30fps, so rendering at a 60/120Hz display rate
adds GPU load without improving the recording. Export resolution is presented
as two always-visible buttons: Full HD 1920x1080 (default/low load) and 4K
3840x2160; portrait mode swaps those dimensions.
Screen recording has its own persisted FHD/4K toolbar toggle, independent of
normal export quality. FHD records a 1920x1080 canvas at 12 Mbps; 4K records a
3840x2160 canvas at 35 Mbps, with portrait dimensions swapped. Resolution
buttons are disabled during active recording because resizing a captured canvas
mid-stream can corrupt or invalidate the MediaRecorder output.
The review-recording MP4 transcode must apply `-vf fps=30`. Canvas MediaRecorder
WebM timestamps can otherwise produce nonsensical nominal frame-rate metadata
(especially at 4K), causing poor playback compatibility despite correct image
dimensions.

Two-clip comparison is an in-editor workflow. The user selects left/top and
right/bottom clips, enters `2画面で編集`, and gets two synchronized video panes
inside a full-window editing view rather than a playback-only preview. Both
sides stay visible and together fill the screen (left/right for landscape,
top/bottom for portrait); clicking a pane or using `左／上を編集` and
`右／下を編集` chooses which side receives edits while playback remains
synchronized. The existing zoom, drag/click pan, keyframe, and auto-track
controls edit the active side independently. Each side also has
a source-position scrubber; the numeric start fields and one-frame nudge
buttons remain available. Active-side one-frame nudges preserve the current
comparison elapsed position instead of restarting at zero. J/K/L, Space, and
Left/Right operate the synchronized
comparison while this mode is active. Landscape output uses hstack; portrait
output uses vstack. `export-comparison` receives both clips' zoom/pan/keyframe
data and renders each pane over a black canvas, preserving whole-source fit at
zoom 1 while matching edited zoom/pan at higher zoom. FHD/4K, codec, fps,
orientation, progress reporting, cancellation, and VideoToolbox encoding reuse
the normal export settings. Comparison clip IDs, absolute source start times,
and audio choice are included in lightweight project save/restore data.
`@` toggles the full-window comparison editor from either direction.

The header `再生画面を大きく` button toggles a persistent large-preview
layout for ordinary one-clip editing. Large mode hides only the right export
settings panel, expands the clip panel to the full window width, and raises the
preview height cap from 38% to 68% of the window. It must not reload media,
seek, or change edit state; switching back restores the normal two-column
layout. The preference is stored as `largePreview` in renderer localStorage.

**Local AI comparison sync.** The two-screen panel and full-window comparison
controls both offer `AIでタイミングを揃える`, with anchors for takeoff start,
hands touching the board, or first standing frame. This is non-destructive: it
changes only `compareStartA`/`compareStartB`, marks both inputs edited, and
leaves source media, trims, keyframes, and clips untouched. The old ±1-frame
buttons remain the final manual adjustment path.

`main.js` makes at most a 50-second, 640px/6fps/no-audio proxy for each side in
the Electron temp directory. A clip of 60 seconds or less uses its complete
trimmed range; longer clips search from five seconds before the current
comparison start. Static/effective zoom and pan at the current start are
applied to the proxy so a centered, enlarged surfer is easier to detect. Both
proxies are streamed over localhost multipart IPC to
`POST http://127.0.0.1:8000/api/sync/takeoff` and always deleted afterward.
The original videos are never copied, modified, or sent outside the Mac.

The additive endpoint is implemented in
`/Users/ishidanaoki/surfing-analyzer/backend/main.py`. It first uses the
existing local MediaPipe Pose model to find the pop-up posture transition. If
the surfer is too small for a skeleton, it may use a lower-confidence central
motion-change fallback; weak/ambiguous motion returns `detected: false` so the
app does not move either start time. The backend must be running with the same
uvicorn command documented below. This endpoint does not call Claude and does
not require video frames to leave localhost.

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

Projects can be saved to `app.getPath('userData')/projects/*.json`. A project
contains only the `clips`/`transitions` edit model, selected clip, and export
settings; source media is referenced by absolute path and is never copied.
The UI can delete every saved project plus Electron's temporary cache in one
action, but that cleanup deliberately never follows media paths and never
touches source or exported videos.

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

**High-speed shuttle preview.** Chromium accepts native positive
`playbackRate` values only up to 16x; assigning 20x throws. Forward L-key
shuttle therefore cycles 1/2/5/10/16x and uses native playback (frame dropping
is handled by Chromium). Do not replace this with rapid `currentTime` writes:
the old 50ms seek loop starved 4K decoding and looked frozen. Reverse shuttle,
which has no native playback support, waits for each seek to decode before
requesting the next one.

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

**Timeline edge trimming.** Every `.tl-clip` has left/right drag handles.
Dragging changes `trimStart`/`trimEnd` and the magnetic timeline reflows. A
start-edge change also shifts local `panKeyframes[].t` and speed-segment times;
an end-edge change clips them and adds an interpolated pan boundary where
needed. Keep timeline handles, scrubber handles, N/M shortcuts, and numeric
trim fields routed through `setClipTrimStart()` / `setClipTrimEnd()` so these
local-time adjustments never diverge.

**Stable compact layout.** The always-visible page header owns `addFilesBtn`
and `dropZone`, so adding media never requires scrolling the clip list. Preview
editing controls live in a single fixed-height, horizontally scrollable
`.edit-toolbar`; the keyframe strip uses `visibility:hidden` rather than
`display:none` to reserve its height. `.preview-wrap` is deliberately not
sticky: the user must be able to scroll the left panel normally. Do not
reintroduce selected-item `scrollIntoView()` in `render()` — it caused the
panel to jump after cuts and keyframe edits. The timeline is 72px tall and the
preview height cap is 38vh so both remain visible in an 800x600 window.

**Timeline skimming.** The `skimmingToggle` setting preserves ordinary
click-to-seek while optionally previewing the timeline position underneath the
mouse without a click. Hover targets are coalesced through `queueSkim()` /
`processPendingSkim()` so rapid movement over long 4K clips cannot flood the
video element with overlapping seeks. The orange `timelineSkimmer` is distinct
from the red playhead, and `B` cuts at the current skimmer target while the
pointer is over the timeline. Keep the checkbox focus exception in the keyboard
handler so `B`, `J`, `K`, and `L` continue to work immediately after changing
this setting. `S` toggles skimming without moving the playhead, `A` always exits
skimming and returns to ordinary click-selection mode, and `B` cuts at the
active skimmer target. The preference is stored in both localStorage and saved
project settings.

`N` must also consume the explicit skimmer target rather than trusting
`previewVideo.currentTime`: rapid hover decoding can lag behind the orange line.
Cancel pending skim seeks before trimming, then seek the red playhead back to
the retained trim boundary after rerendering so it never jumps to a stale frame.
The same `N` path also moves the physical macOS pointer to that new boundary via
the narrow `move-cursor` IPC and bundled `bin/move-cursor` CoreGraphics helper.
Renderer client coordinates must be converted through the originating window's
`getContentBounds()`; do not use hard-coded title-bar or Retina offsets.
While the user horizontally scrolls with skimming active, the mouse must never
be warped. The timeline `scroll` handler recalculates the target underneath the
last fixed client coordinate, keeping the orange skimmer and red playhead at
the pointer's screen position while clips move beneath them. Auto-centering in
`updateTimelinePlayhead()` stays disabled while the skimmer is active to avoid
scroll/seek feedback loops.

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

- Auto-track only extrapolates forward from the seed point/time to
  `trimEnd`, and only within `MAX_TRACK_SECONDS` (90s). It can't track
  backward from the seed, and offers no path to track through the whole
  `trimStart`→`trimEnd` range from a seed placed mid-clip.
- Auto-track can confuse similar-looking subjects (e.g. two surfers close
  together) since it's brightness-based, not identity-based — this is why
  it's click-to-seed rather than fully automatic.
- Automatic-update version parsing/release-summary tests live in
  `test/updater.test.js`; video editing and export verification remains manual
  against real footage, using the methodology above.

## surfing-analyzer integration

Naoki Cutter can send the most recently exported video to the separate
`/Users/ishidanaoki/surfing-analyzer` project. This is a post-export action
only: it does not modify the source video, clips, timeline, or export flow.
Start the existing FastAPI backend before testing the integration:

```bash
cd /Users/ishidanaoki/surfing-analyzer/backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

The integration uses these existing endpoints on `http://127.0.0.1:8000`:

- `POST /api/analyze` with multipart `file` analyzes scenes and scores.
- `POST /api/reference/upload` with multipart `file`, required `name`, and
  optional `description` stores the same export as a reference video.

Network access follows the existing Electron IPC boundary. `renderer.js`
remembers each successful normal, selected-clip, comparison, and screen-
recording export path (also in `localStorage`) and owns the confirmation UI.
`preload.js` exposes only `analyzeExportedVideo` and
`saveExportedAsReference`. `main.js` implements the two `ipcMain.handle`
handlers and streams multipart files to the local backend rather than loading
an entire video into renderer memory. Large base64 `frame_images` and
reference `preview` fields are removed before the result crosses IPC.
`index.html` and `style.css` contain the export-panel button and result/reference
modal. Keep the endpoint host fixed to localhost unless the trust and IPC
model is deliberately revisited.

### Integrated form-analysis workspace and verified labels

The user-facing app is unified even though analysis remains a separate local
FastAPI service. The header tabs in `index.html` switch between the normal
editor, the form-analysis workspace, and the verified training-data library;
they do not open a second app and do not mutate the editor timeline. The form
workspace can analyze any unique source path already loaded into the editor,
so an intermediate export is not required.

Two deliberately different analysis paths are exposed through the existing
main/preload IPC boundary:

- `analyze-form-local` makes a small temporary proxy and calls
  `POST /api/form/local`. This uses MediaPipe/motion analysis on the Mac and
  does not send video outside the machine.
- `analyze-form-cloud` requires an explicit renderer confirmation, makes the
  same temporary proxy, and calls the existing `POST /api/analyze` Claude
  path for detailed scores and comments. Do not remove the disclosure or
  silently fall back from local to cloud analysis.

User-confirmed labels are stored at
`<app.getPath('userData')>/ai-training/surfing-event-labels.json`. The schema
separates `travel_paddle`, `catch_paddle`, and `takeoff`; takeoff starts when
the hands touch the board and ends when the hands leave it. `main.js` owns all
reads, atomic writes, validation, and deletion through `list-training-data`,
`save-training-example`, and `delete-training-example`. Saving stores the
source identity/path and verified timestamps only: it never copies or deletes
the source video. Deleting a label example must likewise leave the original
media untouched. The surfing-analyzer backend reads this same local file at
`GET /api/training/data`, and `/api/form/local` reports the number of verified
examples available. These backend additions live in
`/Users/ishidanaoki/surfing-analyzer/backend/main.py`.

Verified examples are not merely timestamp memories. On save, `main.js`
extracts the labeled takeoff interval into an 8fps/640px temporary proxy and
calls the local-only `POST /api/training/features` endpoint. The backend stores
derived `naoki_motion_features_v1` data on the example: normalized MediaPipe
joint sequences when the surfer is large enough, optical-flow magnitude and
direction over time, and compact low-frequency visual descriptors. Raw frames
and the proxy are deleted after extraction. This allows future detection to
compare motion patterns rather than treating seconds as transferable facts.
Far-away surfers may produce zero pose coverage; keep the motion/visual
features and report that honestly instead of fabricating joint data.

`catch_paddle` is optional because the user also supplies takeoff-only
examples. An empty catch field saves only the `takeoff` segment and its two
boundary labels. If catch is supplied, validation still requires
`catch start <= takeoff start < takeoff end` and stores travel/catch/takeoff
segments separately.

## Free GitHub Releases updater

The public distribution repository is
`https://github.com/ishida-lgtm/naoki-cutter`. The updater intentionally uses
no GitHub token or other secret. `updater.js` calls the anonymous public API at
`GET https://api.github.com/repos/ishida-lgtm/naoki-cutter/releases/latest` and
compares its `tag_name` with `app.getVersion()` (the `version` in
`package.json`). The renderer checks shortly after startup and displays a
non-blocking banner. `preload.js` exposes the `check-for-update` and
`install-update` IPC paths; all network, ZIP, signature, and filesystem work
stays in the main process through `updater.js`.

The expected release asset name is exactly
`Naoki-Cutter-mac-arm64.zip`. Before installing, the updater extracts into an
app-specific temporary directory, verifies bundle ID `com.naoki.cutter` and
the ad-hoc code signature, and removes quarantine with `xattr -dr
com.apple.quarantine`. It then starts a detached temporary zsh helper and
quits. The helper backs up the existing `/Applications/Naoki Cutter.app`,
copies the staged app, removes quarantine again, starts the replacement, and
rolls back if copying fails. A failed update must never prevent ordinary video
editing; permission errors tell the user to replace the app manually from the
ZIP.

### Release procedure

1. Update `version` in both `package.json` and the root entries of
   `package-lock.json` using semantic `major.minor.patch` format.
2. Run the updater tests and build/sign/zip the current version:

   ```bash
   cd /Users/ishidanaoki/video-editor-app
   npm test
   npm run build:release
   ```

   `scripts/build-release.sh` preserves electron-packager, excludes the local
   `release/` archive directory so older ZIPs are never nested into the app,
   builds arm64 without asar, ad-hoc signs and verifies the app, then creates
   `release/v<VERSION>/Naoki-Cutter-mac-arm64.zip`.
3. Commit the release source, tag the same version, and push both:

   ```bash
   git add -A
   git commit -m "Release v<VERSION>"
   git tag -a "v<VERSION>" -m "Naoki Cutter v<VERSION>"
   git push origin main
   git push origin "v<VERSION>"
   ```

4. On GitHub, create a Release from `v<VERSION>`, attach the exact ZIP above,
   add short Japanese release notes, and publish it (not draft/prerelease).
5. Verify the anonymous API response and asset name, then launch an older app
   build to test the banner, `更新する`, replacement, and automatic restart.
   This final test quits the running app and replaces `/Applications/Naoki
   Cutter.app`, so save or explicitly discard any in-memory edit first.
