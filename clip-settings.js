(function exposeClipSettings(root) {
  function cloneClipSettingsForTarget(source, target) {
    const targetDuration = Math.max(0, target.trimEnd - target.trimStart);
    target.zoom = source.zoom;
    target.zoomX = source.zoomX;
    target.zoomY = source.zoomY;
    target.panAnimated = source.panAnimated;
    target.panKeyframes = (source.panKeyframes || [])
      .filter((keyframe) => keyframe.t <= targetDuration)
      .map((keyframe) => ({ ...keyframe }));
    target.speed = source.speed;
    target.speedSegments = (source.speedSegments || [])
      .filter((segment) => segment.start < targetDuration)
      .map((segment) => ({
        ...segment,
        start: Math.max(0, Math.min(targetDuration, segment.start)),
        end: Math.max(0, Math.min(targetDuration, segment.end)),
      }))
      .filter((segment) => segment.end - segment.start >= 0.1);
    return target;
  }

  function cloneZoomForTarget(source, target) {
    target.zoom = source.zoom;
    return target;
  }

  function upsertPanKeyframe(clip, localT, x, y) {
    if (!Array.isArray(clip.panKeyframes)) clip.panKeyframes = [];
    clip.panAnimated = true;
    const duration = Math.max(0, Number(clip.trimEnd) - Number(clip.trimStart));
    const t = Math.max(0, Math.min(duration, Number(localT) || 0));
    const safeX = Math.max(0, Math.min(1, Number(x) || 0));
    const safeY = Math.max(0, Math.min(1, Number(y) || 0));
    const existing = clip.panKeyframes.find((keyframe) => Math.abs(keyframe.t - t) < 0.15);
    if (existing) {
      existing.t = t;
      existing.x = safeX;
      existing.y = safeY;
      return { created: false, keyframe: existing };
    }
    const keyframe = { t, x: safeX, y: safeY };
    clip.panKeyframes.push(keyframe);
    clip.panKeyframes.sort((a, b) => a.t - b.t);
    return { created: true, keyframe };
  }

  function comparisonPairFromSelection(clips, selectedIds) {
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    const pair = clips.filter((clip) => selected.has(clip.id));
    return pair.length === 2 ? pair : null;
  }

  function timelineSelectionAfterClick(selectedIds, clickedId, additive) {
    const next = new Set(selectedIds || []);
    if (!additive) return new Set([clickedId]);
    if (next.has(clickedId)) next.delete(clickedId);
    else next.add(clickedId);
    return next;
  }

  function removeSelectedClipsFromTimeline(clips, transitions, selectedIds) {
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    const remaining = clips
      .map((clip, index) => ({ clip, index }))
      .filter(({ clip }) => !selected.has(clip.id));
    const nextTransitions = [];
    for (let i = 1; i < remaining.length; i += 1) {
      const previousIndex = remaining[i - 1].index;
      const currentIndex = remaining[i].index;
      nextTransitions.push(
        currentIndex === previousIndex + 1
          ? { ...(transitions[previousIndex] || { type: 'cut', duration: 0.5 }) }
          : { type: 'cut', duration: 0.5 }
      );
    }
    return { clips: remaining.map(({ clip }) => clip), transitions: nextTransitions };
  }

  function partitionSpeedSegments(trimDuration, segments, baseSpeed) {
    const epsilon = 0.001;
    const safeBaseSpeed = Number(baseSpeed) > 0 ? Number(baseSpeed) : 1;
    const cleaned = (segments || [])
      .map((segment) => ({
        start: Math.max(0, Math.min(trimDuration, Number(segment.start) || 0)),
        end: Math.max(0, Math.min(trimDuration, Number(segment.end) || 0)),
        speed: Number(segment.speed) > 0 ? Number(segment.speed) : 1,
      }))
      .filter((segment) => segment.end - segment.start > epsilon)
      .sort((a, b) => a.start - b.start);
    const merged = [];
    cleaned.forEach((segment) => {
      if (merged.length && segment.start < merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(
          merged[merged.length - 1].start + epsilon,
          Math.min(merged[merged.length - 1].end, segment.start)
        );
      }
      merged.push({ ...segment });
    });
    const parts = [];
    let cursor = 0;
    merged.forEach((segment) => {
      if (segment.start - cursor > epsilon) {
        parts.push({ start: cursor, end: segment.start, speed: safeBaseSpeed });
      }
      parts.push(segment);
      cursor = segment.end;
    });
    if (trimDuration - cursor > epsilon) {
      parts.push({ start: cursor, end: trimDuration, speed: safeBaseSpeed });
    }
    if (!parts.length) parts.push({ start: 0, end: trimDuration, speed: safeBaseSpeed });
    return parts;
  }

  function clipPlaybackDuration(clip) {
    const trimDuration = Math.max(0, Number(clip.trimEnd) - Number(clip.trimStart));
    const baseSpeed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    if (!Array.isArray(clip.speedSegments) || !clip.speedSegments.length) {
      return trimDuration / baseSpeed;
    }
    return partitionSpeedSegments(trimDuration, clip.speedSegments, baseSpeed)
      .reduce((total, part) => total + (part.end - part.start) / part.speed, 0);
  }

  function sequencePlaybackDuration(clips, transitions) {
    if (!Array.isArray(clips) || !clips.length) return 0;
    let duration = clipPlaybackDuration(clips[0]);
    for (let index = 1; index < clips.length; index += 1) {
      const transition = transitions?.[index - 1] || { type: 'cut', duration: 0 };
      duration += clipPlaybackDuration(clips[index]);
      if (transition.type !== 'cut') duration -= Math.max(Number(transition.duration) || 0, 0.04);
    }
    return Math.max(0, duration);
  }

  function estimateExportSize({ duration, quality = 'fhd', codec = 'h264', fps = 30 }) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    const rates = {
      fhd: { 30: 12, 60: 18 },
      '4k': { 30: 35, 60: 52 },
    };
    const fpsKey = Number(fps) >= 50 ? 60 : 30;
    const h264VideoMbps = rates[quality]?.[fpsKey] || rates.fhd[30];
    const videoMbps = codec === 'h265' ? h264VideoMbps * 0.65 : h264VideoMbps;
    const totalMbps = videoMbps + 0.192;
    const bytes = safeDuration * totalMbps * 1000 * 1000 / 8;
    return {
      bytes,
      lowBytes: bytes * 0.7,
      highBytes: bytes * 1.35,
      duration: safeDuration,
    };
  }

  root.cloneClipSettingsForTarget = cloneClipSettingsForTarget;
  root.cloneZoomForTarget = cloneZoomForTarget;
  root.upsertPanKeyframe = upsertPanKeyframe;
  root.comparisonPairFromSelection = comparisonPairFromSelection;
  root.timelineSelectionAfterClick = timelineSelectionAfterClick;
  root.removeSelectedClipsFromTimeline = removeSelectedClipsFromTimeline;
  root.clipPlaybackDuration = clipPlaybackDuration;
  root.sequencePlaybackDuration = sequencePlaybackDuration;
  root.estimateExportSize = estimateExportSize;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      cloneClipSettingsForTarget, cloneZoomForTarget, upsertPanKeyframe,
      comparisonPairFromSelection, timelineSelectionAfterClick, removeSelectedClipsFromTimeline,
      clipPlaybackDuration, sequencePlaybackDuration, estimateExportSize,
    };
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
