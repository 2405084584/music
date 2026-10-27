// src/components/visualizer/machi/types.ts
// 町景的 tuning：哪个场景、什么时间、什么天气。三项都可以是“自动”：场景和天气按歌的 seed 选，时间跟本地时钟走。

/** 场景（樱花公园随后加进来）。 */
export const MACHI_SCENE_IDS = ['konbini', 'station'] as const;
export type MachiSceneId = typeof MACHI_SCENE_IDS[number];

export const MACHI_TIMES_OF_DAY = ['auto', 'day', 'dusk', 'night'] as const;
export type MachiTimeOfDay = typeof MACHI_TIMES_OF_DAY[number];

export const MACHI_WEATHERS = ['auto', 'clear', 'rain', 'snow', 'fog'] as const;
export type MachiWeather = typeof MACHI_WEATHERS[number];

export interface MachiTuning {
    scene: 'auto' | MachiSceneId;
    timeOfDay: MachiTimeOfDay;
    weather: MachiWeather;
}

export const DEFAULT_MACHI_TUNING: MachiTuning = {
    scene: 'auto',
    timeOfDay: 'auto',
    weather: 'auto',
};
