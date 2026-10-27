import { hashVisualizerSeed } from '../visualizerSeedHash';
import {
    DEFAULT_MACHI_TUNING,
    MACHI_SCENE_IDS,
    MACHI_TIMES_OF_DAY,
    MACHI_WEATHERS,
    type MachiSceneId,
    type MachiTuning,
} from './types';

// src/components/visualizer/machi/machiTuning.ts
// 町景 tuning 的归一化：存档、导入、同步、设置面板都经 normalizeMachiTuning 补齐字段、认不得的值回默认
// （以后删掉的场景也回“自动”）。“自动”场景按 seed 选也在这里（纯函数，运行时与单测共用）。

const SCENE_CHOICES: MachiTuning['scene'][] = ['auto', ...MACHI_SCENE_IDS];

/** 任何存下来的值 → 完整、合法的 tuning。 */
export const normalizeMachiTuning = (raw: unknown): MachiTuning => {
    const input = { ...DEFAULT_MACHI_TUNING, ...(raw && typeof raw === 'object' ? raw as Partial<MachiTuning> : {}) };
    const d = DEFAULT_MACHI_TUNING;
    return {
        scene: SCENE_CHOICES.includes(input.scene) ? input.scene : d.scene,
        timeOfDay: MACHI_TIMES_OF_DAY.includes(input.timeOfDay) ? input.timeOfDay : d.timeOfDay,
        weather: MACHI_WEATHERS.includes(input.weather) ? input.weather : d.weather,
    };
};

/** 这首歌画哪个场景：选了就用选的，“自动”按 seed 在所有场景里挑一个（同一首歌总是同一个）。 */
export const resolveMachiSceneId = (tuning: Pick<MachiTuning, 'scene'>, seed: string | number): MachiSceneId => {
    if (tuning.scene !== 'auto') return tuning.scene;
    return MACHI_SCENE_IDS[hashVisualizerSeed(`machi-scene:${seed}`) % MACHI_SCENE_IDS.length]!;
};
