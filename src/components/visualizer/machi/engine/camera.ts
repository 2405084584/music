import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// src/components/visualizer/machi/engine/camera.ts
// 町景的镜头：正交投影的斜俯视。缩放 1 时按视口把场景给的构图点（底座、最高的招牌……）都框进去，并给底部字幕让出一点；
// 默认构图再拉近到场景给的缩放，目标点往上挪，保住画面上沿的招牌，裁掉的是画面下沿离镜头最近的底座角。
// 可以拖拽旋转、滚轮 / 双指缩放（OrbitControls，限方位角默认视角 ±75°、俯角 20°–70°，不平移），松手约 8 秒后缓回默认构图。

const DEG = Math.PI / 180;

/** 拖拽的范围与闲置回正（三个场景一样）。 */
export const MACHI_CAMERA_LIMITS = {
    azimuthRange: 75 * DEG,
    minElevation: 20 * DEG,
    maxElevation: 70 * DEG,
    minZoom: 0.75,
    maxZoom: 3.6,
    idleReturnSeconds: 8,
} as const;

export interface MachiView {
    azimuth: number;
    elevation: number;
    zoom: number;
}

/** 场景给的取景：要框进去的点与默认视角（方位角按 three 的球坐标，从 +z 转向 +x）。 */
export interface MachiCameraFraming {
    points: THREE.Vector3[];
    view: MachiView;
}

/** 构图留白（占画面的比例）与给字幕让出的下沿。 */
const MARGIN = 0.02;
const SUBTITLE_RESERVE = 0.05;
const CAMERA_DISTANCE = 60;
/** 默认缩放下装不下时，多出来的高度这么多从下沿裁（其余从上沿）。 */
const CROP_FROM_BOTTOM = 0.85;

const orbitDirection = (azimuth: number, elevation: number) => new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
);

export class MachiCamera {
    readonly camera: THREE.OrthographicCamera;
    private controls: OrbitControls | null = null;
    private readonly target = new THREE.Vector3();
    private framing: MachiCameraFraming = { points: [new THREE.Vector3()], view: { azimuth: 45 * DEG, elevation: 31 * DEG, zoom: 1 } };
    /** 构图点投影包围盒的中心（缩放 1 时的目标点）与镜头平面的“上”方向。 */
    private readonly fitCenter = new THREE.Vector3();
    private readonly fitUp = new THREE.Vector3();
    /** 默认构图：半高（缩放 1 时）。 */
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
    }

    /** 默认视角（回正、调试钩子用）。 */
    get defaultView(): MachiView {
        return this.framing.view;
    }

    /** 换场景：新的构图点与默认视角，镜头直接摆到默认构图。 */
    setFraming(framing: MachiCameraFraming) {
        this.framing = framing;
        this.interacting = false;
        this.returning = false;
        this.idleSince = 0;
        this.fitDefault();
        this.applyLimits();
        this.placeAt(framing.view);
    }

    /** 按默认朝向把构图点投到镜头平面上，求目标点和半高。 */
    private fitDefault() {
        const { view } = this.framing;
        const direction = orbitDirection(view.azimuth, view.elevation);
        const forward = direction.clone().negate();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        let minR = Infinity; let maxR = -Infinity; let minU = Infinity; let maxU = -Infinity;
        this.framing.points.forEach(point => {
            const r = point.dot(right);
            const u = point.dot(up);
            minR = Math.min(minR, r); maxR = Math.max(maxR, r);
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        });
        const centerR = (minR + maxR) / 2;
        const centerU = (minU + maxU) / 2;
        // 目标点放在投影包围盒中心（沿视线方向的位置无所谓，正交投影只看垂直于视线的平面）。
        this.fitUp.copy(up);
        this.fitCenter.copy(right.multiplyScalar(centerR)).add(up.clone().multiplyScalar(centerU));
        this.fitHalf = { width: (maxR - minR) / 2, height: (maxU - minU) / 2 };
        this.applyFrustum();
    }

    /**
     * 视口变了：按宽高比取能装下构图的半高，再给字幕让出下沿。默认缩放下竖向装不下的部分大多从下沿裁，
     * 所以目标点往上挪（只在竖向是瓶颈时；横向是瓶颈的竖屏视口竖向本来有富余）。
     */
    private applyFrustum() {
        const usable = 1 - MARGIN * 2 - SUBTITLE_RESERVE;
        const halfHeight = Math.max(this.fitHalf.height, this.fitHalf.width / this.aspect) / usable;
        this.halfHeight = halfHeight;
        const overflow = Math.max(0, this.fitHalf.height / usable - halfHeight / this.framing.view.zoom);
        this.target.copy(this.fitCenter).addScaledVector(this.fitUp, overflow * (CROP_FROM_BOTTOM - 0.5) * 2);
        if (this.controls) {
            const view = this.view();
            this.controls.target.copy(this.target);
            this.placeAt(view);
        }
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
    placeAt(view: MachiView) {
        this.camera.position.copy(this.target).addScaledVector(orbitDirection(view.azimuth, view.elevation), CAMERA_DISTANCE);
        this.camera.zoom = view.zoom;
        this.camera.lookAt(this.target);
        this.camera.updateProjectionMatrix();
        this.controls?.update();
        this.needsRender = true;
    }

    /** 当前视角。 */
    view(): MachiView {
        this.spherical.setFromVector3(this.camera.position.clone().sub(this.controls?.target ?? this.target));
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
        controls.minPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.maxElevation;
        controls.maxPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.minElevation;
        controls.minZoom = MACHI_CAMERA_LIMITS.minZoom;
        controls.maxZoom = MACHI_CAMERA_LIMITS.maxZoom;
        controls.addEventListener('start', this.onStart);
        controls.addEventListener('end', this.onEnd);
        controls.addEventListener('change', this.onChange);
        this.controls = controls;
        this.applyLimits();
        controls.update();
    }

    /** 方位角限在默认视角两侧。 */
    private applyLimits() {
        if (!this.controls) return;
        this.controls.target.copy(this.target);
        this.controls.minAzimuthAngle = this.framing.view.azimuth - MACHI_CAMERA_LIMITS.azimuthRange;
        this.controls.maxAzimuthAngle = this.framing.view.azimuth + MACHI_CAMERA_LIMITS.azimuthRange;
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
        if (!this.controls) return;
        const home = this.framing.view;
        if (!this.interacting && !this.returning && this.idleSince > 0 && performance.now() - this.idleSince > MACHI_CAMERA_LIMITS.idleReturnSeconds * 1000) {
            const view = this.view();
            const off = Math.abs(view.azimuth - home.azimuth) + Math.abs(view.elevation - home.elevation) + Math.abs(view.zoom - home.zoom);
            this.returning = off > 1e-3;
            this.idleSince = 0;
        }
        if (this.returning) {
            const view = this.view();
            const k = 1 - Math.exp(-realDelta * 1.6);
            const next = {
                azimuth: view.azimuth + (home.azimuth - view.azimuth) * k,
                elevation: view.elevation + (home.elevation - view.elevation) * k,
                zoom: view.zoom + (home.zoom - view.zoom) * k,
            };
            const done = Math.abs(next.azimuth - home.azimuth) < 2e-4 && Math.abs(next.elevation - home.elevation) < 2e-4 && Math.abs(next.zoom - home.zoom) < 2e-4;
            this.placeAt(done ? home : next);
            if (done) this.returning = false;
        }
        this.controls.update();
    }

    /** 渲染后清掉“要补帧”的标记。 */
    rendered() {
        this.needsRender = false;
    }

    /** 镜头到目标点的距离（景深的对焦深度）。 */
    get focusDistance() {
        return this.camera.position.distanceTo(this.target);
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
