// src/components/visualizer/machi/types.ts
// 町景的 tuning：哪个场景、什么时间、什么天气（三项都可以是“自动”：场景和天气按歌的 seed 选，时间跟本地时钟走），
// 镜头（默认构图，或固定在自己调的视角上）与景深（强弱、清晰范围、移轴、对焦在哪）。

/** 场景：便利店街角、加油站停车场、城寨酒吧。 */
export const MACHI_SCENE_IDS = ['konbini', 'station', 'kowloon'] as const;
export type MachiSceneId = typeof MACHI_SCENE_IDS[number];

export const MACHI_TIMES_OF_DAY = ['auto', 'day', 'dusk', 'night'] as const;
export type MachiTimeOfDay = typeof MACHI_TIMES_OF_DAY[number];

export const MACHI_WEATHERS = ['auto', 'clear', 'rain', 'snow', 'fog'] as const;
export type MachiWeather = typeof MACHI_WEATHERS[number];

/** 镜头：默认构图（拖动后过一会儿自己回正），或固定在自定义视角上（拖动后就停在那里并记住）。 */
export const MACHI_CAMERA_MODES = ['default', 'custom'] as const;
export type MachiCameraMode = typeof MACHI_CAMERA_MODES[number];

/** 对焦在哪：画面中心（镜头绕着转的那一点）、场景里的歌词屏、手动（画面中心往前往后挪）。 */
export const MACHI_FOCUS_MODES = ['center', 'lyrics', 'manual'] as const;
export type MachiFocusMode = typeof MACHI_FOCUS_MODES[number];

/**
 * 自定义视角，相对各场景的默认构图（三个场景的默认朝向不同，存相对值换场景也合用）：
 * 水平转角与俯仰（度）、远近（默认缩放的倍数）、沿地面平移（米：左右、前后，按默认朝向）。
 */
export interface MachiCameraView {
    azimuth: number;
    elevation: number;
    zoom: number;
    panX: number;
    panZ: number;
}

/** 自定义视角各项的范围（设置面板的滑块与归一化共用）。 */
export const MACHI_VIEW_LIMITS = {
    azimuth: { min: -75, max: 75 },
    elevation: { min: -12, max: 40 },
    zoom: { min: 0.5, max: 2.8 },
    panX: { min: -5, max: 5 },
    panZ: { min: -5, max: 5 },
} as const satisfies Record<keyof MachiCameraView, { min: number; max: number }>;

/** 景深各项的范围：强度（0 关，1 是默认的微缩感，到 2 更虚）、清晰范围的倍数、移轴、手动对焦的前后（米）。 */
export const MACHI_DOF_LIMITS = {
    dof: { min: 0, max: 2 },
    dofRange: { min: 0.3, max: 3 },
    tiltShift: { min: 0, max: 1 },
    focusOffset: { min: -10, max: 10 },
} as const;

export interface MachiTuning {
    scene: 'auto' | MachiSceneId;
    timeOfDay: MachiTimeOfDay;
    weather: MachiWeather;
    camera: MachiCameraMode;
    view: MachiCameraView;
    dof: number;
    dofRange: number;
    tiltShift: number;
    focus: MachiFocusMode;
    focusOffset: number;
}

export const DEFAULT_MACHI_VIEW: MachiCameraView = { azimuth: 0, elevation: 0, zoom: 1, panX: 0, panZ: 0 };

export const DEFAULT_MACHI_TUNING: MachiTuning = {
    scene: 'auto',
    timeOfDay: 'auto',
    weather: 'auto',
    camera: 'default',
    view: DEFAULT_MACHI_VIEW,
    dof: 1,
    dofRange: 1,
    tiltShift: 0.3,
    focus: 'center',
    focusOffset: 0,
};
