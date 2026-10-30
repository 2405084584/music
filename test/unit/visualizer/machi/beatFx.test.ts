import { describe, expect, it } from 'vitest';
import { DRUM_HAT, DRUM_KICK, DRUM_SNARE, type DrumHits } from '@/services/analysis/drumHits';
import type { BeatFxEvent } from '@/services/beatFx/clock';
import {
    latestMachiBeat,
    MACHI_BEAT,
    MACHI_BEAT_REST,
    machiDrumHitsAt,
    machiRippleWetness,
    resolveMachiDrumRipples,
    resolveMachiNeonPulse,
    resolveMachiScreenFlash,
} from '@/components/visualizer/machi/engine/beatFx';

// test/unit/visualizer/machi/beatFx.test.ts
// 町景的智能动感效果：包络为 0 时是常态值；霓虹随拍按拍的三段占比分给暖色灯与霓虹；鼓点涟漪只认够响的底鼓、相隔够远
// （留早的那下）、最多四圈、最新的在前；闪拍只认够响的军鼓，先满亮再淡、
// 横纹扫完一屏；分离到一半的歌只用已知的鼓点；路面越湿涟漪越多、光斑的一跳越少。

const hits = (list: [number, number, number][], until?: number): DrumHits => ({
    times: Float64Array.from(list.map(([time]) => time)),
    kinds: Uint8Array.from(list.map(([, kind]) => kind)),
    strengths: Float32Array.from(list.map(([, , strength]) => strength)),
    until,
});

const frame = () => ({ ...MACHI_BEAT_REST });

describe('resolveMachiNeonPulse', () => {
    it('rests without a beat', () => {
        expect(resolveMachiNeonPulse(0, 0, undefined, frame())).toEqual(MACHI_BEAT_REST);
    });

    it('lifts the neon, the warm lights and the bloom on a beat, more on a downbeat', () => {
        const beat = { ...resolveMachiNeonPulse(1, 0, undefined, frame()) };
        const downbeat = { ...resolveMachiNeonPulse(1, 1, undefined, frame()) };
        expect(beat.neon).toBeCloseTo(1 + MACHI_BEAT.neon.beat);
        expect(beat.warm).toBeCloseTo(1 + MACHI_BEAT.warm.beat);
        expect(downbeat.neon).toBeGreaterThan(beat.neon);
        expect(downbeat.bloom).toBeGreaterThan(beat.bloom);
    });

    it('gives low-heavy beats to the warm lights and bright beats to the neon', () => {
        const low = { ...resolveMachiNeonPulse(1, 0, { low: 0.8, mid: 0.15, high: 0.05 }, frame()) };
        const high = { ...resolveMachiNeonPulse(1, 0, { low: 0.05, mid: 0.35, high: 0.6 }, frame()) };
        expect(low.warm - 1).toBeGreaterThan(high.warm - 1);
        expect(high.neon - 1).toBeGreaterThan(low.neon - 1);
        // 三段一样多时与没有重音数据一样。
        const even = resolveMachiNeonPulse(1, 0, { low: 1 / 3, mid: 1 / 3, high: 1 / 3 }, frame());
        const plain = resolveMachiNeonPulse(1, 0, undefined, frame());
        expect(even.neon).toBeCloseTo(plain.neon);
        expect(even.warm).toBeCloseTo(plain.warm);
    });
});

describe('latestMachiBeat', () => {
    it('takes the later of the last beat and downbeat', () => {
        const beat: BeatFxEvent = { t: 4, kind: 'beat' };
        const downbeat: BeatFxEvent = { t: 3.5, kind: 'downbeat' };
        expect(latestMachiBeat(beat, downbeat)).toBe(beat);
        expect(latestMachiBeat(beat, { ...downbeat, t: 4.5 })?.kind).toBe('downbeat');
        expect(latestMachiBeat(null, downbeat)).toBe(downbeat);
        expect(latestMachiBeat(null, null)).toBeNull();
    });
});

describe('resolveMachiDrumRipples', () => {
    const rings = () => new Float32Array(MACHI_BEAT.ripple.max * 2);

    it('clears every ring without hits or strength', () => {
        const out = rings().fill(5);
        expect(resolveMachiDrumRipples(null, 3, 1, out)).toBe(0);
        expect(Array.from(out)).toEqual([-1, 0, -1, 0, -1, 0, -1, 0]);
        expect(resolveMachiDrumRipples(hits([[1, DRUM_KICK, 0.9]]), 1.2, 0, out)).toBe(0);
        expect(out[1]).toBe(0);
    });

    it('rings out the loud kicks still alive, newest first, apart and at most four', () => {
        const list = hits([
            [0.2, DRUM_KICK, 0.9],
            [1.0, DRUM_KICK, 0.8],
            [1.2, DRUM_SNARE, 0.9],
            [1.3, DRUM_KICK, 0.2],
            [1.5, DRUM_KICK, 0.7],
            [1.55, DRUM_KICK, 0.9],
            [1.8, DRUM_HAT, 0.9],
            [1.9, DRUM_KICK, 0.6],
            [2.0, DRUM_KICK, 0.5],
            [2.5, DRUM_KICK, 0.9],
        ]);
        const out = rings();
        resolveMachiDrumRipples(list, 2.1, 1, out);
        // 2.0 离 1.9 不到 gap，留早的 1.9；1.55 离 1.5 太近，留 1.5；1.3 太弱；0.2 已经过了寿命；2.5 还没到。
        const ages = Array.from(out.filter((_, index) => index % 2 === 0)).map(age => Math.round(age * 100) / 100);
        expect(ages).toEqual([0.2, 0.6, 1.1, -1]);
        expect(out[1]).toBeCloseTo(0.6);
        expect(out[3]).toBeCloseTo(0.7);
        expect(out[5]).toBeCloseTo(0.8);
    });

    it('keeps a ring once it is out, even as the window slides past the kick before it', () => {
        // 0.0 与 0.1 太近，0.1 不起环；0.0 过了寿命以后，0.1 也不该冒出来。
        const list = hits([[0, DRUM_KICK, 1], [0.1, DRUM_KICK, 1], [0.6, DRUM_KICK, 1]]);
        const out = rings();
        resolveMachiDrumRipples(list, 1.35, 1, out);
        expect(Array.from(out.filter((_, index) => index % 2 === 0)).map(age => Math.round(age * 100) / 100)).toEqual([0.75, -1, -1, -1]);
    });

    it('keeps the four newest when more are alive', () => {
        const list = hits([0.9, 1.1, 1.3, 1.5, 1.7].map(time => [time, DRUM_KICK, 1] as [number, number, number]));
        const out = rings();
        resolveMachiDrumRipples(list, 1.8, 1, out);
        expect(Array.from(out.filter((_, index) => index % 2 === 0)).map(age => Math.round(age * 100) / 100)).toEqual([0.1, 0.3, 0.5, 0.7]);
    });

    it('thumps the light pools right on a kick and lets it fall away', () => {
        const list = hits([[1, DRUM_KICK, 1]]);
        const now = resolveMachiDrumRipples(list, 1, 1, rings());
        const later = resolveMachiDrumRipples(list, 1.3, 1, rings());
        expect(now).toBeCloseTo(MACHI_BEAT.ripple.thump);
        expect(later).toBeLessThan(now * 0.2);
        expect(resolveMachiDrumRipples(list, 1, 2, rings())).toBeCloseTo(2 * now);
    });
});

describe('resolveMachiScreenFlash', () => {
    it('flashes on a loud snare, holds, fades, and sweeps the band down once', () => {
        const list = hits([[1, DRUM_SNARE, 0.8], [1.05, DRUM_KICK, 1]]);
        const at = (time: number) => ({ ...resolveMachiScreenFlash(list, time, 1, frame()) });
        expect(at(0.9)).toMatchObject({ flash: 0, scan: -1 });
        expect(at(1.02).flash).toBeCloseTo(0.8);
        expect(at(1.02).scan).toBeCloseTo(0.02 / MACHI_BEAT.flash.scan);
        expect(at(1.2).flash).toBeLessThan(0.4);
        expect(at(1.2).flash).toBeGreaterThan(0);
        expect(at(1.4).scan).toBe(-1);
        expect(at(1.7)).toMatchObject({ flash: 0, scan: -1 });
    });

    it('skips quiet snares and other drums', () => {
        const list = hits([[1, DRUM_SNARE, 0.2], [1.02, DRUM_HAT, 1], [1.04, DRUM_KICK, 1]]);
        expect(resolveMachiScreenFlash(list, 1.1, 1, frame())).toMatchObject({ flash: 0, scan: -1 });
    });
});

describe('machiDrumHitsAt', () => {
    it('uses a track still separating only before the time its hits reach', () => {
        const partial = hits([[1, DRUM_KICK, 1]], 10);
        expect(machiDrumHitsAt(partial, 5)).toBe(partial);
        expect(machiDrumHitsAt(partial, 12)).toBeNull();
        expect(machiDrumHitsAt(hits([[1, DRUM_KICK, 1]]), 99)).not.toBeNull();
        expect(machiDrumHitsAt(null, 1)).toBeNull();
    });
});

describe('machiRippleWetness', () => {
    it('brings the ripples in as the ground gets wet', () => {
        const [from, to] = MACHI_BEAT.ripple.wet;
        expect(machiRippleWetness(0)).toBe(0);
        expect(machiRippleWetness(from)).toBe(0);
        expect(machiRippleWetness((from + to) / 2)).toBeCloseTo(0.5);
        expect(machiRippleWetness(to)).toBe(1);
        expect(machiRippleWetness(1)).toBe(1);
    });
});
