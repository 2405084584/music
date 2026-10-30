import { FOG_DIV, NEBBIA_FIXED } from './nebbiaConstants';
import { NebbiaFogGl } from './nebbiaFogGl';
import { NebbiaNoiseTex } from './nebbiaNoiseTex';
import raindropSpriteUrl from './nebbiaRaindrop.png';
import { NEBBIA_FS, NEBBIA_SPRITE_FS, NEBBIA_SPRITE_VS, NEBBIA_VS } from './nebbiaShaders';
import { link, makeTex, type NebbiaUniforms, type Tex } from './nebbiaGlUtils';
import { NebbiaBuildingCache } from './nebbiaBuildingCache';

// src/components/visualizer/nebbia/nebbiaGl.ts
// 雾笺的 WebGL2 部分：一个全屏着色器，四张玻璃上的纹理（擦痕遮罩、擦痕边 / 雨点的水珠、雾上的凝结水珠、哈气的白气），
// 雾的预渲染（nebbiaFogGl.ts），楼群缓存（nebbiaBuildingCache.ts），静态噪声纹理（nebbiaNoiseTex.ts）。
// 水珠精灵是 raindrop-fx 1.0.8（MIT，见 nebbiaRaindrop.LICENSE.txt）的 assets/img/raindrop.png。

export class NebbiaGl {
    private readonly gl: WebGL2RenderingContext;
    private readonly prog: WebGLProgram;
    private readonly sprog: WebGLProgram;
    private readonly quadVao: WebGLVertexArrayObject;
    private readonly spriteVao: WebGLVertexArrayObject;
    private readonly instBuf: WebGLBuffer;
    private readonly U: Record<string, WebGLUniformLocation | null> = {};
    private readonly uView: WebGLUniformLocation | null;
    private readonly mask: Tex; private readonly drop: Tex; private readonly field: Tex; private readonly sprite: Tex; private readonly breath: Tex;
    private readonly fog: NebbiaFogGl;
    private readonly bld: NebbiaBuildingCache;
    private readonly noise: NebbiaNoiseTex;
    private W = 1; private H = 1;
    private spriteReady = false;
    private instData = new Float32Array(0);
    /** 精灵贴图加载好时调（这之前不画水珠）。 */
    onSpriteReady: (() => void) | null = null;

    constructor(private readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
        if (!gl) throw new Error('Nebbia: WebGL2 unavailable');
        this.gl = gl;
        this.prog = link(gl, NEBBIA_VS, NEBBIA_FS);
        this.sprog = link(gl, NEBBIA_SPRITE_VS, NEBBIA_SPRITE_FS);
        gl.useProgram(this.prog);
        for (const n of ['uRes', 'uTime', 'uMist', 'uEdge', 'uRefract', 'uBus', 'uGlint', 'uNeon', 'uGlassShift', 'uSceneShift', 'uSky0', 'uSky1', 'uLa', 'uLb', 'uLc', 'uPass', 'uFogTex', 'uSpotSrc', 'uSpotSrc2', 'uSpotTgt', 'uSpotR', 'uSpotI', 'uBreathOn', 'uFogB', 'uBreathThick', 'uBldOn', 'uBldGeo', 'uFillB', 'uFillLayer', 'uFillX0', 'uFillGeo', 'uFillSize', 'uNoiseOn']) {
            this.U[n] = gl.getUniformLocation(this.prog, n);
        }
        this.quadVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.quadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(this.prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        this.mask = makeTex(gl, this.prog, 2, 'uMask');
        this.drop = makeTex(gl, this.prog, 3, 'uDrop');
        this.field = makeTex(gl, this.prog, 4, 'uField');
        this.sprite = makeTex(gl, this.prog, 5, null);
        this.fog = new NebbiaFogGl(gl, this.prog, 6, this.U);
        this.breath = makeTex(gl, this.prog, 8, 'uBreath');
        this.bld = new NebbiaBuildingCache(gl, this.prog, 9, this.U);
        this.noise = new NebbiaNoiseTex(gl, this.prog, 15, this.U);
        gl.uniform1f(this.U.uBreathThick, NEBBIA_FIXED.breathThick);
        gl.uniform1i(this.U.uPass, 1);

        this.spriteVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.spriteVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        const aCorner = gl.getAttribLocation(this.sprog, 'aCorner');
        gl.enableVertexAttribArray(aCorner);
        gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
        this.instBuf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        const aRect = gl.getAttribLocation(this.sprog, 'aRect'), aParam = gl.getAttribLocation(this.sprog, 'aParam');
        gl.enableVertexAttribArray(aRect); gl.vertexAttribPointer(aRect, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(aRect, 1);
        gl.enableVertexAttribArray(aParam); gl.vertexAttribPointer(aParam, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(aParam, 1);
        gl.bindVertexArray(null);
        this.uView = gl.getUniformLocation(this.sprog, 'uView');
        gl.useProgram(this.sprog);
        gl.uniform1i(gl.getUniformLocation(this.sprog, 'uSprite'), this.sprite.unit);
        gl.useProgram(this.prog);
        this.loadSprite();
    }

    get isContextLost() {
        return this.gl.isContextLost();
    }

    private loadSprite() {
        const img = new Image();
        img.onload = () => {
            const { gl } = this;
            if (gl.isContextLost()) return;
            gl.activeTexture(gl.TEXTURE0 + this.sprite.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.sprite.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            this.spriteReady = true;
            this.onSpriteReady?.();
        };
        img.src = raindropSpriteUrl;
    }

    /** 主题配色：天色两档、三个灯光色，0..1 的 RGB。 */
    setPalette(sky0: number[], sky1: number[], la: number[], lb: number[], lc: number[]) {
        const { gl, U } = this;
        gl.useProgram(this.prog);
        gl.uniform3fv(U.uSky0, sky0); gl.uniform3fv(U.uSky1, sky1);
        gl.uniform3fv(U.uLa, la); gl.uniform3fv(U.uLb, lb); gl.uniform3fv(U.uLc, lc);
        this.bld.invalidate();
    }

    /** W、H 是 CSS 像素（水珠纹理用这个分辨率），dpr 是画布的像素比。 */
    resize(W: number, H: number, dpr: number) {
        const { gl } = this;
        this.W = Math.max(1, Math.round(W)); this.H = Math.max(1, Math.round(H));
        this.canvas.width = Math.max(1, Math.round(W * dpr));
        this.canvas.height = Math.max(1, Math.round(H * dpr));
        for (const tex of [this.drop, this.field]) {
            gl.activeTexture(gl.TEXTURE0 + tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            if (!tex.fb) tex.fb = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
        }
        this.fog.resize(this.canvas.width, this.canvas.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.noise.resize(this.canvas.width, this.canvas.height);
        this.bld.resize(this.canvas.width, this.canvas.height, Math.max(1, Math.ceil(this.canvas.height / FOG_DIV)));
    }

    // 水珠实例画进一张水珠纹理（CSS 分辨率）
    private renderDrops(tex: Tex, inst: number[]) {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb!);
        gl.viewport(0, 0, this.W, this.H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (inst.length && this.spriteReady) {
            if (this.instData.length < inst.length) this.instData = new Float32Array(Math.ceil(inst.length * 1.5));
            this.instData.set(inst);
            gl.useProgram(this.sprog);
            gl.bindVertexArray(this.spriteVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
            gl.bufferData(gl.ARRAY_BUFFER, this.instData.subarray(0, inst.length), gl.DYNAMIC_DRAW);
            gl.uniform2f(this.uView, this.W, this.H);
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.length / 6);
            gl.disable(gl.BLEND);
            gl.useProgram(this.prog);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** 画一帧：遮罩画布上传（白气遮罩只在这一帧有哈气时传，`breath` 为 null 就不传），两张水珠纹理，雾的预渲染，主画面。 */
    render(mask: HTMLCanvasElement, breath: HTMLCanvasElement | null, drops: number[], field: number[], u: NebbiaUniforms) {
        const { gl, U } = this;
        gl.activeTexture(gl.TEXTURE0 + this.mask.unit);
        gl.bindTexture(gl.TEXTURE_2D, this.mask.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
        if (breath) {
            gl.activeTexture(gl.TEXTURE0 + this.breath.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.breath.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, breath);
        }
        this.renderDrops(this.drop, drops);
        this.renderDrops(this.field, field);
        gl.useProgram(this.prog);
        gl.bindVertexArray(this.quadVao);
        gl.uniform2f(U.uRes, this.canvas.width, this.canvas.height);
        gl.uniform1f(U.uTime, u.time); gl.uniform1f(U.uMist, u.mist); gl.uniform1f(U.uEdge, u.edge);
        gl.uniform1f(U.uRefract, u.refract); gl.uniform1f(U.uBus, u.bus); gl.uniform1f(U.uGlint, u.glint); gl.uniform1f(U.uNeon, u.neon);
        gl.uniform2fv(U.uGlassShift, u.glassShift); gl.uniform2fv(U.uSceneShift, u.sceneShift);
        gl.uniform2fv(U.uSpotSrc, u.spotSrc); gl.uniform2fv(U.uSpotSrc2, u.spotSrc2); gl.uniform2fv(U.uSpotTgt, u.spotTgt);
        gl.uniform1f(U.uSpotR, u.spotR); gl.uniform1f(U.uSpotI, u.spotI);
        gl.uniform1i(U.uBreathOn, breath ? 1 : 0);
        this.bld.update(u.time * u.bus);
        this.noise.update();
        this.fog.draw();
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    destroy() {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
