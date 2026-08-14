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

  root.cloneClipSettingsForTarget = cloneClipSettingsForTarget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { cloneClipSettingsForTarget };
}(typeof globalThis !== 'undefined' ? globalThis : this));
