/**
 * Editable site footer — stored as JSON in `SiteFooterConfig.config`.
 *
 * Mirrors `site-nav-schema.ts`: a strict-but-forgiving parser, a
 * `defaultSiteFooterConfig()` that matches the previously-hardcoded
 * SiteFooter so first deploys show no visual change, and a versioned
 * shape so we can evolve it later.
 */

export const SITE_FOOTER_VERSION = 1 as const;

export interface FooterLink {
  id: string;
  label: string;
  href: string;
}

export interface FooterColumn {
  id: string;
  title: string;
  links: FooterLink[];
}

export interface FooterSocial {
  id: string;
  label: string;
  href: string;
}

export interface SiteFooterConfig {
  version: typeof SITE_FOOTER_VERSION;
  /** Big display line, top-left of the footer (e.g. "Ready when you are."). */
  tagline: string;
  /** Supporting paragraph under the tagline. */
  body: string;
  /** Primary contact email — surfaces as `hello@…` link in the footer. */
  contactEmail: string;
  /** Social links rendered under the email. Order matters. */
  socials: FooterSocial[];
  /** Right-side link columns. Order = visual order left-to-right. */
  columns: FooterColumn[];
  /**
   * Small text rendered under the last column (often a tagline-y
   * descriptor like "Boutique family travel design"). Multiline allowed —
   * `\n` becomes a `<br />`.
   */
  bottomNote: string;
  /**
   * Optional copyright suffix; the year is appended automatically
   * at render time. e.g. "Momentella. All rights reserved."
   */
  copyright: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function uid(prefix = "f"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Strict-but-forgiving parser. Returns null if the shape is invalid;
 * callers should fall back to `defaultSiteFooterConfig()`.
 */
export function parseSiteFooterConfig(
  raw: unknown,
): SiteFooterConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SITE_FOOTER_VERSION) return null;

  if (!isNonEmptyString(o.tagline)) return null;
  const body = typeof o.body === "string" ? o.body : "";
  if (!isNonEmptyString(o.contactEmail)) return null;
  const bottomNote = typeof o.bottomNote === "string" ? o.bottomNote : "";
  const copyright = typeof o.copyright === "string" ? o.copyright : "";

  const socialsRaw = Array.isArray(o.socials) ? o.socials : [];
  const socials: FooterSocial[] = [];
  for (const s of socialsRaw) {
    if (!s || typeof s !== "object") return null;
    const so = s as Record<string, unknown>;
    if (
      !isNonEmptyString(so.id) ||
      !isNonEmptyString(so.label) ||
      !isNonEmptyString(so.href)
    )
      return null;
    socials.push({
      id: so.id,
      label: so.label.trim(),
      href: so.href.trim(),
    });
  }

  const columnsRaw = Array.isArray(o.columns) ? o.columns : [];
  const columns: FooterColumn[] = [];
  for (const c of columnsRaw) {
    if (!c || typeof c !== "object") return null;
    const co = c as Record<string, unknown>;
    if (!isNonEmptyString(co.id) || !isNonEmptyString(co.title)) return null;
    const linksRaw = Array.isArray(co.links) ? co.links : [];
    const links: FooterLink[] = [];
    for (const l of linksRaw) {
      if (!l || typeof l !== "object") return null;
      const lo = l as Record<string, unknown>;
      if (
        !isNonEmptyString(lo.id) ||
        !isNonEmptyString(lo.label) ||
        !isNonEmptyString(lo.href)
      )
        return null;
      links.push({
        id: lo.id,
        label: lo.label.trim(),
        href: lo.href.trim(),
      });
    }
    columns.push({ id: co.id, title: co.title.trim(), links });
  }

  return {
    version: SITE_FOOTER_VERSION,
    tagline: o.tagline.trim(),
    body: body.trim(),
    contactEmail: o.contactEmail.trim(),
    socials,
    columns,
    bottomNote: bottomNote.trim(),
    copyright: copyright.trim(),
  };
}

/**
 * Initial seed — mirrors the previously-hardcoded SiteFooter so visitors
 * see no change on first deploy. Admin can reorder, rename, or edit
 * everything from `/admin/footer`.
 */
export function defaultSiteFooterConfig(): SiteFooterConfig {
  return {
    version: SITE_FOOTER_VERSION,
    tagline: "Ready when you are.",
    body:
      "Tell us the ages of your travelers, the pace you love, and the feeling you want when you unpack. We'll take it from there.",
    contactEmail: "hello@momentella.travel",
    socials: [
      {
        id: uid("s"),
        label: "Instagram — @momentella.travel",
        href: "https://www.instagram.com/momentella.travel/",
      },
    ],
    columns: [
      {
        id: uid("col"),
        title: "Trip types",
        links: [
          { id: uid("l"), label: "Family vacations", href: "/family-vacations" },
          { id: uid("l"), label: "Multigenerational trips", href: "/multigenerational-trips" },
          { id: uid("l"), label: "Couples trips", href: "/couples-trips" },
          { id: uid("l"), label: "Honeymoons", href: "/honeymoons" },
          { id: uid("l"), label: "Babymoons", href: "/babymoons" },
          { id: uid("l"), label: "Destination weddings", href: "/destination-weddings" },
          { id: uid("l"), label: "Anniversary trips", href: "/anniversary-trips" },
          { id: uid("l"), label: "Solo travel", href: "/solo-travel" },
        ],
      },
      {
        id: uid("col"),
        title: "Services",
        links: [
          { id: uid("l"), label: "Itinerary planning", href: "/services" },
          { id: uid("l"), label: "Trip booking", href: "/trip-booking" },
          { id: uid("l"), label: "Gift certificates", href: "/gift-certificates" },
          { id: uid("l"), label: "Journal", href: "/journal" },
        ],
      },
    ],
    bottomNote: "Boutique family travel design\nBased wherever you roam",
    copyright: "Momentella. All rights reserved.",
  };
}
