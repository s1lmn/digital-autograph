const signatures = [
  'M18 82C31 65 63 10 69 16S30 100 41 89c15-14 23-39 25-36 4 4-9 24-3 22 11-3 18-22 19-18 2 5-9 18-3 16 5-2 14-16 16-13 2 5-7 14-1 12l21-10m-78 36c34-12 70-19 103-18',
  'M19 77C44 22 71 13 72 28S24 80 29 68c8-16 31-17 34-8 2 7-8 15-2 15s13-18 16-16c2 2-5 15 0 13 6-2 12-15 15-13s-6 14 0 12l22-12m-91 32 105-14',
  'M16 79C41 42 68 19 71 29S42 86 51 82c9-5 17-27 22-26 4 2-6 17-1 17 5-1 10-12 13-12s-2 13 4 9l25-14m-85 33c27-12 60-17 99-14M46 42l44-3',
  'M25 78C18 59 31 26 50 22s10 20-4 32c-9 8-17 15-12 22 5 9 24-3 27-12s-4-6-6-1 0 13 7 12c8-1 13-17 16-16 2 2-5 13 0 12l16-12c4-3-3 14 2 12l26-13M21 92l111-14',
];
export function SignatureArt({
  variant = 0,
  className,
}: {
  variant?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 150 110"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={signatures[variant % signatures.length]}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
