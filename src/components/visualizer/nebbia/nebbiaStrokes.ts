// src/components/visualizer/nebbia/nebbiaStrokes.ts
// 中日文的笔顺：AnimCJK 的笔画中线（1024 方格、y 向下），由原型（feat/fog-write-prototype 分支 dev/prototypes/fog-write）的 tools/build-strokes.mjs
// 生成成 public/nebbia-strokes.json。
// @note 数据是 Arphic Public License（假名部分可选 LGPL），能不能随应用分发还没定，所以不进仓库（.gitignore），
// 运行时按需读一次；读不到（没生成、网页版没放）就是 null，所有字退回字体骨架追踪（nebbiaSkeleton.ts），笔顺是估的。

export type NebbiaStrokeData = Record<string, [number, number][][]>;

// 放在 public/ 下：网页版 BASE_URL 是 /，Electron 是 ./（相对 index.html）
const STROKES_URL = `${import.meta.env.BASE_URL}nebbia-strokes.json`;
let loading: Promise<NebbiaStrokeData | null> | null = null;
let loaded: NebbiaStrokeData | null = null;

/** 读笔顺数据，只读一次；失败不重试，整个会话都用骨架。 */
export const loadNebbiaStrokes = (): Promise<NebbiaStrokeData | null> => {
    if (!loading) {
        loading = fetch(STROKES_URL)
            .then(response => (response.ok ? response.json() as Promise<NebbiaStrokeData> : null))
            .catch(() => null)
            .then(data => {
                loaded = data && typeof data === 'object' ? data : null;
                return loaded;
            });
    }
    return loading;
};

/** 已经读到的一个字的笔画中线；没读到、没有这个字时 null。 */
export const getNebbiaStrokeMedians = (ch: string): [number, number][][] | null => loaded?.[ch] ?? null;
