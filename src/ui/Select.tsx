"use client";

import type { ReactNode } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import {
  controlHeight,
  controlSurface,
  controlText,
  popupSurface,
  type ControlSize,
} from "./styles";

export interface SelectOption {
  value: string;
  label: string;
  /** Second line under the label. */
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  /** Selected value, or null for none (controlled). */
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** true, false, or "auto" (default): searchable once there are more than 8 options. */
  searchable?: boolean | "auto";
  searchPlaceholder?: string;
  emptyText?: string;
  size?: ControlSize;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

const AUTO_SEARCH_THRESHOLD = 8;

function OptionBody({ option }: { option: SelectOption }) {
  return (
    <>
      {option.icon ? (
        <span className="mt-0.5 shrink-0 text-fg-muted [&_svg]:size-4">{option.icon}</span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{option.label}</span>
        {option.description ? (
          <span className="text-xs text-fg-subtle">{option.description}</span>
        ) : null}
      </span>
    </>
  );
}

function TriggerBody({
  option,
  placeholder,
}: {
  option: SelectOption | undefined;
  placeholder: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
      {option ? (
        <>
          {option.icon ? (
            <span className="shrink-0 text-fg-muted [&_svg]:size-4">{option.icon}</span>
          ) : null}
          <span className="truncate">{option.label}</span>
        </>
      ) : (
        <span className="truncate text-fg-subtle">{placeholder}</span>
      )}
    </span>
  );
}

const itemClass =
  "grid cursor-default select-none grid-cols-[1rem_1fr] items-start gap-2 rounded-sm px-2 py-2 text-sm outline-none " +
  "data-[highlighted]:bg-hover data-[disabled]:opacity-40";

const triggerClass = (size: ControlSize, className?: string) =>
  cn(
    controlSurface,
    controlHeight[size],
    controlText,
    "cursor-default justify-between py-2 pr-2.5 pl-3 text-left outline-none",
    "data-[popup-open]:border-focus",
    className,
  );

export function Select({
  options,
  value,
  onValueChange,
  placeholder = "Choose one",
  searchable = "auto",
  searchPlaceholder = "Search",
  emptyText = "Nothing matches",
  size = "md",
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const control = useFieldControl({ id, disabled });
  const selected = options.find((o) => o.value === value);
  const isSearchable = searchable === "auto" ? options.length > AUTO_SEARCH_THRESHOLD : searchable;

  const chevron = <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />;

  if (isSearchable) {
    return (
      <Combobox.Root<SelectOption>
        items={options}
        value={selected ?? null}
        onValueChange={(next) => {
          if (next) onValueChange(next.value);
        }}
        itemToStringLabel={(o) => o.label}
        itemToStringValue={(o) => o.value}
        isItemEqualToValue={(a, b) => a.value === b.value}
        disabled={control.disabled}
      >
        <Combobox.Trigger
          id={control.id}
          aria-label={ariaLabel}
          aria-describedby={control["aria-describedby"]}
          aria-invalid={control["aria-invalid"]}
          className={triggerClass(size, className)}
        >
          <TriggerBody option={selected} placeholder={placeholder} />
          {chevron}
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner align="start" sideOffset={6} className="z-(--z-popover)">
            <Combobox.Popup
              aria-label={ariaLabel ?? placeholder}
              className={cn(
                popupSurface,
                "w-(--anchor-width) max-w-(--available-width) min-w-60 p-1",
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-2 pt-1 pb-1.5">
                <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                <Combobox.Input
                  placeholder={searchPlaceholder}
                  className="h-9 min-w-0 flex-1 bg-transparent text-base text-fg outline-none sm:text-sm"
                />
              </div>
              <Combobox.Empty className="px-3 py-6 text-center text-sm text-fg-subtle">
                {emptyText}
              </Combobox.Empty>
              <Combobox.List className="max-h-72 overflow-y-auto overscroll-contain pt-1 outline-none">
                {(option: SelectOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    disabled={option.disabled}
                    className={itemClass}
                  >
                    <Combobox.ItemIndicator className="mt-0.5">
                      <Check aria-hidden="true" className="size-4 text-accent-text" />
                    </Combobox.ItemIndicator>
                    <span className="col-start-2 flex items-start gap-3">
                      <OptionBody option={option} />
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    );
  }

  return (
    <BaseSelect.Root<string>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={control.disabled}
    >
      <BaseSelect.Trigger
        id={control.id}
        aria-label={ariaLabel}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"]}
        className={triggerClass(size, className)}
      >
        <TriggerBody option={selected} placeholder={placeholder} />
        {chevron}
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          alignItemWithTrigger={false}
          align="start"
          sideOffset={6}
          className="z-(--z-popover)"
        >
          <BaseSelect.Popup
            className={cn(popupSurface, "max-w-(--available-width) min-w-(--anchor-width) p-1")}
          >
            <BaseSelect.List className="max-h-72 overflow-y-auto overscroll-contain outline-none">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  className={itemClass}
                >
                  <BaseSelect.ItemIndicator className="mt-0.5">
                    <Check aria-hidden="true" className="size-4 text-accent-text" />
                  </BaseSelect.ItemIndicator>
                  <span className="col-start-2 flex items-start gap-3">
                    {option.icon ? (
                      <span className="mt-0.5 shrink-0 text-fg-muted [&_svg]:size-4">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <BaseSelect.ItemText className="truncate">{option.label}</BaseSelect.ItemText>
                      {option.description ? (
                        <span className="text-xs text-fg-subtle">{option.description}</span>
                      ) : null}
                    </span>
                  </span>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
