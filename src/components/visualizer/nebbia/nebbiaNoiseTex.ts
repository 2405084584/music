import { makeTex, type Tex } from './nebbiaGlUtils';

// src/components/visualizer/nebbia/nebbiaNoiseTex.ts
// 主画面每个像素都要的三个静态噪声（擦痕边的细噪声、重新起雾的大块噪声、雾上的闪点），只跟像素位置有关，
// 改尺寸时用主着色器 uPass 3 一次算进一张画布大小的 RGBA8 纹理（R 细、G 大块、B 闪点），之后每帧取一次样代替五次 value noise。
// 颠簸时玻璃有小数像素的偏移，取样是双线性插值，和现算差一点；8 位存储让擦痕边上偶尔差一两级。
// 画布超过纹理尺寸上限，或还没算好时，着色器照旧现算（uNoiseOn 为假）。

export class NebbiaNoiseTex {
    private readonly tex: Tex;
    private readonly fb: WebGLFramebuffer;
    private w = 1; private h = 1;
    private ok = false;
    private dirty = false;

    constructor(private readonly gl: WebGL2RenderingContext, prog: WebGLProgram, unit: number, private readonly U: Record<string, WebGLUniformLocation | null>) {
        this.tex = makeTex(gl, prog, unit, 'uNoise');
        this.fb = gl.createFramebuffer()!;
    }

    /** 画布的像素尺寸。 */
    resize(w: number, h: number) {
        const { gl } = this;
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        this.w = w; this.h = h;
        this.ok = w <= max && h <= max;
        if (!this.ok) return;
        gl.activeTexture(gl.TEXTURE0 + this.tex.unit);
        gl.bindTexture(gl.TEXTURE_2D, this.tex.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.t, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.dirty = true;
    }

    /** 每帧在画之前调（主程序是当前程序、全屏四边形已绑好）：改过尺寸就重算一次，设好 uNoiseOn。 */
    update() {
        const { gl, U } = this;
        if (this.ok && this.dirty) {
            // 画进这张时先从采样单元上卸下，不然算反馈环
            gl.activeTexture(gl.TEXTURE0 + this.tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
            gl.viewport(0, 0, this.w, this.h);
            gl.uniform1i(U.uPass, 3);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.uniform1i(U.uPass, 1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, this.tex.t);
            this.dirty = false;
        }
        gl.uniform1i(U.uNoiseOn, this.ok ? 1 : 0);
    }
}
