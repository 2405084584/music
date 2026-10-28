import { defineVisualizerTuning, numberWithin, type StoredTuningFields } from '../tuningDefinition';
import {
    DEFAULT_NEBBIA_TUNING,
    NEBBIA_APPEAR_MODES,
    NEBBIA_FADE_MODES,
    NEBBIA_LIMITS,
    type NebbiaNumberKey,
    type NebbiaTuning,
} from './types';

// src/components/visualizer/nebbia/tuning.ts
// 雾笺的 tuning：默认值、在设置 store 里的字段、存在哪。渲染器经 read() 从 tuning 包里取（entry.tsx），没有具名 prop。

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'nebbiaTuning', 'handleSetNebbiaTuning', 'handleResetNebbiaTuning', NebbiaTuning> {}
}

const oneOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T => (
    choices.includes(value as T) ? value as T : fallback
);

/** 存着的值、导入或同步来的值，读成一份完整合法的 tuning：缺的、类型不对的用默认，数值夹进范围。 */
export const normalizeNebbiaTuning = (stored: unknown): NebbiaTuning => {
    const values = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof NebbiaTuning, unknown>>;
    const base = DEFAULT_NEBBIA_TUNING;
    const numbers = Object.fromEntries((Object.keys(NEBBIA_LIMITS) as NebbiaNumberKey[]).map(key => [
        key,
        numberWithin(values[key], base[key], NEBBIA_LIMITS[key].min, NEBBIA_LIMITS[key].max),
    ])) as Pick<NebbiaTuning, NebbiaNumberKey>;
    return {
        appearMode: oneOf(NEBBIA_APPEAR_MODES, values.appearMode, base.appearMode),
        fadeMode: oneOf(NEBBIA_FADE_MODES, values.fadeMode, base.fadeMode),
        ...numbers,
    };
};

export default defineVisualizerTuning<NebbiaTuning>({
    mode: 'nebbia',
    defaults: DEFAULT_NEBBIA_TUNING,
    settingsKey: 'nebbiaTuning',
    settingsSetterKey: 'handleSetNebbiaTuning',
    settingsResetterKey: 'handleResetNebbiaTuning',
    storage: {
        key: 'nebbia_tuning',
        read: normalizeNebbiaTuning,
        // 先合并再归一化：设置面板、导入、同步走同一套校验。
        merge: (held, patch) => normalizeNebbiaTuning({ ...held, ...patch }),
        resetNotice: 'notifications.nebbiaReset',
    },
    // 分辨率要重建画布的缓冲：设置窗口的小样在拖滑块时留在已保存的值上。
    preview: (draft, saved) => ({ ...draft, resolution: saved.resolution }),
});
