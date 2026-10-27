import type { Line } from '../../../types';
import { isInterludeLine } from '../../../utils/lyrics/parserCore';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { buildStructureLines, draftParagraphs, resolveParagraphGapThreshold } from '../paragraphStructure';
import { hashVisualizerSeed, visualizerHash01 } from '../visualizerSeedHash';
import type { KonbiniVariation } from './konbiniSeed';

// src/components/visualizer/konbini/konbiniDirector.ts
// 雨町的场景编排（纯函数）：广告塔此刻该亮哪一行还是曲名卡、自动门什么时候开（段落开头有人进店，长间奏里偶尔）、
// 副歌权重、招牌的闪烁日程、音频包络。门、副歌跟歌曲时间走（拖进度也对得上），闪烁跟氛围时钟走。

export type KonbiniBoardTarget = { kind: 'line'; index: number } | { kind: 'card' };

/** 一行唱完后，下一行还没来时牌面再留多久才换成曲名卡。 */
const BOARD_HOLD_SECONDS = 2.6;
/** 牌面比歌词略早一点亮出来，翻牌动画落在唱起的那一刻。 */
const BOARD_LEAD_SECONDS = 0.12;

/** 时刻 time 的牌面：在唱或刚唱完的那一行；间奏、开唱前、长空隙里是曲名卡。 */
export const resolveKonbiniBoardTarget = (lines: readonly Line[], time: number): KonbiniBoardTarget => {
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]!.startTime <= time + BOARD_LEAD_SECONDS) index = i;
        else break;
    }
    if (index < 0) return { kind: 'card' };
    const line = lines[index]!;
    if (isInterludeLine(line) || !line.fullText.trim()) return { kind: 'card' };
    const next = lines[index + 1];
    const hold = getLineRenderEndTime(line) + BOARD_HOLD_SECONDS;
    if (time > hold && (!next || next.startTime - BOARD_LEAD_SECONDS > time)) return { kind: 'card' };
    return { kind: 'line', index };
};

export const sameBoardTarget = (a: KonbiniBoardTarget | null, b: KonbiniBoardTarget) => (
    !!a && a.kind === b.kind && (a.kind === 'card' || (b.kind === 'line' && a.index === b.index))
);

/** 自动门开合的几个时段（秒）。 */
export const KONBINI_DOOR_TIMING = { open: 0.75, hold: 2.6, close: 1.0, lead: 0.7 } as const;
const DOOR_CYCLE = KONBINI_DOOR_TIMING.open + KONBINI_DOOR_TIMING.hold + KONBINI_DOOR_TIMING.close;

/**
 * 开门时刻（歌曲时间，秒）：每个段落开头（第一段除外）提前一点开门，像有人进店；段落之间空了很久时，
 * 空隙里按这首歌的节奏再开几次。
 */
export const buildKonbiniDoorEvents = (lines: readonly Line[], variation: Pick<KonbiniVariation, 'doorInterval' | 'doorPhase'>): number[] => {
    const sung = lines.filter(line => !isInterludeLine(line) && line.fullText.trim());
    if (sung.length === 0) return [];
    const structure = buildStructureLines(sung);
    const drafts = draftParagraphs(structure, resolveParagraphGapThreshold(sung));
    const events: number[] = [];
    drafts.forEach((draft, index) => {
        if (index === 0) return;
        const start = draft.lines[0]!.line.startTime;
        events.push(Math.max(0, start - KONBINI_DOOR_TIMING.lead));
    });
    // 长空隙（前奏、间奏、尾奏）里按间隔补几次。
    const gaps: [number, number][] = [[0, sung[0]!.startTime]];
    for (let i = 1; i < sung.length; i += 1) gaps.push([getLineRenderEndTime(sung[i - 1]!), sung[i]!.startTime]);
    gaps.forEach(([from, to]) => {
        if (to - from < variation.doorInterval * 0.6) return;
        for (let t = from + variation.doorInterval * (0.35 + variation.doorPhase * 0.4); t < to - DOOR_CYCLE; t += variation.doorInterval) {
            events.push(t);
        }
    });
    return events.sort((a, b) => a - b).filter((time, index, all) => index === 0 || time - all[index - 1]! >= DOOR_CYCLE);
};

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * 门开了多少（0 关、1 全开）。有歌词的歌按开门时刻表；纯音乐按 seed 的节奏周期性开。speed 是主题动效强度。
 */
export const resolveKonbiniDoorOpenness = (
    events: readonly number[],
    time: number,
    variation: Pick<KonbiniVariation, 'doorInterval' | 'doorPhase'>,
    instrumental: boolean,
): number => {
    let since = Infinity;
    if (instrumental || events.length === 0) {
        const phase = time / variation.doorInterval + variation.doorPhase;
        since = (phase - Math.floor(phase)) * variation.doorInterval;
    } else {
        for (let i = events.length - 1; i >= 0; i -= 1) {
            if (events[i]! <= time) {
                since = time - events[i]!;
                break;
            }
        }
    }
    const { open, hold, close } = KONBINI_DOOR_TIMING;
    if (since < 0 || since >= open + hold + close) return 0;
    if (since < open) return easeOutCubic(since / open);
    if (since < open + hold) return 1;
    return 1 - easeInOutCubic((since - open - hold) / close);
};

const isChorusLine = (line: Line | undefined) => !!line && (line.isChorus === true || /chorus|副歌/i.test(line.songPart ?? ''));

/** 副歌权重：正在唱副歌行（或刚唱完、下一行还是副歌）时为 1。运行时再做平滑。 */
export const resolveKonbiniChorus = (lines: readonly Line[], target: KonbiniBoardTarget): number => {
    if (target.kind !== 'line') return 0;
    return isChorusLine(lines[target.index]) ? 1 : 0;
};

/** 招牌闪烁：每 6.5 秒一个窗口，按哈希决定这个窗口里有没有一阵快速的明暗（三下），返回亮度倍数 0.5..1。 */
export const resolveKonbiniFlicker = (time: number, seed: string | number, rate = 1): number => {
    const window = 6.5 / Math.max(0.3, rate);
    const index = Math.floor(time / window);
    const key = hashVisualizerSeed(`flicker:${seed}`);
    if (visualizerHash01(key, index, 0x51) > 0.42) return 1;
    const offset = visualizerHash01(key, index, 0x7a) * (window - 0.6);
    const local = time - index * window - offset;
    if (local < 0 || local > 0.46) return 1;
    // 三下：越来越短的暗。
    const dips = [[0, 0.07, 0.5], [0.15, 0.2, 0.68], [0.32, 0.36, 0.8]] as const;
    for (const [from, to, depth] of dips) {
        if (local >= from && local <= to) return depth;
    }
    return 1;
};

/** 音频包络：一见到大于 1 的值就按 0..255 归一化（主播放器），否则当 0..1（预览、OBS）；起音快、释放慢。 */
export class KonbiniAudioFollower {
    value = 0;
    private byteScale = false;

    step(raw: number, deltaSeconds: number, attack = 0.06, release = 0.25) {
        if (raw > 1.0001) this.byteScale = true;
        const target = Math.max(0, Math.min(1, this.byteScale ? raw / 255 : raw));
        const tau = target > this.value ? attack : release;
        const k = deltaSeconds <= 0 ? 0 : 1 - Math.exp(-deltaSeconds / tau);
        this.value += (target - this.value) * k;
        return this.value;
    }
}
