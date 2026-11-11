/**
 * Option thumbnails for the Style screen. Abstract drawings of each treatment, in the label
 * colours (they brighten when chosen). They are not film stills and never stand in for results.
 */

const svgProps = {
  viewBox: "0 0 160 90",
  "aria-hidden": true,
  className: "size-full",
  preserveAspectRatio: "xMidYMid slice",
} as const;

/** Soft light in a wide frame with letterbox bars. */
export function CinematicThumbnail() {
  return (
    <span className="block size-full">
      <svg {...svgProps}>
        <defs>
          <radialGradient id="thumb-cinematic" cx="0.68" cy="0.42" r="0.7">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="160" height="90" fill="url(#thumb-cinematic)" />
        <rect y="62" width="160" height="28" className="fill-ground" opacity="0.55" />
        <rect y="0" width="160" height="11" className="fill-elevated" />
        <rect y="79" width="160" height="11" className="fill-elevated" />
        <rect x="0" y="61.5" width="160" height="1" fill="currentColor" opacity="0.35" />
      </svg>
    </span>
  );
}

/** A shaded sphere and cube on a soft floor shadow. */
export function Animation3dThumbnail() {
  return (
    <span className="block size-full">
      <svg {...svgProps}>
        <defs>
          <radialGradient id="thumb-3d-sphere" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.12" />
          </radialGradient>
        </defs>
        <ellipse cx="72" cy="72" rx="42" ry="6" fill="currentColor" opacity="0.14" />
        <circle cx="68" cy="44" r="25" fill="url(#thumb-3d-sphere)" />
        <polygon points="104,46 124,56 124,76 104,66" fill="currentColor" opacity="0.28" />
        <polygon points="124,56 140,48 140,68 124,76" fill="currentColor" opacity="0.14" />
        <polygon points="104,46 120,38 140,48 124,56" fill="currentColor" opacity="0.5" />
      </svg>
    </span>
  );
}

/** Flat colour shapes with an ink outline and speed lines. */
export function Animation2dThumbnail() {
  return (
    <span className="block size-full">
      <svg {...svgProps}>
        <circle cx="104" cy="34" r="19" fill="currentColor" opacity="0.85" />
        <circle
          cx="108"
          cy="38"
          r="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.9"
        />
        <path
          d="M0 74 C30 50 52 54 80 70 S130 64 160 56 V90 H0 Z"
          fill="currentColor"
          opacity="0.3"
        />
        <path
          d="M0 74 C30 50 52 54 80 70 S130 64 160 56"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M16 24 H48 M24 33 H56 M12 42 H34"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}

/** A frame drawn at the real ratio inside the thumbnail. */
export function FrameThumbnail({ orientation }: { orientation: "landscape" | "portrait" }) {
  return (
    <span className="flex size-full items-center justify-center">
      <span
        aria-hidden="true"
        className={
          orientation === "landscape"
            ? "aspect-video w-3/5 rounded-control-inner bg-fill-2 ring-1 ring-current/40 ring-inset"
            : "aspect-[9/16] h-4/5 rounded-control-inner bg-fill-2 ring-1 ring-current/40 ring-inset"
        }
      />
    </span>
  );
}
