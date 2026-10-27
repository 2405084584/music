import React from 'react';
import { defineVisualizer } from '../definition';

const VisualizerKonbini = React.lazy(() => import('./VisualizerKonbini'));

// src/components/visualizer/konbini/entry.tsx
// Registers 雨町 (Konbini), an experimental three.js style: a procedural miniature of a Japanese convenience
// store on a rainy night street corner, with the lyrics lit up on the rooftop sign tower, the next line on the
// LED ticker over the door and the song on the shop signs. The theme's colours and icons repaint the "chain".
export default defineVisualizer({
    mode: 'konbini',
    order: 27,
    labelKey: 'ui.visualizerKonbini',
    labelFallback: '雨町',
    previewSeed: 'konbini',
    previewStartOffset: 0,
    // 雨町：一间小店，屋顶一块牌子，斜斜的雨
    glyph: (
        <>
            <path d="M4 20V11h11v9" />
            <path d="M6.5 11V8.5h6V11" opacity="0.6" />
            <path d="M9 20v-4.5h3V20" opacity="0.6" />
            <path d="M18 4l-1.2 3M21 6l-1.2 3M18.5 11l-1.2 3" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Konbini',
        description: 'Switch to the Konbini rainy street corner',
        keywords: ['konbini', 'convenience store', 'rain', 'street corner', 'diorama 3d', '雨町', '便利店', '雨夜', '街角'],
    },
    // The scene draws its own sky: no shared background under it.
    background: false,
    // Deliberately unkeyed on the seed: the runtime takes a track change in place (pixiRuntimeHost.ts).
    render: props => <VisualizerKonbini {...props} />,
    ownFontSizeNoticeKey: 'options.konbiniFontSizeAutoNotice',
});
