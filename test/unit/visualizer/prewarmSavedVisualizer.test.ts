import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prewarmSavedVisualizer } from '@/components/visualizer/prewarmSavedVisualizer';
import {
    DEFAULT_VISUALIZER_MODE,
    appendVisualizerEntry,
    getVisualizerRegistryEntry,
    removeVisualizerEntry,
    type VisualizerRegistryEntry,
} from '@/components/visualizer/registry';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import type { VisualizerMode } from '@/types';

// test/unit/visualizer/prewarmSavedVisualizer.test.ts
// Start-up prewarm: only the saved style's `prewarm` runs, and a saved mode that is not registered
// (a mod not loaded yet) does not set off the fallback style's.

const ADDED = 'mod:test:prewarm' as VisualizerMode;
const savedMode = useVisualizerSettingsStore.getState().visualizerMode;

const added = (prewarm?: () => void): VisualizerRegistryEntry => ({
    mode: ADDED,
    order: 900,
    labelKey: 'ui.visualizerAdded',
    labelFallback: 'Added',
    previewSeed: ADDED,
    previewStartOffset: 0,
    render: () => createElement('div'),
    ...(prewarm ? { prewarm } : {}),
});

const save = (mode: VisualizerMode) => useVisualizerSettingsStore.setState({ visualizerMode: mode });

describe('prewarmSavedVisualizer', () => {
    afterEach(() => {
        removeVisualizerEntry(ADDED);
        save(savedMode);
        vi.restoreAllMocks();
    });

    it('runs the saved style\'s prewarm once', () => {
        const prewarm = vi.fn();
        appendVisualizerEntry(added(prewarm));
        save(ADDED);

        prewarmSavedVisualizer();

        expect(prewarm).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a saved style without one', () => {
        appendVisualizerEntry(added());
        save(ADDED);

        expect(() => prewarmSavedVisualizer()).not.toThrow();
    });

    it('does not prewarm the fallback style for a saved mode that is not registered', () => {
        const fallback = getVisualizerRegistryEntry(DEFAULT_VISUALIZER_MODE);
        const prewarm = vi.fn();
        fallback.prewarm = prewarm;
        try {
            save('mod:test:missing' as VisualizerMode);
            prewarmSavedVisualizer();
        } finally {
            delete fallback.prewarm;
        }

        expect(prewarm).not.toHaveBeenCalled();
    });

    it('keeps start-up going when a prewarm throws', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        appendVisualizerEntry(added(() => { throw new Error('no GPU'); }));
        save(ADDED);

        expect(() => prewarmSavedVisualizer()).not.toThrow();
        expect(warn).toHaveBeenCalled();
    });

    it('is declared by 雾笺, whose shaders take long to compile', () => {
        expect(getVisualizerRegistryEntry('nebbia').prewarm).toBeTypeOf('function');
    });
});
