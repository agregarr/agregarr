import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';

interface AlertProps {
  title?: React.ReactNode;
  type?: 'warning' | 'info' | 'error';
  children?: React.ReactNode;
}

const Alert = ({ title, children, type }: AlertProps) => {
  let design = {
    bgColor:
      'border border-orange-500 backdrop-blur bg-orange-400 bg-opacity-20',
    titleColor: 'text-orange-100',
    textColor: 'text-orange-300',
    svg: <ExclamationTriangleIcon className="h-5 w-5" />,
  };

  switch (type) {
    case 'info':
      design = {
        bgColor:
          'border border-slate-500 backdrop-blur bg-slate-400 bg-opacity-20',
        titleColor: 'text-slate-100',
        textColor: 'text-slate-300',
        svg: <InformationCircleIcon className="h-5 w-5" />,
      };
      break;
    case 'error':
      design = {
        bgColor: 'bg-red-600',
        titleColor: 'text-red-100',
        textColor: 'text-red-300',
        svg: <XCircleIcon className="h-5 w-5" />,
      };
      break;
  }

  return (
    <div className={`mb-4 rounded-md p-4 ${design.bgColor}`}>
      <div className="flex">
        <div className={`flex-shrink-0 ${design.titleColor}`}>{design.svg}</div>
        <div className="ml-3">
          {title && (
            <div className={`text-sm font-medium ${design.titleColor}`}>
              {title}
            </div>
          )}
          {children && (
            <div className={`mt-2 text-sm first:mt-0 ${design.textColor}`}>
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Alert;
