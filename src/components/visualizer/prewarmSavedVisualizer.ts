import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { getVisualizerRegistryEntry } from './registry';

// src/components/visualizer/prewarmSavedVisualizer.ts
// 应用启动时（首屏加载遮罩还在）给保存的歌词样式一个提前准备的机会：调它 entry 的 `prewarm`（definition.ts），
// 比如雾笺在后台先编着色器。只看保存的那个样式，别的样式不碰：用不上的准备不做。

/** 主窗口启动时调一次（bootstrap.tsx）。 */
export const prewarmSavedVisualizer = (): void => {
    const { visualizerMode } = useVisualizerSettingsStore.getState();
    const entry = getVisualizerRegistryEntry(visualizerMode);
    if (entry.mode !== visualizerMode || !entry.prewarm) return;
    try {
        entry.prewarm();
    } catch (error) {
        console.warn(`[Visualizer] prewarm of ${visualizerMode} failed`, error);
    }
};
