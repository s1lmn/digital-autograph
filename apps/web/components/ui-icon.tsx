const paths = {
  globe:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  pen: 'm15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3',
  theme: 'M12 3a9 9 0 1 0 0 18V3Zm0 0a9 9 0 0 1 0 18',
  history: 'M3 11a9 9 0 1 1 2 7M3 5v6h6m3-4v5l3 2',
  bell: 'M6 8a6 6 0 0 1 12 0c0 8 3 8 3 9H3c0-1 3-1 3-9Zm4 12h4',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  check: 'm5 12 4 4L19 6',
} as const;

export function Icon({
  name,
  size = 20,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="11" fill="currentColor" />
      <path
        d="M8 24C12 19 16 9 19 9c4 0-6 20-3 18 2-1 5-12 8-11 2 1-2 6 0 6l5-4M9 28l18-3"
        stroke="var(--brand-color-onPrimary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
