import type { ReactNode } from 'react';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
        <path d="m20 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="3" cy="6" r=".5" />
        <circle cx="3" cy="12" r=".5" />
        <circle cx="3" cy="18" r=".5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v17h17M8 16v-5m5 5V6m5 10V9" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    logout: (
      <>
        <path d="M9 4H4v16h5m6-12 4 4-4 4m-6-4h10" />
      </>
    ),
    book: (
      <>
        <path d="M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3V4Zm18 0h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h5V4Z" />
      </>
    ),
    court: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 4v16M3 12h18M7 4v16m10-16v16" />
      </>
    ),
    lab: (
      <>
        <path d="M9 3h6m-5 0v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M7 15h10" />
      </>
    ),
    room: (
      <>
        <path d="M4 21V4l13-2v19M2 21h20M17 6h4v15M12 12v2" />
      </>
    ),
    health: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="M12 7v10M7 12h10" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.grid}
    </svg>
  );
}
export const typeIcon = (type: string) =>
  ({ sports_court: 'court', clinician: 'health', lab_instrument: 'lab', meeting_room: 'room' })[
    type
  ] ?? 'grid';
export function Status({ value }: { value: string }) {
  return (
    <span className={'bf-status ' + value}>
      <i />
      {value.replaceAll('_', ' ')}
    </span>
  );
}
export function Empty({
  icon = 'calendar',
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="bf-empty">
      <span className="bf-empty-icon">
        <Icon name={icon} size={27} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="bf-error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="bf-loading" role="status">
      <span />
      Loading your workspace…
    </div>
  );
}
