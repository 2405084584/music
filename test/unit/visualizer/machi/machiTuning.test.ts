import { describe, expect, it } from 'vitest';
import { normalizeMachiTuning, resolveMachiSceneId } from '@/components/visualizer/machi/machiTuning';
import { DEFAULT_MACHI_TUNING, DEFAULT_MACHI_VIEW, MACHI_SCENE_IDS } from '@/components/visualizer/machi/types';

// test/unit/visualizer/machi/machiTuning.test.ts
// 町景的设置：存下来的值认不得就回默认、数值夹进范围；“自动”场景按 seed 选，同一首歌总是同一个。

describe('normalizeMachiTuning', () => {
    it('fills missing fields and drops unknown values', () => {
        expect(normalizeMachiTuning(undefined)).toEqual(DEFAULT_MACHI_TUNING);
        expect(normalizeMachiTuning({ weather: 'snow' })).toEqual({ ...DEFAULT_MACHI_TUNING, weather: 'snow' });
        expect(normalizeMachiTuning({ scene: 'beach', timeOfDay: 7, weather: 'hail' })).toEqual(DEFAULT_MACHI_TUNING);
        expect(normalizeMachiTuning({ scene: 'konbini', timeOfDay: 'dusk', weather: 'fog' })).toEqual({ ...DEFAULT_MACHI_TUNING, scene: 'konbini', timeOfDay: 'dusk', weather: 'fog' });
    });

    it('keeps a custom view inside the camera limits', () => {
        const tuning = normalizeMachiTuning({ camera: 'custom', view: { azimuth: 120, elevation: -40, zoom: 9, panX: 2.5, panZ: 'far' } });
        expect(tuning.camera).toBe('custom');
        expect(tuning.view).toEqual({ azimuth: 75, elevation: -12, zoom: 2.8, panX: 2.5, panZ: 0 });
        expect(normalizeMachiTuning({ camera: 'orbit', view: null })).toMatchObject({ camera: 'default', view: DEFAULT_MACHI_VIEW });
    });

    it('clamps the depth of field and falls back to centre focus', () => {
        const tuning = normalizeMachiTuning({ dof: 5, dofRange: 0, tiltShift: -1, focus: 'eyes', focusOffset: -30 });
        expect(tuning).toMatchObject({ dof: 2, dofRange: 0.3, tiltShift: 0, focus: 'center', focusOffset: -10 });
        expect(normalizeMachiTuning({ dof: 0, focus: 'lyrics' })).toMatchObject({ dof: 0, focus: 'lyrics' });
    });
});

describe('resolveMachiSceneId', () => {
    it('uses the chosen scene', () => {
        expect(resolveMachiSceneId({ scene: 'konbini' }, 'any')).toBe('konbini');
    });

    it('picks a stable scene per song when automatic', () => {
        ['a', 'b', 'song-42', 7].forEach(seed => {
            const scene = resolveMachiSceneId({ scene: 'auto' }, seed);
            expect(MACHI_SCENE_IDS).toContain(scene);
            expect(resolveMachiSceneId({ scene: 'auto' }, seed)).toBe(scene);
        });
    });
});
