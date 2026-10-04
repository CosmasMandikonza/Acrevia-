# Raw evidence — Philadelphia Zoning Code Base Districts Quick Guide (February 2026), RM-1 excerpts

Source: https://www.phila.gov/media/20260213170558/ZONING-QUICK-GUIDE_feb-2026.pdf
Publisher: Philadelphia City Planning Commission. Document page: https://www.phila.gov/documents/zoning-code-information-manual-quick-guide/
Retrieved: 2026-10-04T03:55:00Z (downloaded with a browser-identified client; direct anonymous download was blocked with HTTP 403 by CloudFront).

Extraction method: `pdftotext -layout` plus a rendered-image cell-level read (pypdfium2 render → vision read) for rows where layout extraction was ambiguous. The row-to-value mapping recorded below is the one confirmed by the image read.

## Disclaimer (guide, "Using this guide")

> "The Philadelphia Zoning Code Quick Reference Manual is intended as a general guide to users of Title 14 of The Philadelphia Code (the Zoning Code). It is not a substitute for any adopted ordinances or codes. The Philadelphia Zoning Code Quick Reference Manual provides additional details on use and dimensional standards. If these guides conflict with any adopted ordinance or code, including the Zoning Code, the latter shall govern."

## Guide disclaimer regarding information currency

The City's separate Zoning Summary Generator tool (li.phila.gov/zoningsummary) exposes current
parcel/zoning information but notes that explanatory text may lag the latest code; it cannot alone
certify the current legal rule. The same caution is applied to this guide.

## Table 14-701-2 — Dimensional Standards for Higher Density Residential Districts (RM-1 column)

| Row | RM-1 value |
| --- | --- |
| Min. Lot Width | 16 ft. |
| Min. Lot Area | 1,440 sq. ft. [1] |
| Max. Occupied Area | Intermediate 75%; Corner 80% [2] |
| Min. Front Setback | Based on adjacent [5,6] |
| * Min. Side Yard Width [8] | 5' to 12' based on number of families (see diagram) |
| Min. Rear Yard Depth | 9 ft. [9] |
| Max. Height / FAR | 38 ft. [5] * |
| Dwelling Unit Density | min 360 sq. ft. lot area per unit for the first 1,440 sq. ft.; min 480 sq. ft. per unit above that |

Table notes (RM-1-relevant, verbatim from guide pp. 16, 48):

> "[1] In the RM-1 district, a lot containing at least 1,920 sq. ft. of land may be divided into lots with a minimum lot size of 960 sq. ft., provided that: a. At least seventy-five percent (75%) of lots adjacent to the lot to be divided are 1,000 sq. ft. or less; and b. Each of the lots created meets the minimum lot width requirement of the zoning district."

> "[1] [density, p.48] In the RM-1 district, the minimum lot area required per dwelling unit is as follows, provided that, whenever the calculation of permitted number of dwelling units results in a fraction of a dwelling unit, then the number of permitted dwelling units shall be rounded down to the nearest whole number: a. A minimum 360 sq. ft. of lot area is required per dwelling unit for the first 1,440 sq. ft. of lot area. b. A minimum of 480 sq. ft. of lot area is required per dwelling unit for the lot area in excess of 1,440 sq. ft."

> "[2] In the RM-1 district, buildings on lots less than 45 ft. in depth are exempt from the maximum occupied area requirement."

> "[5] If abutting lots on both sides of an attached building contain only two stories of enclosed area, stories above the second story of the attached house shall be set back an additional eight ft. from the minimum distance between the front facade and the front lot line described in § 14-701(2)(b)[6] below; except this requirement shall not apply to corner lots."

> "[6] In the RM-1 district, front facades shall comply with the following: a. On any given street, the distance between the front facade and the front lot line shall be no greater than the distance between the front facade and the front lot line of the principal building on the immediately adjacent lot on such street with the greater distance between its front facade and its front lot line; and shall be no less than the distance between the front facade and the front lot line of the principal building on the immediately adjacent lot on such street with the lesser distance between its front facade and its front lot line. b. On any given street, if there is no principal building on an immediately adjacent lot, then the distance between the front facade and the front lot line shall match the distance between the front facade on the closest building to the subject property that is on the same blockface. If there is no such building, the minimum distance between the front facade and the front lot line shall be zero."

> "[8] Number of required yards/required width (ft). 'Each' identifies that each yard must meet the required minimum size. Where each yard size is not identified, table identifies total required yard."

> "[9] In the RM-1 district, lots less than 45 ft. in depth shall be exempt from rear yard area requirements but shall provide a minimum rear yard depth of 7 ft."

> "* Required sideyard widths for permitted nonresidential uses can be found in the full zoning code."

## Zoning Bonus Summary (RM-1 page)

> "Mixed Income Housing (§14-702(7)) — Moderate Income: 25% increase in units permitted; Low Income: 50% increase in units permitted."
> "Green Roof (§14-702(16)) — 25% increase in units permitted."
> "For bonus restrictions in select geographic areas, see page 49." (Printed page 49 of the guide contains industrial and special-purpose notes only; no bonus-restriction list was found there — recorded as open question oq-bonus-geo-restrictions.)

## Table 14-602-1 — Uses Allowed in Residential Districts (RM-1 column, key rows)

Read cell-by-cell from the rendered page (values vertically aligned to the RM-1 column):

| Use | RM-1 |
| --- | --- |
| Household Living — Multi-Family | Y[1] |
| Household Living — Single-Family | Y[1] |
| Religious Assembly | S[2], 14-603(5) |
| Child Care Center | Y |
| Family Child Care | S |
| Community Center | Y |
| Educational Facilities | Y, 14-603(5) |
| Fraternal Organization | S[2], 14-603(5) |
| Safety Services | Y |

Legend (verbatim): "Y = Yes permitted as of right / S = Special exception approval required / N = Not allowed (expressly prohibited) / Uses not listed in this table are prohibited"

## Research-integrity note

A research pass had earlier attributed different RM-1 dimensional values (43 du/acre, 1,000 sq ft/unit,
50% coverage, 15/20 ft rear yards, 50 ft lot width) to the adopted code; those values could not be
reproduced from the cited source and conflict with this official guide. They are excluded from the
benchmark (see SELECTION.md).
