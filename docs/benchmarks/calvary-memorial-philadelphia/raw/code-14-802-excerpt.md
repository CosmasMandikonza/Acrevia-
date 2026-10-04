# Raw evidence — The Philadelphia Code § 14-802 (Motor Vehicle Parking Ratios)

Source (live pages): 
- § 14-802 section head: https://codelibrary.amlegal.com/codes/philadelphia/latest/philadelphia_pa/0-0-0-293733
- § 14-802(2) "Required Parking in Residential Districts" (Table 14-802-1): https://codelibrary.amlegal.com/codes/philadelphia/latest/philadelphia_pa/0-0-0-293741

Publisher: City of Philadelphia, codified by American Legal Publishing
Retrieved: 2026-10-04T04:21:00Z (initial capture); re-verified 2026-10-04T12:11:00Z during PR review after a reviewer challenge to a neighboring-cell value. Captured via a rendering fetcher (plain HTTP clients receive HTTP 403 / Cloudflare challenge).

Host disclaimer: as in code-14-548-excerpt.md ("may not reflect the most recent legislation...").

## Verbatim table text (Table 14-802-1, "(2) Required Parking in Residential Districts")

The table's column groups, left to right:

1. "RSD / RSA-1 / RSA-2 / RSA-3 / RTA-1 / RMX-1"
2. "RSA-4 / RSA-5 / RSA-6 / RTA-2 / RM-1"
3. "RM-2 / RM-3 / RM-4 / RM-5 / RMX-2 / RMX-3 / CMX-1 / CMX-2"
4. "CMX-2.5 / CMX-3 / CMX-4 / CMX-5"
5. "CA-1 / CA-2"
6. "IRMX / ICMX / I-1 / I-2 / I-3 / SP-INS / SP-CIV / SP-ENT / SP-STA / SP-AIR / SP-PO"

Key rows (values per column group, in group order):

> Single-Family — 1 | 0 | 0 | ...
> Two-Family — 1 | 0 | 0 | ...
> Multi-Family — 1 | 0 | 3/10 units | ...
> Religious Assembly — "1/10 seats or 1/1,000 sq. ft., whichever is greater" (same in all residential-district columns)
> Libraries and Cultural Exhibits — "1/1,000 sq. ft."
> Educational Facilities — "1/10 classroom seats or 1/1,000 sq. ft. of floor area, whichever is greater"

**The load-bearing value for this benchmark:** in column group 2 (RSA-4/5/6, RTA-2, **RM-1**),
Multi-Family requires **0** parking spaces. This was re-verified live during PR review.

Table note 879 (amendment history, verbatim):

> "Amended, Bill No. 210075 (approved March 29, 2021); Bill No. 210078-A (approved April 28, 2021); Bill No. 250525 (approved June 13, 2025)."

Related provisions rendered on the section pages (verbatim excerpts):

> § 14-801(2)(b)(.2): "...parking required by this Title for the pre-existing use, provided the structure was built before the effective date of this Title (August 22, 2012)..." [change-of-use context]
>
> § 14-801(2)(f): "...historic structures..." [exemption context]

## Correction log

The initial version of this excerpt (written 2026-10-04T04:21Z) recorded the first column
group's Multi-Family value as "2 spaces/unit". A PR-review challenge prompted live
re-verification of node 0-0-0-293741 on 2026-10-04T12:11Z, which shows the correct
neighboring-cell values: Multi-Family = 1 (group 1), 0 (group 2 / RM-1), 3/10 units
(group 3). The RM-1 conclusion (0 spaces) was never in question; the neighboring-cell
error is corrected here because this file is cached evidence and must be accurate even
in cells that do not drive the benchmark's conclusion.
