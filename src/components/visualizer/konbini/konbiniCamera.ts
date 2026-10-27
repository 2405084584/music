import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BASE, BOARD, CAMERA, PROPS, STORE } from './geometry/layout';

// src/components/visualizer/konbini/konbiniCamera.ts
// 雨町的镜头：正交投影的斜俯视。默认构图按视口把整个底座（连同广告塔、电线杆的高度）框进去，并给底部字幕让出一点；
// 可以拖拽旋转、滚轮 / 双指缩放（OrbitControls，限方位角 ±75°、俯角 20°–70°，不平移），松手约 8 秒后缓回默认构图。

/** 默认构图要框进去的点：底座八个角、广告塔顶、电线杆顶、立柱灯箱顶。 */
const FRAMING_POINTS = (() => {
    const h = BASE.half;
    const points: THREE.Vector3[] = [];
    // 底座只框顶面四角加两侧的厚度：离镜头最近的底角压在字幕后面，不必框进来。
    [-h, h].forEach(x => [-h, h].forEach(z => {
        points.push(new THREE.Vector3(x, 0, z));
        if (x !== z || x < 0) points.push(new THREE.Vector3(x, -BASE.depth, z));
    }));
    const boardTop = BOARD.y0 + BOARD.faceHeight + 0.6;
    const r = BOARD.faceWidth / Math.sqrt(3);
    for (let k = 0; k < 3; k += 1) {
        const a = BOARD.azimuth + Math.PI / 3 + (k * 2 * Math.PI) / 3;
        points.push(new THREE.Vector3(BOARD.cx + Math.sin(a) * r, boardTop, BOARD.cz + Math.cos(a) * r));
    }
    points.push(new THREE.Vector3(PROPS.pylon.x, PROPS.pylon.height + 0.3, PROPS.pylon.z));
    points.push(new THREE.Vector3(STORE.x0, STORE.parapetTop, STORE.z0));
    return points;
})();

/** 构图留白（占画面的比例）与给字幕让出的下沿。 */
const MARGIN = 0.02;
const SUBTITLE_RESERVE = 0.05;
const CAMERA_DISTANCE = 60;

const orbitDirection = (azimuth: number, elevation: number) => new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
);

export interface KonbiniView {
    azimuth: number;
    elevation: number;
    zoom: number;
}

export class KonbiniCamera {
    readonly camera: THREE.OrthographicCamera;
    private controls: OrbitControls | null = null;
    private readonly target = new THREE.Vector3();
    /** 默认构图：目标点与半高（缩放 1 时）。 */
    private halfHeight = 8;
    /** 构图点投影的半宽、半高（缩放 1 时）。 */
    private fitHalf = { width: 9, height: 7 };
    private aspect = 16 / 9;
    private interacting = false;
    private idleSince = 0;
    private returning = false;
    private readonly spherical = new THREE.Spherical();
    /** 镜头有变化、需要补一帧（暂停时按需渲染用）。 */
    needsRender = true;

    constructor() {
        this.camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 200);
        this.camera.name = 'Camera';
        this.fitDefault();
        this.placeAt({ azimuth: CAMERA.azimuth, elevation: CAMERA.elevation, zoom: 1 });
    }

    /** 按默认朝向把构图点投到镜头平面上，求目标点和半高。 */
    private fitDefault() {
        const direction = orbitDirection(CAMERA.azimuth, CAMERA.elevation);
        const forward = direction.clone().negate();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        let minR = Infinity; let maxR = -Infinity; let minU = Infinity; let maxU = -Infinity;
        FRAMING_POINTS.forEach(point => {
            const r = point.dot(right);
            const u = point.dot(up);
            minR = Math.min(minR, r); maxR = Math.max(maxR, r);
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        });
        const centerR = (minR + maxR) / 2;
        const centerU = (minU + maxU) / 2;
        // 目标点放在投影包围盒中心（沿视线方向的位置无所谓，正交投影只看垂直于视线的平面）。
        this.target.copy(right.multiplyScalar(centerR)).add(up.multiplyScalar(centerU));
        const halfWidth = (maxR - minR) / 2;
        const halfHeight = (maxU - minU) / 2;
        this.fitHalf = { width: halfWidth, height: halfHeight };
        this.applyFrustum();
    }

    /** 视口变了：按宽高比取能装下构图的半高，再给字幕让出下沿。 */
    private applyFrustum() {
        const usable = 1 - MARGIN * 2 - SUBTITLE_RESERVE;
        const halfHeight = Math.max(this.fitHalf.height, this.fitHalf.width / this.aspect) / usable;
        this.halfHeight = halfHeight;
        const shift = halfHeight * SUBTITLE_RESERVE;
        this.camera.left = -halfHeight * this.aspect;
        this.camera.right = halfHeight * this.aspect;
        this.camera.top = halfHeight - shift;
        this.camera.bottom = -halfHeight - shift;
        this.camera.updateProjectionMatrix();
        this.needsRender = true;
    }

    setAspect(width: number, height: number) {
        const aspect = width / Math.max(1, height);
        if (Math.abs(aspect - this.aspect) < 1e-4) return;
        this.aspect = aspect;
        this.applyFrustum();
    }

    /** 直接摆到某个视角（调试钩子、回正动画用）。 */
    placeAt(view: KonbiniView) {
        this.camera.position.copy(this.target).addScaledVector(orbitDirection(view.azimuth, view.elevation), CAMERA_DISTANCE);
        this.camera.zoom = view.zoom;
        this.camera.lookAt(this.target);
        this.camera.updateProjectionMatrix();
        this.controls?.update();
        this.needsRender = true;
    }

    /** 当前视角。 */
    view(): KonbiniView {
        this.spherical.setFromVector3(this.camera.position.clone().sub(this.target));
        return { azimuth: this.spherical.theta, elevation: Math.PI / 2 - this.spherical.phi, zoom: this.camera.zoom };
    }

    /** 接上拖拽：限角、阻尼、缩放上下限、不平移。 */
    attach(element: HTMLElement) {
        if (this.controls) return;
        const controls = new OrbitControls(this.camera, element);
        controls.target.copy(this.target);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.rotateSpeed = 0.55;
        controls.zoomSpeed = 0.8;
        controls.minAzimuthAngle = CAMERA.azimuth - CAMERA.azimuthRange;
        controls.maxAzimuthAngle = CAMERA.azimuth + CAMERA.azimuthRange;
        controls.minPolarAngle = Math.PI / 2 - CAMERA.maxElevation;
        controls.maxPolarAngle = Math.PI / 2 - CAMERA.minElevation;
        controls.minZoom = CAMERA.minZoom;
        controls.maxZoom = CAMERA.maxZoom;
        controls.addEventListener('start', this.onStart);
        controls.addEventListener('end', this.onEnd);
        controls.addEventListener('change', this.onChange);
        controls.update();
        this.controls = controls;
    }

    private readonly onStart = () => {
        this.interacting = true;
        this.returning = false;
    };

    private readonly onEnd = () => {
        this.interacting = false;
        this.idleSince = performance.now();
    };

    private readonly onChange = () => {
        this.needsRender = true;
    };

    /** 镜头还在动（阻尼、回正）：暂停时也要继续出帧。 */
    get busy() {
        return this.interacting || this.returning || this.needsRender;
    }

    /**
     * 每帧推进：阻尼、闲置回正。realDelta 是真实时间（镜头属于界面，不随歌曲暂停）。
     */
    update(realDelta: number) {
        if (this.controls) {
            if (!this.interacting && !this.returning && this.idleSince > 0 && performance.now() - this.idleSince > CAMERA.idleReturnSeconds * 1000) {
                const view = this.view();
                const off = Math.abs(view.azimuth - CAMERA.azimuth) + Math.abs(view.elevation - CAMERA.elevation) + Math.abs(view.zoom - 1);
                this.returning = off > 1e-3;
                this.idleSince = 0;
            }
            if (this.returning) {
                const view = this.view();
                const k = 1 - Math.exp(-realDelta * 1.6);
                const next = {
                    azimuth: view.azimuth + (CAMERA.azimuth - view.azimuth) * k,
                    elevation: view.elevation + (CAMERA.elevation - view.elevation) * k,
                    zoom: view.zoom + (1 - view.zoom) * k,
                };
                const done = Math.abs(next.azimuth - CAMERA.azimuth) < 2e-4 && Math.abs(next.elevation - CAMERA.elevation) < 2e-4 && Math.abs(next.zoom - 1) < 2e-4;
                this.placeAt(done ? { azimuth: CAMERA.azimuth, elevation: CAMERA.elevation, zoom: 1 } : next);
                if (done) this.returning = false;
            }
            this.controls.update();
        }
    }

    /** 渲染后清掉“要补帧”的标记。 */
    rendered() {
        this.needsRender = false;
    }

    get frustumHalfHeight() {
        return this.halfHeight / this.camera.zoom;
    }

    dispose() {
        if (!this.controls) return;
        this.controls.removeEventListener('start', this.onStart);
        this.controls.removeEventListener('end', this.onEnd);
        this.controls.removeEventListener('change', this.onChange);
        this.controls.dispose();
        this.controls = null;
    }
}
