import { FOG_DIV } from './nebbiaConstants';
import { makeTex, type Tex } from './nebbiaGlUtils';

// src/components/visualizer/nebbia/nebbiaFogGl.ts
// 雾的预渲染（从 nebbiaGl.ts 拆出）：雾后面两层模糊的窗外各画进一张 RGBA16F，主画面放大采样。
// 模糊半径 0.03 那层 1/4 画布分辨率；0.09 那层糊得多（2K 屏上约 180 像素），1/8 就够。
// 不支持浮点渲染目标、或帧缓冲拼不成时 ok 为假，主画面自己算（uFogTex 为假）。

interface FogLayer { tex: Tex; fb: WebGLFramebuffer | null; div: number; b: number; w: number; h: number }

export class NebbiaFogGl {
    private readonly layers: FogLayer[];
    private ok: boolean;

    /** `prog` 要是当前程序。 */
    constructor(private readonly gl: WebGL2RenderingContext, private readonly prog: WebGLProgram, unit: number, private readonly U: Record<string, WebGLUniformLocation | null>) {
        this.layers = [
            { tex: makeTex(gl, prog, unit, 'uFogBlur'), fb: null, div: FOG_DIV, b: 0.03, w: 1, h: 1 },
            { tex: makeTex(gl, prog, unit + 1, 'uFogGlow'), fb: null, div: FOG_DIV * 2, b: 0.09, w: 1, h: 1 },
        ];
        this.ok = !!gl.getExtension('EXT_color_buffer_float');
        gl.uniform1i(U.uFogTex, this.ok ? 1 : 0);
    }

    /** 画布的像素尺寸。 */
    resize(canvasW: number, canvasH: number) {
        const { gl } = this;
        if (!this.ok) return;
        for (const L of this.layers) {
            L.w = Math.max(1, Math.ceil(canvasW / L.div)); L.h = Math.max(1, Math.ceil(canvasH / L.div));
            if (!L.fb) L.fb = gl.createFramebuffer()!;
            gl.activeTexture(gl.TEXTURE0 + L.tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, L.tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, L.w, L.h, 0, gl.RGBA, gl.HALF_FLOAT, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.tex.t, 0);
            // 有的驱动报了 EXT_color_buffer_float 却拼不成 RGBA16F 的帧缓冲：退回主画面自己算雾
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.warn('[Nebbia] fog prepass framebuffer incomplete, computing the fog in the main pass');
                this.ok = false;
                for (const l of this.layers) { if (l.fb) gl.deleteFramebuffer(l.fb); l.fb = null; }
                gl.useProgram(this.prog);
                gl.uniform1i(this.U.uFogTex, 0);
                break;
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** 每帧在主画面之前调（主程序是当前程序、全屏四边形已绑好）。 */
    draw() {
        const { gl, U } = this;
        if (!this.ok) return;
        // 画之前把两张纹理从采样单元上卸下：同一个程序既采样又往里画会被判成反馈环
        for (const L of this.layers) { gl.activeTexture(gl.TEXTURE0 + L.tex.unit); gl.bindTexture(gl.TEXTURE_2D, null); }
        gl.uniform1i(U.uPass, 0);
        for (const L of this.layers) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb);
            gl.viewport(0, 0, L.w, L.h);
            gl.uniform1f(U.uFogB, L.b);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.uniform1i(U.uPass, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (const L of this.layers) { gl.activeTexture(gl.TEXTURE0 + L.tex.unit); gl.bindTexture(gl.TEXTURE_2D, L.tex.t); }
    }
}
