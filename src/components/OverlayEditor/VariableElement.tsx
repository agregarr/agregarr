import { fontLoader } from '@app/utils/fontLoader';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef, useState } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type {
  OverlayElement,
  OverlayRenderContext,
  OverlayVariableElementProps,
} from './types';
import { AVAILABLE_VARIABLES } from './types';

interface VariableElementComponentProps {
  element: OverlayElement;
  renderContext?: OverlayRenderContext;
  isSelected: boolean;
  onSelect: (node: Konva.Node) => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number
  ) => void;
}

export const VariableElement: React.FC<VariableElementComponentProps> = ({
  element,
  renderContext,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as OverlayVariableElementProps;
  const groupRef = useRef<Konva.Group | null>(null);
  const [fontLoaded, setFontLoaded] = useState(false);

  // Load custom font if needed
  useEffect(() => {
    if (props.fontFamily && !fontLoader.isFontLoaded(props.fontFamily)) {
      fontLoader
        .waitForFont(props.fontFamily.replace(/'/g, ''), 1000)
        .then(() => setFontLoaded(true))
        .catch(() => setFontLoaded(true)); // Continue with fallback
    } else {
      setFontLoaded(true);
    }
  }, [props.fontFamily]);

  // Format date based on format string
  const formatDate = (date: Date | string, format: string): string => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    const monthNames = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ];
    const monthNamesFull = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayNamesFull = [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ];

    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const monthName = monthNames[dateObj.getMonth()];
    const monthNameFull = monthNamesFull[dateObj.getMonth()];
    const dayName = dayNames[dateObj.getDay()];
    const dayNameFull = dayNamesFull[dateObj.getDay()];

    const pad = (n: number) => String(n).padStart(2, '0');

    switch (format) {
      case 'YYYY-MM-DD':
        return `${year}-${pad(month)}-${pad(day)}`;
      case 'YYYY/MM/DD':
        return `${year}/${pad(month)}/${pad(day)}`;
      case 'DD-MM-YYYY':
        return `${pad(day)}-${pad(month)}-${year}`;
      case 'DD/MM/YYYY':
        return `${pad(day)}/${pad(month)}/${year}`;
      case 'MM/DD/YYYY':
        return `${pad(month)}/${pad(day)}/${year}`;
      case 'DD/MM':
        return `${pad(day)}/${pad(month)}`;
      case 'D/M':
        return `${day}/${month}`;
      case 'MM/DD':
        return `${pad(month)}/${pad(day)}`;
      case 'M/D':
        return `${month}/${day}`;
      case 'DDD DD/MM':
        return `${dayName} ${pad(day)}/${pad(month)}`;
      case 'DDD D/M':
        return `${dayName} ${day}/${month}`;
      case 'DDD MM/DD':
        return `${dayName} ${pad(month)}/${pad(day)}`;
      case 'DDD M/D':
        return `${dayName} ${month}/${day}`;
      case 'DDDD':
        return dayNameFull;
      case 'DDD':
        return dayName;
      case 'MMM DD':
        return `${monthName} ${pad(day)}`;
      case 'DD MMM':
        return `${pad(day)} ${monthName}`;
      case 'MMM DD, YYYY':
        return `${monthName} ${pad(day)}, ${year}`;
      case 'DD MMM YYYY':
        return `${pad(day)} ${monthName} ${year}`;
      case 'MMMM DD, YYYY':
        return `${monthNameFull} ${pad(day)}, ${year}`;
      case 'DD MMMM YYYY':
        return `${pad(day)} ${monthNameFull} ${year}`;
      default:
        return `${monthName} ${pad(day)}`;
    }
  };

  // Build display text from segments
  const getDisplayText = (): string => {
    let text = '';

    // Build array of all available variables for lookup
    const allVars = [
      ...AVAILABLE_VARIABLES.ratings,
      ...AVAILABLE_VARIABLES.metadata,
      ...AVAILABLE_VARIABLES.video,
      ...AVAILABLE_VARIABLES.audio,
      ...AVAILABLE_VARIABLES.language,
      ...AVAILABLE_VARIABLES.file,
      ...AVAILABLE_VARIABLES.playback,
      ...AVAILABLE_VARIABLES['coming-soon'],
      ...AVAILABLE_VARIABLES.status,
    ];

    for (const segment of props.segments) {
      if (segment.type === 'text') {
        // Static text segment - use value as-is
        text += segment.value || '';
      } else if (segment.type === 'variable' && segment.field) {
        // Variable segment - look up value in context
        if (renderContext) {
          const value = renderContext[segment.field];
          if (value !== undefined && value !== null) {
            // Check if this is a date field with custom format
            const isDateField = [
              'releaseDate',
              'lastPlayed',
              'dateAdded',
            ].includes(segment.field);
            if (
              isDateField &&
              (typeof value === 'string' || value instanceof Date)
            ) {
              // Use specified format or default to 'MMM DD'
              text += formatDate(value, segment.format || 'MMM DD');
            } else if (typeof value === 'number') {
              // Format numbers appropriately
              if (segment.field === 'imdbRating') {
                // IMDb ratings should show decimal (e.g., 8.7)
                text += value.toFixed(1);
              } else if (
                segment.field.includes('Score') ||
                segment.field.includes('Rating')
              ) {
                // RT scores are percentages - no decimal needed (e.g., 89)
                text += Math.round(value).toString();
              } else {
                text += value.toString();
              }
            } else {
              text += String(value);
            }
          } else {
            // Fallback to example value if available
            const varInfo = allVars.find((v) => v.field === segment.field);
            text += varInfo?.example || `{${segment.field}}`;
          }
        } else {
          // No context - show example value instead of raw variable
          const varInfo = allVars.find((v) => v.field === segment.field);
          text += varInfo?.example || `{${segment.field}}`;
        }
      }
    }

    return text;
  };

  const displayText = getDisplayText();

  return (
    <Group
      ref={groupRef}
      id={element.id}
      x={element.x + element.width / 2}
      y={element.y + element.height / 2}
      offsetX={element.width / 2}
      offsetY={element.height / 2}
      width={element.width}
      height={element.height}
      rotation={element.rotation || 0}
      opacity={(props.opacity ?? 100) / 100}
      draggable
      onClick={() => {
        if (groupRef.current) {
          onSelect(groupRef.current);
        }
      }}
      onTap={() => {
        if (groupRef.current) {
          onSelect(groupRef.current);
        }
      }}
      onDragMove={() => {
        if (groupRef.current) {
          onDragMove(groupRef.current);
        }
      }}
      onDragEnd={(e: KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onDragEnd(node.x() - element.width / 2, node.y() - element.height / 2);
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (node) {
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          const rotation = node.rotation();

          const newWidth = Math.round(element.width * scaleX);
          const newHeight = Math.round(element.height * scaleY);

          node.scaleX(1);
          node.scaleY(1);

          onTransformEnd(
            node.x() - newWidth / 2,
            node.y() - newHeight / 2,
            newWidth,
            newHeight,
            rotation
          );
        }
      }}
    >
      {/* Hit area */}
      <Rect
        width={element.width}
        height={element.height}
        fill="rgba(0,0,0,0.01)"
        listening={true}
      />

      {/* Variable text */}
      {fontLoaded &&
        (() => {
          // Konva expects fontStyle to include bold (e.g., "bold", "italic", "bold italic")
          const fontStyle =
            props.fontWeight === 'bold'
              ? props.fontStyle === 'italic'
                ? 'bold italic'
                : 'bold'
              : props.fontStyle;

          return (
            <Text
              text={displayText}
              fontSize={props.fontSize}
              fontFamily={props.fontFamily}
              fontStyle={fontStyle}
              fill={props.color}
              align={props.textAlign}
              verticalAlign="middle"
              width={element.width}
              height={element.height}
              listening={false}
            />
          );
        })()}

      {/* Selection indicator */}
      {isSelected && (
        <Rect
          width={element.width}
          height={element.height}
          fill="transparent"
          stroke="#ff6b35"
          strokeWidth={2}
          listening={false}
        />
      )}
    </Group>
  );
};
