import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Line, Theme } from '../../../types';
import { loadLucideIcons } from '../../../services/lucideIconResolver';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixi/pixiRuntimeHost';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { KonbiniRuntime, KonbiniSongContext } from './createKonbiniRuntime';

// src/components/visualizer/konbini/VisualizerKonbini.tsx
// 雨町的 React 外壳：挂共享 shell 与底部字幕层，把按需加载的 three.js 运行时建一次（useVisualizerPixiHost 托管，
// 它与渲染器无关），换歌、换主题、暂停、静态模式都就地推给运行时。WebGL 上下文丢了就换一个 epoch 重建。
// 每帧的时间只在运行时的循环里读 currentTime，不进 React state。

const EMPTY_LINES: Line[] = [];

/** 主题没有图标时招牌上用的兜底图标。 */
export const KONBINI_FALLBACK_ICONS = ['Store', 'Umbrella', 'CloudRain', 'Moon'];

/** 招牌同步画图标：建运行时与换歌 / 换主题前先把主题图标和兜底图标加载好。 */
const loadKonbiniIcons = (theme: Theme) => loadLucideIcons([...(theme.lyricsIcons ?? []), ...KONBINI_FALLBACK_ICONS]);

const VisualizerKonbini: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        staticMode = false,
        paused = false,
        isPreviewMode = false,
        seed = 'konbini',
        songTitle,
        songArtist,
        songAlbum,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
        subtitleTheme,
        subtitleFontScale,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    const [contextEpoch, setContextEpoch] = useState(0);

    // 运行时创建期间这些输入可能已经变了；create 完成后按最新值补一次。
    const latestRef = useRef({ theme, paused, showText, staticMode });
    latestRef.current = { theme, paused, showText, staticMode };

    // 真正在画的歌：切歌时滞后于 props，免得对着还没到的歌词换牌面（songHandover.ts）。
    const committedSong = useVisualizerSongCommit({ seed, lines, currentTime, readyGraceMs: 3000 });
    const committedLines = committedSong.isInstrumental ? EMPTY_LINES : committedSong.lines;

    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const songContext = useMemo<KonbiniSongContext>(() => ({
        seed: committedSong.seed ?? 'konbini',
        lines: committedLines,
        isInstrumental: committedSong.isInstrumental,
        title: songTitle ?? '',
        artist: songArtist ?? '',
        album: songAlbum ?? '',
    }), [committedLines, committedSong.isInstrumental, committedSong.seed, songAlbum, songArtist, songTitle]);

    const runtimeRef = useVisualizerPixiHost<KonbiniRuntime, KonbiniSongContext>({
        hostRef,
        label: 'Konbini',
        // 只有真正需要新 WebGL 上下文的输入；歌、主题、暂停、静态模式都就地推给运行时。
        rebuildKey: [currentTime, audioPower, audioBands, isPreviewMode, contextEpoch],
        song: songContext,
        create: async (host, song, signal) => {
            const [{ KonbiniRuntime: Runtime }] = await Promise.all([
                import('./createKonbiniRuntime'),
                loadKonbiniIcons(latestRef.current.theme),
            ]);
            const latest = latestRef.current;
            const runtime = await Runtime.create({
                host,
                song,
                theme: latest.theme,
                currentTime,
                audioPower,
                audioBands,
                paused: latest.paused,
                staticMode: latest.staticMode,
                showText: latest.showText,
                previewMode: isPreviewMode,
                fallbackIcons: KONBINI_FALLBACK_ICONS,
                onContextLost: () => setContextEpoch(epoch => epoch + 1),
                signal,
            });
            const current = latestRef.current;
            runtime.setTheme(current.theme);
            runtime.setShowText(current.showText);
            runtime.setStaticMode(current.staticMode);
            runtime.setPaused(current.paused);
            return runtime;
        },
        swap: async (runtime, song) => {
            await loadKonbiniIcons(latestRef.current.theme);
            runtime.swapSong(song);
        },
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => {
        let cancelled = false;
        void loadKonbiniIcons(theme).then(() => {
            if (!cancelled) runtimeRef.current?.setTheme(theme);
        });
        return () => { cancelled = true; };
    }, [theme, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setShowText(showText);
    }, [showText, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setStaticMode(staticMode);
    }, [staticMode, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused, runtimeRef]);

    // 暂停时循环停着，拖动进度要手动补一帧。
    useEffect(() => currentTime.on('change', () => {
        if (paused || staticMode) runtimeRef.current?.renderOnce();
    }), [currentTime, paused, staticMode, runtimeRef]);

    const fallbackFontFamily = resolveThemeFontStack(theme);
    const fallbackFontWeight = resolveThemeFontWeight(theme, 700);
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
            renderBackground={false}
        >
            <div className="absolute inset-0 z-10 overflow-hidden">
                {/* 拖拽旋转、缩放要收到指针，所以这一层不是 pointer-events-none；预览里不接拖拽。 */}
                <div
                    ref={hostRef}
                    className={`absolute inset-0 z-10 ${isPreviewMode ? 'pointer-events-none' : ''}`}
                    aria-hidden="true"
                />
                {runtimeFailed && (
                    <div
                        className="pointer-events-none absolute inset-0 flex items-center justify-center px-10 text-center"
                        style={{
                            color: theme.primaryColor,
                            fontFamily: fallbackFontFamily,
                            fontWeight: fallbackFontWeight,
                            fontSize: `clamp(2rem, ${5.4 * lyricsFontScale}vw, 5.6rem)`,
                        }}
                    >
                        {showText && !committedSong.isInstrumental ? (activeLine?.fullText || t('ui.waitingForMusic')) : null}
                    </div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={subtitleFontSizes.translationFontSize}
                upcomingFontSize={subtitleFontSizes.upcomingFontSize}
                subtitleFontScale={subtitleFontScale}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerKonbini;
