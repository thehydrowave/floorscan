/**
 * cctp-templates.ts
 *
 * DTU template database for the CCTP module.
 * Maps each DPGF line item to its DTU reference and prescriptive text key.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CctpItemTemplate {
  /** Key referencing the DPGF line description (dpgf_depose, dpgf_ba13, …) */
  dpgf_key: string;
  /** i18n key for the item title (same as dpgf description key) */
  title_key: string;
  /** DTU / norm reference (stays in French for all languages) */
  dtu_ref: string;
  /** i18n key for the prescriptive text paragraph */
  template_key: string;
}

export interface CctpLotTemplate {
  lot_number: number;
  /** i18n key for the lot introduction paragraph */
  intro_key: string;
  /** Items in this lot */
  items: CctpItemTemplate[];
}

// ── Templates ─────────────────────────────────────────────────────────────────

export const CCTP_TEMPLATES: CctpLotTemplate[] = [
  // LOT 1 — Démolition / Préparation
  {
    lot_number: 1,
    intro_key: "cctp_lot1_intro",
    items: [
      {
        dpgf_key: "dpgf_depose",
        title_key: "dpgf_depose",
        dtu_ref: "Règles de l'art",
        template_key: "cctp_depose_text",
      },
      {
        dpgf_key: "dpgf_gravats",
        title_key: "dpgf_gravats",
        dtu_ref: "Réglementation déchets",
        template_key: "cctp_gravats_text",
      },
    ],
  },

  // LOT 2 — Cloisons / Plâtrerie
  {
    lot_number: 2,
    intro_key: "cctp_lot2_intro",
    items: [
      {
        dpgf_key: "dpgf_ba13",
        title_key: "dpgf_ba13",
        dtu_ref: "DTU 25.41",
        template_key: "cctp_ba13_text",
      },
      {
        dpgf_key: "dpgf_enduit",
        title_key: "dpgf_enduit",
        dtu_ref: "DTU 25.41",
        template_key: "cctp_enduit_text",
      },
    ],
  },

  // LOT 3 — Menuiseries intérieures
  {
    lot_number: 3,
    intro_key: "cctp_lot3_intro",
    items: [
      {
        dpgf_key: "dpgf_bloc_porte",
        title_key: "dpgf_bloc_porte",
        dtu_ref: "DTU 36.1",
        template_key: "cctp_bloc_porte_text",
      },
    ],
  },

  // LOT 4 — Menuiseries extérieures
  {
    lot_number: 4,
    intro_key: "cctp_lot4_intro",
    items: [
      {
        dpgf_key: "dpgf_fenetre",
        title_key: "dpgf_fenetre",
        dtu_ref: "DTU 36.1 / DTU 37.1",
        template_key: "cctp_fenetre_text",
      },
    ],
  },

  // LOT 5 — Revêtement de sol
  {
    lot_number: 5,
    intro_key: "cctp_lot5_intro",
    items: [
      {
        dpgf_key: "dpgf_parquet_ch",
        title_key: "dpgf_parquet_ch",
        dtu_ref: "DTU 51.11",
        template_key: "cctp_parquet_text",
      },
      {
        dpgf_key: "dpgf_carrelage",
        title_key: "dpgf_carrelage",
        dtu_ref: "DTU 52.1",
        template_key: "cctp_carrelage_text",
      },
      {
        dpgf_key: "dpgf_sol_souple",
        title_key: "dpgf_sol_souple",
        dtu_ref: "DTU 53.2",
        template_key: "cctp_sol_souple_text",
      },
      {
        dpgf_key: "dpgf_ragerage",
        title_key: "dpgf_ragerage",
        dtu_ref: "DTU 26.2",
        template_key: "cctp_ragerage_text",
      },
    ],
  },

  // LOT 6 — Peinture / Finitions
  {
    lot_number: 6,
    intro_key: "cctp_lot6_intro",
    items: [
      {
        dpgf_key: "dpgf_peint_mur",
        title_key: "dpgf_peint_mur",
        dtu_ref: "DTU 59.1",
        template_key: "cctp_peinture_text",
      },
    ],
  },

  // LOT 7 — Électricité
  {
    lot_number: 7,
    intro_key: "cctp_lot7_intro",
    items: [
      {
        dpgf_key: "dpgf_prises",
        title_key: "dpgf_prises",
        dtu_ref: "NF C 15-100",
        template_key: "cctp_elec_text",
      },
    ],
  },

  // LOT 8 — Plomberie
  {
    lot_number: 8,
    intro_key: "cctp_lot8_intro",
    items: [
      {
        dpgf_key: "dpgf_sdb",
        title_key: "dpgf_sdb",
        dtu_ref: "DTU 60.1 / DTU 60.11",
        template_key: "cctp_plomberie_text",
      },
    ],
  },

  // LOT 9 — Plinthes
  {
    lot_number: 9,
    intro_key: "cctp_lot9_intro",
    items: [
      {
        dpgf_key: "dpgf_plinthes",
        title_key: "dpgf_plinthes",
        dtu_ref: "Règles de l'art",
        template_key: "cctp_plinthes_text",
      },
    ],
  },
];
