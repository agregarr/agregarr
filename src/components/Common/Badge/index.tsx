import Link from 'next/link';
import React from 'react';

interface BadgeProps {
  badgeType?:
    | 'default'
    | 'primary'
    | 'danger'
    | 'warning'
    | 'success'
    | 'dark'
    | 'light';
  className?: string;
  href?: string;
  children: React.ReactNode;
}

const Badge = (
  { badgeType = 'default', className, href, children }: BadgeProps,
  ref?: React.Ref<HTMLElement>
) => {
  const badgeStyle = [
    'px-2 inline-flex text-xs leading-5 font-semibold rounded-full whitespace-nowrap',
  ];

  if (href) {
    badgeStyle.push('transition cursor-pointer !no-underline');
  } else {
    badgeStyle.push('cursor-default');
  }

  switch (badgeType) {
    case 'danger':
      badgeStyle.push('bg-transparent border border-red-500 !text-red-300');
      if (href) {
        badgeStyle.push('hover:bg-red-500 hover:bg-opacity-20');
      }
      break;
    case 'primary':
      badgeStyle.push(
        'bg-orange-500 bg-opacity-80 border-orange-500 border !text-orange-100'
      );
      if (href) {
        badgeStyle.push('hover:bg-orange-500 hover:bg-opacity-100');
      }
      break;
    case 'warning':
      badgeStyle.push('bg-transparent border border-orange-500 !text-gray-300');
      if (href) {
        badgeStyle.push('hover:bg-orange-500 hover:bg-opacity-20');
      }
      break;
    case 'success':
      badgeStyle.push('bg-transparent border border-green-500 !text-green-300');
      if (href) {
        badgeStyle.push('hover:bg-green-500 hover:bg-opacity-20');
      }
      break;
    case 'dark':
      badgeStyle.push('bg-stone-900 !text-gray-400');
      if (href) {
        badgeStyle.push('hover:bg-stone-800');
      }
      break;
    case 'light':
      badgeStyle.push('bg-gray-700 !text-gray-300');
      if (href) {
        badgeStyle.push('hover:bg-gray-600');
      }
      break;
    default:
      badgeStyle.push('bg-transparent border border-gray-500 !text-gray-300');
      if (href) {
        badgeStyle.push('hover:bg-gray-500 hover:bg-opacity-20');
      }
  }

  if (className) {
    badgeStyle.push(className);
  }

  if (href?.includes('://')) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </a>
    );
  } else if (href) {
    return (
      <Link href={href}>
        <a
          className={badgeStyle.join(' ')}
          ref={ref as React.Ref<HTMLAnchorElement>}
        >
          {children}
        </a>
      </Link>
    );
  } else {
    return (
      <span
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLSpanElement>}
      >
        {children}
      </span>
    );
  }
};

export default React.forwardRef(Badge) as typeof Badge;
