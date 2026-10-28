import React from 'react';
import { cycleValue, QuickControlChip } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import NebbiaSettingsPanel, { NEBBIA_APPEAR_LABEL_KEYS, NEBBIA_FADE_LABEL_KEYS } from './NebbiaSettingsPanel';
import nebbiaTuning from './tuning';
import { NEBBIA_APPEAR_MODES, NEBBIA_FADE_MODES, type NebbiaTuning } from './types';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';

const VisualizerNebbia = React.lazy(() => import('./VisualizerNebbia'));

// src/components/visualizer/nebbia/entry.tsx
// Registers 雾笺 (Nebbia): writing lyrics with a fingertip on the fogged-up window of a bus on a rainy night.
// Each character is written stroke by stroke in its stroke order and wipes the fog clear onto the city
// outside; beads gather along the wipe, drops run down, the fog creeps back. Raindrops hit the glass with
// the vocal, and two spotlights from the street follow the character being sung.
export default defineVisualizer({
    mode: 'nebbia',
    order: 29,
    labelKey: 'ui.visualizerNebbia',
    labelFallback: '雾笺',
    previewSeed: 'nebbia',
    previewStartOffset: 0,
    // 雾笺：一扇窗，雾上手指写的一笔，几颗水珠
    glyph: (
        <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
            <path d="M7 14c2-3.5 4-3.5 5 0s3 3 5-1" opacity="0.6" />
            <path d="M8 8v1.5M15.5 7.5v2" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Nebbia',
        description: 'Switch to the Nebbia fogged-window writing',
        keywords: ['nebbia', 'rain window', 'fog', 'bus window', 'writing on glass', 'raindrops', '雾笺', '起雾', '玻璃写字', '公交车', '雨夜'],
    },
    // 画面自己画窗外的夜景：不要共用背景。
    background: false,
    usesWordSegmentation: true,
    // 智能动感模式, 疏雨轻车: one effect, two parts, both off the htdemucs run (`source: 'stems'`).
    // - rain (雨点强度): the rain follows the vocal stem (analysis/vocalEnvelope.ts) - small drops as
    //   dense as the voice is loud, a big one on every sung onset; its strength scales the density and
    //   the big drops' size. Until the track is analysed it follows the 1-3.5 kHz band of the mix.
    // - bump (颠簸强度): the bus jolts on the kicks (nebbiaDrumBumps.ts) instead of at random;
    //   its strength scales the jolts. A drumless or not yet analysed track keeps the random ones.
    beatEffects: [
        {
            id: BEAT_EFFECT_IDS.nebbiaDrizzleRide,
            nameKey: 'options.beatEffect_nebbiaDrizzleRide',
            descKey: 'options.beatEffect_nebbiaDrizzleRideDesc',
            source: 'stems',
            parts: [
                { key: 'rain', nameKey: 'options.beatEffectPart_nebbiaRain' },
                { key: 'bump', nameKey: 'options.beatEffectPart_nebbiaBump' },
            ],
        },
    ],
    // Deliberately unkeyed on the seed: the runtime takes a track change in place (createNebbiaRuntime.ts).
    render: props => <VisualizerNebbia {...props} nebbiaTuning={nebbiaTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => <NebbiaSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<NebbiaTuning>) => {
        const appear = t(NEBBIA_APPEAR_LABEL_KEYS[tuning.appearMode]);
        const fade = t(NEBBIA_FADE_LABEL_KEYS[tuning.fadeMode]);
        return (
            <>
                <QuickControlChip
                    label={appear}
                    title={`${t('options.nebbiaAppear')}: ${appear}`}
                    onClick={() => onTuningChange({ appearMode: cycleValue(NEBBIA_APPEAR_MODES, tuning.appearMode) })}
                />
                <QuickControlChip
                    label={fade}
                    title={`${t('options.nebbiaFade')}: ${fade}`}
                    onClick={() => onTuningChange({ fadeMode: cycleValue(NEBBIA_FADE_MODES, tuning.fadeMode) })}
                />
            </>
        );
    },
});
