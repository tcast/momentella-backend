/**
 * Niche-specific intake form schemas. Each travel sub-segment we serve
 * has its own focused intake — the questions families need to answer
 * are different from the questions babymoon couples or destination-
 * wedding planners need to answer.
 *
 * Forms are seeded into the database via seed-niche-forms.ts and
 * referenced by slug from the matching niche landing page. Admins can
 * fully edit any form via /admin/intake.
 */

import {
  FORM_SCHEMA_VERSION,
  type FormField,
  type IntakeFormSchema,
} from "./intake-schema.js";

// ─── Shared field builders ──────────────────────────────────────────────

function contactFields(): FormField[] {
  return [
    {
      id: "sec_contact",
      type: "section",
      label: "Contact",
      description: "How we reach you",
    },
    { id: "contact_name", type: "text", label: "Full name", required: true },
    { id: "contact_email", type: "email", label: "Email", required: true },
    {
      id: "contact_phone",
      type: "tel",
      label: "Phone",
      description: "Include country code if outside the US",
    },
  ];
}

function destinationField(label = "Destinations or regions of interest"): FormField {
  return {
    id: "destinations",
    type: "destination",
    label,
    description:
      "Start typing a country, city, park, or region — add as many as you like.",
    allowMultiple: true,
  };
}

function homeAirportField(): FormField {
  return {
    id: "home_airport",
    type: "airport",
    label: "Home airport",
    description: "Type a city, airport name, or 3-letter code (e.g. DTW).",
  };
}

function dateFields(): FormField[] {
  return [
    {
      id: "date_flex",
      type: "select",
      label: "Timing",
      required: true,
      options: [
        { value: "fixed", label: "We have specific dates" },
        { value: "month", label: "We have a month / season in mind" },
        { value: "flexible", label: "Fully flexible" },
      ],
    },
    { id: "date_start", type: "date", label: "Earliest departure" },
    { id: "date_end", type: "date", label: "Latest return" },
    {
      id: "trip_length",
      type: "select",
      label: "Approximate trip length",
      options: [
        { value: "long_weekend", label: "Long weekend (3–4 nights)" },
        { value: "1w", label: "About 1 week" },
        { value: "1_2w", label: "1–2 weeks" },
        { value: "2w_plus", label: "2+ weeks" },
      ],
    },
  ];
}

function budgetField(label = "Budget range (total, excluding flights if unsure)"): FormField {
  return {
    id: "budget",
    type: "select",
    label,
    options: [
      { value: "under_5k", label: "Under $5k" },
      { value: "5_10k", label: "$5k – $10k" },
      { value: "10_25k", label: "$10k – $25k" },
      { value: "25_50k", label: "$25k – $50k" },
      { value: "50k_plus", label: "$50k+" },
      { value: "unsure", label: "Prefer to discuss" },
    ],
  };
}

function notesField(label = "Anything else we should know"): FormField {
  return { id: "notes", type: "textarea", label };
}

function referralField(): FormField {
  return {
    id: "referral",
    type: "select",
    label: "How did you hear about Momentella?",
    options: [
      { value: "referral", label: "Referral" },
      { value: "instagram", label: "Instagram" },
      { value: "search", label: "Search" },
      { value: "ads", label: "An ad" },
      { value: "other", label: "Other" },
    ],
  };
}

// ─── Niche schemas ──────────────────────────────────────────────────────

export function multigenerationalIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_party", type: "section", label: "Who's coming" },
      {
        id: "travel_party",
        type: "travel_party",
        label: "Total travelers",
        required: true,
        minAdults: 2,
        maxAdults: 30,
        maxChildren: 30,
        collectChildAges: true,
        description:
          "Include all generations — grandparents, parents, kids, partners.",
      },
      {
        id: "generations",
        type: "multiselect",
        label: "Generations traveling together",
        options: [
          { value: "grandparents", label: "Grandparents" },
          { value: "parents", label: "Parents" },
          { value: "young_kids", label: "Young kids (under 7)" },
          { value: "tweens_teens", label: "Tweens / teens" },
          { value: "adult_kids", label: "Adult children" },
        ],
      },
      {
        id: "mobility_notes",
        type: "textarea",
        label: "Mobility, accessibility, or medical considerations",
        description:
          "Walkers, wheelchairs, dietary, medications that need refrigeration, etc.",
      },
      {
        id: "lodging_pref",
        type: "select",
        label: "Lodging preference",
        options: [
          { value: "one_villa", label: "One villa, everyone under one roof" },
          { value: "hotel_block", label: "Hotel rooms close together" },
          { value: "mixed", label: "Mix — some together, some separate" },
          { value: "unsure", label: "Open to your suggestion" },
        ],
      },
      { id: "sec_trip", type: "section", label: "Trip vision" },
      destinationField(),
      homeAirportField(),
      ...dateFields(),
      budgetField(),
      {
        id: "celebration",
        type: "text",
        label: "Is this around a milestone?",
        placeholder: "Big birthday, anniversary, retirement, family reunion…",
      },
      notesField(),
      referralField(),
    ],
  };
}

export function couplesIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_party", type: "section", label: "About the trip" },
      {
        id: "celebration",
        type: "text",
        label: "Special occasion?",
        placeholder: "Just because, anniversary, birthday, reset weekend…",
      },
      {
        id: "vibe",
        type: "multiselect",
        label: "What kind of trip are you craving?",
        options: [
          { value: "city", label: "City + culture" },
          { value: "beach", label: "Beach + sun" },
          { value: "wine", label: "Food + wine" },
          { value: "nature", label: "Nature + landscapes" },
          { value: "adventure", label: "Soft adventure" },
          { value: "spa", label: "Wellness + spa" },
          { value: "buzz", label: "Lively + nightlife" },
          { value: "quiet", label: "Quiet + remote" },
        ],
      },
      destinationField(),
      homeAirportField(),
      ...dateFields(),
      budgetField(),
      {
        id: "lodging",
        type: "select",
        label: "Lodging style",
        options: [
          { value: "boutique", label: "Boutique hotels" },
          { value: "luxury", label: "Luxury / 5-star" },
          { value: "villa", label: "Private rental" },
          { value: "mixed", label: "Mix / open to your suggestion" },
        ],
      },
      notesField("Anything else — past trips you loved, things you don't want, etc."),
      referralField(),
    ],
  };
}

export function honeymoonIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_wedding", type: "section", label: "Your wedding" },
      {
        id: "wedding_date",
        type: "date",
        label: "Wedding date",
        description: "So we time the planning around your bandwidth.",
      },
      { id: "sec_trip", type: "section", label: "Your honeymoon" },
      destinationField("Where you're dreaming of going (or open to ideas)"),
      homeAirportField(),
      {
        id: "honeymoon_dates",
        type: "select",
        label: "When are you traveling?",
        required: true,
        options: [
          { value: "right_after", label: "Right after the wedding" },
          { value: "delayed_weeks", label: "A few weeks after" },
          { value: "delayed_months", label: "A few months after / mini-moon now, big trip later" },
          { value: "flexible", label: "Flexible" },
        ],
      },
      { id: "date_start", type: "date", label: "Earliest departure" },
      { id: "date_end", type: "date", label: "Latest return" },
      {
        id: "trip_length",
        type: "select",
        label: "How long?",
        options: [
          { value: "1w", label: "About 1 week" },
          { value: "10_14", label: "10–14 days" },
          { value: "2w_plus", label: "2+ weeks" },
          { value: "multi_stop", label: "Multi-stop / extended" },
        ],
      },
      {
        id: "vibe",
        type: "multiselect",
        label: "Vibe",
        options: [
          { value: "beach", label: "Beach + relax" },
          { value: "city", label: "City + culture" },
          { value: "adventure", label: "Adventure + active" },
          { value: "remote", label: "Remote + quiet" },
          { value: "luxury", label: "All-out luxury" },
          { value: "food", label: "Food + wine focused" },
          { value: "split", label: "Two contrasting halves" },
        ],
      },
      budgetField("Budget range (total, both of you)"),
      {
        id: "past_trips",
        type: "textarea",
        label: "Trips you've taken together that you've loved",
        description: "Helps us avoid suggesting the same vibe twice.",
      },
      notesField("Special touches, dietary needs, anything we should know"),
      referralField(),
    ],
  };
}

export function babymoonIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_pregnancy", type: "section", label: "About the pregnancy" },
      { id: "due_date", type: "date", label: "Due date", required: true },
      {
        id: "trimester_at_travel",
        type: "select",
        label: "Trimester at travel",
        required: true,
        options: [
          { value: "first", label: "First trimester" },
          { value: "second", label: "Second trimester" },
          { value: "third", label: "Third trimester" },
        ],
      },
      {
        id: "doctor_clearance",
        type: "checkbox",
        label: "I've confirmed with my doctor that travel is OK",
        description:
          "We're happy to plan around any restrictions you mention below.",
      },
      {
        id: "pregnancy_notes",
        type: "textarea",
        label: "Anything to plan around",
        description:
          "Energy levels, food restrictions, mobility, what feels comfortable, what doesn't.",
      },
      { id: "sec_trip", type: "section", label: "The trip" },
      destinationField("Destinations you're considering"),
      homeAirportField(),
      ...dateFields(),
      budgetField(),
      {
        id: "vibe",
        type: "select",
        label: "What kind of trip?",
        options: [
          { value: "calm", label: "Calm + restful" },
          { value: "city", label: "Easy-paced city" },
          { value: "beach", label: "Beach / pool focus" },
          { value: "spa", label: "Wellness + spa" },
          { value: "scenic", label: "Scenic drives, gentle outdoors" },
        ],
      },
      notesField(),
      referralField(),
    ],
  };
}

export function destinationWeddingIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_wedding", type: "section", label: "About your wedding" },
      {
        id: "wedding_date",
        type: "date",
        label: "Wedding date (or target window)",
        required: true,
      },
      {
        id: "guest_count",
        type: "number",
        label: "Estimated guest count",
        min: 2,
        max: 500,
      },
      destinationField("Destination (locked or considering)"),
      {
        id: "venue_status",
        type: "select",
        label: "Venue status",
        options: [
          { value: "locked", label: "Venue is locked" },
          { value: "considering", label: "Considering a few" },
          { value: "open", label: "Wide open — need help" },
        ],
      },
      {
        id: "planner_status",
        type: "select",
        label: "Wedding planner",
        options: [
          { value: "have_planner", label: "We have a planner — you'd handle the surrounding weekend" },
          { value: "no_planner", label: "No planner — we want full coordination" },
          { value: "unsure", label: "Not sure yet" },
        ],
      },
      {
        id: "scope",
        type: "multiselect",
        label: "What we'd handle",
        options: [
          { value: "welcome_dinner", label: "Welcome dinner" },
          { value: "guest_logistics", label: "Guest transfers + welcome bags" },
          { value: "stay_play", label: "Pre/post stay-and-play activities" },
          { value: "brunch", label: "Sunday brunch" },
          { value: "ceremony_reception", label: "Ceremony + reception (if no planner)" },
          { value: "your_honeymoon", label: "Our honeymoon afterwards" },
        ],
      },
      budgetField("Surrounding-weekend budget (excluding ceremony / reception)"),
      notesField("Anything we should know — guest dynamics, dietary, family considerations"),
      referralField(),
    ],
  };
}

export function anniversaryIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_milestone", type: "section", label: "The milestone" },
      {
        id: "anniversary_number",
        type: "number",
        label: "Which anniversary?",
        description: "5th, 10th, 25th, 40th — whatever you're marking.",
        min: 1,
        max: 80,
      },
      {
        id: "milestone_significance",
        type: "textarea",
        label: "Why this one matters",
        description:
          "Recovering year? Long-awaited milestone? Just a great excuse? Helps us calibrate the trip.",
      },
      { id: "sec_trip", type: "section", label: "The trip" },
      destinationField(),
      homeAirportField(),
      ...dateFields(),
      budgetField(),
      {
        id: "past_loved",
        type: "textarea",
        label: "Past anniversary trips you've loved",
        description: "What worked, where you went, hotels you'd return to.",
      },
      {
        id: "past_avoided",
        type: "textarea",
        label: "Trips that didn't work",
        description: "Vibes / styles / destinations to skip this time.",
      },
      {
        id: "mark_the_date",
        type: "textarea",
        label: "How (if at all) you want to mark the date",
        description:
          "Quiet dinner with the right view? A small surprise? We can keep it discreet — just want to know.",
      },
      notesField(),
      referralField(),
    ],
  };
}

export function soloTravelIntakeSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      ...contactFields(),
      { id: "sec_solo", type: "section", label: "Solo travel context" },
      {
        id: "solo_experience",
        type: "select",
        label: "Solo travel experience",
        options: [
          { value: "first", label: "First solo trip" },
          { value: "some", label: "A few solo trips" },
          { value: "lots", label: "Solo travel often" },
        ],
      },
      {
        id: "solo_comfort",
        type: "select",
        label: "Comfort eating dinner alone in public",
        options: [
          { value: "love_it", label: "Love it" },
          { value: "fine", label: "Fine, especially with a book" },
          { value: "prefer_avoid", label: "Prefer to avoid — counter seats / room service ok" },
        ],
      },
      {
        id: "solo_concerns",
        type: "textarea",
        label: "Concerns or things you'd like us to plan around",
        description:
          "Safety, language, dietary, accessibility, social needs — say anything.",
      },
      {
        id: "structure_pref",
        type: "select",
        label: "How structured do you want days?",
        options: [
          { value: "tight", label: "Most days planned" },
          { value: "balanced", label: "Mix of planned + free" },
          { value: "loose", label: "Mostly free, just bookings I'd struggle to get" },
        ],
      },
      { id: "sec_trip", type: "section", label: "The trip" },
      destinationField(),
      homeAirportField(),
      ...dateFields(),
      budgetField(),
      {
        id: "emergency_contact",
        type: "tel",
        label: "Emergency contact phone (optional)",
        description:
          "We never share, but it helps us reach someone if you're unreachable on a travel day.",
      },
      notesField(),
      referralField(),
    ],
  };
}

// ─── Registry ───────────────────────────────────────────────────────────

export interface NicheFormDef {
  slug: string;
  name: string;
  description: string;
  schema: () => IntakeFormSchema;
}

export const NICHE_FORMS: NicheFormDef[] = [
  {
    slug: "multigenerational-intake",
    name: "Multigenerational trip intake",
    description: "Intake form for multigenerational / family-reunion trips.",
    schema: multigenerationalIntakeSchema,
  },
  {
    slug: "couples-intake",
    name: "Couples trip intake",
    description: "Intake form for couples trips and romantic getaways.",
    schema: couplesIntakeSchema,
  },
  {
    slug: "honeymoon-intake",
    name: "Honeymoon intake",
    description: "Intake form for honeymoon trips.",
    schema: honeymoonIntakeSchema,
  },
  {
    slug: "babymoon-intake",
    name: "Babymoon intake",
    description: "Intake form for babymoons / pre-baby couples trips.",
    schema: babymoonIntakeSchema,
  },
  {
    slug: "destination-wedding-intake",
    name: "Destination wedding intake",
    description: "Intake form for destination wedding planning.",
    schema: destinationWeddingIntakeSchema,
  },
  {
    slug: "anniversary-intake",
    name: "Anniversary trip intake",
    description: "Intake form for milestone anniversary trips.",
    schema: anniversaryIntakeSchema,
  },
  {
    slug: "solo-travel-intake",
    name: "Solo travel intake",
    description: "Intake form for solo travelers.",
    schema: soloTravelIntakeSchema,
  },
];
