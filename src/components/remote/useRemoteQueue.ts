import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteQueueExpansion } from '../../types/remoteControl';

// src/components/remote/useRemoteQueue.ts
// Whether the remote window shows the play queue, and where. The queue key opens and closes it;
// Esc clears the search, then closes it; it leaves by itself when the pointer stays away, except
// while the search is being typed. Opening asks the main process which side has room, anchors the
// card on that side, then has the window grow (electron/remoteControlWindowGeometry.cjs).

/** The queue goes this long after the pointer leaves, as the sheet does. */
const QUEUE_IDLE_CLOSE_MS = 6000;
/** How long the list takes to fade before the window shrinks back. */
const QUEUE_LEAVE_MS = 160;

export const REMOTE_QUEUE_ROW_HEIGHT = 36;
export const REMOTE_QUEUE_MAX_VISIBLE_ROWS = 8;
/** The search field at the top of the list block. */
const QUEUE_SEARCH_HEIGHT = 40;
/** Space between the card and the list block, and under the last row. */
const QUEUE_GAP = 6;

/** How much taller the window wants to be for a queue of `count` songs (an empty queue keeps one row for its note). */
export const remoteQueueWantedHeight = (count: number) => (
    QUEUE_GAP + QUEUE_SEARCH_HEIGHT + Math.max(1, Math.min(count, REMOTE_QUEUE_MAX_VISIBLE_ROWS)) * REMOTE_QUEUE_ROW_HEIGHT + QUEUE_GAP
);

type UseRemoteQueueParams = {
    queueLength: number;
    pointerInside: boolean;
    /** A click-through window is a display: the queue never shows. */
    isDisplayOnly: boolean;
    /** The sheet takes Esc first. */
    isSheetOpen: boolean;
};

export type RemoteQueueState = {
    /** Asked for: the key reads pressed. */
    isOpen: boolean;
    /** The side the card is anchored to: set before the window grows, cleared after it shrinks. */
    direction: RemoteQueueExpansion['direction'] | null;
    /** The list is drawn: open, and the window has grown. */
    isShown: boolean;
    query: string;
    setQuery: (query: string) => void;
    toggle: () => void;
    close: () => void;
};

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export const useRemoteQueue = ({ queueLength, pointerInside, isDisplayOnly, isSheetOpen }: UseRemoteQueueParams): RemoteQueueState => {
    const [requested, setRequested] = useState(false);
    const [query, setQuery] = useState('');
    const [direction, setDirection] = useState<RemoteQueueExpansion['direction'] | null>(null);
    const [expansion, setExpansion] = useState<RemoteQueueExpansion | null>(null);
    const directionRef = useRef(direction);
    directionRef.current = direction;
    const isOpen = requested && !isDisplayOnly;
    const wantedHeight = remoteQueueWantedHeight(queueLength);

    // Turning click-through on closes the queue for good, not only for as long as it lasts.
    useEffect(() => {
        if (isDisplayOnly) {
            setRequested(false);
        }
    }, [isDisplayOnly]);

    // Grow, follow the queue's length, or shrink back. A newer request cancels a step still waiting.
    useEffect(() => {
        const resize = window.electron?.setRemoteControlQueueExpansion;
        let cancelled = false;

        const run = async () => {
            if (!resize) {
                // Opened in a browser: nothing to grow, the page shows the list as if it had.
                setDirection(isOpen ? 'down' : null);
                setExpansion(isOpen ? { direction: 'down', height: wantedHeight } : null);
                return;
            }

            if (isOpen) {
                if (!directionRef.current) {
                    const plan = await resize(wantedHeight, { preview: true });
                    if (cancelled || !plan) return;
                    // At the window's own height the card sits the same anchored to either side,
                    // so it does not move now, nor when the window grows on that side.
                    setDirection(plan.direction);
                    await nextFrame();
                    await nextFrame();
                    if (cancelled) return;
                }
                const applied = await resize(wantedHeight);
                if (!cancelled) setExpansion(applied);
                return;
            }

            if (!directionRef.current) return;
            setExpansion(null);
            await new Promise(resolve => window.setTimeout(resolve, QUEUE_LEAVE_MS));
            if (cancelled) return;
            await resize(null);
            if (!cancelled) setDirection(null);
        };

        run().catch(error => console.warn('[RemoteQueue] Failed to resize the window', error));
        return () => {
            cancelled = true;
        };
    }, [isOpen, wantedHeight]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || isSheetOpen) return;
            if (query) setQuery('');
            else setRequested(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, isSheetOpen, query]);

    // The search is being typed: its field has the caret and the window has the system's focus.
    const [isTyping, setIsTyping] = useState(false);
    useEffect(() => {
        if (!isOpen) {
            setIsTyping(false);
            return;
        }

        const sync = () => {
            const focused = document.activeElement;
            setIsTyping(document.hasFocus() && focused instanceof HTMLInputElement && focused.dataset.remoteQueueSearch !== undefined);
        };
        const stop = () => setIsTyping(false);
        sync();
        document.addEventListener('focusin', sync);
        document.addEventListener('focusout', sync);
        window.addEventListener('focus', sync);
        window.addEventListener('blur', stop);
        return () => {
            document.removeEventListener('focusin', sync);
            document.removeEventListener('focusout', sync);
            window.removeEventListener('focus', sync);
            window.removeEventListener('blur', stop);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || pointerInside || isTyping) {
            return;
        }

        const timer = window.setTimeout(() => setRequested(false), QUEUE_IDLE_CLOSE_MS);
        return () => window.clearTimeout(timer);
    }, [isOpen, pointerInside, isTyping]);

    // A closed queue starts again from the whole list next time.
    useEffect(() => {
        if (!isOpen) setQuery('');
    }, [isOpen]);

    const toggle = useCallback(() => setRequested(previous => !previous), []);
    const close = useCallback(() => setRequested(false), []);

    return {
        isOpen,
        direction,
        isShown: isOpen && expansion !== null,
        query,
        setQuery,
        toggle,
        close,
    };
};
