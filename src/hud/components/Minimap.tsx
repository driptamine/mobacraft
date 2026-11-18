import type { JSX, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { world, PLAYER, camera, currentBounds } from '../../core/scene.js';
import { issueGroundOrder, isFlyArmed, setHudHover } from '../../core/input.js';
import { useHUDVersion } from '../useHUD.js';
import { MinimapPanel, MinimapCanvas, MinimapLabel } from '../primitives.jsx';

// Doom Spiral runs a straight-on camera (alpha 0: screen-right is -Z,
// far side is -X), so its minimap is transposed to match that view
// (world -Z on the right, -X on top). Every other map keeps the legacy
// mirror (+X left, +Z top) that matches the diagonal default camera.
// Mapping kept literal: minimap-flip.test.js.
export function doomSpiralMinimap(): boolean {
  return typeof window !== 'undefined' && /doom.?spiral/i.test((window as unknown as { _currentMapKey?: string })._currentMapKey || '');
}

function drawMinimap(canvasEl: HTMLCanvasElement | null): void {
  if (!canvasEl || !world) {
    return;
  }
  const ctx = canvasEl.getContext('2d');
  if (!ctx) {
    return;
  }
  const W = canvasEl.width;
  const H = canvasEl.height;
  const HALF = currentBounds();
  const doom = doomSpiralMinimap();
  const wx = (x: number, z: number): number => doom
    ? Math.round(((HALF - z) / (HALF * 2)) * W)
    : Math.round(((HALF - x) / (HALF * 2)) * W);
  const wy = (x: number, z: number): number => doom
    ? Math.round(((x + HALF) / (HALF * 2)) * H)
    : Math.round(((HALF - z) / (HALF * 2)) * H);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(4, 10, 22, 0.95)';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(80, 200, 255, 0.07)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i += 1) {
    const x = Math.round((i / 4) * W) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    const y = Math.round((i / 4) * H) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  world.query('strategicPoint').forEach((id: number) => {
    const sp = world.get(id, 'strategicPoint');
    if (!sp || !sp.position) {
      return;
    }
    const x = wx(sp.position.x, sp.position.z);
    const y = wy(sp.position.x, sp.position.z);
    const color = sp.owner == null ? 'rgba(255,255,255,0.3)' : (sp.owner === PLAYER ? '#44aaff' : '#ff4444');
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    if (sp.owner != null) {
      ctx.fillStyle = `${color}44`;
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
  });

  world.query('building').concat(world.query('structure')).forEach((id: number) => {
    const building = world.get(id, 'building') || world.get(id, 'structure');
    const mc = world.get(id, 'mesh');
    if (!mc?.root) {
      return;
    }
    const { position } = mc.root;
    ctx.fillStyle = building?.team === PLAYER ? 'rgba(80,200,255,0.55)' : '#f55';
    ctx.fillRect(wx(position.x, position.z) - 2, wy(position.x, position.z) - 2, 5, 5);
  });

  world.query('squad').forEach((id: number) => {
    const squad = world.get(id, 'squad');
    if (!squad || !squad.position) {
      return;
    }
    const x = wx(squad.position.x, squad.position.z);
    const y = wy(squad.position.x, squad.position.z);
    ctx.fillStyle = squad.team === PLAYER ? '#4af' : '#f55';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  world.query('builder').forEach((id: number) => {
    const builder = world.get(id, 'builder');
    const bmc = world.get(id, 'mesh');
    if (!bmc?.root) {
      return;
    }
    const { position } = bmc.root;
    ctx.fillStyle = builder?.team === PLAYER ? '#fc4' : '#f55';
    ctx.fillRect(wx(position.x, position.z) - 2, wy(position.x, position.z) - 2, 4, 4);
  });

  world.query('apc').forEach((id: number) => {
    const apc = world.get(id, 'apc');
    if (!apc || !apc.position) {
      return;
    }
    ctx.fillStyle = apc.team === PLAYER ? '#8f8' : '#f55';
    ctx.fillRect(wx(apc.position.x, apc.position.z) - 2, wy(apc.position.x, apc.position.z) - 2, 5, 5);
  });

  world.query('jet').forEach((id: number) => {
    const jet = world.get(id, 'jet');
    if (!jet || jet.team !== PLAYER || !jet.position) {
      return;
    }
    const x = wx(jet.position.x, jet.position.z);
    const y = wy(jet.position.x, jet.position.z);
    ctx.fillStyle = jet.selected ? '#fff' : '#88ddff';
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 3, y + 3);
    ctx.lineTo(x - 3, y + 3);
    ctx.closePath();
    ctx.fill();
  });

  if (camera) {
    const { target } = camera;
    const cx = wx(target.x, target.z);
    const cy = wy(target.x, target.z);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
  }
}

export function Minimap(): JSX.Element {
  const version = useHUDVersion('minimap');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    drawMinimap(canvasRef.current);
  }, [version]);

  // While the cursor is over the minimap, edge-pan must stay off: the panel
  // sits in the screen-edge zone, otherwise the camera drifts away from the
  // point being clicked. Blur resets the flag if the pointer leaves the page.
  useEffect(() => {
    const clear = () => setHudHover(false);
    window.addEventListener('blur', clear);
    return () => window.removeEventListener('blur', clear);
  }, []);

  const minimapWorld = (e: ReactMouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const normalizedX = (e.clientX - rect.left) / rect.width;
    const normalizedY = (e.clientY - rect.top) / rect.height;
    const HALF = currentBounds();
    if (doomSpiralMinimap()) {
      return new THREE.Vector3(normalizedY * HALF * 2 - HALF, 0, HALF - normalizedX * HALF * 2);
    }
    return new THREE.Vector3(HALF - normalizedX * HALF * 2, 0, HALF - normalizedY * HALF * 2);
  };

  const handleClick = (e: ReactMouseEvent) => {
    if (!camera) {
      return;
    }
    camera.target = minimapWorld(e);
  };

  const handleContextMenu = (e: ReactMouseEvent) => {
    // No Chrome menu over the minimap: right-click issues orders instead.
    e.preventDefault();
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    // Right-click on the minimap sends the selection there: same ground
    // order as a canvas right-click (formation, paint snap, capture).
    if (e.button !== 2 || !camera || isFlyArmed()) {
      return;
    }
    issueGroundOrder(minimapWorld(e));
  };

  return (
    <MinimapPanel onMouseEnter={() => setHudHover(true)} onMouseLeave={() => setHudHover(false)}>
      <MinimapLabel>MINIMAP</MinimapLabel>
      <MinimapCanvas ref={canvasRef} width={140} height={140} onClick={handleClick} onContextMenu={handleContextMenu} onMouseDown={handleMouseDown} />
    </MinimapPanel>
  );
}
