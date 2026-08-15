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

  root.cloneClipSettingsForTarget = cloneClipSettingsForTarget;
  root.cloneZoomForTarget = cloneZoomForTarget;
  root.upsertPanKeyframe = upsertPanKeyframe;
  root.comparisonPairFromSelection = comparisonPairFromSelection;
  root.removeSelectedClipsFromTimeline = removeSelectedClipsFromTimeline;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cloneClipSettingsForTarget, cloneZoomForTarget, upsertPanKeyframe, comparisonPairFromSelection, removeSelectedClipsFromTimeline };
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
