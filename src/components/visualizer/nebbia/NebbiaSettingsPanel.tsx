import React from 'react';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import { percent, SliderRow, times } from '../panelRows';
import {
    DEFAULT_NEBBIA_TUNING,
    NEBBIA_APPEAR_MODES,
    NEBBIA_FADE_MODES,
    NEBBIA_LIMITS,
    type NebbiaAppearMode,
    type NebbiaFadeMode,
    type NebbiaNumberKey,
    type NebbiaTuning,
} from './types';

// src/components/visualizer/nebbia/NebbiaSettingsPanel.tsx
// 雾笺的设置：字怎么出现、怎么消失，雾和书写，窗外，聚光灯和雨点，画质。用设置窗口的共用控件画成几组。

export const NEBBIA_APPEAR_LABEL_KEYS: Record<NebbiaAppearMode, string> = {
    auto: 'options.nebbiaAppearAuto',
    write: 'options.nebbiaAppearWrite',
    fade: 'options.nebbiaAppearFade',
};
export const NEBBIA_FADE_LABEL_KEYS: Record<NebbiaFadeMode, string> = {
    fog: 'options.nebbiaFadeFog',
    fingers: 'options.nebbiaFadeFingers',
    mix: 'options.nebbiaFadeMix',
};

const seconds = (value: number) => `${value.toFixed(1)}s`;
type SliderSpec = [NebbiaNumberKey, string, number, (value: number) => string];

const GROUPS: { def: SettingsGroupDef; sliders: SliderSpec[] }[] = [
    {
        def: { id: 'vis-nebbia-writing', titleKey: 'options.nebbiaWriting' },
        sliders: [
            ['strokeWidth', 'options.nebbiaStrokeWidth', 0.005, percent],
            ['writeSpeed', 'options.nebbiaWriteSpeed', 0.05, times],
            ['doodle', 'options.nebbiaDoodle', 0.05, percent],
            ['mist', 'options.nebbiaMist', 0.01, percent],
            ['hold', 'options.nebbiaHold', 0.1, seconds],
            ['refog', 'options.nebbiaRefog', 0.5, seconds],
        ],
    },
    {
        def: { id: 'vis-nebbia-window', titleKey: 'options.nebbiaWindow' },
        sliders: [
            ['busSpeed', 'options.nebbiaBusSpeed', 0.05, times],
            ['neon', 'options.nebbiaNeon', 0.05, times],
            ['bump', 'options.nebbiaBump', 0.05, times],
            ['spot', 'options.nebbiaSpot', 0.05, times],
            ['spotX', 'options.nebbiaSpotX', 0.01, percent],
            ['rainHit', 'options.nebbiaRainHit', 0.05, times],
            ['rainBig', 'options.nebbiaRainBig', 0.05, times],
            ['resolution', 'options.nebbiaResolution', 0.25, times],
        ],
    },
];

const NebbiaSettingsPanel: React.FC<VisualizerSettingsPanelProps<NebbiaTuning>> = ({
    t,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const resolved = tuning ?? DEFAULT_NEBBIA_TUNING;
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            {GROUPS.map(({ def, sliders }, gi) => (
                <Group key={def.id} def={def}>
                    {gi === 0 && (
                        <>
                            <Row label={t('options.nebbiaAppear')}>
                                <Segmented<NebbiaAppearMode>
                                    value={resolved.appearMode}
                                    options={NEBBIA_APPEAR_MODES.map(value => ({ value, label: t(NEBBIA_APPEAR_LABEL_KEYS[value]) }))}
                                    onChange={next => onTuningChange({ appearMode: next })}
                                />
                            </Row>
                            <Row label={t('options.nebbiaFade')}>
                                <Segmented<NebbiaFadeMode>
                                    value={resolved.fadeMode}
                                    options={NEBBIA_FADE_MODES.map(value => ({ value, label: t(NEBBIA_FADE_LABEL_KEYS[value]) }))}
                                    onChange={next => onTuningChange({ fadeMode: next })}
                                />
                            </Row>
                        </>
                    )}
                    {sliders.map(([key, labelKey, step, format]) => (
                        <SliderRow
                            key={key}
                            {...drag}
                            label={t(labelKey)}
                            value={resolved[key]}
                            min={NEBBIA_LIMITS[key].min}
                            max={NEBBIA_LIMITS[key].max}
                            step={step}
                            format={format}
                            onChange={value => onTuningChange({ [key]: value } as Partial<NebbiaTuning>)}
                        />
                    ))}
                </Group>
            ))}
        </>
    );
};

export default NebbiaSettingsPanel;
