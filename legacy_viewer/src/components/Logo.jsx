export function Logo({ className = '' }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Black background */}
      <rect width="64" height="64" rx="8" fill="#000000" />
      
      {/* White border */}
      <rect x="2" y="2" width="60" height="60" rx="6" fill="none" stroke="#ffffff" strokeWidth="2" />
      
      {/* Stylized C in white */}
      <path
        d="M44 24c-6.627 0-12 5.373-12 12s5.373 12 12 12c2.2 0 4.267-.62 6.02-1.69l-2.9-4.9A7.5 7.5 0 0 1 44 42c-4.142 0-7.5-3.358-7.5-7.5S39.858 27 44 27c1.46 0 2.82.42 3.98 1.15l2.9-4.9A11.95 11.95 0 0 0 44 24Z"
        fill="#ffffff"
      />
    </svg>
  );
}
