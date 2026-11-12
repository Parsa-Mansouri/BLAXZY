"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Sheet, Skeleton, cn } from "@/ui";
import { AssetThumb } from "../../_components/asset-thumb";
import { loadPickerAssetsAction, type PickerAsset } from "../actions";

/**
 * The project's ready characters, places and props as a grid of sheets; choose any number up to
 * the room left on the shot. Mounted only while open, so it starts with nothing chosen.
 */
export function AssetPickerSheet({
  open,
  onOpenChange,
  projectId,
  attachedIds,
  room,
  maxAssets,
  saving,
  serverError,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  attachedIds: string[];
  /** How many more assets the shot can take. */
  room: number;
  maxAssets: number;
  saving: boolean;
  serverError: string | null;
  onConfirm: (assetIds: string[]) => void;
}) {
  const [items, setItems] = useState<PickerAsset[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void loadPickerAssetsAction(projectId, null).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(result.data.items);
      setCursor(result.data.nextCursor);
    });
  }, [open, projectId]);

  function more() {
    if (!cursor) return;
    setError(null);
    startLoading(async () => {
      const result = await loadPickerAssetsAction(projectId, cursor);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((list) => [...(list ?? []), ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  function toggle(id: string) {
    setSelected((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id);
      return list.length >= room ? list : [...list, id];
    });
  }

  const available = (items ?? []).filter((item) => !attachedIds.includes(item.id));
  const full = selected.length >= room;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Add Asset"
      description={`Choose the characters, places and props that appear in this shot. A shot can use up to ${maxAssets}. It is prepared again with the new choice.`}
      footer={
        <>
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={selected.length === 0}
            onClick={() => onConfirm([...attachedIds, ...selected])}
          >
            {selected.length > 1 ? `Add ${selected.length} Assets` : "Add Asset"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {items === null ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="aspect-video" />
                <Skeleton className="h-4 w-2/3 rounded-paper" />
              </div>
            ))}
          </div>
        ) : available.length === 0 && !cursor ? (
          <p className="text-body text-label-2">
            Every ready asset is already in this shot. Finish more assets in Pre-production to add
            them.
          </p>
        ) : (
          <ul
            aria-label="Ready assets"
            className="grid max-h-[50dvh] grid-cols-2 gap-x-3 gap-y-4 overflow-y-auto p-1 sm:grid-cols-3"
          >
            {available.map((item) => {
              const checked = selected.includes(item.id);
              const blocked = !checked && full;
              return (
                <li key={item.id} className="min-w-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-disabled={blocked || undefined}
                    onClick={() => (blocked ? undefined : toggle(item.id))}
                    className={cn(
                      "group/pick flex w-full min-w-0 press flex-col gap-1.5 rounded-tile text-left focus-ring outline-offset-2",
                      blocked && "opacity-40",
                    )}
                  >
                    <AssetThumb
                      fileId={item.thumbnailFileId}
                      className={cn(
                        "w-full rounded-tile",
                        checked && "outline-2 -outline-offset-2 outline-brand",
                      )}
                    />
                    <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-secondary text-label">
                      {checked ? (
                        <Check
                          aria-hidden
                          strokeWidth={1.5}
                          className="size-(--icon) shrink-0 text-brand"
                        />
                      ) : null}
                      <span className="truncate">{item.name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {loading
              ? Array.from({ length: 3 }, (_, i) => (
                  <li key={`pending-${i}`} aria-hidden className="flex flex-col gap-1.5">
                    <Skeleton className="aspect-video" />
                    <Skeleton className="h-4 w-2/3 rounded-paper" />
                  </li>
                ))
              : null}
          </ul>
        )}
        {cursor ? (
          <div>
            <Button size="small" onClick={more} loading={loading}>
              Load More
            </Button>
          </div>
        ) : null}
        {full && room > 0 ? (
          <p className="text-secondary text-label-2">That is as many as this shot can use.</p>
        ) : null}
        {error || serverError ? (
          <p role="alert" className="text-secondary text-failed">
            {error ?? serverError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
