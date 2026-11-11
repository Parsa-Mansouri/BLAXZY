/**
 * A screen that is one composition fills the viewport below the toolbar: the project content
 * wrapper adds 32px above and 72px below, so the page is at least the rest of the viewport tall.
 * Put `flex-1` on the region that should grow.
 */
export const FILL_PAGE = "flex min-h-[calc(100dvh-var(--toolbar-h)-6.5rem)] flex-col";

/** The tallest a large picture may be and still fit beside the header on one screen. */
export const PICTURE_MAX_H = "max-h-[calc(100dvh-var(--toolbar-h)-15rem)]";
