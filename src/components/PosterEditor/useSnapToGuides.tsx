import type Konva from 'konva';
import type React from 'react';
import { useCallback, useState } from 'react';
import { Line } from 'react-konva';

interface SnapLine {
  id: string;
  orientation: 'vertical' | 'horizontal';
  position: number;
}

interface SnapResult {
  x: number;
  y: number;
  snapLines: SnapLine[];
}

const SNAP_THRESHOLD = 8;

export function useSnapToGuides(
  canvasWidth: number,
  canvasHeight: number,
  enabled: boolean
) {
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);

  const calculateSnap = useCallback(
    (node: Konva.Node, otherNodes: Konva.Node[]): SnapResult => {
      if (!enabled) {
        return {
          x: node.x(),
          y: node.y(),
          snapLines: [],
        };
      }

      // Use unscaled coordinates (not getClientRect which returns scaled screen pixels)
      const nodeX = node.x();
      const nodeY = node.y();
      const nodeWidth = node.width();
      const nodeHeight = node.height();
      const nodeCenterX = nodeX + nodeWidth / 2;
      const nodeCenterY = nodeY + nodeHeight / 2;
      const nodeRight = nodeX + nodeWidth;
      const nodeBottom = nodeY + nodeHeight;

      let newX = nodeX;
      let newY = nodeY;
      const lines: SnapLine[] = [];

      // Canvas edge snapping
      // Horizontal (vertical lines)
      if (Math.abs(nodeX) < SNAP_THRESHOLD) {
        newX = 0;
        lines.push({
          id: 'left-edge',
          orientation: 'vertical',
          position: 0,
        });
      } else if (Math.abs(nodeRight - canvasWidth) < SNAP_THRESHOLD) {
        newX = canvasWidth - nodeWidth;
        lines.push({
          id: 'right-edge',
          orientation: 'vertical',
          position: canvasWidth,
        });
      } else if (Math.abs(nodeCenterX - canvasWidth / 2) < SNAP_THRESHOLD) {
        newX = canvasWidth / 2 - nodeWidth / 2;
        lines.push({
          id: 'center-x',
          orientation: 'vertical',
          position: canvasWidth / 2,
        });
      }

      // Vertical (horizontal lines)
      if (Math.abs(nodeY) < SNAP_THRESHOLD) {
        newY = 0;
        lines.push({
          id: 'top-edge',
          orientation: 'horizontal',
          position: 0,
        });
      } else if (Math.abs(nodeBottom - canvasHeight) < SNAP_THRESHOLD) {
        newY = canvasHeight - nodeHeight;
        lines.push({
          id: 'bottom-edge',
          orientation: 'horizontal',
          position: canvasHeight,
        });
      } else if (Math.abs(nodeCenterY - canvasHeight / 2) < SNAP_THRESHOLD) {
        newY = canvasHeight / 2 - nodeHeight / 2;
        lines.push({
          id: 'center-y',
          orientation: 'horizontal',
          position: canvasHeight / 2,
        });
      }

      // Object-to-object snapping
      for (const otherNode of otherNodes) {
        if (otherNode === node || !otherNode.id()) continue;

        const otherX = otherNode.x();
        const otherY = otherNode.y();
        const otherWidth = otherNode.width();
        const otherHeight = otherNode.height();
        const otherCenterX = otherX + otherWidth / 2;
        const otherCenterY = otherY + otherHeight / 2;
        const otherRight = otherX + otherWidth;
        const otherBottom = otherY + otherHeight;

        // Horizontal alignment
        if (Math.abs(nodeX - otherX) < SNAP_THRESHOLD) {
          newX = otherX;
          lines.push({
            id: `left-${otherNode.id()}`,
            orientation: 'vertical',
            position: otherX,
          });
        } else if (Math.abs(nodeRight - otherRight) < SNAP_THRESHOLD) {
          newX = otherRight - nodeWidth;
          lines.push({
            id: `right-${otherNode.id()}`,
            orientation: 'vertical',
            position: otherRight,
          });
        } else if (Math.abs(nodeCenterX - otherCenterX) < SNAP_THRESHOLD) {
          newX = otherCenterX - nodeWidth / 2;
          lines.push({
            id: `center-x-${otherNode.id()}`,
            orientation: 'vertical',
            position: otherCenterX,
          });
        }

        // Vertical alignment
        if (Math.abs(nodeY - otherY) < SNAP_THRESHOLD) {
          newY = otherY;
          lines.push({
            id: `top-${otherNode.id()}`,
            orientation: 'horizontal',
            position: otherY,
          });
        } else if (Math.abs(nodeBottom - otherBottom) < SNAP_THRESHOLD) {
          newY = otherBottom - nodeHeight;
          lines.push({
            id: `bottom-${otherNode.id()}`,
            orientation: 'horizontal',
            position: otherBottom,
          });
        } else if (Math.abs(nodeCenterY - otherCenterY) < SNAP_THRESHOLD) {
          newY = otherCenterY - nodeHeight / 2;
          lines.push({
            id: `center-y-${otherNode.id()}`,
            orientation: 'horizontal',
            position: otherCenterY,
          });
        }
      }

      return { x: newX, y: newY, snapLines: lines };
    },
    [canvasWidth, canvasHeight, enabled]
  );

  const clearSnapLines = useCallback(() => {
    setSnapLines([]);
  }, []);

  const updateSnapLines = useCallback((lines: SnapLine[]) => {
    setSnapLines(lines);
  }, []);

  return {
    snapLines,
    calculateSnap,
    clearSnapLines,
    updateSnapLines,
  };
}

// Component to render snap lines
export const SnapLines: React.FC<{
  lines: SnapLine[];
  canvasWidth: number;
  canvasHeight: number;
}> = ({ lines, canvasWidth, canvasHeight }) => {
  return (
    <>
      {lines.map((line) => {
        if (line.orientation === 'vertical') {
          return (
            <Line
              key={line.id}
              points={[line.position, 0, line.position, canvasHeight]}
              stroke="#ff6b35"
              strokeWidth={2}
              dash={[5, 5]}
              listening={false}
            />
          );
        } else {
          return (
            <Line
              key={line.id}
              points={[0, line.position, canvasWidth, line.position]}
              stroke="#ff6b35"
              strokeWidth={2}
              dash={[5, 5]}
              listening={false}
            />
          );
        }
      })}
    </>
  );
};
