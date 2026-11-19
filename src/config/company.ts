/** The company running this ERP. GST state code decides intra-state (CGST+SGST) vs inter-state (IGST). */
export const COMPANY = {
  name: "Biios Automation Labs",
  /** Maharashtra. */
  stateCode: process.env.NEXT_PUBLIC_COMPANY_STATE_CODE ?? "27",
};

export const GST_RATES = [0, 5, 12, 18, 28] as const;
