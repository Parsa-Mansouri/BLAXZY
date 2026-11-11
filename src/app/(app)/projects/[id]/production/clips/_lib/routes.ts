/** Routes of the Production stage the clips screens link to. */
export const boardHref = (projectId: string) => `/projects/${projectId}/production/clips`;

export const clipHref = (projectId: string, lineageId: string) =>
  `${boardHref(projectId)}/${encodeURIComponent(lineageId)}`;

export const finishedHref = (projectId: string) => `/projects/${projectId}/production/finished`;

export const blocksHref = (projectId: string) => `/projects/${projectId}/production/blocks`;
