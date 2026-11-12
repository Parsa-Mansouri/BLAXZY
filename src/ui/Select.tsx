"use client";

import type { ReactNode } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import { menuPad, menuRow, popupSurface } from "./styles";

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
  /** `regular` 28px or `large` 32px. */
  size?: "regular" | "large";
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

const AUTO_SEARCH_THRESHOLD = 8;

function OptionBody({ option, text }: { option: SelectOption; text: ReactNode }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      {option.icon ? (
        <span className="mt-px shrink-0 text-label-2 [&_svg]:size-(--icon)">{option.icon}</span>
      ) : null}
      <span className="flex min-w-0 flex-col py-1">
        {text}
        {option.description ? (
          <span className="text-callout text-label-2">{option.description}</span>
        ) : null}
      </span>
    </span>
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
            <span className="shrink-0 text-label-2 [&_svg]:size-(--icon)">{option.icon}</span>
          ) : null}
          <span className="truncate">{option.label}</span>
        </>
      ) : (
        <span className="truncate text-label-2">{placeholder}</span>
      )}
    </span>
  );
}

const itemClass = cn(menuRow, "grid grid-cols-[var(--icon)_1fr] items-start gap-1.5 py-0");

const triggerClass = (size: "regular" | "large", className?: string) =>
  cn(
    "inline-flex min-w-40 cursor-default items-center justify-between gap-2 rounded-control bg-fill-2 pr-1.5 pl-2.5 text-body text-label outline-none focus-ring",
    "transition-colors duration-(--dur-fast) hover:bg-fill data-[popup-open]:bg-fill",
    "aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-red aria-[invalid=true]:ring-inset",
    "data-[disabled]:pointer-events-none data-[disabled]:text-label-3",
    size === "large" ? "h-(--control-h-lg)" : "h-(--control-h)",
    className,
  );

const chevron = (
  <ChevronsUpDown aria-hidden="true" className="size-(--icon) shrink-0 text-label-2" />
);

const checkmark = <Check aria-hidden="true" className="mt-1 size-(--icon) text-label" />;

/**
 * A pop-up button: one choice from a list, with the up-and-down chevrons. The open list places
 * the chosen item over the button, as on macOS. Long lists get a search field.
 */
export function Select({
  options,
  value,
  onValueChange,
  placeholder = "Choose",
  searchable = "auto",
  searchPlaceholder = "Search",
  emptyText = "No Results",
  size = "regular",
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const control = useFieldControl({ id, disabled });
  const selected = options.find((o) => o.value === value);
  const isSearchable = searchable === "auto" ? options.length > AUTO_SEARCH_THRESHOLD : searchable;

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
          <Combobox.Positioner
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-(--z-popover)"
          >
            <Combobox.Popup
              aria-label={ariaLabel ?? placeholder}
              className={cn(
                popupSurface,
                menuPad,
                "w-(--anchor-width) max-w-(--available-width) min-w-60",
              )}
            >
              <div className="mb-1 flex h-(--control-h) items-center gap-2 rounded-item border field-focus border-transparent bg-fill-3 px-2">
                <Search aria-hidden="true" className="size-(--icon) shrink-0 text-label-2" />
                <Combobox.Input
                  placeholder={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-body text-label outline-none"
                />
              </div>
              <Combobox.Empty className="px-2 py-4 text-center text-body text-label-2 empty:hidden">
                {emptyText}
              </Combobox.Empty>
              <Combobox.List className="max-h-72 overflow-y-auto overscroll-contain outline-none">
                {(option: SelectOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    disabled={option.disabled}
                    className={itemClass}
                  >
                    <Combobox.ItemIndicator>{checkmark}</Combobox.ItemIndicator>
                    <span className="col-start-2">
                      <OptionBody option={option} text={<span>{option.label}</span>} />
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
        <BaseSelect.Positioner sideOffset={4} collisionPadding={8} className="z-(--z-popover)">
          <BaseSelect.Popup
            className={cn(
              popupSurface,
              menuPad,
              "max-w-(--available-width) min-w-(--anchor-width)",
            )}
          >
            <BaseSelect.List className="max-h-80 overflow-y-auto overscroll-contain outline-none">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  className={itemClass}
                >
                  <BaseSelect.ItemIndicator>{checkmark}</BaseSelect.ItemIndicator>
                  <span className="col-start-2">
                    <OptionBody
                      option={option}
                      text={<BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>}
                    />
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
