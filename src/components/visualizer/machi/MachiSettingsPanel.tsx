import React from 'react';
import { Button, Group, PictureGrid, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { percent, SliderRow, times } from '../panelRows';
import {
    DEFAULT_MACHI_TUNING,
    DEFAULT_MACHI_VIEW,
    MACHI_CAMERA_MODES,
    MACHI_DOF_LIMITS,
    MACHI_FOCUS_MODES,
    MACHI_SCENE_IDS,
    MACHI_TIMES_OF_DAY,
    MACHI_VIEW_LIMITS,
    MACHI_WEATHERS,
    type MachiCameraMode,
    type MachiCameraView,
    type MachiFocusMode,
    type MachiTimeOfDay,
    type MachiTuning,
    type MachiWeather,
} from './types';

// src/components/visualizer/machi/MachiSettingsPanel.tsx
// 町景的设置面板：场景（线稿小图，不放实时预览）、时间、天气三项，每项都有“自动”；镜头（默认视角，或自定义视角
// 与它的五个滑块）；景深（强度、清晰范围、移轴、对焦在哪）。快捷控件里的胶囊用同一套文案。

const SCENE_GROUP: SettingsGroupDef = { id: 'vis-machi-scene', titleKey: 'options.machiSceneSection' };
const SKY_GROUP: SettingsGroupDef = { id: 'vis-machi-sky', titleKey: 'options.machiSkySection' };
const CAMERA_GROUP: SettingsGroupDef = { id: 'vis-machi-camera', titleKey: 'options.machiCameraSection' };
const DOF_GROUP: SettingsGroupDef = { id: 'vis-machi-dof', titleKey: 'options.machiDofSection' };

export const MACHI_SCENE_CHOICES: MachiTuning['scene'][] = ['auto', ...MACHI_SCENE_IDS];

export const MACHI_SCENE_LABEL_KEYS: Record<MachiTuning['scene'], string> = {
    auto: 'options.machiSceneAuto',
    konbini: 'options.machiSceneKonbini',
    station: 'options.machiSceneStation',
    kowloon: 'options.machiSceneKowloon',
};

export const MACHI_TIME_LABEL_KEYS: Record<MachiTimeOfDay, string> = {
    auto: 'options.machiTimeAuto',
    day: 'options.machiTimeDay',
    dusk: 'options.machiTimeDusk',
    night: 'options.machiTimeNight',
};

export const MACHI_CAMERA_LABEL_KEYS: Record<MachiCameraMode, string> = {
    default: 'options.machiCameraDefault',
    custom: 'options.machiCameraCustom',
};

const MACHI_FOCUS_LABEL_KEYS: Record<MachiFocusMode, string> = {
    center: 'options.machiFocusCenter',
    lyrics: 'options.machiFocusLyrics',
    manual: 'options.machiFocusManual',
};

/** 带正负号的读数：+12°、−0.5 m。 */
const signed = (unit: string, digits = 0) => (value: number) => {
    const text = Math.abs(value).toFixed(digits);
    const sign = Number(text) === 0 ? '' : value > 0 ? '+' : '−';
    return `${sign}${text}${unit}`;
};

/** 自定义视角的五个滑块：转角、俯仰（度）、远近（倍数）、左右与前后平移（米）。 */
const VIEW_SLIDERS: { key: keyof MachiCameraView; labelKey: string; step: number; format: (value: number) => string }[] = [
    { key: 'azimuth', labelKey: 'options.machiViewAzimuth', step: 1, format: signed('°') },
    { key: 'elevation', labelKey: 'options.machiViewElevation', step: 1, format: signed('°') },
    { key: 'zoom', labelKey: 'options.machiViewZoom', step: 0.05, format: times },
    { key: 'panX', labelKey: 'options.machiViewPanX', step: 0.1, format: signed(' m', 1) },
    { key: 'panZ', labelKey: 'options.machiViewPanZ', step: 0.1, format: signed(' m', 1) },
];

export const MACHI_WEATHER_LABEL_KEYS: Record<MachiWeather, string> = {
    auto: 'options.machiWeatherAuto',
    clear: 'options.machiWeatherClear',
    rain: 'options.machiWeatherRain',
    snow: 'options.machiWeatherSnow',
    fog: 'options.machiWeatherFog',
};

/** 场景的线稿小图（24×24 的路径，跟着面板文字色）。 */
const SCENE_GLYPHS: Record<MachiTuning['scene'], React.ReactNode> = {
    // 自动：两道交错的箭头（随机）
    auto: (
        <>
            <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
            <path d="m18 2 4 4-4 4" />
            <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" opacity="0.6" />
            <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" opacity="0.6" />
            <path d="m18 14 4 4-4 4" />
        </>
    ),
    // 便利店：一间小店，屋顶一块牌子
    konbini: (
        <>
            <path d="M4 20V11h13v9" />
            <path d="M7 11V7.5h7V11" opacity="0.6" />
            <path d="M9.5 20v-4.5h3V20" opacity="0.6" />
            <path d="M3 20h18" />
        </>
    ),
    // 加油站：罩棚、一台加油机，旁边停着一辆车
    station: (
        <>
            <path d="M3 8h13" />
            <path d="M5 8v12M14 8v12" opacity="0.6" />
            <path d="M8 20v-6h3v6" />
            <path d="M15 20v-3.5l1.5-2h4.5v5.5" opacity="0.7" />
            <path d="M3 20h19" />
        </>
    ),
    // 城寨酒吧：高低错落的楼、楼顶一根天线，楼面伸出一块竖招牌
    kowloon: (
        <>
            <path d="M3 20V9h5v11M8 20V5h6v15M14 20v-8h6v8" />
            <path d="M11 5V2.5M9.5 3.5h3" opacity="0.6" />
            <path d="M14 7h1M15 6h2.5v4.5H15z" opacity="0.7" />
            <path d="M3 20h18" />
        </>
    ),
};

const scenePicture = (scene: MachiTuning['scene']) => (
    <span className="absolute inset-0 flex items-center justify-center text-[color:var(--st-t2)]">
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {SCENE_GLYPHS[scene]}
        </svg>
    </span>
);

const MachiSettingsPanel: React.FC<VisualizerSettingsPanelProps<MachiTuning>> = ({
    t,
    tuning = DEFAULT_MACHI_TUNING,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const custom = tuning.camera === 'custom';
    return (
        <>
            <Group def={SCENE_GROUP}>
                <Row
                    note={t('options.machiSceneHint')}
                    below={(
                        <PictureGrid<MachiTuning['scene']>
                            className="-mx-4"
                            columns={3}
                            label={t('options.machiScene')}
                            value={tuning.scene}
                            options={MACHI_SCENE_CHOICES.map(scene => ({ value: scene, label: t(MACHI_SCENE_LABEL_KEYS[scene]) }))}
                            picture={scenePicture}
                            onChange={scene => onTuningChange?.({ scene })}
                        />
                    )}
                />
            </Group>

            <Group def={SKY_GROUP}>
                <Row label={t('options.machiTimeOfDay')} note={t('options.machiTimeOfDayHint')}>
                    <Segmented<MachiTimeOfDay>
                        value={tuning.timeOfDay}
                        options={MACHI_TIMES_OF_DAY.map(time => ({ value: time, label: t(MACHI_TIME_LABEL_KEYS[time]) }))}
                        onChange={timeOfDay => onTuningChange?.({ timeOfDay })}
                    />
                </Row>
                <Row label={t('options.machiWeather')} note={t('options.machiWeatherHint')}>
                    <Segmented<MachiWeather>
                        value={tuning.weather}
                        options={MACHI_WEATHERS.map(weather => ({ value: weather, label: t(MACHI_WEATHER_LABEL_KEYS[weather]) }))}
                        onChange={weather => onTuningChange?.({ weather })}
                    />
                </Row>
            </Group>

            <Group
                def={CAMERA_GROUP}
                action={custom ? (
                    <Button variant="quiet" onClick={() => onTuningChange?.({ view: DEFAULT_MACHI_VIEW })}>
                        {t('options.machiViewReset')}
                    </Button>
                ) : undefined}
            >
                <Row label={t('options.machiCameraMode')} note={t('options.machiCameraModeHint')}>
                    <Segmented<MachiCameraMode>
                        value={tuning.camera}
                        options={MACHI_CAMERA_MODES.map(mode => ({ value: mode, label: t(MACHI_CAMERA_LABEL_KEYS[mode]) }))}
                        onChange={camera => onTuningChange?.({ camera })}
                    />
                </Row>
                {custom && VIEW_SLIDERS.map(slider => (
                    <SliderRow
                        key={slider.key}
                        label={t(slider.labelKey)}
                        value={tuning.view[slider.key]}
                        min={MACHI_VIEW_LIMITS[slider.key].min}
                        max={MACHI_VIEW_LIMITS[slider.key].max}
                        step={slider.step}
                        format={slider.format}
                        onChange={value => onTuningChange?.({ view: { ...tuning.view, [slider.key]: value } })}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                ))}
            </Group>

            <Group def={DOF_GROUP}>
                <SliderRow
                    label={t('options.machiDof')}
                    note={t('options.machiDofHint')}
                    value={tuning.dof}
                    min={MACHI_DOF_LIMITS.dof.min}
                    max={MACHI_DOF_LIMITS.dof.max}
                    step={0.05}
                    format={percent}
                    onChange={dof => onTuningChange?.({ dof })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <SliderRow
                    label={t('options.machiDofRange')}
                    value={tuning.dofRange}
                    min={MACHI_DOF_LIMITS.dofRange.min}
                    max={MACHI_DOF_LIMITS.dofRange.max}
                    step={0.05}
                    format={times}
                    disabled={tuning.dof === 0}
                    onChange={dofRange => onTuningChange?.({ dofRange })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <SliderRow
                    label={t('options.machiTiltShift')}
                    note={t('options.machiTiltShiftHint')}
                    value={tuning.tiltShift}
                    min={MACHI_DOF_LIMITS.tiltShift.min}
                    max={MACHI_DOF_LIMITS.tiltShift.max}
                    step={0.05}
                    format={percent}
                    onChange={tiltShift => onTuningChange?.({ tiltShift })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <Row label={t('options.machiFocus')} note={t('options.machiFocusHint')}>
                    <Segmented<MachiFocusMode>
                        value={tuning.focus}
                        options={MACHI_FOCUS_MODES.map(focus => ({ value: focus, label: t(MACHI_FOCUS_LABEL_KEYS[focus]) }))}
                        onChange={focus => onTuningChange?.({ focus })}
                    />
                </Row>
                {tuning.focus === 'manual' && (
                    <SliderRow
                        label={t('options.machiFocusOffset')}
                        value={tuning.focusOffset}
                        min={MACHI_DOF_LIMITS.focusOffset.min}
                        max={MACHI_DOF_LIMITS.focusOffset.max}
                        step={0.1}
                        format={signed(' m', 1)}
                        onChange={focusOffset => onTuningChange?.({ focusOffset })}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                )}
            </Group>
        </>
    );
};

export default MachiSettingsPanel;
