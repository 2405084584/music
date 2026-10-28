import { clamp, NEBBIA_FIXED, smooth } from './nebbiaConstants';
import { isIconChar, type NebbiaChar, type NebbiaSourceLine } from './nebbiaChars';
import { isWideChar } from './nebbiaBlocks';
import { pointAt, warpGlyph, type NebbiaGlyphCache, type Glyph } from './nebbiaGlyphs';
import { layoutNebbiaSong } from './nebbiaLayout';
import type { NebbiaWipe } from './nebbiaWipe';
import type { NebbiaFadeMode, NebbiaTuning } from './types';
import { createVisualizerRng, hashVisualizerSeed } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaScene.ts
// 一首歌在雾笺上的全部安排：每个字的位置、变形后的字形、擦痕边的水珠和下淌的水珠、出现方式（手写或透出）；
// 每句的淡出方式和「让位」时刻（后面某句要写到这句的位置、而这句还没被雾吞掉时，这句提前快速起雾）。
// 只由歌词、tuning 和屏幕尺寸决定；每帧怎么画在 nebbiaMask.ts。

export interface Bead { s: number; x: number; y: number; nx: number; ny: number; r: number; j: number }
export interface Drip { delay: number; len: number; dur: number; r: number; seed: number }
export interface LaidChar extends NebbiaChar {
    x: number; y: number; s: number; rot: number;
    /** 手写变形后的字形；空格、画不出来的字没有。 */
    glyph: Glyph | null;
    beads: Bead[][];
    drips: (Drip | null)[];
    ends: { h: number; j: number }[];
    /** 慢慢显现用几秒；0 = 手指书写。 */
    appearDur: number;
}
export interface LaidLine {
    chars: LaidChar[];
    t: number; end: number; next: number;
    mode: 'fog' | 'fingers';
    yieldAt: number;
    /** 手指抹除的几何，第一次用到时才建（undefined = 还没建，null = 没有可抹的字）。 */
    wipe?: NebbiaWipe | null;
}

const lineModeOf = (fade: NebbiaFadeMode, idx: number, seed: number): 'fog' | 'fingers' => (
    fade !== 'mix' ? fade : (createVisualizerRng((seed + idx * 977 + 3) >>> 0)() < 0.5 ? 'fog' : 'fingers')
);
/** 写完后开始起雾的时刻：下一句开始（最多唱完 6 秒）后再保持 hold 秒。 */
export const fogStartOf = (end: number, next: number, hold: number) => Math.min(next, end + 6) + hold;

/** 一个字挑水珠：每一笔沿边缘零星凝出小水珠，少数笔画底部会淌下一颗。 */
const decorate = (c: LaidChar, base: Glyph, rnd: () => number) => {
    const g = warpGlyph(base, createVisualizerRng(Math.floor(rnd() * 1e9)), NEBBIA_FIXED.warp);
    c.glyph = g;
    c.beads = g.strokes.map(st => {
        const out: Bead[] = [], step = 7 / c.s;
        for (let s = step * rnd(); s < st.len; s += step * (0.5 + rnd())) {
            if (rnd() > NEBBIA_FIXED.beads) continue;
            const [x, y, nx, ny] = pointAt(st, s), side = rnd() < 0.5 ? -1 : 1;
            out.push({ s, x, y, nx: nx * side, ny: ny * side, r: 1.6 + rnd() ** 2.2 * 3.6, j: rnd() });
        }
        return out;
    });
    c.drips = g.strokes.map(() => (rnd() < NEBBIA_FIXED.drip * 0.22
        ? { delay: 0.3 + rnd() * 1.6, len: 30 + rnd() * 130, dur: 2 + rnd() * 3.5, r: 3.2 + rnd() * 2.6, seed: rnd() * 100 } : null));
    // 收笔水珠的随机量放在最后取，不打乱前面的随机序列
    c.ends = g.strokes.map(() => ({ h: rnd(), j: rnd() }));
};

/** 自然书写一个字要几秒。 */
export const naturalWriteTime = (g: Glyph, speed: number) => (g.total * 0.28 + (g.strokes.length - 1) * 0.06) / speed;

/** 一句的出现方式：auto 时这句平均每个字唱的时间不到自然书写时间的一半，就慢慢显现。 */
const applyAppear = (line: LaidLine, tuning: NebbiaTuning) => {
    const cs = line.chars.filter(c => c.glyph);
    let fade = tuning.appearMode === 'fade';
    if (tuning.appearMode === 'auto' && cs.length) {
        const sung = cs.reduce((s, c) => s + c.d, 0), nat = cs.reduce((s, c) => s + naturalWriteTime(c.glyph!, tuning.writeSpeed), 0);
        fade = sung < nat * 0.5;
    }
    for (const c of line.chars) c.appearDur = fade ? clamp(c.d * 3, 0.35, 1.2) : 0;
};

export const lineRect = (line: LaidLine) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, S = 0;
    for (const c of line.chars) if (c.glyph) {
        x0 = Math.min(x0, c.x - c.s / 2); x1 = Math.max(x1, c.x + c.s / 2);
        y0 = Math.min(y0, c.y - c.s / 2); y1 = Math.max(y1, c.y + c.s / 2); S = Math.max(S, c.s);
    }
    return { x0, x1, y0, y1, S };
};

/** 排一首歌：source 来自 buildNebbiaLines，glyphs 是按主题字体的字形缓存。 */
export const buildNebbiaScene = (
    source: NebbiaSourceLine[],
    glyphs: NebbiaGlyphCache,
    tuning: NebbiaTuning,
    size: { W: number; H: number; fontScale: number },
    seed: string | number,
): LaidLine[] => {
    const seedHash = hashVisualizerSeed(String(seed));
    const modes = source.map((_, i) => lineModeOf(tuning.fadeMode, i, seedHash));
    const fogAt = (i: number) => fogStartOf(source[i].end, source[i].next, tuning.hold);
    const goneAt = (i: number) => fogAt(i) + tuning.refog + (modes[i] === 'fog' ? 0 : 2.5);
    const pos = layoutNebbiaSong(source, { W: size.W, H: size.H, jitter: NEBBIA_FIXED.jitter, fontScale: size.fontScale, visibleUntil: goneAt, fogAt });
    const laid: LaidLine[] = source.map((line, li) => ({
        t: line.t, end: line.end, next: line.next, mode: modes[li], yieldAt: Infinity,
        chars: line.chars.map((c, i) => {
            const p = pos[li][i], wide = isWideChar(c.ch) || isIconChar(c.ch);
            const out: LaidChar = { ...c, x: p.x, y: p.y, s: p.s * (wide ? 1 : 1.15), rot: p.rot, glyph: null, beads: [], drips: [], ends: [], appearDur: 0 };
            const base = glyphs.get(c.ch);
            if (base) decorate(out, base, createVisualizerRng((li * 131 + i * 17 + 5) >>> 0));
            return out;
        }),
    }));
    laid.forEach(line => applyAppear(line, tuning));
    // 让位：后面第一句和这句重叠、且在这句消失前开始的，记下它开始的时刻
    const rects = laid.map(lineRect);
    laid.forEach((line, i) => {
        const gone = goneAt(i);
        for (let j = i + 1; j < laid.length && laid[j].t < gone; j += 1) {
            const a = rects[i], b = rects[j];
            if (Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0)) { line.yieldAt = laid[j].t; break; }
        }
    });
    return laid;
};

/** 让位的句子在后面那句开写前 0.6 秒起用 1 秒快速起雾。 */
export const yieldFactor = (line: LaidLine, T: number) => 1 - smooth(clamp((T - line.yieldAt + 0.6) / 1));
