/** Approved Brew Guide accessory / step icons (Lucide-compatible 24×24). */

function IconShell({ className, children, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function DosingCupIcon(props) {
  return (
    <IconShell {...props}>
      <path d="M3 6h18" />
      <path d="M3 6v2h3M21 6v2h-3" />
      <path d="M6 6v12a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V6" />
    </IconShell>
  );
}

export function DosingFunnelIcon(props) {
  return (
    <IconShell {...props}>
      <ellipse cx="12" cy="8" rx="10" ry="3.5" />
      <path d="M2 8c2 3 3 5 3 8M22 8c-2 3-3 5-3 8" />
      <path d="M5 16a7 2.5 0 0 0 14 0" />
    </IconShell>
  );
}

export function RdtSprayIcon(props) {
  return (
    <IconShell {...props}>
      <rect x="7" y="11" width="10" height="11" rx="2" />
      <path d="M10 11V9h4v2" />
      <path d="M9 9h6" />
      <path d="M11 9V5h4v2" />
      <path d="M15 5h2" />
      <path d="M20 3h.01M21 6h.01M20 9h.01" />
    </IconShell>
  );
}

export function BlindShakerIcon(props) {
  return (
    <IconShell {...props}>
      <path d="M7 2h10" />
      <path d="M6 5h12V3.5" />
      <path d="M6 5V3.5" />
      <path d="M6 8h12v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8z" />
      <path d="M2.5 10c-1 1.5-1 3.5 0 5M21.5 10c1 1.5 1 3.5 0 5" />
    </IconShell>
  );
}

export function WdtToolIcon(props) {
  return (
    <IconShell {...props}>
      <rect x="6" y="2" width="12" height="7" rx="3" />
      <path d="M7.5 9v10M10.5 9v10M13.5 9v10M16.5 9v10" />
      <path d="M4 22h16" />
    </IconShell>
  );
}

export function DistributorIcon(props) {
  return (
    <IconShell {...props}>
      <rect x="9" y="5" width="6" height="4" rx="2" />
      <path d="M3 9h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
      <path d="M5 16v3h14v-3" />
    </IconShell>
  );
}

export function SelfLevellingTamperIcon(props) {
  return (
    <IconShell {...props}>
      <circle cx="12" cy="3.5" r="1.5" />
      <path d="M8 6h8l-2.5 7h-3L8 6z" />
      <path d="M5 13h14v4H5z" />
      <path d="M7 17v3h10v-3" />
    </IconShell>
  );
}

export function PuckScreenIcon(props) {
  return (
    <IconShell {...props}>
      <circle cx="12" cy="12" r="9" />
      <path
        strokeWidth="0.8"
        d="M10.2 6.6h.01M12 6.6h.01M13.8 6.6h.01M7.5 8.4h.01M9.3 8.4h.01M11.1 8.4h.01M12.9 8.4h.01M14.7 8.4h.01M16.5 8.4h.01M6.6 10.2h.01M8.4 10.2h.01M10.2 10.2h.01M12 10.2h.01M13.8 10.2h.01M15.6 10.2h.01M17.4 10.2h.01M5.7 12h.01M7.5 12h.01M9.3 12h.01M11.1 12h.01M12.9 12h.01M14.7 12h.01M16.5 12h.01M6.6 13.8h.01M8.4 13.8h.01M10.2 13.8h.01M12 13.8h.01M13.8 13.8h.01M15.6 13.8h.01M17.4 13.8h.01M7.5 15.6h.01M9.3 15.6h.01M11.1 15.6h.01M12.9 15.6h.01M14.7 15.6h.01M16.5 15.6h.01M10.2 17.4h.01M12 17.4h.01M13.8 17.4h.01"
      />
    </IconShell>
  );
}

export function CoffeeScaleIcon(props) {
  return (
    <IconShell {...props}>
      <rect x="2" y="15" width="20" height="5" rx="1.5" />
      <path d="M15 17.5h3" />
      <path d="M7 6h8v4a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3V6z" />
      <path d="M15 7h1a2 2 0 0 1 0 4h-1" />
    </IconShell>
  );
}

export function PortafilterIcon(props) {
  return (
    <IconShell {...props}>
      <circle cx="8" cy="12" r="6" />
      <circle cx="8" cy="12" r="3" />
      <path d="M14 11h7a1 1 0 0 1 0 2h-7" />
      <path d="M8 6V4.5M8 19.5V18" />
    </IconShell>
  );
}

export function GroupFlushIcon(props) {
  return (
    <IconShell {...props}>
      <rect x="5" y="2" width="14" height="5" rx="1" />
      <path d="M4 7h16v3H4z" />
      <path d="M8 13v2M12 13v4M16 13v2M8 19v2M16 19v2" />
    </IconShell>
  );
}

export function MilkPitcherIcon(props) {
  return (
    <IconShell {...props}>
      <path d="M6 4h10l1.5 1.5L20 5l-2 3v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4z" />
      <path d="M6 9H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" />
    </IconShell>
  );
}

export function HotChocolateIcon(props) {
  return (
    <IconShell {...props}>
      <path d="M4 10h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-6z" />
      <path d="M17 12h1a3 3 0 0 1 0 6h-1.5" />
      <path d="M4 10c3-2 4 2 6.5 0s3.5-2 6.5 0" />
      <path d="M8 3c1 1-1 2 0 3M13 3c1 1-1 2 0 3" />
    </IconShell>
  );
}
