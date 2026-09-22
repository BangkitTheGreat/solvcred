import type { ReactElement } from 'react';

// One authored stroke set (24px grid, 1.75 stroke, round joins) so every status reads as the same family.
const PATHS = {
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.4 2.7 2.7L16.2 9.4" /></>,
  circle: <circle cx="12" cy="12" r="8" />,
  x: <><circle cx="12" cy="12" r="9" /><path d="m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="M5.7 5.7 18.3 18.3" /></>,
  alert: <><path d="M10.3 4.2 2.9 17.3A2 2 0 0 0 4.6 20.3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4.2M12 16.8v.1" /></>,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2 1-1.2 1.8v.3M12 16.9v.1" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.8 4.8" /></>,
  pause: <><circle cx="12" cy="12" r="9" /><path d="M10 9.2v5.6M14 9.2v5.6" /></>,
  shield: <><path d="M12 3.2 5 5.9v5.4c0 4.4 2.9 7.9 7 9.5 4.1-1.6 7-5.1 7-9.5V5.9l-7-2.7Z" /></>,
  file: <><path d="M14 3.2H7.2a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8l-4.8-4.8Z" /><path d="M14 3.2V8h4.8" /></>,
  fileCheck: <><path d="M14 3.2H7.2a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8l-4.8-4.8Z" /><path d="M14 3.2V8h4.8M9.3 14.2l1.9 1.9 3.6-3.7" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.2V12l3.1 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.2M12 7.8v.1" /></>,
  download: <><path d="M12 4v11m-4.6-4.4L12 15.2l4.6-4.6M5 19.8h14" /></>,
  upload: <><path d="M12 15.6V4.4M7.4 9 12 4.4 16.6 9M5 19.8h14" /></>,
  copy: <><rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2" /><path d="M15.4 8.6V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.4a2 2 0 0 0 2 2h2.6" /></>,
  key: <><circle cx="8" cy="15.5" r="3.8" /><path d="m10.8 12.8 8.7-8.7M16.2 7.4l2.4 2.4M13.8 9.8l2 2" /></>,
  wallet: <><path d="M4 7.2A2.2 2.2 0 0 1 6.2 5h11v3" /><rect x="4" y="8" width="16.5" height="11.5" rx="2" /><path d="M16.3 13.8h.1" /></>,
  refresh: <><path d="M19.6 12.4a7.6 7.6 0 1 1-2.2-5.8l2.2 2.1" /><path d="M19.8 4.6v4.3h-4.3" /></>,
  lock: <><rect x="5" y="10.8" width="14" height="9.4" rx="2" /><path d="M8.2 10.8V8a3.8 3.8 0 0 1 7.6 0v2.8" /></>,
  link: <><path d="M14 4h6v6M20 4l-8.5 8.5M18.5 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h4.5" /></>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, label }: { readonly name: IconName; readonly size?: number; readonly label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {PATHS[name]}
    </svg>
  );
}
