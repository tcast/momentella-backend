/** Editable site nav config — stored as JSON in `SiteNavConfig.config`. */

export const SITE_NAV_VERSION = 1 as const;

export interface NavLink {
  kind: "link";
  id: string;
  label: string;
  href: string;
}

export interface NavDropdownChild {
  id: string;
  label: string;
  href: string;
  description?: string;
}

export interface NavDropdown {
  kind: "dropdown";
  id: string;
  label: string;
  children: NavDropdownChild[];
}

export type NavItem = NavLink | NavDropdown;

export interface NavCta {
  label: string;
  href: string;
}

export interface SiteNavConfig {
  version: typeof SITE_NAV_VERSION;
  items: NavItem[];
  /** Right-side primary button (e.g. "Plan a trip"). */
  cta: NavCta;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Strict-but-forgiving parser. Returns null if the shape is invalid;
 * callers fall back to `defaultSiteNavConfig()`.
 */
export function parseSiteNavConfig(raw: unknown): SiteNavConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SITE_NAV_VERSION) return null;
  const items = Array.isArray(o.items) ? o.items : null;
  const cta = o.cta && typeof o.cta === "object" ? (o.cta as Record<string, unknown>) : null;
  if (!items || !cta) return null;
  if (!isNonEmptyString(cta.label) || !isNonEmptyString(cta.href)) return null;

  const parsed: NavItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") return null;
    const obj = it as Record<string, unknown>;
    if (obj.kind === "link") {
      if (
        !isNonEmptyString(obj.id) ||
        !isNonEmptyString(obj.label) ||
        !isNonEmptyString(obj.href)
      )
        return null;
      parsed.push({
        kind: "link",
        id: obj.id,
        label: obj.label.trim(),
        href: obj.href.trim(),
      });
    } else if (obj.kind === "dropdown") {
      if (!isNonEmptyString(obj.id) || !isNonEmptyString(obj.label)) return null;
      const childArr = Array.isArray(obj.children) ? obj.children : [];
      const children: NavDropdownChild[] = [];
      for (const c of childArr) {
        if (!c || typeof c !== "object") return null;
        const co = c as Record<string, unknown>;
        if (
          !isNonEmptyString(co.id) ||
          !isNonEmptyString(co.label) ||
          !isNonEmptyString(co.href)
        )
          return null;
        const child: NavDropdownChild = {
          id: co.id,
          label: co.label.trim(),
          href: co.href.trim(),
        };
        if (typeof co.description === "string" && co.description.trim()) {
          child.description = co.description.trim();
        }
        children.push(child);
      }
      parsed.push({
        kind: "dropdown",
        id: obj.id,
        label: obj.label.trim(),
        children,
      });
    } else {
      return null;
    }
  }

  return {
    version: SITE_NAV_VERSION,
    items: parsed,
    cta: { label: cta.label.trim(), href: cta.href.trim() },
  };
}

function uid(prefix = "n"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Initial seed — mirrors the previously-hardcoded SiteHeader so visitors
 * see no change on first deploy. Admin can reorder, rename, add, or
 * delete anything from `/admin/navigation`.
 */
export function defaultSiteNavConfig(): SiteNavConfig {
  return {
    version: SITE_NAV_VERSION,
    items: [
      { kind: "link", id: uid(), label: "Approach", href: "/#approach" },
      { kind: "link", id: uid(), label: "Journeys", href: "/#journeys" },
      {
        kind: "dropdown",
        id: uid(),
        label: "Services",
        children: [
          {
            id: uid("c"),
            label: "Itinerary planning",
            href: "/services",
            description:
              "1, 2, or 3-day plans designed by a real travel designer.",
          },
          {
            id: uid("c"),
            label: "Trip booking",
            href: "/trip-booking",
            description: "We plan, book, and run the whole trip end-to-end.",
          },
          {
            id: uid("c"),
            label: "Gift certificates",
            href: "/gift-certificates",
            description: "Gift a planned vacation day to someone you love.",
          },
        ],
      },
      { kind: "link", id: uid(), label: "How we plan", href: "/#process" },
    ],
    cta: { label: "Plan a trip", href: "/connect" },
  };
}
