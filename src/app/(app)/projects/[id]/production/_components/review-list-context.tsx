"use client";

import { createContext, useContext } from "react";

/**
 * Lets a review page tell the list beside it (which lives in the route's layout and outlives a
 * move from shot to shot) to read the shots again after an action.
 */
export const ReviewListContext = createContext<() => void>(() => {});

export function useRefreshReviewList(): () => void {
  return useContext(ReviewListContext);
}
