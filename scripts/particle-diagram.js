import * as THREE from 'three';
import { OrbitControls } from '/three/OrbitControls.js';

function tag(text, color) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  ctx.fillStyle = '#15191fee';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 28px system-ui';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(2.15, .54, 1);
  sprite.position.y = .56;
  return sprite;
}

export function mountParticleDiagram(panel) {
  const viewport = panel.querySelector('.diagram-viewport');
  const toggle = panel.querySelector('button');
  const timeline = panel.querySelector('input');
  const info = panel.querySelector('output');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', 'Анимированная схема связей системы частиц');
  renderer.domElement.setAttribute('role', 'img');
  viewport.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101417);
  const grid = new THREE.GridHelper(19, 19, 0x3a484f, 0x28343a);
  grid.position.y = -.8;
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(39, 1, .1, 100);
  camera.position.set(9, 12, 14);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.minDistance = 5;
  orbit.maxDistance = 35;
  orbit.update();

  const graph = new THREE.Group();
  scene.add(graph);
  const draw = () => renderer.render(scene, camera);
  orbit.addEventListener('change', draw);
  new ResizeObserver(() => {
    const { clientWidth, clientHeight } = viewport;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    draw();
  }).observe(viewport);

  let edges = [];
  let playing = true;
  let phase = 0;
  let previousTime;
  function showFrame(value) {
    phase = value;
    edges.forEach(({ curve, marker }, index) => {
      curve.getPoint((phase + index / edges.length) % 1, marker.position);
    });
    timeline.value = String(Math.round(phase * 1000));
    draw();
  }
  function setPlaying(value) {
    playing = value;
    previousTime = undefined;
    toggle.textContent = playing ? 'Пауза' : 'Воспроизвести';
  }
  toggle.addEventListener('click', () => setPlaying(!playing));
  timeline.addEventListener('input', () => {
    setPlaying(false);
    showFrame(Number(timeline.value) / 1000);
  });
  renderer.setAnimationLoop(time => {
    if (!playing || panel.hidden || !edges.length) return;
    const delta = previousTime === undefined ? 0 : Math.min(.1, (time - previousTime) / 1000);
    previousTime = time;
    showFrame((phase + delta / 3) % 1);
  });

  const origin = new THREE.Vector3();
  function node(position, label, geometry, color) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(position);
    mesh.add(tag(label, color));
    graph.add(mesh);
  }
  function connect(position, color) {
    const midpoint = position.clone().multiplyScalar(.5).setY(1.4);
    const curve = new THREE.QuadraticBezierCurve3(origin, midpoint, position);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55 }));
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.14), new THREE.MeshBasicMaterial({ color }));
    graph.add(line, marker);
    edges.push({ curve, marker });
  }
  function branch(items, direction, color, shape, label) {
    items.forEach((item, i) => {
      const angle = direction + (i - (items.length - 1) / 2) * Math.min(.56, 1.35 / items.length);
      const radius = 4.5 + (items.length > 6 ? i % 2 : 0);
      const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      node(position, label(item, i), shape(), color);
      connect(position, color);
    });
  }
  return result => {
    graph.traverse(object => {
      object.geometry?.dispose();
      object.material?.map?.dispose();
      object.material?.dispose();
    });
    graph.clear();
    edges = [];
    node(origin, 'VPCF', new THREE.BoxGeometry(.75, .75, .75), '#f6df9c');
    const points = result.controlPoints;
    const children = result.references.filter(ref => ref.child);
    const emitters = result.classes['Эмиттеры'] || [];
    branch(points, Math.PI, '#71dec6', () => new THREE.SphereGeometry(.21, 16, 8), point => `CP ${point.id}`);
    branch(children, 0, '#c9a8ff', () => new THREE.OctahedronGeometry(.28), (_, i) => `Child ${i + 1}`);
    branch(emitters, Math.PI / 2, '#ffab73', () => new THREE.BoxGeometry(.32, .32, .32), (_, i) => `Emitter ${i + 1}`);
    info.textContent = `Контрольные точки — ${points.length} · Эмиттеры — ${emitters.length} · Дочерние эффекты — ${children.length}`;
    timeline.disabled = toggle.disabled = !edges.length;
    previousTime = undefined;
    showFrame(0);
  };
}
