import { describe, expect, it } from 'vitest';
import { normalizeMachiTuning, resolveMachiQualityPreset, resolveMachiSceneId } from '@/components/visualizer/machi/machiTuning';
import { DEFAULT_MACHI_QUALITY, DEFAULT_MACHI_TUNING, DEFAULT_MACHI_VIEW, MACHI_QUALITY_PRESET_IDS, MACHI_QUALITY_PRESETS, MACHI_SCENE_IDS } from '@/components/visualizer/machi/types';

// test/unit/visualizer/machi/machiTuning.test.ts
// 町景的设置：存下来的值认不得就回默认、数值夹进范围；画质每项认不得的回默认，预设由细项推出来；
// “自动”场景按 seed 选，同一首歌总是同一个。

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

    it('keeps known quality values field by field and fills the rest', () => {
        expect(normalizeMachiTuning({}).quality).toEqual(DEFAULT_MACHI_QUALITY);
        expect(normalizeMachiTuning({ quality: null }).quality).toEqual(DEFAULT_MACHI_QUALITY);
        expect(normalizeMachiTuning({ quality: { antialias: 'ssaa', glow: false } }).quality).toEqual({ ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa', glow: false });
        expect(normalizeMachiTuning({ quality: { renderScale: 3, antialias: 'taa', shadows: 'ultra', reflections: 1, glow: 'yes', adaptive: 0 } }).quality).toEqual(DEFAULT_MACHI_QUALITY);
        expect(normalizeMachiTuning({ quality: { renderScale: 0.5, shadows: 'off', reflections: 'low', adaptive: false } }).quality)
            .toEqual({ ...DEFAULT_MACHI_QUALITY, renderScale: 0.5, shadows: 'off', reflections: 'low', adaptive: false });
    });
});

describe('resolveMachiQualityPreset', () => {
    it('names the preset a quality matches, whatever the auto-degrade switch says', () => {
        MACHI_QUALITY_PRESET_IDS.forEach(id => {
            expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS[id], adaptive: true })).toBe(id);
            expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS[id], adaptive: false })).toBe(id);
        });
        expect(resolveMachiQualityPreset(DEFAULT_MACHI_QUALITY)).toBe('high');
    });

    it('calls any other combination custom', () => {
        expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS.high, antialias: 'ssaa', adaptive: true })).toBe('custom');
        expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS.low, glow: true, adaptive: true })).toBe('custom');
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
