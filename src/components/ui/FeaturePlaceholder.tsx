import type { ComponentType, ReactNode, SVGProps } from "react";
import { useId } from "react";

/**
 * FeaturePlaceholder
 * ------------------
 * Drop-in body for any editor panel (Stickers, Effects, Filters, Transitions,
 * Captions...) whose real functionality isn't ready yet.
 *
 * Theming: every colour reads a CSS variable first and falls back to the warm
 * palette from the current panel, so you can wire it to your tokens later
 * without touching this file. Suggested names:
 *   --panel-surface   tile / card background
 *   --panel-border    hairlines and dashed outlines
 *   --panel-text      primary text
 *   --panel-muted     secondary text
 *   --panel-accent    orange accent
 */

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export type FeatureStatus = "planned" | "in-progress" | "beta";

const STATUS_LABEL: Record<FeatureStatus, string> = {
  planned: "Planned",
  "in-progress": "In development",
  beta: "Almost ready",
};

export interface FeaturePlaceholderProps {
  /** Lucide icon component (or any SVG component), e.g. `Smile`. */
  icon: IconType;
  /** What the user will be able to do, e.g. "Stickers are on the way". */
  title: string;
  /** One or two plain sentences. */
  description: string;
  /** Short bullets of what's coming. Keep to 3-4. */
  planned?: string[];
  status?: FeatureStatus;
  /**
   * Optional action. Use onClick (not href) so you can route through Tauri's
   * opener plugin, e.g. open the GitHub roadmap or issue tracker.
   */
  action?: { label: string; onClick: () => void };
  /** Faint outline of the future layout behind the message. */
  ghost?: "grid" | "list" | "none";
  /** Extra content under the message, e.g. a version note. */
  footer?: ReactNode;
  className?: string;
}

export function FeaturePlaceholder({
  icon: Icon,
  title,
  description,
  planned,
  status = "in-progress",
  action,
  ghost = "grid",
  footer,
  className = "",
}: FeaturePlaceholderProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={`relative isolate flex h-full min-h-[320px] w-full flex-col items-center justify-center overflow-hidden px-6 py-10 text-center ${className}`}
    >
      {ghost !== "none" && <GhostLayout kind={ghost} />}

      <div className="flex max-w-[280px] flex-col items-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[var(--panel-border,#43362e)] bg-[var(--panel-surface,#2b231e)] text-[var(--panel-accent,#d99a5b)] shadow-[0_0_0_6px_rgba(217,154,91,0.06)]">
          <Icon width={26} height={26} aria-hidden="true" />
        </div>

        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--panel-border,#43362e)] px-2.5 py-0.5 text-xs text-[var(--panel-muted,#a0907f)]">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-[var(--panel-accent,#d99a5b)]"
          />
          {STATUS_LABEL[status]}
        </span>

        <h3
          id={headingId}
          className="text-base font-semibold text-[var(--panel-text,#f1e7dc)]"
        >
          {title}
        </h3>

        <p className="mt-1.5 text-sm leading-relaxed text-[var(--panel-muted,#a0907f)]">
          {description}
        </p>

        {planned && planned.length > 0 && (
          <ul className="mt-5 w-full space-y-1.5 text-left text-sm text-[var(--panel-text,#f1e7dc)]/85">
            {planned.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--panel-accent,#d99a5b)]"
                />
                {item}
              </li>
            ))}
          </ul>
        )}

        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-6 rounded-lg border border-[var(--panel-border,#43362e)] bg-[var(--panel-surface,#2b231e)] px-3.5 py-1.5 text-sm text-[var(--panel-text,#f1e7dc)] transition-colors hover:border-[var(--panel-accent,#d99a5b)] hover:text-[var(--panel-accent,#d99a5b)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--panel-accent,#d99a5b)] cursor-pointer"
          >
            {action.label}
          </button>
        )}

        {footer && (
          <div className="mt-4 text-xs text-[var(--panel-muted,#a0907f)]">{footer}</div>
        )}
      </div>
    </section>
  );
}

/** Dashed outlines that hint at the layout the real panel will have. */
function GhostLayout({ kind }: { kind: "grid" | "list" }) {
  const tiles = kind === "grid" ? 9 : 5;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 p-4 opacity-40 [mask-image:radial-gradient(ellipse_at_center,transparent_30%,black_85%)] ${
        kind === "grid" ? "grid grid-cols-3 gap-3" : "flex flex-col gap-3"
      }`}
    >
      {Array.from({ length: tiles }).map((_, i) => (
        <div
          key={i}
          className={`rounded-xl border border-dashed border-[var(--panel-border,#43362e)] ${
            kind === "grid" ? "aspect-square" : "h-14"
          }`}
        />
      ))}
    </div>
  );
}

export default FeaturePlaceholder;
