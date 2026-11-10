/** Small line icons for buttons. 20x20, currentColor. */
type P = { size?: number };
const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconFirst = ({ size }: P) => (
  <svg {...base(size)}><path d="M5 4v12M15 4.5L8.5 10l6.5 5.5" /></svg>
);
export const IconPrev = ({ size }: P) => (
  <svg {...base(size)}><path d="M12.5 4.5L7 10l5.5 5.5" /></svg>
);
export const IconNext = ({ size }: P) => (
  <svg {...base(size)}><path d="M7.5 4.5L13 10l-5.5 5.5" /></svg>
);
export const IconLast = ({ size }: P) => (
  <svg {...base(size)}><path d="M15 4v12M5 4.5l6.5 5.5L5 15.5" /></svg>
);
export const IconFlip = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 3v13M3 13l3 3 3-3M14 17V4M11 7l3-3 3 3" /></svg>
);
export const IconGear = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <path d="M8.6 2.5h2.8l.4 2.1c.5.2 1 .5 1.4.8l2-.7 1.4 2.4-1.6 1.4c.1.5.1 1 0 1.5l1.6 1.4-1.4 2.4-2-.7c-.4.3-.9.6-1.4.8l-.4 2.1H8.6l-.4-2.1c-.5-.2-1-.5-1.4-.8l-2 .7-1.4-2.4L5 11c-.1-.5-.1-1 0-1.5L3.4 8.1l1.4-2.4 2 .7c.4-.3.9-.6 1.4-.8z" />
    <circle cx="10" cy="10.25" r="2.3" />
  </svg>
);
export const IconRetry = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 10a6 6 0 1 0 2-4.5M4 3.5V6h2.5" /></svg>
);
export const IconBulb = ({ size }: P) => (
  <svg {...base(size)}><path d="M7.5 14h5M8 17h4M10 3a5 5 0 0 0-3 9c.6.5 1 1.1 1 2h4c0-.9.4-1.5 1-2a5 5 0 0 0-3-9z" /></svg>
);
export const IconPlay = ({ size }: P) => (
  <svg {...base(size)}><path d="M7 4.5v11l8.5-5.5z" fill="currentColor" stroke="none" /></svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}><path d="M5 5l10 10M15 5L5 15" /></svg>
);
export const IconDownload = ({ size }: P) => (
  <svg {...base(size)}><path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 16.5h12" /></svg>
);
export const IconBack = ({ size }: P) => (
  <svg {...base(size)}><path d="M8 5L3 10l5 5M3 10h14" /></svg>
);
export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6" /></svg>
);
export const IconKey = ({ size }: P) => (
  <svg {...base(size)}><path d="M10 3l1.9 4.2 4.6.4-3.5 3 1.1 4.5L10 12.8 5.9 15.1 7 10.6l-3.5-3 4.6-.4z" /></svg>
);
