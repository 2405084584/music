import React from 'react';
import { Group, PictureGrid, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import {
    DEFAULT_MACHI_TUNING,
    MACHI_SCENE_IDS,
    MACHI_TIMES_OF_DAY,
    MACHI_WEATHERS,
    type MachiTimeOfDay,
    type MachiTuning,
    type MachiWeather,
} from './types';

// src/components/visualizer/machi/MachiSettingsPanel.tsx
// 町景的设置面板：场景（线稿小图，不放实时预览）、时间、天气三项，每项都有“自动”。快捷控件里的三个胶囊用同一套文案。

const SCENE_GROUP: SettingsGroupDef = { id: 'vis-machi-scene', titleKey: 'options.machiSceneSection' };
const SKY_GROUP: SettingsGroupDef = { id: 'vis-machi-sky', titleKey: 'options.machiSkySection' };

export const MACHI_SCENE_CHOICES: MachiTuning['scene'][] = ['auto', ...MACHI_SCENE_IDS];

export const MACHI_SCENE_LABEL_KEYS: Record<MachiTuning['scene'], string> = {
    auto: 'options.machiSceneAuto',
    konbini: 'options.machiSceneKonbini',
};

export const MACHI_TIME_LABEL_KEYS: Record<MachiTimeOfDay, string> = {
    auto: 'options.machiTimeAuto',
    day: 'options.machiTimeDay',
    dusk: 'options.machiTimeDusk',
    night: 'options.machiTimeNight',
};

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
}) => (
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
    </>
);

export default MachiSettingsPanel;
