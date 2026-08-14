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
  root.removeSelectedClipsFromTimeline = removeSelectedClipsFromTimeline;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cloneClipSettingsForTarget, removeSelectedClipsFromTimeline };
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
