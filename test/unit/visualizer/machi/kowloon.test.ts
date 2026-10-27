import { describe, expect, it } from 'vitest';
import { MACHI_BASE } from '@/components/visualizer/machi/engine/geometry/plinth';
import { resolveKowloonHologramText } from '@/components/visualizer/machi/scenes/kowloon/hologram';
import { resolveKowloonJet } from '@/components/visualizer/machi/scenes/kowloon/jet';
import { resolveKowloonVerticalText } from '@/components/visualizer/machi/scenes/kowloon/kowloonSignPaint';
import { resolveKowloonTickerText } from '@/components/visualizer/machi/scenes/kowloon/kowloonSigns';
import {
    BLOCKS,
    HANGING_SIGNS,
    HOLOGRAM,
    JET,
    KOWLOON_VIEW,
    leftFaceAt,
    POLE,
    SCREEN,
    STALL,
} from '@/components/visualizer/machi/scenes/kowloon/layout';
import type { Line } from '@/types';

// test/unit/visualizer/machi/kowloon.test.ts
// 城寨酒吧：全息写下一句（跳过空行，没有下一句用译文，曲名卡写曲名与歌手）、跑马灯写译文或曲名、竖招牌的竖排与
// 转写、客机的航班表（确定、一个窗口最多一趟）；楼都在底座里、互不重叠，招牌从楼面伸出来，歌词屏朝着默认镜头，
// 全息、大排档、电线杆都在巷子里。

const line = (text: string, start: number, extra: Partial<Line> = {}): Line => ({
    words: [{ text, startTime: start, endTime: start + 2 }],
    startTime: start,
    endTime: start + 2,
    fullText: text,
    ...extra,
});

const song = { title: '迟到的雨', artist: '城寨乐队' };

describe('resolveKowloonHologramText', () => {
    const lines = [line('在城市尽头等', 0, { translation: 'waiting at the edge' }), line('  ', 3), line('一场迟到的雨', 5, { translation: 'a late rain' })];

    it('shows the next non-empty line', () => {
        expect(resolveKowloonHologramText({ kind: 'line', index: 0 }, lines, song)).toEqual({ label: 'NEXT', text: '一场迟到的雨' });
    });

    it('falls back to the translation on the last line, then to the title', () => {
        expect(resolveKowloonHologramText({ kind: 'line', index: 2 }, lines, song)).toEqual({ label: 'TRANSLATION', text: 'a late rain' });
        expect(resolveKowloonHologramText({ kind: 'line', index: 0 }, [line('最后', 0)], song)).toEqual({ label: 'NOW PLAYING', text: '迟到的雨 — 城寨乐队' });
        expect(resolveKowloonHologramText({ kind: 'card' }, lines, { title: '', artist: '' })).toEqual({ label: 'NOW PLAYING', text: 'KOWLOON' });
    });
});

describe('resolveKowloonTickerText', () => {
    it('scrolls the translation of the current line, otherwise the credits', () => {
        const lines = [line('在城市尽头等', 0, { translation: 'waiting' }), line('雨', 3)];
        expect(resolveKowloonTickerText({ kind: 'line', index: 0 }, lines, song)).toContain('waiting');
        const credits = resolveKowloonTickerText({ kind: 'line', index: 1 }, lines, song);
        expect(credits).toContain('迟到的雨 — 城寨乐队');
        expect(resolveKowloonTickerText({ kind: 'card' }, lines, song)).toBe(credits);
    });
});

describe('resolveKowloonVerticalText', () => {
    it('stacks CJK and short Latin names, and turns long Latin names sideways', () => {
        expect(resolveKowloonVerticalText('義體 診所')).toEqual({ mode: 'stack', glyphs: ['義', '體', '診', '所'] });
        expect(resolveKowloonVerticalText('Aimer')).toEqual({ mode: 'stack', glyphs: ['A', 'i', 'm', 'e', 'r'] });
        expect(resolveKowloonVerticalText('Probe Ensemble')).toEqual({ mode: 'rotate', text: 'Probe Ensemble' });
    });

    it('cuts long CJK names with an ellipsis', () => {
        const result = resolveKowloonVerticalText('一二三四五六七八九十');
        expect(result).toEqual({ mode: 'stack', glyphs: ['一', '二', '三', '四', '五', '六', '七', '…'] });
    });
});

describe('resolveKowloonJet', () => {
    it('is deterministic and flies at most one pass per 42-second window', () => {
        let passes = 0;
        for (let window = 0; window < 60; window += 1) {
            const covered: number[] = [];
            for (let t = window * 42; t < (window + 1) * 42; t += 0.25) {
                const progress = resolveKowloonJet(t, 'song-1');
                expect(resolveKowloonJet(t, 'song-1')).toBe(progress);
                if (progress !== null) {
                    expect(progress).toBeGreaterThanOrEqual(0);
                    expect(progress).toBeLessThanOrEqual(1);
                    covered.push(t);
                }
            }
            if (covered.length) {
                passes += 1;
                expect(covered[covered.length - 1]! - covered[0]!).toBeLessThanOrEqual(JET.duration + 0.25);
            }
        }
        expect(passes).toBeGreaterThan(20);
        expect(passes).toBeLessThan(60);
    });
});

describe('kowloon layout', () => {
    const half = MACHI_BASE.half;
    const inside = (x: number, y: number, z: number) => BLOCKS.some(block => x > block.x0 && x < block.x1 && z > block.z0 && z < block.z1 && y < block.height);

    it('keeps the blocks on the base without overlapping', () => {
        BLOCKS.forEach(block => {
            expect(block.x0).toBeGreaterThanOrEqual(-half);
            expect(block.x1).toBeLessThanOrEqual(half);
            expect(block.z0).toBeGreaterThanOrEqual(-half);
            expect(block.z1).toBeLessThanOrEqual(half);
        });
        BLOCKS.forEach((a, i) => BLOCKS.slice(i + 1).forEach(b => {
            const overlap = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
            expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
        }));
    });

    it('hangs every sign off a wall into the open alley', () => {
        HANGING_SIGNS.forEach((sign, index) => {
            if (sign.axis === 'x') expect(sign.wall, `sign ${index}`).toBeCloseTo(leftFaceAt(sign.at), 5);
            const tip = sign.axis === 'x' ? [sign.tip, sign.at] : [sign.at, sign.tip];
            expect(inside(tip[0]!, (sign.y0 + sign.y1) / 2, tip[1]!), `sign ${index} tip`).toBe(false);
            expect(Math.abs(tip[0]!)).toBeLessThan(half);
            expect(Math.abs(tip[1]!)).toBeLessThan(half);
        });
    });

    it('turns the lyric screen towards the default camera and keeps the alley pieces out of the blocks', () => {
        expect(Math.abs(KOWLOON_VIEW.azimuth) * 180 / Math.PI).toBeLessThanOrEqual(30);
        expect(SCREEN.width).toBeGreaterThan(4);
        const bar = BLOCKS.find(block => block.name === 'B1')!;
        expect(SCREEN.z).toBeGreaterThan(bar.z1);
        expect(SCREEN.x - SCREEN.width / 2).toBeGreaterThanOrEqual(bar.x0);
        expect(SCREEN.x + SCREEN.width / 2).toBeLessThanOrEqual(bar.x1);
        expect(inside(HOLOGRAM.x, 1, HOLOGRAM.z)).toBe(false);
        expect(inside(POLE.x, 1, POLE.z)).toBe(false);
        expect(inside((STALL.x0 + STALL.x1) / 2, 1, (STALL.z0 + STALL.z1) / 2)).toBe(false);
    });
});
