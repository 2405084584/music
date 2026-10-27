import { describe, expect, it } from 'vitest';
import { normalizeMachiTuning, resolveMachiSceneId } from '@/components/visualizer/machi/machiTuning';
import { DEFAULT_MACHI_TUNING, MACHI_SCENE_IDS } from '@/components/visualizer/machi/types';

// test/unit/visualizer/machi/machiTuning.test.ts
// 町景的设置：存下来的值认不得就回默认；“自动”场景按 seed 选，同一首歌总是同一个。

describe('normalizeMachiTuning', () => {
    it('fills missing fields and drops unknown values', () => {
        expect(normalizeMachiTuning(undefined)).toEqual(DEFAULT_MACHI_TUNING);
        expect(normalizeMachiTuning({ weather: 'snow' })).toEqual({ ...DEFAULT_MACHI_TUNING, weather: 'snow' });
        expect(normalizeMachiTuning({ scene: 'beach', timeOfDay: 7, weather: 'hail' })).toEqual(DEFAULT_MACHI_TUNING);
        expect(normalizeMachiTuning({ scene: 'konbini', timeOfDay: 'dusk', weather: 'fog' })).toEqual({ scene: 'konbini', timeOfDay: 'dusk', weather: 'fog' });
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
